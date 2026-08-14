import { randomUUID } from "node:crypto";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { WorkClaim, WorkItem } from "../../domain/work.js";
import type { SecretProvider } from "../../ports/security.js";
import { describeHttpFailure, isJsonObject, type FetchClient } from "../model/http-support.js";

export interface WorkApiCredential {
  token?: string;
  tokenReference?: string;
  secrets?: SecretProvider;
}

export async function resolveToken(options: WorkApiCredential): Promise<string | undefined> {
  if (options.token !== undefined) return options.token;
  if (options.tokenReference === undefined || options.secrets === undefined) return undefined;
  return options.secrets.get(options.tokenReference);
}

export async function requestJson(
  fetchClient: FetchClient,
  url: string,
  init: RequestInit,
): Promise<{ value: JsonValue; response: Response }> {
  const response = await fetchClient(url, init);
  if (!response.ok) throw new WorkApiError(await describeHttpFailure(response), response.status);
  if (response.status === 204) return { value: null, response };
  const parsed: unknown = await response.json();
  if (!isJsonValue(parsed)) throw new Error(`API returned non-JSON data from ${url}`);
  return { value: parsed, response };
}

export class WorkApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WorkApiError";
  }
}

export class LocalWorkClaims {
  readonly #claims = new Map<string, WorkClaim>();

  public claim(item: WorkItem, owner: string, ttlMs: number): WorkClaim {
    const current = this.#claims.get(item.externalId);
    if (current !== undefined && Date.parse(current.expiresAt) > Date.now()) {
      throw new Error(`Work item is already claimed: ${item.externalId}`);
    }
    const claim: WorkClaim = {
      workItemId: item.id,
      token: randomUUID(),
      owner,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    this.#claims.set(item.externalId, claim);
    return structuredClone(claim);
  }

  public release(claim: WorkClaim): void {
    const entry = [...this.#claims.entries()].find(([, value]) => value.token === claim.token);
    if (entry !== undefined) this.#claims.delete(entry[0]);
  }
}

export function objectValue(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function scalarString(value: JsonValue | undefined, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function booleanValue(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function extractText(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map(extractText)
      .filter((part): part is string => part !== undefined)
      .join("");
    return text.length === 0 ? undefined : text;
  }
  if (!isJsonObject(value)) return undefined;
  const direct = stringValue(value["text"]);
  const nested = extractText(value["content"]);
  return direct ?? nested;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return value !== null && typeof value === "object" && Object.values(value).every(isJsonValue);
}
