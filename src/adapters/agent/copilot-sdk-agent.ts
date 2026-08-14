import {
  CopilotClient,
  type CopilotClientOptions,
  type PermissionHandler,
  type SessionConfig,
  type SessionEvent,
} from "@github/copilot-sdk";
import type {
  AgentProviderEvent,
  AgentRequest,
  ProviderDescriptor,
} from "../../domain/providers.js";
import type { AgentProvider } from "../../ports/providers.js";
import type { PermissionProvider } from "../../ports/security.js";
import { AsyncEventQueue } from "./async-event-queue.js";

interface CopilotSessionLike {
  readonly sessionId: string;
  on(handler: (event: SessionEvent) => void): () => void;
  send(options: { prompt: string }): Promise<string>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  getAuthStatus(): Promise<{ isAuthenticated: boolean; statusMessage?: string }>;
  listModels(): Promise<Array<{ id: string }>>;
  createSession(config: SessionConfig): Promise<CopilotSessionLike>;
  resumeSession(sessionId: string, config: SessionConfig): Promise<CopilotSessionLike>;
}

export interface CopilotSdkAgentProviderOptions {
  clientOptions?: CopilotClientOptions;
  clientFactory?: () => CopilotClientLike;
  permissions?: PermissionProvider;
  timeoutMs?: number;
}

export class CopilotSdkAgentProvider implements AgentProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "agent" } = {
    id: "github-copilot-sdk",
    displayName: "GitHub Copilot SDK",
    kind: "agent",
    version: "1.0.0",
    capabilities: [
      "reasoning",
      "tool_use",
      "parallel_tool_use",
      "streaming",
      "resume_session",
      "code_execution",
      "mcp",
      "skills",
      "hooks",
      "subagents",
      "context_compaction",
    ],
    authentication: ["cli_session", "oauth", "api_key"],
  };

  readonly #options: CopilotSdkAgentProviderOptions;
  readonly #active = new Map<string, CopilotSessionLike>();

  public constructor(options: CopilotSdkAgentProviderOptions = {}) {
    this.#options = options;
  }

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models?: string[];
    detail?: string;
  }> {
    const client = this.#client();
    try {
      await client.start();
      const auth = await client.getAuthStatus();
      const models = auth.isAuthenticated
        ? (await client.listModels()).map((model) => model.id)
        : [];
      return {
        installed: true,
        authenticated: auth.isAuthenticated,
        available: auth.isAuthenticated,
        ...(models.length === 0 ? {} : { models }),
        ...(auth.statusMessage === undefined ? {} : { detail: auth.statusMessage }),
      };
    } catch (error) {
      return {
        installed: false,
        authenticated: false,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await client.stop().catch(() => []);
    }
  }

  public async *run(
    request: AgentRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    const client = this.#client();
    let session: CopilotSessionLike | undefined;
    const queue = new AsyncEventQueue<AgentProviderEvent>();
    const toolNames = new Map<string, string>();
    let summary = "";
    let sawDeltas = false;
    try {
      await client.start();
      const config: SessionConfig = {
        clientName: "Fable",
        workingDirectory: request.workspacePath,
        streaming: true,
        coauthorEnabled: false,
        enableManagedSettings: true,
        onPermissionRequest: this.#permissionHandler(request),
        ...(request.model === undefined ? {} : { model: request.model }),
      };
      session =
        request.sessionId === undefined
          ? await client.createSession(config)
          : await client.resumeSession(request.sessionId, config);
      this.#active.set(session.sessionId, session);
      queue.push({ type: "session", sessionId: session.sessionId });
      const unsubscribe = session.on((event) => {
        if (event.type === "assistant.message_delta") {
          sawDeltas = true;
          summary += event.data.deltaContent;
          queue.push({ type: "message", text: event.data.deltaContent });
        } else if (event.type === "assistant.message") {
          summary = event.data.content;
          if (!sawDeltas) queue.push({ type: "message", text: event.data.content });
        } else if (event.type === "tool.execution_start") {
          toolNames.set(event.data.toolCallId, event.data.toolName);
          queue.push({ type: "tool", name: event.data.toolName, status: "started" });
        } else if (event.type === "tool.execution_complete") {
          const name =
            toolNames.get(event.data.toolCallId) ?? event.data.toolDescription?.name ?? "tool";
          toolNames.delete(event.data.toolCallId);
          queue.push({
            type: "tool",
            name,
            status: event.data.success ? "completed" : "failed",
          });
        } else if (event.type === "assistant.usage") {
          queue.push({
            type: "usage",
            usage: {
              inputTokens: event.data.inputTokens ?? 0,
              outputTokens: event.data.outputTokens ?? 0,
              ...(event.data.cacheReadTokens === undefined
                ? {}
                : { cachedInputTokens: event.data.cacheReadTokens }),
              subscriptionRequests: 1,
            },
          });
        } else if (event.type === "session.error") {
          queue.push({
            type: "error",
            error: event.data.message,
            retryable: ["rate_limit", "server_error"].includes(event.data.errorType),
          });
        } else if (event.type === "session.idle") {
          queue.push({
            type: "completed",
            outcome: event.data.aborted === true ? "CANCELLED" : "GOAL_COMPLETED",
            summary,
          });
          queue.end();
        }
      });
      const onAbort = () => {
        if (session !== undefined)
          void session.abort().catch((error: unknown) => queue.fail(error));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void session.send({ prompt: request.goal }).catch((error: unknown) => queue.fail(error));
      try {
        yield* queue;
      } finally {
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      if (signal?.aborted === true) yield { type: "completed", outcome: "CANCELLED" };
      else {
        yield {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
          retryable: false,
        };
        yield { type: "completed", outcome: "FATAL_FAILURE", summary };
      }
    } finally {
      if (session !== undefined) {
        this.#active.delete(session.sessionId);
        await session.disconnect().catch(() => undefined);
      }
      await client.stop().catch(() => []);
    }
  }

  public async cancel(sessionId: string): Promise<void> {
    await this.#active.get(sessionId)?.abort();
  }

  #client(): CopilotClientLike {
    if (this.#options.clientFactory !== undefined) return this.#options.clientFactory();
    return new CopilotClient(this.#options.clientOptions);
  }

  #permissionHandler(request: AgentRequest): PermissionHandler {
    return async (permission) => {
      if (permission.managedApprovalRequired === true || this.#options.permissions === undefined) {
        return { kind: "user-not-available" };
      }
      const evaluation = await this.#options.permissions.evaluate({
        capability: permissionCapability(permission.kind),
        resource: permissionResource(permission),
        operation: `copilot.${permission.kind}`,
        providerId: this.descriptor.id,
        ...(typeof request.metadata?.["runId"] === "string"
          ? { runId: request.metadata["runId"] }
          : {}),
      });
      return evaluation.decision === "allow" || evaluation.decision === "sandbox-only"
        ? { kind: "approved" }
        : evaluation.decision === "ask"
          ? { kind: "user-not-available" }
          : { kind: "reject", feedback: evaluation.reason, forceReject: true };
    };
  }
}

function permissionCapability(
  kind: string,
): "filesystem.read" | "filesystem.write" | "process.execute" | "network.connect" {
  if (kind === "read" || kind === "memory") return "filesystem.read";
  if (kind === "write") return "filesystem.write";
  if (kind === "url") return "network.connect";
  return "process.execute";
}

function permissionResource(permission: Parameters<PermissionHandler>[0]): string {
  if (permission.kind === "shell") return permission.fullCommandText;
  if (permission.kind === "write") return permission.fileName;
  if (permission.kind === "read") return permission.path;
  if (permission.kind === "url") return permission.url;
  if (permission.kind === "mcp") return `${permission.serverName}.${permission.toolName}`;
  return permission.kind;
}
