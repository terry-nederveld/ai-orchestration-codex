import type { JsonObject, JsonValue } from "../../domain/json.js";
import type {
  AgentProviderEvent,
  AgentRequest,
  GoalOutcome,
  ProviderDescriptor,
} from "../../domain/providers.js";
import type { StreamingProcessRunner } from "../../ports/process.js";
import type { AgentProvider } from "../../ports/providers.js";
import { isJsonObject } from "../model/http-support.js";

export interface ClaudeCodeAgentProviderOptions {
  runner: StreamingProcessRunner;
  executable?: string;
  env?: Record<string, string>;
  permissionMode?: "default" | "acceptEdits" | "plan";
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  consumption?: "subscription" | "api";
}

export class ClaudeCodeAgentProvider implements AgentProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "agent" } = {
    id: "claude-code",
    displayName: "Claude Code",
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
    ],
    authentication: ["cli_session", "oauth", "api_key"],
  };

  readonly #options: ClaudeCodeAgentProviderOptions;

  public constructor(options: ClaudeCodeAgentProviderOptions) {
    this.#options = options;
  }

  public async availability(signal?: AbortSignal): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    detail?: string;
  }> {
    try {
      const result = await this.#options.runner.run(
        {
          command: this.#executable(),
          args: ["auth", "status"],
          cwd: process.cwd(),
          ...(this.#options.env === undefined ? {} : { env: this.#options.env }),
          timeoutMs: 15_000,
          maxOutputBytes: 64_000,
        },
        signal,
      );
      return {
        installed: true,
        authenticated: result.exitCode === 0,
        available: result.exitCode === 0,
        ...(result.exitCode === 0
          ? {}
          : { detail: result.stderr || result.stdout || "Run `claude auth login`" }),
      };
    } catch (error) {
      return {
        installed: false,
        authenticated: false,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async *run(
    request: AgentRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    const args = this.#arguments(request);
    let lineBuffer = "";
    let stderr = "";
    let completed = false;
    const toolNames = new Map<string, string>();
    try {
      for await (const event of this.#options.runner.stream(
        {
          command: this.#executable(),
          args,
          cwd: request.workspacePath,
          ...(this.#options.env === undefined ? {} : { env: this.#options.env }),
          ...(this.#options.timeoutMs === undefined ? {} : { timeoutMs: this.#options.timeoutMs }),
          maxOutputBytes: 10_000_000,
        },
        signal,
      )) {
        if (event.type === "stderr") {
          stderr += event.data;
          continue;
        }
        if (event.type === "stdout") {
          lineBuffer += event.data;
          const lines = lineBuffer.split("\n");
          lineBuffer = lines.pop() ?? "";
          for (const line of lines) {
            for (const normalized of normalizeClaudeEvent(
              line,
              toolNames,
              this.#options.consumption,
            )) {
              if (normalized.type === "completed") completed = true;
              yield normalized;
            }
          }
          continue;
        }
        if (lineBuffer.trim().length > 0) {
          for (const normalized of normalizeClaudeEvent(
            lineBuffer,
            toolNames,
            this.#options.consumption,
          )) {
            if (normalized.type === "completed") completed = true;
            yield normalized;
          }
          lineBuffer = "";
        }
        if (event.result.exitCode !== 0 && !completed) {
          yield {
            type: "error",
            error: stderr.trim() || `Claude Code exited with ${event.result.exitCode}`,
            retryable: false,
          };
          yield { type: "completed", outcome: "FATAL_FAILURE" };
          completed = true;
        }
      }
      if (!completed) yield { type: "completed", outcome: "FATAL_FAILURE", summary: stderr.trim() };
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

  #arguments(request: AgentRequest): string[] {
    const args = [
      "-p",
      request.goal,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      this.#options.permissionMode ?? "acceptEdits",
    ];
    if (request.sessionId !== undefined) args.push("--resume", request.sessionId);
    if (request.model !== undefined) args.push("--model", request.model);
    if (this.#options.allowedTools !== undefined) {
      args.push("--allowedTools", ...this.#options.allowedTools);
    }
    if (this.#options.disallowedTools !== undefined) {
      args.push("--disallowedTools", ...this.#options.disallowedTools);
    }
    if (this.#options.maxTurns !== undefined)
      args.push("--max-turns", String(this.#options.maxTurns));
    if (this.#options.maxBudgetUsd !== undefined) {
      args.push("--max-budget-usd", String(this.#options.maxBudgetUsd));
    }
    return args;
  }

  #executable(): string {
    return this.#options.executable ?? "claude";
  }
}

function normalizeClaudeEvent(
  line: string,
  toolNames: Map<string, string>,
  consumption: "subscription" | "api" | undefined,
): AgentProviderEvent[] {
  if (line.trim().length === 0) return [];
  let event: JsonObject;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isJsonObject(parsed)) return [];
    event = parsed;
  } catch {
    return [{ type: "message", text: line }];
  }
  const type = textField(event, "type");
  if (type === "system" && textField(event, "subtype") === "init") {
    const sessionId = textField(event, "session_id");
    return sessionId === undefined ? [] : [{ type: "session", sessionId }];
  }
  if (type === "stream_event") {
    const streamEvent = objectField(event, "event");
    const delta = objectField(streamEvent, "delta");
    return textField(delta, "type") === "text_delta" && textField(delta, "text") !== undefined
      ? [{ type: "message", text: textField(delta, "text") ?? "" }]
      : [];
  }
  if (type === "assistant" || type === "user") {
    const message = objectField(event, "message");
    const content = arrayField(message, "content");
    const normalized: AgentProviderEvent[] = [];
    for (const block of content) {
      if (!isJsonObject(block)) continue;
      const blockType = textField(block, "type");
      if (type === "assistant" && blockType === "tool_use") {
        const id = textField(block, "id") ?? "unknown";
        const name = textField(block, "name") ?? "unknown_tool";
        toolNames.set(id, name);
        normalized.push({ type: "tool", name, status: "started" });
      } else if (type === "user" && blockType === "tool_result") {
        const id = textField(block, "tool_use_id") ?? "unknown";
        normalized.push({
          type: "tool",
          name: toolNames.get(id) ?? "unknown_tool",
          status: block["is_error"] === true ? "failed" : "completed",
        });
      }
    }
    return normalized;
  }
  if (type === "result") {
    const usage = objectField(event, "usage");
    const inputTokens = numberField(usage, "input_tokens") ?? 0;
    const outputTokens = numberField(usage, "output_tokens") ?? 0;
    const cachedInputTokens =
      (numberField(usage, "cache_read_input_tokens") ?? 0) +
      (numberField(usage, "cache_creation_input_tokens") ?? 0);
    const estimatedCostUsd = numberField(event, "total_cost_usd");
    const result: AgentProviderEvent[] = [];
    if (usage !== undefined || estimatedCostUsd !== undefined) {
      result.push({
        type: "usage",
        usage: {
          inputTokens,
          outputTokens,
          ...(cachedInputTokens === 0 ? {} : { cachedInputTokens }),
          ...(estimatedCostUsd === undefined ? {} : { estimatedCostUsd }),
          ...(consumption === "api" ? {} : { subscriptionRequests: 1 }),
        },
      });
    }
    const summary = textField(event, "result");
    result.push({
      type: "completed",
      outcome: claudeOutcome(event),
      ...(summary === undefined ? {} : { summary }),
    });
    return result;
  }
  return [];
}

function claudeOutcome(event: JsonObject): GoalOutcome {
  if (event["is_error"] !== true) return "GOAL_COMPLETED";
  const subtype = textField(event, "subtype") ?? "";
  if (subtype.includes("max_turn") || subtype.includes("budget")) return "BUDGET_EXHAUSTED";
  return "FATAL_FAILURE";
}

function objectField(value: JsonObject | undefined, key: string): JsonObject | undefined {
  const field = value?.[key];
  return isJsonObject(field) ? field : undefined;
}

function textField(value: JsonObject | undefined, key: string): string | undefined {
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
