import { describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "../../src/adapters/fakes/model-provider.js";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { NativeAgentRuntime } from "../../src/application/agent/native-runtime.js";
import { SlidingWindowContextManager } from "../../src/application/agent/context-manager.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { RuleBasedPermissionProvider } from "../../src/application/policy-engine.js";
import { ProviderRegistry } from "../../src/application/provider-registry.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";

function createRuntime(
  provider: ScriptedModelProvider,
  persistence = new InMemoryPersistenceProvider(),
) {
  const models = new ProviderRegistry<ScriptedModelProvider>();
  models.register(provider);
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "Echo input",
    inputSchema: { type: "object" },
    permissions: ["filesystem.read"],
    execute: async (input) => ({ content: input }),
  });
  const events = new InMemoryEventBus();
  const eventTypes: string[] = [];
  events.subscribe("*", (event) => {
    eventTypes.push(event.type);
  });
  const runtime = new NativeAgentRuntime(
    models,
    tools,
    new RuleBasedPermissionProvider([{ capability: "*", decision: "allow" }]),
    events,
    new SlidingWindowContextManager(20),
    persistence,
  );
  return { runtime, provider, persistence, eventTypes };
}

const request = {
  runId: "run-1",
  goal: "Complete the deterministic task",
  workspacePath: "/workspace",
  providerId: "fake-model",
  model: "scripted",
  budgets: { maxIterations: 5, maxInputTokens: 1_000 },
};

describe("NativeAgentRuntime", () => {
  it("executes tool calls and continues until explicit goal completion", async () => {
    const provider = new ScriptedModelProvider([
      [
        { type: "text", text: "Checking" },
        { type: "tool_call", name: "echo", arguments: { value: "ok" } },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
        { type: "complete" },
      ],
      [
        { type: "text", text: "GOAL_COMPLETED" },
        { type: "usage", usage: { inputTokens: 5, outputTokens: 1 } },
        { type: "complete" },
      ],
    ]);
    const { runtime, persistence, eventTypes } = createRuntime(provider);
    await persistence.initialize();

    const result = await runtime.run(request);

    expect(result).toMatchObject({
      outcome: "GOAL_COMPLETED",
      turns: 2,
      toolCalls: 1,
      usage: { inputTokens: 15, outputTokens: 3 },
    });
    expect(provider.requests[1]?.messages.some(({ role }) => role === "tool")).toBe(true);
    expect(eventTypes).toContain("tool.completed");
    expect(eventTypes.at(-1)).toBe("agent.completed");
    await expect(
      persistence.entities.get("agent_session", result.sessionId),
    ).resolves.toBeDefined();
  });

  it("retries transient model failures without counting another agent turn", async () => {
    const provider = new ScriptedModelProvider([
      [{ type: "fail", message: "rate limited", retryable: true }],
      [{ type: "complete", text: "done", outcome: "GOAL_COMPLETED" }],
    ]);
    const { runtime, persistence } = createRuntime(provider);
    await persistence.initialize();

    const result = await runtime.run(request);
    expect(result.outcome).toBe("GOAL_COMPLETED");
    expect(result.turns).toBe(1);
    expect(provider.requests).toHaveLength(2);
  });

  it("stops when an iteration budget is exhausted instead of looping on prose", async () => {
    const provider = new ScriptedModelProvider([[{ type: "complete", text: "Still working" }]]);
    const { runtime, persistence } = createRuntime(provider);
    await persistence.initialize();

    const result = await runtime.run({
      ...request,
      budgets: { maxIterations: 1 },
    });
    expect(result.outcome).toBe("BUDGET_EXHAUSTED");
    expect(result.turns).toBe(1);
  });

  it("returns cancellation when the caller aborts a pending provider", async () => {
    const provider = new ScriptedModelProvider([
      [{ type: "timeout", delayMs: 1_000 }, { type: "complete" }],
    ]);
    const { runtime, persistence } = createRuntime(provider);
    await persistence.initialize();
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("operator cancelled")), 10);

    const result = await runtime.run(request, controller.signal);
    expect(result.outcome).toBe("CANCELLED");
    expect(result.summary).toBe("operator cancelled");
  });
});
