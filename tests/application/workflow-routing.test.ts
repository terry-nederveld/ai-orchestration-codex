import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";
import { RoutingLearningService, WorkflowRouter } from "../../src/application/workflow-routing.js";
import type { WorkItem } from "../../src/domain/work.js";

describe("workflow routing", () => {
  it("does not guess on zero or multiple matches", () => {
    const work = item("one");
    const delivery = workflow("delivery", ["Ready"]);
    const discovery = workflow("discovery", ["Ready"]);
    expect(new WorkflowRouter().route({ ...work, state: "Draft" }, [delivery])).toMatchObject({
      status: "NO_MATCH",
    });
    const ambiguous = new WorkflowRouter().route(work, [delivery, discovery]);
    expect(ambiguous).toMatchObject({ status: "WORKFLOW_SELECTION_REQUIRED" });
    if (ambiguous.status === "WORKFLOW_SELECTION_REQUIRED") {
      expect(ambiguous.candidates.map(({ workflowId }) => workflowId)).toEqual([
        "delivery",
        "discovery",
      ]);
    }
    expect(new WorkflowRouter().route(work, [delivery])).toMatchObject({
      status: "MATCHED",
      selected: { workflowId: "delivery", version: 1 },
    });
  });

  it("learns only an explicit suggestion and requires approval", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const learning = new RoutingLearningService(persistence, 3);
    for (const id of ["one", "two"]) {
      await expect(
        learning.recordChoice({
          workItem: item(id),
          workflowId: "delivery",
          workflowVersion: 2,
          actorId: "operator",
        }),
      ).resolves.toEqual({ selected: true });
    }
    const third = await learning.recordChoice({
      workItem: item("three"),
      workflowId: "delivery",
      workflowVersion: 2,
      actorId: "operator",
    });
    expect(third.suggestion).toMatchObject({ status: "proposed", evidenceCount: 3 });
    await expect(learning.decide(third.suggestion!.id, "approved")).resolves.toBe(true);
    const stored = await persistence.entities.get("routing_rule_suggestion", third.suggestion!.id);
    expect(stored?.value["status"]).toBe("approved");
    await expect(
      learning.recordChoice({
        workItem: item("three"),
        workflowId: "discovery",
        workflowVersion: 1,
        actorId: "other",
      }),
    ).resolves.toEqual({ selected: false });
  });
});

function workflow(id: string, states: string[]) {
  return compileWorkflow({
    schemaVersion: 2,
    id,
    name: id,
    trigger: { states },
    steps: [{ id: "run", type: "action", action: "fixture", input: {} }],
  }).definition;
}

function item(id: string): WorkItem {
  return {
    id,
    provider: "fixture",
    externalId: id,
    title: id,
    state: "Ready",
    type: "Story",
    labels: ["agent-ready"],
    assignees: [],
    relationships: [],
    metadata: { project: "WEB" },
  };
}
