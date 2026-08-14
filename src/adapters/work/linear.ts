import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { WorkClaim, WorkItem, WorkPage, WorkQuery, WorkUpdate } from "../../domain/work.js";
import type { WorkProvider } from "../../ports/providers.js";
import type { SecretProvider } from "../../ports/security.js";
import type { FetchClient } from "../model/http-support.js";
import {
  LocalWorkClaims,
  arrayValue,
  booleanValue,
  numberValue,
  objectValue,
  requestJson,
  resolveToken,
  scalarString,
  stringValue,
} from "./http-work-support.js";

export interface LinearWorkProviderOptions {
  token?: string;
  tokenReference?: string;
  secrets?: SecretProvider;
  apiUrl?: string;
  team?: string;
  fetch?: FetchClient;
  repository?: {
    id: string;
    cloneUrl: string;
    owner?: string;
    name?: string;
    defaultBranch?: string;
  };
}

export class LinearWorkProvider implements WorkProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "work" } = {
    id: "linear",
    displayName: "Linear",
    kind: "work",
    version: "1.0.0",
    capabilities: [],
    authentication: ["api_key", "oauth"],
  };

  readonly #options: LinearWorkProviderOptions;
  readonly #fetch: FetchClient;
  readonly #claims = new LocalWorkClaims();

  public constructor(options: LinearWorkProviderOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async availability(signal?: AbortSignal) {
    try {
      const data = await this.#graphql("query FableViewer { viewer { id name } }", {}, signal);
      return {
        installed: true,
        authenticated: objectValue(data["viewer"]) !== undefined,
        available: objectValue(data["viewer"]) !== undefined,
      };
    } catch (error) {
      return {
        installed: true,
        authenticated: false,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async discover(query: WorkQuery, signal?: AbortSignal): Promise<WorkPage> {
    const first = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const filter = linearFilter(query, this.#options.team);
    const data = await this.#graphql(
      `query FableIssues($first: Int!, $after: String, $filter: IssueFilter) {
        issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
          nodes { ${issueFields} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { first, ...(query.cursor === undefined ? {} : { after: query.cursor }), filter },
      signal,
    );
    const connection = requiredObject(data["issues"], "Linear issues connection");
    const pageInfo = objectValue(connection["pageInfo"]);
    const nextCursor = stringValue(pageInfo?.["endCursor"]);
    return {
      items: arrayValue(connection["nodes"]).map((issue) =>
        this.#mapIssue(requiredObject(issue, "Linear issue")),
      ),
      ...(booleanValue(pageInfo?.["hasNextPage"]) !== true || nextCursor === undefined
        ? {}
        : { nextCursor }),
    };
  }

  public async get(externalId: string, signal?: AbortSignal): Promise<WorkItem | undefined> {
    const data = await this.#graphql(
      `query FableIssue($id: String!) { issue(id: $id) { ${issueFields} } }`,
      { id: externalId },
      signal,
    );
    const issue = objectValue(data["issue"]);
    return issue === undefined ? undefined : this.#mapIssue(issue);
  }

  public async claim(item: WorkItem, owner: string, ttlMs: number): Promise<WorkClaim> {
    return this.#claims.claim(item, owner, ttlMs);
  }

  public async update(
    externalId: string,
    update: WorkUpdate,
    signal?: AbortSignal,
  ): Promise<WorkItem> {
    const current = await this.get(externalId, signal);
    if (current === undefined) throw new Error(`Unknown Linear issue: ${externalId}`);
    const input: JsonObject = {};
    if (update.state !== undefined)
      input["stateId"] = await this.#stateId(current, update.state, signal);
    if (update.assignee !== undefined) input["assigneeId"] = update.assignee;
    if (update.addLabels !== undefined || update.removeLabels !== undefined) {
      const currentIds = labelIds(current);
      const removals = new Set(update.removeLabels ?? []);
      const kept = currentIds.filter((label) => !removals.has(label.name)).map((label) => label.id);
      const additions = await this.#labelIds(update.addLabels ?? [], signal);
      input["labelIds"] = [...new Set([...kept, ...additions])];
    }
    if (Object.keys(input).length > 0) {
      const data = await this.#graphql(
        `mutation FableIssueUpdate($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) { success }
        }`,
        { id: externalId, input },
        signal,
      );
      if (objectValue(data["issueUpdate"])?.["success"] !== true) {
        throw new Error(`Linear rejected update for ${externalId}`);
      }
    }
    if (update.comment !== undefined) {
      const issueId = stringValue(current.metadata["linearId"]) ?? externalId;
      await this.#graphql(
        `mutation FableComment($input: CommentCreateInput!) {
          commentCreate(input: $input) { success }
        }`,
        { input: { issueId, body: update.comment } },
        signal,
      );
    }
    const updated = await this.get(externalId, signal);
    if (updated === undefined) throw new Error(`Linear issue disappeared: ${externalId}`);
    return updated;
  }

  public async release(claim: WorkClaim): Promise<void> {
    this.#claims.release(claim);
  }

  async #stateId(current: WorkItem, state: string, signal?: AbortSignal): Promise<string> {
    const teamId = stringValue(current.metadata["teamId"]);
    if (teamId === undefined) throw new Error("Linear issue did not include a team ID");
    const data = await this.#graphql(
      `query FableStates($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name } }
      }`,
      { teamId },
      signal,
    );
    const states = arrayValue(objectValue(data["workflowStates"])?.["nodes"])
      .map(objectValue)
      .filter((value): value is JsonObject => value !== undefined);
    const match = states.find(
      (candidate) => stringValue(candidate["name"])?.toLowerCase() === state.toLowerCase(),
    );
    const id = stringValue(match?.["id"]);
    if (id === undefined) throw new Error(`Unknown Linear workflow state: ${state}`);
    return id;
  }

  async #labelIds(labels: string[], signal?: AbortSignal): Promise<string[]> {
    if (labels.length === 0) return [];
    const data = await this.#graphql(
      `query FableLabels($names: [String!]) {
        issueLabels(filter: { name: { in: $names } }) { nodes { id name } }
      }`,
      { names: labels },
      signal,
    );
    const found = arrayValue(objectValue(data["issueLabels"])?.["nodes"])
      .map(objectValue)
      .filter((value): value is JsonObject => value !== undefined);
    const byName = new Map(
      found.map((label) => [stringValue(label["name"]), stringValue(label["id"])]),
    );
    const missing = labels.filter((label) => byName.get(label) === undefined);
    if (missing.length > 0) throw new Error(`Unknown Linear labels: ${missing.join(", ")}`);
    return labels.map((label) => byName.get(label) ?? "");
  }

  async #graphql(query: string, variables: JsonObject, signal?: AbortSignal): Promise<JsonObject> {
    const token = await resolveToken(this.#options);
    if (token === undefined) throw new Error("Linear credential is missing");
    const { value } = await requestJson(
      this.#fetch,
      this.#options.apiUrl ?? "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const response = requiredObject(value, "Linear GraphQL response");
    const errors = arrayValue(response["errors"]);
    if (errors.length > 0) {
      const messages = errors
        .map((error) => stringValue(objectValue(error)?.["message"]))
        .filter((message): message is string => message !== undefined);
      throw new Error(`Linear GraphQL error: ${messages.join("; ") || "unknown error"}`);
    }
    return requiredObject(response["data"], "Linear GraphQL data");
  }

  #mapIssue(issue: JsonObject): WorkItem {
    const state = objectValue(issue["state"]);
    const assignee = objectValue(issue["assignee"]);
    const team = objectValue(issue["team"]);
    const email = stringValue(assignee?.["email"]);
    const description = stringValue(issue["description"]);
    const priority = numberValue(issue["priority"]);
    const url = stringValue(issue["url"]);
    const updatedAt = stringValue(issue["updatedAt"]);
    const labels = arrayValue(objectValue(issue["labels"])?.["nodes"])
      .map(objectValue)
      .filter((value): value is JsonObject => value !== undefined);
    const externalId = stringValue(issue["identifier"]) ?? scalarString(issue["id"], "unknown");
    return {
      id: `${this.descriptor.id}:${scalarString(issue["id"], externalId)}`,
      provider: this.descriptor.id,
      externalId,
      title: stringValue(issue["title"]) ?? externalId,
      ...(description === undefined ? {} : { description }),
      state: stringValue(state?.["name"]) ?? "Unknown",
      type: "issue",
      ...(priority === undefined ? {} : { priority: String(priority) }),
      labels: labels
        .map((label) => stringValue(label["name"]))
        .filter((label): label is string => label !== undefined),
      assignees:
        assignee === undefined
          ? []
          : [
              {
                id: stringValue(assignee["id"]) ?? "unknown",
                displayName: stringValue(assignee["name"]) ?? "unknown",
                ...(email === undefined ? {} : { email }),
                provider: "linear",
              },
            ],
      relationships: [],
      ...(this.#options.repository === undefined
        ? {}
        : { repository: { ...this.#options.repository, provider: "linear" } }),
      metadata: {
        linearId: scalarString(issue["id"], ""),
        teamId: scalarString(team?.["id"], ""),
        labelIds: labels.map((label) => ({
          id: stringValue(label["id"]) ?? "",
          name: stringValue(label["name"]) ?? "",
        })),
      },
      ...(url === undefined ? {} : { url }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    };
  }
}

const issueFields = `
  id identifier title description priority url updatedAt
  state { id name }
  assignee { id name email }
  team { id key }
  labels { nodes { id name } }
`;

function linearFilter(query: WorkQuery, configuredTeam: string | undefined): JsonObject {
  const filter: JsonObject = {};
  const team = query.project ?? configuredTeam;
  if (team !== undefined) filter["team"] = { key: { eq: team } };
  if (query.states !== undefined && query.states.length > 0) {
    filter["state"] = { name: { in: query.states } };
  }
  if (query.labels !== undefined && query.labels.length > 0) {
    filter["labels"] = { name: { in: query.labels } };
  }
  if (query.assignee !== undefined) filter["assignee"] = { id: { eq: query.assignee } };
  return filter;
}

function labelIds(item: WorkItem): Array<{ id: string; name: string }> {
  return arrayValue(item.metadata["labelIds"])
    .map(objectValue)
    .filter((value): value is JsonObject => value !== undefined)
    .map((value) => ({
      id: stringValue(value["id"]) ?? "",
      name: stringValue(value["name"]) ?? "",
    }));
}

function requiredObject(value: JsonValue | undefined, context: string): JsonObject {
  const object = objectValue(value);
  if (object === undefined) throw new Error(`${context} was not an object`);
  return object;
}
