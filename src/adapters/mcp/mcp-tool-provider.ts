import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { PermissionCapability } from "../../domain/permissions.js";
import type { ToolDefinition, ToolProvider, ToolResult } from "../../ports/tools.js";
import { isJsonObject, type FetchClient } from "../model/http-support.js";

export type McpServerConfiguration =
  | {
      id: string;
      transport: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      permissions?: PermissionCapability[];
      transportFactory?: () => Transport;
    }
  | {
      id: string;
      transport: "http";
      url: string;
      headers?: Record<string, string>;
      fetch?: FetchClient;
      permissions?: PermissionCapability[];
      transportFactory?: () => Transport;
    };

export class McpToolProvider implements ToolProvider {
  public readonly id: string;
  readonly #configuration: McpServerConfiguration;
  readonly #client: Client;
  #tools: ToolDefinition[] = [];
  #connected = false;

  public constructor(configuration: McpServerConfiguration) {
    this.#configuration = configuration;
    this.id = `mcp:${configuration.id}`;
    this.#client = new Client({ name: "Fable", version: "0.1.0" }, { capabilities: {} });
  }

  public async connect(signal?: AbortSignal): Promise<void> {
    if (this.#connected) return;
    const transport =
      this.#configuration.transportFactory !== undefined
        ? this.#configuration.transportFactory()
        : this.#configuration.transport === "stdio"
          ? new StdioClientTransport({
              command: this.#configuration.command,
              ...(this.#configuration.args === undefined ? {} : { args: this.#configuration.args }),
              ...(this.#configuration.cwd === undefined ? {} : { cwd: this.#configuration.cwd }),
              ...(this.#configuration.env === undefined ? {} : { env: this.#configuration.env }),
              stderr: "pipe",
            })
          : new StreamableHTTPClientTransport(new URL(this.#configuration.url), {
              ...(this.#configuration.headers === undefined
                ? {}
                : { requestInit: { headers: this.#configuration.headers } }),
              ...(this.#configuration.fetch === undefined
                ? {}
                : { fetch: this.#configuration.fetch }),
            });
    await this.#client.connect(
      transport as unknown as Transport,
      signal === undefined ? undefined : { signal },
    );
    const listed = await this.#client.listTools({}, signal === undefined ? undefined : { signal });
    this.#tools = listed.tools.map((tool) => this.#normalizeTool(tool));
    this.#connected = true;
  }

  public list(): ToolDefinition[] {
    return [...this.#tools];
  }

  public get(name: string): ToolDefinition | undefined {
    return this.#tools.find((tool) => tool.name === name);
  }

  public serverCapabilities() {
    return this.#client.getServerCapabilities();
  }

  public serverVersion() {
    return this.#client.getServerVersion();
  }

  public async close(): Promise<void> {
    if (!this.#connected) return;
    await this.#client.close();
    this.#connected = false;
    this.#tools = [];
  }

  #normalizeTool(tool: Awaited<ReturnType<Client["listTools"]>>["tools"][number]): ToolDefinition {
    const inputSchema = normalizeJsonObject(tool.inputSchema, `MCP tool ${tool.name} input schema`);
    const permissions =
      this.#configuration.permissions ??
      (this.#configuration.transport === "http" ? ["network.connect"] : ["process.execute"]);
    return {
      name: `${this.#configuration.id}.${tool.name}`,
      description: tool.description ?? tool.title ?? `MCP tool ${tool.name}`,
      inputSchema,
      permissions,
      execute: async (input, context): Promise<ToolResult> => {
        const result = await this.#client.callTool(
          { name: tool.name, arguments: input },
          undefined,
          { signal: context.signal },
        );
        if ("toolResult" in result) {
          return { content: toJsonValue(result.toolResult), isError: false };
        }
        const structured = result.structuredContent;
        return {
          content:
            structured === undefined
              ? result.content.map(normalizeContentBlock)
              : normalizeJsonObject(structured, `MCP tool ${tool.name} result`),
          ...(result.isError === undefined ? {} : { isError: result.isError }),
          metadata: {
            server: this.#configuration.id,
            tool: tool.name,
            content: result.content.map(normalizeContentBlock),
          },
        };
      },
    };
  }
}

function normalizeContentBlock(block: { type: string; [key: string]: unknown }): JsonObject {
  if (block.type === "text") return { type: "text", text: safeString(block["text"], "") };
  if (block.type === "image" || block.type === "audio") {
    return {
      type: block.type,
      data: safeString(block["data"], ""),
      mimeType: safeString(block["mimeType"], "application/octet-stream"),
    };
  }
  if (block.type === "resource") {
    return { type: "resource", resource: toJsonValue(block["resource"]) };
  }
  if (block.type === "resource_link") {
    return {
      type: "resource_link",
      uri: safeString(block["uri"], ""),
      name: safeString(block["name"], ""),
    };
  }
  return { type: block.type };
}

function normalizeJsonObject(value: unknown, context: string): JsonObject {
  const normalized = toJsonValue(value);
  if (!isJsonObject(normalized)) throw new Error(`${context} is not a JSON object`);
  return normalized;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const normalized: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) normalized[key] = toJsonValue(item);
    }
    return normalized;
  }
  return `[unsupported:${typeof value}]`;
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return fallback;
}
