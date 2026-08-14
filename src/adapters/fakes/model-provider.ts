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

export type FakeModelAction =
  | { type: "text"; text: string; chunkSize?: number }
  | { type: "tool_call"; id?: string; name: string; arguments: JsonObject }
  | { type: "usage"; usage: Usage }
  | { type: "fail"; message: string; retryable?: boolean }
  | { type: "timeout"; delayMs: number }
  | { type: "complete"; text?: string; outcome?: "GOAL_COMPLETED" | "GOAL_BLOCKED" }
  | { type: "assert_context"; maximumMessages: number };

export class ScriptedModelProvider implements ModelProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "model" } = {
    id: "fake-model",
    displayName: "Scripted model",
    kind: "model",
    version: "1.0.0",
    capabilities: ["chat", "tool_use", "parallel_tool_use", "streaming", "structured_output"],
    authentication: ["none"],
  };

  readonly #scripts: FakeModelAction[][];
  public readonly requests: ModelRequest[] = [];

  public constructor(scripts: FakeModelAction[][]) {
    this.#scripts = scripts.map((script) => structuredClone(script));
  }

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models: string[];
  }> {
    return { installed: true, authenticated: true, available: true, models: ["scripted"] };
  }

  public async *invoke(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    const actions = this.#scripts.shift();
    if (actions === undefined) throw new Error("No scripted response remains");
    let text = "";
    const calls: ToolCallContent[] = [];

    for (const action of actions) {
      signal?.throwIfAborted();
      switch (action.type) {
        case "text": {
          const chunkSize = action.chunkSize ?? action.text.length;
          for (let offset = 0; offset < action.text.length; offset += chunkSize) {
            const delta = action.text.slice(offset, offset + chunkSize);
            text += delta;
            yield { type: "text_delta", delta };
          }
          break;
        }
        case "tool_call": {
          const call: ToolCallContent = {
            type: "tool_call",
            id: action.id ?? `call-${calls.length + 1}`,
            name: action.name,
            arguments: structuredClone(action.arguments),
          };
          calls.push(call);
          yield { type: "tool_call", call };
          break;
        }
        case "usage":
          yield { type: "usage", usage: structuredClone(action.usage) };
          break;
        case "fail":
          yield { type: "error", error: action.message, retryable: action.retryable ?? false };
          return;
        case "timeout":
          await wait(action.delayMs, signal);
          break;
        case "assert_context":
          if (request.messages.length > action.maximumMessages) {
            throw new Error(
              `Expected at most ${action.maximumMessages} messages, got ${request.messages.length}`,
            );
          }
          break;
        case "complete": {
          text += action.text ?? "";
          const message = completedMessage(text, calls);
          yield {
            type: "completed",
            message,
            ...(action.outcome === undefined ? {} : { outcome: action.outcome }),
          };
          return;
        }
      }
    }

    yield { type: "completed", message: completedMessage(text, calls) };
  }
}

function completedMessage(text: string, calls: ToolCallContent[]): ModelMessage {
  return {
    role: "assistant",
    content: [...(text.length === 0 ? [] : [{ type: "text" as const, text }]), ...calls],
  };
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      },
      { once: true },
    );
  });
}
