import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { ExecutionSpecificationService } from "../../src/application/execution-specifications.js";

describe("ExecutionSpecificationService", () => {
  it("keeps history immutable and revises only when authoritative inputs change", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const specifications = new ExecutionSpecificationService(persistence);
    const base = fixture();
    const first = await specifications.reconcile(base);
    const unchanged = await specifications.reconcile(structuredClone(base));
    const revised = await specifications.reconcile({
      ...base,
      acceptanceCriteria: [...base.acceptanceCriteria, "A migration note is present"],
    });

    expect(first.revision).toBe(1);
    expect(unchanged.id).toBe(first.id);
    expect(revised).toMatchObject({ revision: 2, supersedes: first.id });
    await expect(specifications.history("run-1")).resolves.toEqual([first, revised]);
    await expect(specifications.current("run-1")).resolves.toEqual(revised);
  });
});

function fixture() {
  return {
    runId: "run-1",
    workflowSnapshotId: "snapshot-1",
    workflow: {
      kind: "workflow" as const,
      id: "delivery",
      version: 1,
      digest: "abc",
    },
    goal: "Ship the requested capability",
    acceptanceCriteria: ["Tests pass"],
    completionCriteria: ["Pull request opened"],
    work: { id: "ISSUE-1", updatedAt: "2026-08-18T00:00:00.000Z" },
    relatedWork: [],
    repositories: [],
    instructions: [],
    context: [],
    workflowOutputs: {},
    dependencies: [],
    tests: ["npm test"],
    tools: ["git"],
    permissions: ["process.execute"],
    validationRequirements: ["review"],
  };
}
