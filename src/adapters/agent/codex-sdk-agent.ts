import {
  Codex,
  type CodexOptions,
  type ThreadEvent,
  type ThreadItem,
  type ThreadOptions,
} from "@openai/codex-sdk";
import type {
  AgentProviderEvent,
  AgentRequest,
  ProviderDescriptor,
} from "../../domain/providers.js";
import type { AgentProvider } from "../../ports/providers.js";
import type { SecretProvider } from "../../ports/security.js";

interface CodexThreadLike {
  runStreamed(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    events: AsyncGenerator<ThreadEvent>;
  }>;
}

interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike;
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike;
}

export interface CodexSdkAgentProviderOptions {
  apiKey?: string;
  apiKeyReference?: string;
  secrets?: SecretProvider;
  codexPathOverride?: string;
  baseUrl?: string;
  env?: Record<string, string>;
  networkAccessEnabled?: boolean;
  approvalPolicy?: ThreadOptions["approvalPolicy"];
  clientFactory?: (options: CodexOptions) => CodexClientLike;
  authenticationProbe?: () => Promise<boolean>;
}

export class CodexSdkAgentProvider implements AgentProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "agent" } = {
    id: "codex-sdk",
    displayName: "OpenAI Codex",
    kind: "agent",
    version: "1.0.0",
    capabilities: [
      "reasoning",
      "tool_use",
      "streaming",
      "resume_session",
      "code_execution",
      "mcp",
      "skills",
    ],
    authentication: ["cli_session", "device_code", "api_key"],
  };

  readonly #options: CodexSdkAgentProviderOptions;

  public constructor(options: CodexSdkAgentProviderOptions = {}) {
    this.#options = options;
  }

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    detail?: string;
  }> {
    const apiKey = await this.#apiKey();
    const authenticated =
      apiKey !== undefined ||
      (this.#options.authenticationProbe === undefined
        ? true
        : await this.#options.authenticationProbe());
    return {
      installed: true,
      authenticated,
      available: authenticated,
      ...(!authenticated ? { detail: "Run `codex login` or configure an API key" } : {}),
    };
  }

  public async *run(
    request: AgentRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    try {
      const apiKey = await this.#apiKey();
      const clientOptions: CodexOptions = {
        ...(this.#options.codexPathOverride === undefined
          ? {}
          : { codexPathOverride: this.#options.codexPathOverride }),
        ...(this.#options.baseUrl === undefined ? {} : { baseUrl: this.#options.baseUrl }),
        ...(this.#options.env === undefined ? {} : { env: this.#options.env }),
        ...(apiKey === undefined ? {} : { apiKey }),
      };
      const client = (this.#options.clientFactory ?? ((value) => new Codex(value)))(clientOptions);
      const threadOptions: ThreadOptions = {
        workingDirectory: request.workspacePath,
        skipGitRepoCheck: false,
        sandboxMode: "workspace-write",
        approvalPolicy: this.#options.approvalPolicy ?? "never",
        networkAccessEnabled: this.#options.networkAccessEnabled ?? false,
        ...(request.model === undefined ? {} : { model: request.model }),
      };
      const thread =
        request.sessionId === undefined
          ? client.startThread(threadOptions)
          : client.resumeThread(request.sessionId, threadOptions);
      const streamed = await thread.runStreamed(request.goal, {
        ...(signal === undefined ? {} : { signal }),
      });
      let summary = "";
      for await (const event of streamed.events) {
        signal?.throwIfAborted();
        if (event.type === "thread.started") {
          yield { type: "session", sessionId: event.thread_id };
        } else if (event.type === "item.started") {
          const toolName = codexToolName(event.item);
          if (toolName !== undefined) yield { type: "tool", name: toolName, status: "started" };
        } else if (event.type === "item.completed") {
          if (event.item.type === "agent_message") {
            summary += event.item.text;
            yield { type: "message", text: event.item.text };
          } else {
            const toolName = codexToolName(event.item);
            if (toolName !== undefined) {
              yield {
                type: "tool",
                name: toolName,
                status: codexToolFailed(event.item) ? "failed" : "completed",
              };
            }
          }
        } else if (event.type === "turn.completed") {
          yield {
            type: "usage",
            usage: {
              inputTokens: event.usage.input_tokens,
              outputTokens: event.usage.output_tokens,
              cachedInputTokens: event.usage.cached_input_tokens,
              subscriptionRequests: 1,
            },
          };
          yield { type: "completed", outcome: "GOAL_COMPLETED", summary };
        } else if (event.type === "turn.failed") {
          yield { type: "error", error: event.error.message, retryable: false };
          yield { type: "completed", outcome: "FATAL_FAILURE", summary };
        } else if (event.type === "error") {
          yield { type: "error", error: event.message, retryable: false };
        }
      }
    } catch (error) {
      if (signal?.aborted === true) {
        yield { type: "completed", outcome: "CANCELLED" };
        return;
      }
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
      yield { type: "completed", outcome: "FATAL_FAILURE" };
    }
  }

  async #apiKey(): Promise<string | undefined> {
    if (this.#options.apiKey !== undefined) return this.#options.apiKey;
    if (this.#options.apiKeyReference === undefined || this.#options.secrets === undefined)
      return undefined;
    return this.#options.secrets.get(this.#options.apiKeyReference);
  }
}

function codexToolName(item: ThreadItem): string | undefined {
  if (item.type === "command_execution") return "command";
  if (item.type === "file_change") return "file_change";
  if (item.type === "mcp_tool_call") return `${item.server}.${item.tool}`;
  if (item.type === "web_search") return "web_search";
  return undefined;
}

function codexToolFailed(item: ThreadItem): boolean {
  if (item.type === "command_execution") return item.status === "failed";
  if (item.type === "file_change") return item.status === "failed";
  if (item.type === "mcp_tool_call") return item.status === "failed";
  return false;
}
