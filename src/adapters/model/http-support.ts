import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { SecretProvider } from "../../ports/security.js";

export type FetchClient = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ApiCredentialOptions {
  apiKey?: string;
  apiKeyReference?: string;
  secrets?: SecretProvider;
}

export interface ServerSentEvent {
  event?: string;
  data: string;
}

export async function resolveApiKey(options: ApiCredentialOptions): Promise<string | undefined> {
  if (options.apiKey !== undefined) return options.apiKey;
  if (options.apiKeyReference === undefined || options.secrets === undefined) return undefined;
  return options.secrets.get(options.apiKeyReference);
}

export async function* readServerSentEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<ServerSentEvent> {
  if (response.body === null) throw new Error("Streaming response did not include a body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseFrame(frame);
        if (parsed !== undefined) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    const parsed = parseSseFrame(buffer);
    if (parsed !== undefined) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

export function parseJsonObject(value: string, context: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isJsonObject(parsed)) throw new Error(`${context} must be a JSON object`);
  return parsed;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

export async function describeHttpFailure(response: Response): Promise<string> {
  const body = (await response.text()).slice(0, 16_384).trim();
  return body.length === 0
    ? `HTTP ${response.status} ${response.statusText}`
    : `HTTP ${response.status}: ${body}`;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSseFrame(frame: string): ServerSentEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trimStart();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { ...(event === undefined ? {} : { event }), data: data.join("\n") };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === "object") return Object.values(value).every(isJsonValue);
  return false;
}
