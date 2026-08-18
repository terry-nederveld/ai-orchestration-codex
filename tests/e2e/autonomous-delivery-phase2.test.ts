import { describe, expect, it, vi } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { ExecutionSpecificationService } from "../../src/application/execution-specifications.js";
import { HumanInputManager, WaitConditionManager } from "../../src/application/wait-manager.js";
import { validateCommitMessage } from "../../src/adapters/source-control/conventional-commit.js";
import { HumanInputStepHandler } from "../../src/application/workflows/builtin-handlers.js";
import { WorkflowEngine } from "../../src/application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../../src/application/workflows/handler-registry.js";
import { loadWorkflow } from "../../src/application/workflows/loader.js";
import type { JsonObject } from "../../src/domain/json.js";
import type { WorkflowStep } from "../../src/domain/workflows.js";
import type { VersionedAssetReference } from "../../src/domain/assets.js";

describe("Phase 2 Autonomous Delivery acceptance", () => {
  it("runs ranked-resolution/gates/work, suspends durably, revises context, and completes delivery", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const specifications = new ExecutionSpecificationService(persistence);
    const workflow = await loadWorkflow("workflows/autonomous-delivery.yaml", "workflows");
    const actionCalls: string[] = [];
    const agentCalls: string[] = [];
    const work = {
      id: "ISSUE-DELIVERY",
      title: "Preserve compatibility while adding strict validation",
      updatedAt: "2026-08-18T00:00:00.000Z",
    };
    const action = vi.fn(async (step: WorkflowStep) => {
      actionCalls.push(step.id);
      if (step.id === "specification") {
        const specification = await specifications.reconcile(
          specInput(work, workflow.reference, 1),
        );
        return { output: { revision: specification.revision } };
      }
      if (step.id === "authoritative_refresh") {
        const specification = await specifications.reconcile(
          specInput(
            { ...work, updatedAt: "2026-08-18T01:00:00.000Z", selected: "strict" },
            workflow.reference,
            1,
          ),
        );
        return { output: { revision: specification.revision, refreshed: true } };
      }
      if (step.id === "dor_evaluate" || step.id === "dod_evaluate") {
        return { output: { passed: false, failures: ["fixture gap"] } };
      }
      if (step.id === "dor_reevaluate" || step.id === "dod_reevaluate") {
        return { output: { passed: true, independentlyReevaluated: true } };
      }
      if (step.id === "tests") return { output: { passed: true, commands: ["npm test"] } };
      if (step.id === "commit") {
        const message = workflow.definition.variables["commitMessage"] as string;
        validateCommitMessage(message);
        return { output: { sha: "abc123", message } };
      }
      if (step.id === "pull_request") {
        return { output: { number: 42, url: "https://example.test/pull/42", state: "open" } };
      }
      if (step.id === "update_work") return { output: { state: "Done" } };
      return { output: { passed: true, step: step.id } };
    });
    const agent = vi.fn(async (step: WorkflowStep) => {
      agentCalls.push(step.id);
      return { output: { outcome: "GOAL_COMPLETED", structured: { complete: true } } };
    });

    const firstWaits = new WaitConditionManager(persistence, events);
    const first = await new WorkflowEngine(
      registry(firstWaits, action, agent),
      events,
      persistence,
    ).execute({ runId: "delivery-run", workflow });
    expect(first.status).toBe("WAITING");
    expect(first.steps["ambiguity"]).toMatchObject({ status: "WAITING" });
    expect(first.steps["dor_remediate"]?.status).toBe("SUCCEEDED");
    expect(first.steps["dor_reevaluate"]?.status).toBe("SUCCEEDED");
    expect(agentCalls).toEqual(["implement"]);

    // The original model and engine no longer exist. A work-item response unblocks a new process.
    const resumedWaits = new WaitConditionManager(persistence, events);
    await new HumanInputManager(resumedWaits).respond(first.waitConditionIds![0]!, {
      source: "work_item",
      actorId: "reviewer",
      value: "Adopt strict behavior",
      promote: true,
    });
    const completed = await new WorkflowEngine(
      registry(resumedWaits, action, agent),
      events,
      persistence,
    ).execute({ runId: "delivery-run", workflow });

    expect(completed.status).toBe("SUCCEEDED");
    expect(agentCalls).toEqual(["implement", "complete_implementation", "review"]);
    expect(actionCalls.filter((id) => id === "resolve")).toHaveLength(1);
    expect(actionCalls).toContain("push");
    expect(completed.outputs).toMatchObject({
      authoritative_refresh: { revision: 2, refreshed: true },
      tests: { passed: true },
      commit: { message: "feat(delivery): complete requested work" },
      pull_request: { number: 42 },
      update_work: { state: "Done" },
    });
    await expect(specifications.history("delivery-run")).resolves.toHaveLength(2);
    expect(workflow.definition.configuration).toMatchObject({
      lane: { policy: "ranked_parallel", preserveNativeRank: true },
      checkpoint: { strategy: "remote_git_branch" },
    });
  });
});

function registry(
  waits: WaitConditionManager,
  action: (step: WorkflowStep) => Promise<{ output: JsonObject }>,
  agent: (step: WorkflowStep) => Promise<{ output: JsonObject }>,
) {
  const result = new WorkflowStepHandlerRegistry();
  result.register({ type: "action", execute: action });
  result.register({ type: "agent", execute: agent });
  result.register(new HumanInputStepHandler(new HumanInputManager(waits)));
  return result;
}

function specInput(work: JsonObject, workflow: VersionedAssetReference, revision: number) {
  return {
    runId: "delivery-run",
    workflowSnapshotId: "snapshot-delivery",
    workflow,
    goal: "Deliver the requested compatibility change",
    acceptanceCriteria: ["Tests pass", `authoritative revision ${revision}`],
    completionCriteria: ["Pull request opened", "Work item updated"],
    work,
    relatedWork: [],
    repositories: [],
    instructions: [],
    context: [],
    workflowOutputs: {},
    dependencies: [],
    tests: ["npm test"],
    tools: ["git"],
    permissions: ["git.write"],
    validationRequirements: ["independent review"],
  };
}
