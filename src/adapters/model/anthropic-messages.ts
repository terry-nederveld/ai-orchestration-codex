import type { JsonObject, JsonValue } from "../../domain/json.js";
import type {
  ModelEvent,
  ModelMessage,
  ModelRequest,
  ProviderDescriptor,
  ToolCallContent,
  Usage,
} from "../../domain/providers.js";
import type { ModelProvider } from "../../ports/providers.js";
import {
  describeHttpFailure,
  errorMessage,
  isJsonObject,
  isRetryableStatus,
  parseJsonObject,
  readServerSentEvents,
  resolveApiKey,
  type ApiCredentialOptions,
  type FetchClient,
} from "./http-support.js";

export interface AnthropicMessagesProviderOptions extends ApiCredentialOptions {
  baseUrl?: string;
  apiVersion?: string;
  fetch?: FetchClient;
  models?: string[];
}

interface PendingTool {
  id: string;
  name: string;
  json: string;
}

export class AnthropicMessagesProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "model" } = {
    id: "anthropic-messages",
    displayName: "Anthropic Messages API",
    kind: "model",
    version: "1.0.0",
    capabilities: ["chat", "tool_use", "parallel_tool_use", "streaming", "structured_output"],
    authentication: ["api_key"],
  };

  readonly #options: AnthropicMessagesProviderOptions;
  readonly #fetch: FetchClient;

  public constructor(options: AnthropicMessagesProviderOptions = {}) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models?: string[];
    detail?: string;
  }> {
    const apiKey = await resolveApiKey(this.#options);
    return apiKey === undefined
      ? { installed: true, authenticated: false, available: false, detail: "API key missing" }
      : {
          installed: true,
          authenticated: true,
          available: true,
          ...(this.#options.models === undefined ? {} : { models: this.#options.models }),
        };
  }

  public async *invoke(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    try {
      const apiKey = await resolveApiKey(this.#options);
      if (apiKey === undefined) {
        yield { type: "error", error: "Anthropic API key is not configured", retryable: false };
        return;
      }
      const response = await this.#fetch(`${this.#baseUrl()}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": this.#options.apiVersion ?? "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(toAnthropicRequest(request)),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        yield {
          type: "error",
          error: await describeHttpFailure(response),
          retryable: isRetryableStatus(response.status),
        };
        return;
      }

      let text = "";
      let inputTokens = 0;
      let cachedInputTokens = 0;
      let outputTokens = 0;
      const pending = new Map<number, PendingTool>();
      const calls: ToolCallContent[] = [];
      for await (const frame of readServerSentEvents(response, signal)) {
        const event = parseJsonObject(frame.data, "Anthropic stream event");
        const type = stringField(event, "type") ?? frame.event;
        if (type === "message_start") {
          const usage = objectField(objectField(event, "message"), "usage");
          inputTokens = numberField(usage, "input_tokens") ?? 0;
          cachedInputTokens =
            (numberField(usage, "cache_read_input_tokens") ?? 0) +
            (numberField(usage, "cache_creation_input_tokens") ?? 0);
        } else if (type === "content_block_start") {
          const content = objectField(event, "content_block");
          if (stringField(content, "type") === "tool_use") {
            pending.set(numberField(event, "index") ?? pending.size, {
              id: stringField(content, "id") ?? `tool-${pending.size}`,
              name: stringField(content, "name") ?? "unknown_tool",
              json: "",
            });
          }
        } else if (type === "content_block_delta") {
          const delta = objectField(event, "delta");
          if (stringField(delta, "type") === "text_delta") {
            const value = stringField(delta, "text") ?? "";
            text += value;
            if (value.length > 0) yield { type: "text_delta", delta: value };
          } else if (stringField(delta, "type") === "input_json_delta") {
            const current = pending.get(numberField(event, "index") ?? -1);
            if (current !== undefined) current.json += stringField(delta, "partial_json") ?? "";
          }
        } else if (type === "content_block_stop") {
          const index = numberField(event, "index") ?? -1;
          const current = pending.get(index);
          if (current !== undefined) {
            const call: ToolCallContent = {
              type: "tool_call",
              id: current.id,
              name: current.name,
              arguments:
                current.json.length === 0 ? {} : parseJsonObject(current.json, "tool input"),
            };
            calls.push(call);
            pending.delete(index);
            yield { type: "tool_call", call };
          }
        } else if (type === "message_delta") {
          const usage = objectField(event, "usage");
          outputTokens = numberField(usage, "output_tokens") ?? outputTokens;
        } else if (type === "error") {
          const failure = objectField(event, "error");
          yield {
            type: "error",
            error: stringField(failure, "message") ?? "Anthropic response failed",
            retryable: stringField(failure, "type") === "overloaded_error",
          };
          return;
        }
      }
      const usage: Usage = {
        inputTokens,
        outputTokens,
        ...(cachedInputTokens === 0 ? {} : { cachedInputTokens }),
      };
      yield { type: "usage", usage };
      yield { type: "completed", message: completedMessage(text, calls) };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      yield { type: "error", error: errorMessage(error), retryable: error instanceof TypeError };
    }
  }

  #baseUrl(): string {
    return (this.#options.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  }
}

function toAnthropicRequest(request: ModelRequest): JsonObject {
  const system = request.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => message.content)
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n\n");
  const messages: JsonObject[] = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    const content: JsonObject[] = [];
    for (const part of message.content) {
      if (part.type === "text") content.push({ type: "text", text: part.text });
      else if (part.type === "tool_call") {
        content.push({ type: "tool_use", id: part.id, name: part.name, input: part.arguments });
      } else {
        content.push({
          type: "tool_result",
          tool_use_id: part.toolCallId,
          content: serializeContent(part.content),
          ...(part.isError === undefined ? {} : { is_error: part.isError }),
        });
      }
    }
    messages.push({ role: message.role === "tool" ? "user" : message.role, content });
  }
  return {
    model: request.model,
    max_tokens: request.maxOutputTokens ?? 4096,
    stream: true,
    messages,
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    ...(system.length === 0 ? {} : { system }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  };
}

function serializeContent(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function completedMessage(text: string, calls: ToolCallContent[]): ModelMessage {
  return {
    role: "assistant",
    content: [...(text.length === 0 ? [] : [{ type: "text" as const, text }]), ...calls],
  };
}

function objectField(value: JsonObject | undefined, key: string): JsonObject | undefined {
  const field = value?.[key];
  return isJsonObject(field) ? field : undefined;
}

function stringField(value: JsonObject | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function numberField(value: JsonObject | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === "number" ? field : undefined;
}
