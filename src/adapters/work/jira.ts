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
  extractText,
  numberValue,
  objectValue,
  requestJson,
  resolveToken,
  scalarString,
  stringValue,
} from "./http-work-support.js";

export interface JiraProviderOptions {
  deployment: "cloud" | "data-center";
  baseUrl: string;
  project?: string;
  email?: string;
  token?: string;
  tokenReference?: string;
  secrets?: SecretProvider;
  fetch?: FetchClient;
  repository?: {
    id: string;
    cloneUrl: string;
    owner?: string;
    name?: string;
    defaultBranch?: string;
  };
}

export class JiraWorkProvider implements WorkProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "work" };
  readonly #options: JiraProviderOptions;
  readonly #fetch: FetchClient;
  readonly #claims = new LocalWorkClaims();

  public constructor(options: JiraProviderOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.descriptor = {
      id: `jira-${options.deployment}:${new URL(options.baseUrl).host}`,
      displayName: options.deployment === "cloud" ? "Jira Cloud" : "Jira Data Center",
      kind: "work",
      version: "1.0.0",
      capabilities: [],
      authentication:
        options.deployment === "cloud" ? ["api_key", "oauth"] : ["api_key", "oauth", "custom"],
    };
  }

  public async availability(signal?: AbortSignal) {
    const token = await resolveToken(this.#options);
    if (token === undefined) {
      return {
        installed: true,
        authenticated: false,
        available: false,
        detail: "Credential missing",
      };
    }
    try {
      await this.#request("/myself", {}, signal);
      return { installed: true, authenticated: true, available: true };
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
    const jql = buildJql(query, this.#options.project);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    if (this.#options.deployment === "cloud") {
      const { value } = await this.#request(
        "/search/jql",
        {
          method: "POST",
          body: JSON.stringify({
            jql,
            maxResults: limit,
            fields: jiraFields,
            ...(query.cursor === undefined ? {} : { nextPageToken: query.cursor }),
          }),
        },
        signal,
      );
      const response = requiredObject(value, "Jira search response");
      const nextCursor = stringValue(response["nextPageToken"]);
      return {
        items: arrayValue(response["issues"]).map((issue) =>
          this.#mapIssue(requiredObject(issue, "Jira issue")),
        ),
        ...(booleanValue(response["isLast"]) === true || nextCursor === undefined
          ? {}
          : { nextCursor }),
      };
    }

    const startAt = Number(query.cursor ?? "0");
    const { value } = await this.#request(
      "/search",
      {
        method: "POST",
        body: JSON.stringify({
          jql,
          startAt: Number.isFinite(startAt) ? startAt : 0,
          maxResults: limit,
          fields: jiraFields,
        }),
      },
      signal,
    );
    const response = requiredObject(value, "Jira search response");
    const items = arrayValue(response["issues"]).map((issue) =>
      this.#mapIssue(requiredObject(issue, "Jira issue")),
    );
    const next = (Number.isFinite(startAt) ? startAt : 0) + items.length;
    const total = numberValue(response["total"]) ?? next;
    return { items, ...(next >= total ? {} : { nextCursor: String(next) }) };
  }

  public async get(externalId: string, signal?: AbortSignal): Promise<WorkItem | undefined> {
    try {
      const fields = encodeURIComponent(jiraFields.join(","));
      const { value } = await this.#request(
        `/issue/${encodeURIComponent(externalId)}?fields=${fields}`,
        {},
        signal,
      );
      return this.#mapIssue(requiredObject(value, "Jira issue"));
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) return undefined;
      throw error;
    }
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
    if (current === undefined) throw new Error(`Unknown Jira issue: ${externalId}`);
    const fields: JsonObject = {};
    if (update.addLabels !== undefined || update.removeLabels !== undefined) {
      fields["labels"] = [
        ...new Set(
          current.labels
            .filter((label) => !(update.removeLabels ?? []).includes(label))
            .concat(update.addLabels ?? []),
        ),
      ];
    }
    if (update.assignee !== undefined) {
      fields["assignee"] =
        this.#options.deployment === "cloud"
          ? { accountId: update.assignee }
          : { name: update.assignee };
    }
    if (Object.keys(fields).length > 0) {
      await this.#request(
        `/issue/${encodeURIComponent(externalId)}`,
        { method: "PUT", body: JSON.stringify({ fields }) },
        signal,
      );
    }
    if (update.state !== undefined && update.state !== current.state) {
      await this.#transition(externalId, update.state, signal);
    }
    if (update.comment !== undefined) {
      const body =
        this.#options.deployment === "cloud"
          ? {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: update.comment }],
                  },
                ],
              },
            }
          : { body: update.comment };
      await this.#request(
        `/issue/${encodeURIComponent(externalId)}/comment`,
        { method: "POST", body: JSON.stringify(body) },
        signal,
      );
    }
    const updated = await this.get(externalId, signal);
    if (updated === undefined) throw new Error(`Jira issue disappeared: ${externalId}`);
    return updated;
  }

  public async release(claim: WorkClaim): Promise<void> {
    this.#claims.release(claim);
  }

  async #transition(externalId: string, state: string, signal?: AbortSignal): Promise<void> {
    const { value } = await this.#request(
      `/issue/${encodeURIComponent(externalId)}/transitions?expand=transitions.fields`,
      {},
      signal,
    );
    const transitions = arrayValue(requiredObject(value, "Jira transitions")["transitions"])
      .map(objectValue)
      .filter((transition): transition is JsonObject => transition !== undefined);
    const transition = transitions.find((candidate) => {
      const target = objectValue(candidate["to"]);
      return [stringValue(candidate["name"]), stringValue(target?.["name"])]
        .filter((value): value is string => value !== undefined)
        .some((value) => value.toLowerCase() === state.toLowerCase());
    });
    if (transition === undefined) throw new Error(`No Jira transition leads to state: ${state}`);
    await this.#request(
      `/issue/${encodeURIComponent(externalId)}/transitions`,
      {
        method: "POST",
        body: JSON.stringify({ transition: { id: scalarString(transition["id"], "") } }),
      },
      signal,
    );
  }

  async #request(path: string, init: RequestInit, signal?: AbortSignal) {
    const token = await resolveToken(this.#options);
    if (token === undefined) throw new Error("Jira credential is missing");
    const authorization =
      this.#options.email === undefined
        ? `Bearer ${token}`
        : `Basic ${Buffer.from(`${this.#options.email}:${token}`).toString("base64")}`;
    const version = this.#options.deployment === "cloud" ? "3" : "2";
    return requestJson(
      this.#fetch,
      `${this.#options.baseUrl.replace(/\/$/, "")}/rest/api/${version}${path}`,
      {
        ...init,
        headers: {
          authorization,
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(signal === undefined ? {} : { signal }),
      },
    );
  }

  #mapIssue(issue: JsonObject): WorkItem {
    const fields = objectValue(issue["fields"]) ?? {};
    const status = objectValue(fields["status"]);
    const type = objectValue(fields["issuetype"]);
    const priority = objectValue(fields["priority"]);
    const assignee = objectValue(fields["assignee"]);
    const email = stringValue(assignee?.["emailAddress"]);
    const description = extractText(fields["description"]);
    const issueType = stringValue(type?.["name"]);
    const priorityName = stringValue(priority?.["name"]);
    const updatedAt = stringValue(fields["updated"]);
    const externalId = stringValue(issue["key"]) ?? scalarString(issue["id"], "unknown");
    return {
      id: `${this.descriptor.id}:${scalarString(issue["id"], externalId)}`,
      provider: this.descriptor.id,
      externalId,
      title: stringValue(fields["summary"]) ?? externalId,
      ...(description === undefined ? {} : { description }),
      state: stringValue(status?.["name"]) ?? "Unknown",
      ...(issueType === undefined ? {} : { type: issueType }),
      ...(priorityName === undefined ? {} : { priority: priorityName }),
      labels: arrayValue(fields["labels"]).filter(
        (label): label is string => typeof label === "string",
      ),
      assignees:
        assignee === undefined
          ? []
          : [
              {
                id:
                  stringValue(assignee["accountId"]) ?? stringValue(assignee["name"]) ?? "unknown",
                displayName:
                  stringValue(assignee["displayName"]) ??
                  stringValue(assignee["name"]) ??
                  "unknown",
                ...(email === undefined ? {} : { email }),
                provider: "jira",
              },
            ],
      relationships: arrayValue(fields["issuelinks"]).flatMap(jiraRelationships),
      ...(this.#options.repository === undefined
        ? {}
        : { repository: { ...this.#options.repository, provider: "jira" } }),
      metadata: { jiraId: scalarString(issue["id"], "") },
      url: `${this.#options.baseUrl.replace(/\/$/, "")}/browse/${externalId}`,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    };
  }
}

const jiraFields = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "labels",
  "assignee",
  "issuelinks",
  "updated",
];

function buildJql(query: WorkQuery, configuredProject: string | undefined): string {
  const clauses: string[] = [];
  const project = query.project ?? configuredProject;
  if (project !== undefined) clauses.push(`project = "${escapeJql(project)}"`);
  if (query.states !== undefined && query.states.length > 0) {
    clauses.push(`status in (${query.states.map((state) => `"${escapeJql(state)}"`).join(", ")})`);
  }
  for (const label of query.labels ?? []) clauses.push(`labels = "${escapeJql(label)}"`);
  if (query.assignee !== undefined) clauses.push(`assignee = "${escapeJql(query.assignee)}"`);
  return `${clauses.length === 0 ? "ORDER BY updated DESC" : `${clauses.join(" AND ")} ORDER BY updated DESC`}`;
}

function escapeJql(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function jiraRelationships(value: JsonValue): Array<{ type: string; targetId: string }> {
  const link = objectValue(value);
  if (link === undefined) return [];
  const outward = objectValue(link["outwardIssue"]);
  const inward = objectValue(link["inwardIssue"]);
  const type = objectValue(link["type"]);
  if (outward !== undefined) {
    return [
      {
        type: stringValue(type?.["outward"]) ?? "related",
        targetId: stringValue(outward["key"]) ?? scalarString(outward["id"], "unknown"),
      },
    ];
  }
  if (inward !== undefined) {
    return [
      {
        type: stringValue(type?.["inward"]) ?? "related",
        targetId: stringValue(inward["key"]) ?? scalarString(inward["id"], "unknown"),
      },
    ];
  }
  return [];
}

function requiredObject(value: JsonValue, context: string): JsonObject {
  const object = objectValue(value);
  if (object === undefined) throw new Error(`${context} was not an object`);
  return object;
}
