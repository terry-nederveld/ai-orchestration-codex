import { describe, expect, it, vi } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";
import { StepExecutionError, WorkflowEngine } from "../../src/application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../../src/application/workflows/handler-registry.js";
import type { WorkflowStepHandler } from "../../src/ports/workflow.js";

describe("WorkflowEngine", () => {
  it("runs independent steps in parallel, retries, repeats, evaluates conditions, and persists", async () => {
    const bus = new InMemoryEventBus();
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events: string[] = [];
    bus.subscribe("workflow.*", (event) => {
      events.push(event.type);
    });

    let flakyAttempts = 0;
    let repeatCount = 0;
    let concurrent = 0;
    let maximumConcurrent = 0;
    const handler: WorkflowStepHandler = {
      type: "command",
      execute: async (step) => {
        concurrent += 1;
        maximumConcurrent = Math.max(maximumConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
        if (step.id === "flaky" && ++flakyAttempts === 1) {
          throw new StepExecutionError("transient", true);
        }
        if (step.id === "repeat") return { output: ++repeatCount };
        return { output: step.id };
      },
    };
    const registry = new WorkflowStepHandlerRegistry();
    registry.register(handler);
    const workflow = compileWorkflow({
      schemaVersion: 1,
      id: "execution-test",
      name: "Execution test",
      steps: [
        { id: "left", type: "command", command: "left" },
        { id: "right", type: "command", command: "right" },
        {
          id: "flaky",
          type: "command",
          command: "flaky",
          dependsOn: ["left", "right"],
          retry: { maxAttempts: 2, backoffMs: 0 },
        },
        {
          id: "repeat",
          type: "command",
          command: "repeat",
          dependsOn: ["flaky"],
          repeat: { while: "steps.repeat.output != 3", maxIterations: 3 },
        },
        {
          id: "conditional",
          type: "command",
          command: "conditional",
          dependsOn: ["repeat"],
          when: "steps.repeat.output == 99",
        },
      ],
    });

    const result = await new WorkflowEngine(registry, bus, persistence).execute({
      runId: "run-1",
      workflow,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(maximumConcurrent).toBe(2);
    expect(result.steps["flaky"]).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect(result.steps["repeat"]).toMatchObject({
      status: "SUCCEEDED",
      iterations: 3,
      output: 3,
    });
    expect(result.steps["conditional"]?.status).toBe("SKIPPED");
    expect(events).toContain("workflow.completed");
    await expect(persistence.entities.get("workflow_execution", "run-1")).resolves.toBeDefined();
  });

  it("fails fast after a non-continuable step failure", async () => {
    const registry = new WorkflowStepHandlerRegistry();
    registry.register({
      type: "command",
      execute: vi.fn().mockRejectedValue(new StepExecutionError("fatal")),
    });
    const workflow = compileWorkflow({
      schemaVersion: 1,
      id: "failure-test",
      name: "Failure test",
      steps: [
        { id: "fails", type: "command", command: "false" },
        { id: "blocked", type: "command", command: "never", dependsOn: ["fails"] },
      ],
    });

    const result = await new WorkflowEngine(registry, new InMemoryEventBus()).execute({
      runId: "run-fail",
      workflow,
    });
    expect(result.status).toBe("FAILED");
    expect(result.steps["fails"]?.status).toBe("FAILED");
    expect(result.steps["blocked"]).toMatchObject({ status: "SKIPPED" });
  });

  it("runs declared node lifecycle actions around the node exactly once", async () => {
    const calls: string[] = [];
    const registry = new WorkflowStepHandlerRegistry();
    registry.register({
      type: "command",
      execute: async (step) => {
        calls.push(step.id);
        return { output: "done" };
      },
    });
    registry.register({
      type: "action",
      execute: async (step) => {
        calls.push(step.id);
        return { output: step.type === "action" ? step.action : "unexpected" };
      },
    });
    const workflow = compileWorkflow({
      schemaVersion: 2,
      id: "lifecycle-test",
      name: "Lifecycle test",
      steps: [
        {
          id: "build",
          type: "command",
          command: "build",
          onEnter: [{ action: "mark_started", input: {} }],
          onExit: [{ action: "mark_finished", input: {} }],
        },
      ],
    });

    const result = await new WorkflowEngine(registry, new InMemoryEventBus()).execute({
      runId: "run-lifecycle",
      workflow,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(calls).toEqual(["build_on_enter_1", "build", "build_on_exit_1"]);
    expect(result.steps["build"]).toMatchObject({ entered: true, exited: true });
  });

  it("uses declared fan-in semantics instead of requiring every branch", async () => {
    const registry = new WorkflowStepHandlerRegistry();
    registry.register({
      type: "command",
      execute: async (step) => {
        if (step.id === "rejected") throw new StepExecutionError("candidate killed");
        return { output: step.id };
      },
    });
    const workflow = compileWorkflow({
      schemaVersion: 2,
      id: "join-test",
      name: "Join test",
      steps: [
        { id: "survivor", type: "command", command: "survive" },
        { id: "rejected", type: "command", command: "reject", onError: "continue" },
        {
          id: "advance",
          type: "command",
          command: "advance",
          dependsOn: ["survivor", "rejected"],
          join: { mode: "any" },
        },
      ],
    });

    const result = await new WorkflowEngine(registry, new InMemoryEventBus()).execute({
      runId: "run-join",
      workflow,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.steps["rejected"]?.status).toBe("FAILED");
    expect(result.steps["advance"]?.status).toBe("SUCCEEDED");
  });

  it("rejects node output that violates its declared structured contract", async () => {
    const registry = new WorkflowStepHandlerRegistry();
    registry.register({ type: "command", execute: async () => ({ output: { ready: "yes" } }) });
    const workflow = compileWorkflow({
      schemaVersion: 2,
      id: "output-contract",
      name: "Output contract",
      steps: [
        {
          id: "inspect",
          type: "command",
          command: "inspect",
          outputSchema: {
            type: "object",
            required: ["ready"],
            properties: { ready: { type: "boolean" } },
          },
        },
      ],
    });

    const result = await new WorkflowEngine(registry, new InMemoryEventBus()).execute({
      runId: "run-output-contract",
      workflow,
    });
    expect(result.status).toBe("FAILED");
    expect(result.steps["inspect"]?.error).toMatch(/ready.*boolean/i);
  });
});
