import { describe, expect, it } from "vitest";
import { ExperimentService } from "../../src/application/experiments.js";
import type { EvaluationRubric } from "../../src/domain/experiments.js";

describe("ExperimentService", () => {
  it("pins criteria, tests candidates, kills weak options, and builds a judgment package", async () => {
    const rubric: EvaluationRubric = {
      id: "discovery",
      version: 3,
      name: "Discovery rubric",
      criteria: [
        {
          id: "impact",
          name: "Customer impact",
          description: "Expected reduction in setup contacts",
          weight: 0.6,
          hardKillBelow: 30,
        },
        {
          id: "feasibility",
          name: "Feasibility",
          description: "Can be validated cheaply",
          weight: 0.4,
        },
      ],
    };
    const result = await new ExperimentService().run({
      outcome: "Reduce setup-related support contacts",
      hypothesis: "Earlier contextual guidance prevents setup confusion",
      candidates: [
        {
          id: "a",
          name: "Static checklist",
          iteration: 1,
          payload: { impact: 20, feasibility: 90 },
        },
        {
          id: "b",
          name: "Contextual guide",
          iteration: 1,
          payload: { impact: 85, feasibility: 80 },
        },
        { id: "c", name: "Concierge", iteration: 1, payload: { impact: 90, feasibility: 25 } },
      ],
      rubric,
      killThreshold: 50,
      advanceThreshold: 70,
      survivorCount: 1,
      bounds: {
        maxCandidates: 3,
        maxIterations: 2,
        maxWallClockMs: 5_000,
        maxEvaluations: 6,
        maxConcurrent: 2,
      },
      executor: async (candidate) => ({
        artifacts: [
          {
            id: `prototype-${candidate.id}`,
            kind: "prototype",
            name: `${candidate.name} prototype`,
            reference: `artifact://${candidate.id}`,
          },
        ],
        evidence: [{ source: "simulation", summary: `${candidate.name} tested` }],
      }),
      evaluator: async (criterion, candidate) => ({
        score: candidate.payload[criterion.id] as number,
        reason: "fixture score",
      }),
    });

    expect(result).toMatchObject({ rubricId: "discovery", rubricVersion: 3 });
    expect(result.survivors.map(({ candidate }) => candidate.id)).toEqual(["b"]);
    expect(result.rejected.map(({ candidate }) => candidate.id).sort()).toEqual(["a", "c"]);
    expect(result.lessons).toHaveLength(2);
    expect(result.judgment.decisions).toEqual(["Kill", "Advance", "Iterate", "Need More Evidence"]);
    expect(result.metrics).toMatchObject({ ideasTested: 3, iterations: 1 });
  });

  it("rejects runaway candidate and iteration budgets before doing work", async () => {
    let executed = false;
    await expect(
      new ExperimentService().run({
        outcome: "Outcome",
        hypothesis: "Hypothesis",
        candidates: [{ id: "a", name: "A", iteration: 2, payload: {} }],
        rubric: {
          id: "r",
          version: 1,
          name: "R",
          criteria: [{ id: "c", name: "C", description: "C", weight: 1 }],
        },
        killThreshold: 10,
        advanceThreshold: 20,
        survivorCount: 1,
        bounds: {
          maxCandidates: 1,
          maxIterations: 1,
          maxWallClockMs: 100,
          maxEvaluations: 1,
          maxConcurrent: 1,
        },
        executor: async () => {
          executed = true;
          return { artifacts: [], evidence: [] };
        },
        evaluator: async () => ({ score: 100, reason: "unused" }),
      }),
    ).rejects.toThrow(/iteration budget/i);
    expect(executed).toBe(false);
  });
});
