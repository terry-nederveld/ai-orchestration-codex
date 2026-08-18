import { describe, expect, it, vi } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { HumanInputManager, WaitConditionManager } from "../../src/application/wait-manager.js";
import { HumanInputStepHandler } from "../../src/application/workflows/builtin-handlers.js";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";
import { WorkflowEngine } from "../../src/application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../../src/application/workflows/handler-registry.js";
import type { WorkflowStep } from "../../src/domain/workflows.js";
import type { WorkflowStepHandler } from "../../src/ports/workflow.js";

describe("durable workflow suspension", () => {
  it("resumes the exact pinned node after process recreation without rerunning completed work", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const completedWork = vi.fn(async (step: WorkflowStep) => ({
      output: { prepared: true, stepId: step.id },
    }));
    const workflow = compileWorkflow({
      schemaVersion: 2,
      id: "durable-input",
      version: 4,
      name: "Durable input",
      workspace: { strategy: "temporary" },
      steps: [
        { id: "prepare", type: "action", action: "fixture.prepare", input: {} },
        {
          id: "choose",
          type: "human_input",
          inputType: "single_choice",
          title: "Choose",
          description: "Choose the candidate",
          channel: "both",
          choices: ["A", "B"],
          dependsOn: ["prepare"],
        },
        {
          id: "complete",
          type: "action",
          action: "fixture.complete",
          input: {},
          dependsOn: ["choose"],
        },
      ],
    });
    const firstWaits = new WaitConditionManager(persistence, events);
    const firstRegistry = registry(firstWaits, completedWork);
    const first = await new WorkflowEngine(firstRegistry, events, persistence).execute({
      runId: "run-durable",
      workflow,
    });
    expect(first.status).toBe("WAITING");
    expect(first.steps["prepare"]?.status).toBe("SUCCEEDED");
    expect(first.steps["choose"]?.status).toBe("WAITING");
    expect(completedWork).toHaveBeenCalledTimes(1);

    // Simulate terminating the process: all managers and the engine are discarded.
    const secondWaits = new WaitConditionManager(persistence, events);
    const humans = new HumanInputManager(secondWaits);
    await humans.respond(first.waitConditionIds![0]!, {
      source: "work_item",
      actorId: "authorized-reviewer",
      value: "B",
    });
    const second = await new WorkflowEngine(
      registry(secondWaits, completedWork),
      events,
      persistence,
    ).execute({ runId: "run-durable", workflow });

    expect(second.status).toBe("SUCCEEDED");
    expect(second.outputs["choose"]).toMatchObject({
      humanInput: { requestType: "single_choice", value: "B" },
    });
    expect(second.steps["complete"]?.status).toBe("SUCCEEDED");
    expect(completedWork).toHaveBeenCalledTimes(2);
    expect(completedWork.mock.calls.map((call) => call[0].id)).toEqual(["prepare", "complete"]);
  });
});

function registry(waits: WaitConditionManager, execute: WorkflowStepHandler["execute"]) {
  const result = new WorkflowStepHandlerRegistry();
  result.register({ type: "action", execute });
  result.register(new HumanInputStepHandler(new HumanInputManager(waits)));
  return result;
}
