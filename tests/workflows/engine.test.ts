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
});
