import type { JsonObject } from "../../domain/json.js";
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

export interface OpenAIResponsesProviderOptions extends ApiCredentialOptions {
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetch?: FetchClient;
  models?: string[];
}

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAIResponsesProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "model" } = {
    id: "openai-responses",
    displayName: "OpenAI Responses API",
    kind: "model",
    version: "1.0.0",
    capabilities: ["chat", "tool_use", "parallel_tool_use", "streaming", "structured_output"],
    authentication: ["api_key"],
  };

  readonly #options: OpenAIResponsesProviderOptions;
  readonly #fetch: FetchClient;

  public constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.#options = options;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  public async availability(signal?: AbortSignal): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models?: string[];
    detail?: string;
  }> {
    const apiKey = await resolveApiKey(this.#options);
    if (apiKey === undefined) {
      return { installed: true, authenticated: false, available: false, detail: "API key missing" };
    }
    if (this.#options.models !== undefined) {
      return {
        installed: true,
        authenticated: true,
        available: true,
        models: this.#options.models,
      };
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
      return { installed: true, authenticated: true, available: true };
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
      if (apiKey === undefined) {
        yield { type: "error", error: "OpenAI API key is not configured", retryable: false };
        return;
      }
      const response = await this.#fetch(`${this.#baseUrl()}/responses`, {
        method: "POST",
        headers: { ...this.#headers(apiKey), "content-type": "application/json" },
        body: JSON.stringify(toOpenAIRequest(request)),
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
      const pending = new Map<string, PendingCall>();
      const completedCalls: ToolCallContent[] = [];
      for await (const frame of readServerSentEvents(response, signal)) {
        if (frame.data === "[DONE]") break;
        const event = parseJsonObject(frame.data, "OpenAI stream event");
        const type = stringField(event, "type") ?? frame.event;
        if (type === "response.output_text.delta") {
          const delta = stringField(event, "delta") ?? "";
          text += delta;
          if (delta.length > 0) yield { type: "text_delta", delta };
        } else if (type === "response.output_item.added") {
          const item = objectField(event, "item");
          if (item !== undefined && stringField(item, "type") === "function_call") {
            const key =
              stringField(item, "item_id") ?? stringField(item, "id") ?? `call-${pending.size}`;
            pending.set(key, {
              id: stringField(item, "call_id") ?? stringField(item, "id") ?? key,
              name: stringField(item, "name") ?? "unknown_tool",
              arguments: stringField(item, "arguments") ?? "",
            });
          }
        } else if (type === "response.function_call_arguments.delta") {
          const key = stringField(event, "item_id") ?? "";
          const current = pending.get(key);
          if (current !== undefined) current.arguments += stringField(event, "delta") ?? "";
        } else if (type === "response.function_call_arguments.done") {
          const key = stringField(event, "item_id") ?? "";
          const current = pending.get(key) ?? {
            id: stringField(event, "call_id") ?? key,
            name: stringField(event, "name") ?? "unknown_tool",
            arguments: "",
          };
          current.arguments = stringField(event, "arguments") ?? current.arguments;
          const call = finishCall(current);
          completedCalls.push(call);
          pending.delete(key);
          yield { type: "tool_call", call };
        } else if (type === "response.completed") {
          const responseObject = objectField(event, "response");
          usage = parseOpenAIUsage(
            responseObject === undefined ? undefined : objectField(responseObject, "usage"),
          );
        } else if (type === "error" || type === "response.failed") {
          const failure =
            objectField(event, "error") ?? objectField(objectField(event, "response"), "error");
          yield {
            type: "error",
            error: stringField(failure, "message") ?? "OpenAI response failed",
            retryable: false,
          };
          return;
        }
      }
      for (const current of pending.values()) {
        const call = finishCall(current);
        completedCalls.push(call);
        yield { type: "tool_call", call };
      }
      if (usage !== undefined) yield { type: "usage", usage };
      yield { type: "completed", message: completedMessage(text, completedCalls) };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      yield { type: "error", error: errorMessage(error), retryable: error instanceof TypeError };
    }
  }

  #baseUrl(): string {
    return (this.#options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  #headers(apiKey: string): Record<string, string> {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(this.#options.organization === undefined
        ? {}
        : { "OpenAI-Organization": this.#options.organization }),
      ...(this.#options.project === undefined ? {} : { "OpenAI-Project": this.#options.project }),
    };
  }
}

function toOpenAIRequest(request: ModelRequest): JsonObject {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => message.content)
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n\n");
  const input: JsonObject[] = [];
  for (const message of request.messages) {
    if (message.role === "system") continue;
    const text = message.content
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    if (text.length > 0) input.push({ role: message.role, content: text });
    for (const content of message.content) {
      if (content.type === "tool_call") {
        input.push({
          type: "function_call",
          call_id: content.id,
          name: content.name,
          arguments: JSON.stringify(content.arguments),
        });
      } else if (content.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: content.toolCallId,
          output: JSON.stringify(content.content),
        });
      }
    }
  }
  return {
    model: request.model,
    stream: true,
    input,
    tools: request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    })),
    ...(instructions.length === 0 ? {} : { instructions }),
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
  };
}

function finishCall(pending: PendingCall): ToolCallContent {
  return {
    type: "tool_call",
    id: pending.id,
    name: pending.name,
    arguments:
      pending.arguments.length === 0 ? {} : parseJsonObject(pending.arguments, "tool arguments"),
  };
}

function completedMessage(text: string, calls: ToolCallContent[]): ModelMessage {
  return {
    role: "assistant",
    content: [...(text.length === 0 ? [] : [{ type: "text" as const, text }]), ...calls],
  };
}

function parseOpenAIUsage(value: JsonObject | undefined): Usage | undefined {
  if (value === undefined) return undefined;
  const inputDetails = objectField(value, "input_tokens_details");
  const cachedInputTokens = numberField(inputDetails, "cached_tokens");
  return {
    inputTokens: numberField(value, "input_tokens") ?? 0,
    outputTokens: numberField(value, "output_tokens") ?? 0,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
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
