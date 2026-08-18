import { describe, expect, it } from "vitest";
import { GateService } from "../../src/application/gates.js";
import type { GateSetDefinition } from "../../src/domain/policies.js";

describe("GateService", () => {
  it("separates remediation from evaluation and independently reevaluates", async () => {
    let ready = false;
    let evaluations = 0;
    const service = new GateService(
      new Map([
        [
          "fixture.ready",
          async () => {
            evaluations += 1;
            return { passed: ready, message: ready ? "ready" : "missing acceptance criteria" };
          },
        ],
      ]),
      new Map([
        [
          "fixture.remediate",
          async () => {
            ready = true;
            return { changed: true };
          },
        ],
      ]),
    );
    const result = await service.evaluate(fixtureGateSet(), {});
    expect(result.passed).toBe(true);
    expect(result.gates[0]).toMatchObject({ attempts: 1, passed: true });
    expect(result.gates[0]?.evaluations).toHaveLength(2);
    expect(evaluations).toBe(2);
  });

  it("stops bounded remediation and fails a required gate", async () => {
    let remediations = 0;
    const service = new GateService(
      new Map([["fixture.ready", async () => ({ passed: false, message: "still not ready" })]]),
      new Map([["fixture.remediate", async () => ({ attempt: ++remediations })]]),
    );
    const result = await service.evaluate(fixtureGateSet(), {});
    expect(result.passed).toBe(false);
    expect(result.gates[0]).toMatchObject({ attempts: 2, passed: false });
    expect(remediations).toBe(2);
  });
});

function fixtureGateSet(): GateSetDefinition {
  return {
    id: "ready",
    version: 1,
    name: "Definition of Ready",
    kind: "definition_of_ready",
    extends: [],
    gates: [
      {
        id: "acceptance",
        name: "Acceptance criteria",
        evaluation: "deterministic",
        evaluator: "fixture.ready",
        input: {},
        required: true,
        remediation: { action: "fixture.remediate", maxAttempts: 2 },
      },
    ],
  };
}
