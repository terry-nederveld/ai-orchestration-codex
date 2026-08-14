import { describe, expect, it } from "vitest";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";

const base = {
  schemaVersion: 1,
  id: "test-workflow",
  name: "Test workflow",
  agents: { coder: { requiredCapabilities: ["tool_use"] } },
  steps: [
    { id: "analyze", type: "agent", agent: "coder", goal: "Analyze" },
    { id: "test", type: "command", command: "npm", args: ["test"], dependsOn: ["analyze"] },
    { id: "review", type: "agent", agent: "coder", goal: "Review", dependsOn: ["analyze"] },
    {
      id: "deliver",
      type: "action",
      action: "deliver",
      dependsOn: ["test", "review"],
    },
  ],
};

describe("compileWorkflow", () => {
  it("applies defaults and creates a deterministic dependency graph", () => {
    const compiled = compileWorkflow(base);

    expect(compiled.topologicalOrder).toEqual(["analyze", "review", "test", "deliver"]);
    expect(compiled.definition.workspace).toEqual({
      strategy: "git-worktree",
      retainOnFailure: true,
    });
    expect(compiled.stepsById.get("analyze")).toMatchObject({
      retry: { maxAttempts: 1, backoffMs: 1_000 },
      dependsOn: [],
    });
  });

  it("rejects duplicate ids, missing dependencies, unknown roles, and cycles", () => {
    expect(() => compileWorkflow({ ...base, steps: [base.steps[0], base.steps[0]] })).toThrow(
      "Duplicate workflow step",
    );
    expect(() =>
      compileWorkflow({
        ...base,
        steps: [{ id: "one", type: "command", command: "true", dependsOn: ["missing"] }],
      }),
    ).toThrow("unknown dependency");
    expect(() =>
      compileWorkflow({
        ...base,
        steps: [{ id: "one", type: "agent", agent: "missing", goal: "Run" }],
      }),
    ).toThrow("unknown agent role");
    expect(() =>
      compileWorkflow({
        ...base,
        steps: [
          { id: "one", type: "command", command: "true", dependsOn: ["two"] },
          { id: "two", type: "command", command: "true", dependsOn: ["one"] },
        ],
      }),
    ).toThrow("cycle detected");
  });
});
