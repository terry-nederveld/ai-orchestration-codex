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

export interface OpenAICompatibleProviderOptions extends ApiCredentialOptions {
  id?: string;
  displayName?: string;
  baseUrl: string;
  fetch?: FetchClient;
  models?: string[];
  headers?: Record<string, string>;
  requireApiKey?: boolean;
  includeUsage?: boolean;
}

interface PendingTool {
  id: string;
  name: string;
  json: string;
}

export class OpenAICompatibleProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "model" };
  readonly #options: OpenAICompatibleProviderOptions;
  readonly #fetch: FetchClient;

  public constructor(options: OpenAICompatibleProviderOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.descriptor = {
      id: options.id ?? "openai-compatible",
      displayName: options.displayName ?? "OpenAI-compatible API",
      kind: "model",
      version: "1.0.0",
      capabilities: ["chat", "tool_use", "parallel_tool_use", "streaming"],
      authentication: options.requireApiKey === false ? ["none", "api_key"] : ["api_key"],
      metadata: { baseUrl: options.baseUrl },
    };
  }

  public async availability(signal?: AbortSignal): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models?: string[];
    detail?: string;
  }> {
    const apiKey = await resolveApiKey(this.#options);
    if (this.#options.requireApiKey !== false && apiKey === undefined) {
      return { installed: true, authenticated: false, available: false, detail: "API key missing" };
    }
    try {
      const response = await this.#fetch(`${this.#baseUrl()}/models`, {
        headers: this.#headers(apiKey),
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        return {
          installed: true,
          authenticated: response.status !== 401 && response.status !== 403,
          available: false,
          detail: await describeHttpFailure(response),
        };
      }
      return {
        installed: true,
        authenticated: true,
        available: true,
        ...(this.#options.models === undefined ? {} : { models: this.#options.models }),
      };
    } catch (error) {
      return {
        installed: true,
        authenticated: true,
        available: false,
        detail: errorMessage(error),
      };
    }
  }

  public async *invoke(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    try {
      const apiKey = await resolveApiKey(this.#options);
      if (this.#options.requireApiKey !== false && apiKey === undefined) {
        yield {
          type: "error",
          error: `${this.descriptor.displayName} API key is missing`,
          retryable: false,
        };
        return;
      }
      const response = await this.#fetch(`${this.#baseUrl()}/chat/completions`, {
        method: "POST",
        headers: { ...this.#headers(apiKey), "content-type": "application/json" },
        body: JSON.stringify(toChatRequest(request, this.#options.includeUsage ?? true)),
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
      let usage: Usage | undefined;
      const pending = new Map<number, PendingTool>();
      for await (const frame of readServerSentEvents(response, signal)) {
        if (frame.data === "[DONE]") break;
        const chunk = parseJsonObject(frame.data, "chat completion chunk");
        const apiError = objectField(chunk, "error");
        if (apiError !== undefined) {
          yield {
            type: "error",
            error: stringField(apiError, "message") ?? "Chat completion failed",
            retryable: false,
          };
          return;
        }
        usage = parseUsage(objectField(chunk, "usage")) ?? usage;
        const choice = firstObject(chunk["choices"]);
        const delta = objectField(choice, "delta");
        const content = stringField(delta, "content");
        if (content !== undefined && content.length > 0) {
          text += content;
          yield { type: "text_delta", delta: content };
        }
        const toolDeltas = arrayField(delta, "tool_calls");
        for (const value of toolDeltas) {
          if (!isJsonObject(value)) continue;
          const index = numberField(value, "index") ?? 0;
          const fn = objectField(value, "function");
          const current = pending.get(index) ?? {
            id: stringField(value, "id") ?? `tool-${index}`,
            name: "",
            json: "",
          };
          current.id = stringField(value, "id") ?? current.id;
          current.name += stringField(fn, "name") ?? "";
          current.json += stringField(fn, "arguments") ?? "";
          pending.set(index, current);
        }
      }
      const calls: ToolCallContent[] = [];
      for (const current of [...pending.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, value]) => value)) {
        const call: ToolCallContent = {
          type: "tool_call",
          id: current.id,
          name: current.name,
          arguments:
            current.json.length === 0 ? {} : parseJsonObject(current.json, "tool arguments"),
        };
        calls.push(call);
        yield { type: "tool_call", call };
      }
      if (usage !== undefined) yield { type: "usage", usage };
      yield { type: "completed", message: completedMessage(text, calls) };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      yield { type: "error", error: errorMessage(error), retryable: error instanceof TypeError };
    }
  }

  #baseUrl(): string {
    return this.#options.baseUrl.replace(/\/$/, "");
  }

  #headers(apiKey: string | undefined): Record<string, string> {
    return {
      ...this.#options.headers,
      ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
    };
  }
}

function toChatRequest(request: ModelRequest, includeUsage: boolean): JsonObject {
  const messages: JsonObject[] = [];
  for (const message of request.messages) {
    const text = message.content
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    const calls = message.content.filter((content) => content.type === "tool_call");
    const results = message.content.filter((content) => content.type === "tool_result");
    if (results.length > 0) {
      for (const result of results) {
        messages.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          content: serializeContent(result.content),
        });
      }
    } else {
      messages.push({
        role: message.role,
        content: text.length === 0 ? null : text,
        ...(calls.length === 0
          ? {}
          : {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }),
      });
    }
  }
  return {
    model: request.model,
    messages,
    stream: true,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    tools: request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
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

function parseUsage(value: JsonObject | undefined): Usage | undefined {
  if (value === undefined) return undefined;
  const details = objectField(value, "prompt_tokens_details");
  const cached = numberField(details, "cached_tokens");
  return {
    inputTokens: numberField(value, "prompt_tokens") ?? 0,
    outputTokens: numberField(value, "completion_tokens") ?? 0,
    ...(cached === undefined ? {} : { cachedInputTokens: cached }),
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

function arrayField(value: JsonObject | undefined, key: string): JsonValue[] {
  const field = value?.[key];
  return Array.isArray(field) ? field : [];
}

function firstObject(value: JsonValue | undefined): JsonObject | undefined {
  return Array.isArray(value) && isJsonObject(value[0]) ? value[0] : undefined;
}
