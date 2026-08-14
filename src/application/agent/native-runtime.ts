import { randomUUID } from "node:crypto";
import { BudgetManager } from "../budget-manager.js";
import { EventFactory } from "../events.js";
import { emptyConsumption, type BudgetConsumption } from "../../domain/budgets.js";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type {
  GoalOutcome,
  ModelEvent,
  ModelMessage,
  ModelToolDefinition,
  ToolCallContent,
  Usage,
} from "../../domain/providers.js";
import type {
  AgentRuntime,
  AgentRuntimeRequest,
  AgentRuntimeResult,
  ContextManager,
} from "../../ports/agent-runtime.js";
import type { EventBus } from "../../ports/event-bus.js";
import type { PersistenceProvider } from "../../ports/persistence.js";
import type { ModelProvider } from "../../ports/providers.js";
import type { PermissionProvider } from "../../ports/security.js";
import type { ToolDefinition, ToolProvider, ToolResult } from "../../ports/tools.js";
import type { HookRegistry } from "../hooks.js";
import type { ProviderRegistry } from "../provider-registry.js";

interface PersistedSession extends JsonObject {
  runId: string;
  sessionId: string;
  goal: string;
  messages: JsonValue;
  usage: JsonObject;
  turns: number;
  toolCalls: number;
  startedAt: string;
  updatedAt: string;
}

interface TurnCollection {
  text: string;
  calls: ToolCallContent[];
  message?: ModelMessage;
  outcome?: GoalOutcome;
  usage: Usage;
  error?: { message: string; retryable: boolean };
}

export class NativeAgentRuntime implements AgentRuntime {
  public constructor(
    private readonly models: ProviderRegistry<ModelProvider>,
    private readonly tools: ToolProvider,
    private readonly permissions: PermissionProvider,
    private readonly events: EventBus,
    private readonly contextManager: ContextManager,
    private readonly persistence?: PersistenceProvider,
    private readonly hooks?: HookRegistry,
  ) {}

  public async run(
    request: AgentRuntimeRequest,
    externalSignal?: AbortSignal,
  ): Promise<AgentRuntimeResult> {
    const startedAt = new Date().toISOString();
    const sessionId = request.sessionId ?? randomUUID();
    const limits = {
      maxIterations: 20,
      maxWallClockMs: 3_600_000,
      ...request.budgets,
    };
    const timeoutSignal =
      limits.maxWallClockMs === undefined
        ? new AbortController().signal
        : AbortSignal.timeout(limits.maxWallClockMs);
    const signal = AbortSignal.any([externalSignal ?? new AbortController().signal, timeoutSignal]);
    const eventFactory = new EventFactory({ source: "native-agent-runtime", runId: request.runId });
    const budget = new BudgetManager(limits);
    const restored = await this.restoreSession(sessionId);
    const messages = restored?.messages ?? initialMessages(request);
    const usage: BudgetConsumption = restored?.consumption ?? emptyConsumption();
    let turns = restored?.turns ?? 0;
    let toolCalls = restored?.toolCalls ?? 0;
    const started = restored?.startedAt ?? startedAt;

    const requiredCapabilities = [
      ...(request.requiredCapabilities ?? []),
      ...(this.tools.list().length === 0 ? [] : (["tool_use"] as const)),
    ];
    const provider = await this.models.select({
      ...(request.providerId === undefined ? {} : { id: request.providerId }),
      capabilities: requiredCapabilities,
    });
    await this.events.publish(
      eventFactory.create("agent.started", {
        sessionId,
        provider: provider.descriptor.id,
        model: request.model,
      }),
    );

    try {
      await this.hooks?.execute(
        "before_agent_start",
        {
          runId: request.runId,
          sessionId,
          provider: provider.descriptor.id,
          model: request.model,
          goal: request.goal,
        },
        signal,
      );
      while (true) {
        signal.throwIfAborted();
        usage.wallClockMs = Date.now() - Date.parse(started);
        const check = budget.check(usage);
        if (!check.allowed) {
          await this.events.publish(
            eventFactory.create("budget.exhausted", { dimensions: check.exhausted }),
          );
          return this.result(
            request,
            sessionId,
            "BUDGET_EXHAUSTED",
            `Budget exhausted: ${check.exhausted.join(", ")}`,
            messages,
            usage,
            turns,
            toolCalls,
            started,
          );
        }
        if (check.warnings.length > 0) {
          await this.events.publish(
            eventFactory.create("budget.warning", { dimensions: check.warnings }),
          );
        }

        turns += 1;
        usage.iterations = turns;
        const compacted = await this.contextManager.compact(messages);
        await this.events.publish(
          eventFactory.create("agent.turn.started", { sessionId, turn: turns }),
        );
        const turn = await this.invokeWithRetry(provider, request, compacted, signal, eventFactory);
        addUsage(usage, turn.usage);

        if (turn.error !== undefined) {
          return this.result(
            request,
            sessionId,
            "FATAL_FAILURE",
            turn.error.message,
            messages,
            usage,
            turns,
            toolCalls,
            started,
          );
        }

        const assistantMessage = turn.message ?? assistantMessageFrom(turn.text, turn.calls);
        messages.push(assistantMessage);
        const inferredOutcome = turn.outcome ?? parseOutcome(turn.text);
        if (inferredOutcome !== undefined) {
          await this.persistSession(request, sessionId, messages, usage, turns, toolCalls, started);
          await this.hooks?.execute(
            "after_agent_turn",
            { runId: request.runId, sessionId, turn: turns, outcome: inferredOutcome },
            signal,
          );
          return this.result(
            request,
            sessionId,
            inferredOutcome,
            turn.text || inferredOutcome,
            messages,
            usage,
            turns,
            toolCalls,
            started,
          );
        }

        if (turn.calls.length > 0) {
          toolCalls += turn.calls.length;
          const results = await Promise.all(
            turn.calls.map((call) =>
              this.executeTool(call, request, sessionId, signal, eventFactory),
            ),
          );
          messages.push({
            role: "tool",
            content: results.map((result, index) => ({
              type: "tool_result" as const,
              toolCallId: turn.calls[index]!.id,
              content: result.content,
              ...(result.isError === undefined ? {} : { isError: result.isError }),
            })),
          });
        } else {
          messages.push({
            role: "user",
            content: [
              {
                type: "text",
                text: "Continue working toward the goal. When terminal, report exactly one explicit outcome: GOAL_COMPLETED, GOAL_BLOCKED, HUMAN_INPUT_REQUIRED, POLICY_BLOCKED, or FATAL_FAILURE.",
              },
            ],
          });
        }

        await this.persistSession(request, sessionId, messages, usage, turns, toolCalls, started);
        await this.hooks?.execute(
          "after_agent_turn",
          { runId: request.runId, sessionId, turn: turns },
          signal,
        );
        await this.events.publish(
          eventFactory.create("agent.turn.completed", { sessionId, turn: turns }),
        );
      }
    } catch (error) {
      const outcome: GoalOutcome = signal.aborted ? "CANCELLED" : "FATAL_FAILURE";
      return this.result(
        request,
        sessionId,
        outcome,
        error instanceof Error ? error.message : String(error),
        messages,
        usage,
        turns,
        toolCalls,
        started,
      );
    }
  }

  private async invokeWithRetry(
    provider: ModelProvider,
    request: AgentRuntimeRequest,
    messages: ModelMessage[],
    signal: AbortSignal,
    eventFactory: EventFactory,
  ): Promise<TurnCollection> {
    const maximumAttempts = 3;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const result: TurnCollection = {
        text: "",
        calls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      await this.events.publish(
        eventFactory.create("model.request.started", {
          provider: provider.descriptor.id,
          model: request.model,
          attempt,
        }),
      );
      for await (const event of provider.invoke(
        {
          model: request.model,
          messages,
          tools: this.modelTools(),
          ...(request.budgets.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: request.budgets.maxOutputTokens }),
          metadata: { runId: request.runId },
        },
        signal,
      )) {
        collectEvent(result, event);
      }
      await this.events.publish(
        eventFactory.create("model.request.completed", {
          provider: provider.descriptor.id,
          model: request.model,
          attempt,
          retryableError: result.error?.retryable ?? false,
        }),
      );
      if (result.error === undefined || !result.error.retryable || attempt === maximumAttempts) {
        return result;
      }
      await delay(250 * 2 ** (attempt - 1), signal);
    }
    throw new Error("Unreachable provider retry state");
  }

  private async executeTool(
    call: ToolCallContent,
    request: AgentRuntimeRequest,
    sessionId: string,
    signal: AbortSignal,
    eventFactory: EventFactory,
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (tool === undefined) return { content: `Unknown tool: ${call.name}`, isError: true };
    const resource = inferResource(call.arguments, tool);
    for (const capability of tool.permissions) {
      const evaluation = await this.permissions.evaluate({
        capability,
        resource,
        operation: tool.name,
        runId: request.runId,
      });
      if (evaluation.decision === "deny" || evaluation.decision === "ask") {
        await this.events.publish(
          eventFactory.create("tool.blocked", {
            tool: tool.name,
            capability,
            decision: evaluation.decision,
            reason: evaluation.reason,
          }),
        );
        return {
          content:
            evaluation.decision === "ask"
              ? `Human approval required for ${capability} on ${resource}`
              : `Policy denied ${capability} on ${resource}`,
          isError: true,
        };
      }
      if (evaluation.decision === "sandbox-only" && request.metadata?.["sandboxed"] !== true) {
        return { content: `Tool requires a sandbox: ${tool.name}`, isError: true };
      }
    }

    await this.hooks?.execute(
      "before_tool_call",
      { runId: request.runId, sessionId, tool: tool.name, input: call.arguments },
      signal,
    );
    await this.events.publish(
      eventFactory.create("tool.started", { tool: tool.name, callId: call.id }),
    );
    try {
      const result = await tool.execute(call.arguments, {
        runId: request.runId,
        workspacePath: request.workspacePath,
        signal,
        metadata: request.metadata ?? {},
      });
      await this.events.publish(
        eventFactory.create("tool.completed", { tool: tool.name, callId: call.id }),
      );
      await this.hooks?.execute(
        "after_tool_call",
        {
          runId: request.runId,
          sessionId,
          tool: tool.name,
          callId: call.id,
          isError: result.isError ?? false,
        },
        signal,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.events.publish(
        eventFactory.create("tool.failed", { tool: tool.name, callId: call.id, error: message }),
      );
      return { content: message, isError: true };
    }
  }

  private modelTools(): ModelToolDefinition[] {
    return this.tools.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  private async restoreSession(sessionId: string): Promise<
    | {
        messages: ModelMessage[];
        consumption: BudgetConsumption;
        turns: number;
        toolCalls: number;
        startedAt: string;
      }
    | undefined
  > {
    const entity = await this.persistence?.entities.get<PersistedSession>(
      "agent_session",
      sessionId,
    );
    if (entity === undefined) return undefined;
    return {
      messages: entity.value.messages as unknown as ModelMessage[],
      consumption: entity.value.usage as unknown as BudgetConsumption,
      turns: entity.value.turns,
      toolCalls: entity.value.toolCalls,
      startedAt: entity.value.startedAt,
    };
  }

  private async persistSession(
    request: AgentRuntimeRequest,
    sessionId: string,
    messages: ModelMessage[],
    usage: BudgetConsumption,
    turns: number,
    toolCalls: number,
    startedAt: string,
  ): Promise<void> {
    if (this.persistence === undefined) return;
    const session: PersistedSession = {
      runId: request.runId,
      sessionId,
      goal: request.goal,
      messages: toJson(messages),
      usage: toJson(usage) as JsonObject,
      turns,
      toolCalls,
      startedAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put("agent_session", sessionId, session);
  }

  private async result(
    request: AgentRuntimeRequest,
    sessionId: string,
    outcome: GoalOutcome,
    summary: string,
    messages: ModelMessage[],
    usage: BudgetConsumption,
    turns: number,
    toolCalls: number,
    startedAt: string,
  ): Promise<AgentRuntimeResult> {
    await this.persistSession(request, sessionId, messages, usage, turns, toolCalls, startedAt);
    await this.events.publish(
      new EventFactory({ source: "native-agent-runtime", runId: request.runId }).create(
        "agent.completed",
        { sessionId, outcome, turns, toolCalls },
      ),
    );
    return {
      runId: request.runId,
      sessionId,
      outcome,
      summary,
      messages,
      usage: publicUsage(usage),
      turns,
      toolCalls,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}

function initialMessages(request: AgentRuntimeRequest): ModelMessage[] {
  return [
    {
      role: "system",
      content: [
        {
          type: "text",
          text:
            request.systemPrompt ??
            "Work autonomously toward the user's goal. Use tools when needed. Completion is explicit; report one terminal outcome only when it is true.",
        },
      ],
    },
    { role: "user", content: [{ type: "text", text: request.goal }] },
  ];
}

function collectEvent(result: TurnCollection, event: ModelEvent): void {
  switch (event.type) {
    case "text_delta":
      result.text += event.delta;
      break;
    case "tool_call":
      result.calls.push(event.call);
      break;
    case "usage":
      addUsage(result.usage, event.usage);
      break;
    case "completed":
      result.message = event.message;
      if (result.text.length === 0) {
        result.text = event.message.content
          .filter((content) => content.type === "text")
          .map((content) => content.text)
          .join("");
      }
      if (event.outcome !== undefined) result.outcome = event.outcome;
      break;
    case "error":
      result.error = { message: event.error, retryable: event.retryable };
      break;
  }
}

function assistantMessageFrom(text: string, calls: ToolCallContent[]): ModelMessage {
  return {
    role: "assistant",
    content: [...(text.length === 0 ? [] : [{ type: "text" as const, text }]), ...calls],
  };
}

function parseOutcome(text: string): GoalOutcome | undefined {
  const match =
    /\b(GOAL_COMPLETED|GOAL_BLOCKED|BUDGET_EXHAUSTED|POLICY_BLOCKED|HUMAN_INPUT_REQUIRED|FATAL_FAILURE|CANCELLED)\b/.exec(
      text,
    );
  return match?.[1] as GoalOutcome | undefined;
}

function addUsage(target: Usage, value: Usage): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cachedInputTokens = (target.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0);
  target.estimatedCostUsd = (target.estimatedCostUsd ?? 0) + (value.estimatedCostUsd ?? 0);
  target.subscriptionRequests =
    (target.subscriptionRequests ?? 0) + (value.subscriptionRequests ?? 0);
}

function publicUsage(value: BudgetConsumption): Usage {
  return {
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    ...(value.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: value.cachedInputTokens }),
    ...(value.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: value.estimatedCostUsd }),
    ...(value.subscriptionRequests === undefined
      ? {}
      : { subscriptionRequests: value.subscriptionRequests }),
  };
}

function inferResource(input: JsonObject, tool: ToolDefinition): string {
  for (const key of ["path", "url", "command", "resource"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return tool.name;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handle = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(handle);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      },
      { once: true },
    );
  });
}
