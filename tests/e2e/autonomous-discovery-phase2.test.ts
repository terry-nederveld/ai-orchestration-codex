import { describe, expect, it, vi } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { ExperimentService } from "../../src/application/experiments.js";
import { readManagedSection, updateManagedSection } from "../../src/application/managed-section.js";
import { HumanInputManager, WaitConditionManager } from "../../src/application/wait-manager.js";
import { HumanInputStepHandler } from "../../src/application/workflows/builtin-handlers.js";
import { WorkflowEngine } from "../../src/application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../../src/application/workflows/handler-registry.js";
import { loadWorkflow } from "../../src/application/workflows/loader.js";
import type { ExperimentResult } from "../../src/domain/experiments.js";
import type { JsonObject } from "../../src/domain/json.js";
import type { WorkflowStep } from "../../src/domain/workflows.js";

describe("Phase 2 Autonomous Discovery acceptance", () => {
  it("preserves evidence and rejected learning through experiment, two durable judgments, PRD, stories, and handoff", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const workflow = await loadWorkflow("workflows/autonomous-discovery.yaml", "workflows");
    let workItemBody = "Human-authored outcome: reduce account setup contacts.\n";
    let experiment: ExperimentResult | undefined;
    const actionCalls: string[] = [];
    const actions = vi.fn(async (step: WorkflowStep) => {
      actionCalls.push(step.id);
      if (step.id === "pain_points") {
        return {
          output: {
            painPoints: [
              { summary: "Users miss the verification prerequisite", source: "support-case-17" },
            ],
          },
        };
      }
      if (step.id === "predeclare")
        return { output: { rubric: "discovery-outcome@1", pinned: true } };
      if (step.id === "candidates") return { output: { count: 3 } };
      if (step.id === "experiment") {
        experiment = await runExperiment();
        return { output: JSON.parse(JSON.stringify(experiment)) as JsonObject };
      }
      if (step.id === "capture_learning") {
        workItemBody = updateManagedSection(
          workItemBody,
          `## Discovery status\n\n${experiment!.lessons.join("\n")}\n\nSelected: ${experiment!.survivors[0]!.candidate.name}`,
        );
        return { output: { managedSectionUpdated: true, rejected: experiment!.rejected.length } };
      }
      if (step.id === "prd") {
        return { output: { title: "Contextual setup guide", reviewPackage: "artifact://prd.md" } };
      }
      if (step.id === "stories") {
        return {
          output: {
            created: [
              {
                id: "STORY-1",
                relationship: "derived_from",
                repositoryRoles: ["frontend", "backend"],
                agentReady: true,
              },
            ],
          },
        };
      }
      if (step.id === "delivery_handoff") return { output: { workflow: "autonomous-delivery@1" } };
      return { output: { step: step.id } };
    });
    const agents = vi.fn(async (step: WorkflowStep) => ({
      output:
        step.id === "evidence"
          ? { evidence: [{ source: "support-case-17", observation: "verification confusion" }] }
          : { hypotheses: ["Contextual guidance reduces setup confusion"] },
    }));

    let waits = new WaitConditionManager(persistence, events);
    let result = await engine(waits, actions, agents, persistence, events).execute({
      runId: "discovery-run",
      workflow,
    });
    expect(result).toMatchObject({ status: "WAITING", steps: { judgment: { status: "WAITING" } } });
    expect(experiment?.survivors.map(({ candidate }) => candidate.id)).toEqual(["guide"]);
    expect(experiment?.rejected).toHaveLength(2);

    waits = new WaitConditionManager(persistence, events);
    await new HumanInputManager(waits).respond(result.waitConditionIds![0]!, {
      source: "app",
      actorId: "product-lead",
      value: "Advance",
    });
    result = await engine(waits, actions, agents, persistence, events).execute({
      runId: "discovery-run",
      workflow,
    });
    expect(result).toMatchObject({ status: "WAITING", steps: { approval: { status: "WAITING" } } });
    expect(result.outputs["prd"]).toMatchObject({ reviewPackage: "artifact://prd.md" });

    waits = new WaitConditionManager(persistence, events);
    await new HumanInputManager(waits).respond(result.waitConditionIds![0]!, {
      source: "work_item",
      actorId: "authorized-stakeholder",
      value: true,
    });
    result = await engine(waits, actions, agents, persistence, events).execute({
      runId: "discovery-run",
      workflow,
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.outputs).toMatchObject({
      stories: { created: [{ relationship: "derived_from", agentReady: true }] },
      delivery_handoff: { workflow: "autonomous-delivery@1" },
    });
    expect(actionCalls.filter((id) => id === "experiment")).toHaveLength(1);
    expect(workItemBody.startsWith("Human-authored outcome")).toBe(true);
    expect(readManagedSection(workItemBody)).toContain("rejected");
    expect(readManagedSection(workItemBody)).toContain("Selected: Contextual guide");
    expect(workflow.definition.configuration).toMatchObject({
      stopModes: ["prd", "stories", "delivery_handoff"],
      approval: { beforeStoryCreation: true },
    });
  });
});

function engine(
  waits: WaitConditionManager,
  actions: (step: WorkflowStep) => Promise<{ output: JsonObject }>,
  agents: (step: WorkflowStep) => Promise<{ output: JsonObject }>,
  persistence: InMemoryPersistenceProvider,
  events: InMemoryEventBus,
) {
  const registry = new WorkflowStepHandlerRegistry();
  registry.register({ type: "action", execute: actions });
  registry.register({ type: "agent", execute: agents });
  registry.register(new HumanInputStepHandler(new HumanInputManager(waits)));
  return new WorkflowEngine(registry, events, persistence);
}

async function runExperiment() {
  return new ExperimentService().run({
    outcome: "Reduce account setup contacts",
    hypothesis: "Contextual guidance prevents verification confusion",
    candidates: [
      {
        id: "checklist",
        name: "Static checklist",
        iteration: 1,
        payload: { impact: 20, feasibility: 90 },
      },
      {
        id: "guide",
        name: "Contextual guide",
        iteration: 1,
        payload: { impact: 90, feasibility: 80 },
      },
      {
        id: "concierge",
        name: "Concierge",
        iteration: 1,
        payload: { impact: 70, feasibility: 30 },
      },
    ],
    rubric: {
      id: "discovery-outcome",
      version: 1,
      name: "Outcome rubric",
      criteria: [
        {
          id: "impact",
          name: "Impact",
          description: "Customer impact",
          weight: 0.6,
          hardKillBelow: 30,
        },
        { id: "feasibility", name: "Feasibility", description: "Practicality", weight: 0.4 },
      ],
    },
    killThreshold: 50,
    advanceThreshold: 70,
    survivorCount: 1,
    bounds: {
      maxCandidates: 3,
      maxIterations: 2,
      maxWallClockMs: 5_000,
      maxEvaluations: 6,
      maxConcurrent: 3,
    },
    executor: async (candidate) => ({
      artifacts: [
        {
          id: `${candidate.id}-prototype`,
          kind: "prototype",
          name: candidate.name,
          reference: `artifact://${candidate.id}`,
        },
      ],
      evidence: [{ source: "prototype-test", summary: `${candidate.name} simulated` }],
    }),
    evaluator: async (criterion, candidate) => ({
      score: candidate.payload[criterion.id] as number,
      reason: "predeclared fixture evaluation",
    }),
  });
}
