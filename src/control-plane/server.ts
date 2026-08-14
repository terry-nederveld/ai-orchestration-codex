import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject } from "../domain/json.js";
import type { WorkQuery } from "../domain/work.js";
import { isJsonObject } from "../adapters/model/http-support.js";
import type { FableRuntime } from "../composition/runtime.js";

export interface ControlPlaneOptions {
  host?: string;
  port?: number;
  token?: string;
  allowedOrigins?: string[];
}

export interface ControlPlaneAddress {
  host: string;
  port: number;
  token: string;
  url: string;
}

export class ControlPlaneServer {
  readonly #runtime: FableRuntime;
  readonly #host: string;
  readonly #port: number;
  readonly #token: string;
  readonly #origins: Set<string>;
  readonly #server: Server;
  readonly #streams = new Set<ServerResponse>();
  #unsubscribe: (() => void) | undefined;
  #heartbeat: NodeJS.Timeout | undefined;

  public constructor(runtime: FableRuntime, options: ControlPlaneOptions = {}) {
    this.#runtime = runtime;
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 3210;
    this.#token = options.token ?? randomBytes(32).toString("base64url");
    this.#origins = new Set(
      options.allowedOrigins ?? [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
      ],
    );
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  public async start(): Promise<ControlPlaneAddress> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(this.#port, this.#host, () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    this.#unsubscribe = this.#runtime.events.subscribe("*", (event) => this.#broadcast(event));
    this.#heartbeat = setInterval(() => {
      for (const stream of this.#streams) stream.write(": heartbeat\n\n");
    }, 15_000);
    this.#heartbeat.unref();
    const address = this.#server.address() as AddressInfo;
    return {
      host: this.#host,
      port: address.port,
      token: this.#token,
      url: `http://${formatHost(this.#host)}:${address.port}`,
    };
  }

  public async close(): Promise<void> {
    this.#unsubscribe?.();
    if (this.#heartbeat !== undefined) clearInterval(this.#heartbeat);
    for (const stream of this.#streams) stream.end();
    this.#streams.clear();
    if (this.#server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.#server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!this.#validHost(request.headers.host)) {
        sendJson(response, 421, { error: "Invalid Host header" });
        return;
      }
      const origin = request.headers.origin;
      if (origin !== undefined && !this.#origins.has(origin)) {
        sendJson(response, 403, { error: "Origin is not allowed" });
        return;
      }
      setCors(response, origin);
      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "ok", version: "0.1.0" });
        return;
      }
      if (!this.#authorized(request)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        sendJson(response, 401, { error: "Authentication required" });
        return;
      }
      await this.#route(request, response, url);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, statusForError(error), {
          error: error instanceof Error ? error.message : String(error),
        });
      } else response.end();
    }
  }

  async #route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (request.method === "GET" && url.pathname === "/api/providers") {
      sendJson(response, 200, { providers: await this.#runtime.providerStatuses() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/workflows") {
      sendJson(response, 200, {
        workflows: this.#runtime.workflowIds().map((id) => this.#runtime.workflow(id).definition),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/work") {
      const provider = requiredParameter(url, "provider");
      const project = url.searchParams.get("project");
      const assignee = url.searchParams.get("assignee");
      const cursor = url.searchParams.get("cursor");
      const query: WorkQuery = {
        ...(project === null ? {} : { project }),
        ...(url.searchParams.getAll("state").length === 0
          ? {}
          : { states: url.searchParams.getAll("state") }),
        ...(url.searchParams.getAll("label").length === 0
          ? {}
          : { labels: url.searchParams.getAll("label") }),
        ...(assignee === null ? {} : { assignee }),
        ...(cursor === null ? {} : { cursor }),
        limit: parseLimit(url.searchParams.get("limit")),
      };
      sendJson(response, 200, await this.#runtime.discoverWork(provider, query));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      sendJson(response, 200, { runs: await this.#runtime.listRuns() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/runs") {
      const body = await readObjectBody(request);
      const started = this.#runtime.startRun({
        workProviderId: requiredString(body, "workProviderId"),
        externalId: requiredString(body, "externalId"),
        workflowId: requiredString(body, "workflowId"),
        ...(typeof body["owner"] === "string" ? { owner: body["owner"] } : {}),
      });
      sendJson(response, 202, { runId: started.runId });
      return;
    }
    const runMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && runMatch !== null) {
      const run = await this.#runtime.getRun(decodeURIComponent(runMatch[1] ?? ""));
      if (run === undefined) sendJson(response, 404, { error: "Run not found" });
      else sendJson(response, 200, { run });
      return;
    }
    const eventMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
    if (request.method === "GET" && eventMatch !== null) {
      sendJson(response, 200, {
        events: await this.#runtime.eventsForRun(decodeURIComponent(eventMatch[1] ?? "")),
      });
      return;
    }
    const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(url.pathname);
    if (request.method === "POST" && cancelMatch !== null) {
      const cancelled = this.#runtime.cancelRun(decodeURIComponent(cancelMatch[1] ?? ""));
      sendJson(response, cancelled ? 202 : 409, { cancelled });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/approvals") {
      sendJson(response, 200, { approvals: await this.#runtime.approvals.list() });
      return;
    }
    const approvalMatch = /^\/api\/approvals\/([^/]+)$/.exec(url.pathname);
    if (request.method === "POST" && approvalMatch !== null) {
      const body = await readObjectBody(request);
      const decision = body["decision"];
      if (decision !== "approved" && decision !== "denied") {
        throw new TypeError("decision must be approved or denied");
      }
      const resolved = await this.#runtime.resolveApproval(
        decodeURIComponent(approvalMatch[1] ?? ""),
        decision,
      );
      sendJson(response, resolved ? 200 : 409, { resolved });
      return;
    }
    const secretMatch = /^\/api\/secrets\/([a-zA-Z0-9._-]+)$/.exec(url.pathname);
    if (request.method === "PUT" && secretMatch !== null) {
      const body = await readObjectBody(request);
      await this.#runtime.secrets.set(
        decodeURIComponent(secretMatch[1] ?? ""),
        requiredString(body, "value"),
      );
      sendJson(response, 204, null);
      return;
    }
    if (request.method === "DELETE" && secretMatch !== null) {
      sendJson(response, 200, {
        deleted: await this.#runtime.secrets.delete(decodeURIComponent(secretMatch[1] ?? "")),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      this.#openEventStream(request, response);
      return;
    }
    sendJson(response, 404, { error: "Route not found" });
  }

  #authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return false;
    const supplied = Buffer.from(header.slice(7));
    const expected = Buffer.from(this.#token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  #validHost(host: string | undefined): boolean {
    if (host === undefined) return false;
    const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
    return ["127.0.0.1", "localhost", "::1", this.#host].includes(name ?? "");
  }

  #openEventStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.write("event: ready\ndata: {}\n\n");
    this.#streams.add(response);
    request.once("close", () => this.#streams.delete(response));
  }

  #broadcast(event: DomainEvent): void {
    const frame = `event: domain-event\ndata: ${JSON.stringify(event)}\n\n`;
    for (const stream of this.#streams) stream.write(frame);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (status === 204) {
    response.writeHead(status).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readObjectBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : undefined;
    if (buffer === undefined) throw new TypeError("Request body contains an unsupported value");
    length += buffer.length;
    if (length > 1_000_000) throw new RangeError("Request body exceeds 1 MB");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!isJsonObject(parsed)) throw new TypeError("Request body must be a JSON object");
  return parsed;
}

function requiredString(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return field;
}

function requiredParameter(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (value === null || value.length === 0)
    throw new TypeError(`${key} query parameter is required`);
  return value;
}

function parseLimit(value: string | null): number {
  if (value === null) return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new RangeError("limit must be an integer from 1 through 100");
  }
  return parsed;
}

function setCors(response: ServerResponse, origin: string | undefined): void {
  if (origin !== undefined) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
}

function statusForError(error: unknown): number {
  if (error instanceof TypeError || error instanceof RangeError) return 400;
  return 500;
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}
