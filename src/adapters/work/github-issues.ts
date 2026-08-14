import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { WorkClaim, WorkItem, WorkPage, WorkQuery, WorkUpdate } from "../../domain/work.js";
import type { WorkProvider } from "../../ports/providers.js";
import type { SecretProvider } from "../../ports/security.js";
import type { FetchClient } from "../model/http-support.js";
import {
  LocalWorkClaims,
  arrayValue,
  objectValue,
  requestJson,
  resolveToken,
  scalarString,
  stringValue,
} from "./http-work-support.js";

export interface GitHubIssuesProviderOptions {
  owner: string;
  repository: string;
  token?: string;
  tokenReference?: string;
  secrets?: SecretProvider;
  apiUrl?: string;
  webUrl?: string;
  cloneUrl?: string;
  fetch?: FetchClient;
}

export class GitHubIssuesProvider implements WorkProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "work" };
  readonly #options: GitHubIssuesProviderOptions;
  readonly #fetch: FetchClient;
  readonly #claims = new LocalWorkClaims();

  public constructor(options: GitHubIssuesProviderOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.descriptor = {
      id: `github-issues:${options.owner}/${options.repository}`,
      displayName: `GitHub Issues (${options.owner}/${options.repository})`,
      kind: "work",
      version: "1.0.0",
      capabilities: [],
      authentication: ["oauth", "api_key", "none"],
    };
  }

  public async availability(signal?: AbortSignal) {
    const token = await resolveToken(this.#options);
    try {
      await requestJson(this.#fetch, `${this.#repositoryApi()}`, {
        headers: this.#headers(token),
        ...(signal === undefined ? {} : { signal }),
      });
      return { installed: true, authenticated: token !== undefined, available: true };
    } catch (error) {
      return {
        installed: true,
        authenticated: token !== undefined,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async discover(query: WorkQuery, signal?: AbortSignal): Promise<WorkPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const page = Number(query.cursor ?? "1");
    const parameters = new URLSearchParams({
      per_page: String(limit),
      page: String(Number.isFinite(page) ? page : 1),
      state: githubState(query.states),
    });
    if (query.labels !== undefined) parameters.set("labels", query.labels.join(","));
    if (query.assignee !== undefined) parameters.set("assignee", query.assignee);
    const { value } = await this.#request(`/issues?${parameters.toString()}`, {}, signal);
    const items = arrayValue(value)
      .filter((issue) => objectValue(issue)?.["pull_request"] === undefined)
      .map((issue) => this.#mapIssue(requiredObject(issue, "GitHub issue")));
    return {
      items,
      ...(items.length < limit
        ? {}
        : { nextCursor: String((Number.isFinite(page) ? page : 1) + 1) }),
    };
  }

  public async get(externalId: string, signal?: AbortSignal): Promise<WorkItem | undefined> {
    try {
      const { value } = await this.#request(
        `/issues/${encodeURIComponent(externalId)}`,
        {},
        signal,
      );
      return this.#mapIssue(requiredObject(value, "GitHub issue"));
    } catch (error) {
      if (isNotFound(error)) return undefined;
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
    if (current === undefined) throw new Error(`Unknown GitHub issue: ${externalId}`);
    const labels = current.labels
      .filter((label) => !(update.removeLabels ?? []).includes(label))
      .concat(update.addLabels ?? []);
    const body: JsonObject = {
      ...(update.state === undefined ? {} : { state: normalizeGitHubState(update.state) }),
      ...(update.addLabels === undefined && update.removeLabels === undefined
        ? {}
        : { labels: [...new Set(labels)] }),
      ...(update.assignee === undefined ? {} : { assignees: [update.assignee] }),
    };
    if (Object.keys(body).length > 0) {
      await this.#request(
        `/issues/${encodeURIComponent(externalId)}`,
        { method: "PATCH", body: JSON.stringify(body) },
        signal,
      );
    }
    if (update.comment !== undefined) {
      await this.#request(
        `/issues/${encodeURIComponent(externalId)}/comments`,
        { method: "POST", body: JSON.stringify({ body: update.comment }) },
        signal,
      );
    }
    const updated = await this.get(externalId, signal);
    if (updated === undefined) throw new Error(`GitHub issue disappeared: ${externalId}`);
    return updated;
  }

  public async release(claim: WorkClaim): Promise<void> {
    this.#claims.release(claim);
  }

  async #request(path: string, init: RequestInit, signal?: AbortSignal) {
    const token = await resolveToken(this.#options);
    return requestJson(this.#fetch, `${this.#repositoryApi()}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...this.#headers(token),
      },
      ...(signal === undefined ? {} : { signal }),
    });
  }

  #headers(token: string | undefined): Record<string, string> {
    return token === undefined ? {} : { authorization: `Bearer ${token}` };
  }

  #repositoryApi(): string {
    const api = (this.#options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    return `${api}/repos/${encodeURIComponent(this.#options.owner)}/${encodeURIComponent(this.#options.repository)}`;
  }

  #mapIssue(issue: JsonObject): WorkItem {
    const externalId = scalarString(issue["number"] ?? issue["id"], "unknown");
    const description = stringValue(issue["body"]);
    const url = stringValue(issue["html_url"]);
    const updatedAt = stringValue(issue["updated_at"]);
    const labels = arrayValue(issue["labels"])
      .map((label) =>
        typeof label === "string" ? label : stringValue(objectValue(label)?.["name"]),
      )
      .filter((label): label is string => label !== undefined);
    const assignees = arrayValue(issue["assignees"])
      .map(objectValue)
      .filter((assignee): assignee is JsonObject => assignee !== undefined)
      .map((assignee) => ({
        id: scalarString(assignee["id"] ?? assignee["login"], "unknown"),
        displayName: stringValue(assignee["login"]) ?? "unknown",
        provider: "github",
      }));
    return {
      id: `${this.descriptor.id}:${externalId}`,
      provider: this.descriptor.id,
      externalId,
      title: stringValue(issue["title"]) ?? `Issue ${externalId}`,
      ...(description === undefined ? {} : { description }),
      state: stringValue(issue["state"]) ?? "open",
      type: "issue",
      labels,
      assignees,
      relationships: [],
      repository: {
        id: `${this.#options.owner}/${this.#options.repository}`,
        cloneUrl:
          this.#options.cloneUrl ??
          `https://github.com/${this.#options.owner}/${this.#options.repository}.git`,
        owner: this.#options.owner,
        name: this.#options.repository,
        provider: "github",
      },
      metadata: { number: Number(externalId) },
      ...(url === undefined ? {} : { url }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
    };
  }
}

function githubState(states: string[] | undefined): string {
  if (states === undefined || states.length !== 1) return "all";
  return normalizeGitHubState(states[0] ?? "all");
}

function normalizeGitHubState(state: string): string {
  const normalized = state.toLowerCase();
  if (["closed", "done", "resolved", "completed"].includes(normalized)) return "closed";
  return "open";
}

function requiredObject(value: JsonValue, context: string): JsonObject {
  const object = objectValue(value);
  if (object === undefined) throw new Error(`${context} was not an object`);
  return object;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}
