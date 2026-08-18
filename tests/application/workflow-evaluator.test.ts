import { describe, expect, it, vi } from "vitest";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";
import { WorkflowEvaluator } from "../../src/application/workflow-evaluator.js";
import type { WorkItem } from "../../src/domain/work.js";

describe("WorkflowEvaluator", () => {
  it("explains matching and resolution with zero side effects", async () => {
    const mutation = vi.fn();
    const work = fixtureWork();
    const workflow = compileWorkflow({
      schemaVersion: 2,
      id: "delivery",
      version: 2,
      name: "Delivery",
      requirements: { capabilities: ["tool_use"], providers: ["codex"], tools: ["git"] },
      configuration: { stateMappings: { completed: "Done" } },
      steps: [
        { id: "resolve", type: "action", action: "resolve.context", input: {} },
        {
          id: "implement",
          type: "agent",
          agent: "builder",
          goal: "Implement",
          dependsOn: ["resolve"],
          when: "steps.resolve.output.ready == true",
        },
      ],
      agents: { builder: { requiredCapabilities: ["tool_use"] } },
    }).definition;
    const result = await new WorkflowEvaluator().evaluate({
      workItem: work,
      workflows: [workflow],
      repositoryRules: [
        {
          id: "web",
          priority: 1,
          when: { operator: "equals", path: "issue.metadata.project", value: "WEB" },
          repositories: [{ id: "web", cloneUrl: "https://example.test/web.git", role: "primary" }],
        },
      ],
      contextResolvers: [
        {
          id: "fixture",
          resolve: async () => {
            // A resolver used by Evaluate is read-only; this assertion catches accidental write hooks.
            expect(mutation).not.toHaveBeenCalled();
            return [];
          },
        },
      ],
    });
    expect(result).toMatchObject({
      sideEffects: false,
      routing: { status: "MATCHED" },
      profileRequirements: { capabilities: ["tool_use"] },
      stateMappings: { completed: "Done" },
    });
    expect(result.repositories).toEqual([
      expect.objectContaining({ id: "web", source: "mapping" }),
    ]);
    expect(result.guards).toEqual([
      expect.objectContaining({ stepId: "implement", determinable: false }),
    ]);
    expect(result.expectedSideEffects).toEqual([
      "run action resolve.context",
      "invoke agent/model",
    ]);
    expect(mutation).not.toHaveBeenCalled();
  });
});

function fixtureWork(): WorkItem {
  return {
    id: "ISSUE-1",
    provider: "fixture",
    externalId: "ISSUE-1",
    title: "Ship it",
    state: "Ready",
    labels: [],
    assignees: [],
    relationships: [],
    metadata: { project: "WEB" },
  };
}
