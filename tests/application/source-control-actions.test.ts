import { describe, expect, it } from "vitest";
import { InMemorySourceControlProvider } from "../../src/adapters/fakes/source-control-provider.js";
import {
  CommitAction,
  PullRequestAction,
} from "../../src/application/actions/source-control-actions.js";
import { HookRegistry } from "../../src/application/hooks.js";
import { RuleBasedPermissionProvider } from "../../src/application/policy-engine.js";

describe("source-control lifecycle hooks", () => {
  it("allows hooks to prepare commits and observes completion", async () => {
    const provider = new InMemorySourceControlProvider();
    const hooks = new HookRegistry();
    const calls: string[] = [];
    hooks.register({
      id: "prepare-commit",
      name: "before_commit",
      execute: async () => {
        calls.push("before_commit");
        return { message: "fix(core): prepared by hook", paths: ["src"] };
      },
    });
    hooks.register({
      id: "observe-commit",
      name: "after_commit",
      execute: async () => {
        calls.push("after_commit");
      },
    });
    const action = new CommitAction(provider, allowAll(), hooks);

    await action.execute({
      runId: "run-1",
      workspacePath: "/workspace",
      inputs: { message: "fix(core): original" },
      signal: new AbortController().signal,
    });

    expect(calls).toEqual(["before_commit", "after_commit"]);
    expect(provider.invocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "stage", values: ["src"] }),
        expect.objectContaining({ operation: "commit", values: ["fix(core): prepared by hook"] }),
      ]),
    );
  });

  it("fills pull-request defaults without requiring hooks", async () => {
    const provider = new InMemorySourceControlProvider();
    const action = new PullRequestAction(provider, allowAll());

    const result = await action.execute({
      runId: "run-2",
      workspacePath: "/workspace",
      inputs: { repository: "fable/fable", title: "Deliver work" },
      signal: new AbortController().signal,
    });

    expect(result["url"]).toBe("https://example.invalid/pull/1");
    expect(provider.invocations.at(-1)?.pullRequest).toMatchObject({
      repository: "fable/fable",
      head: "fable/test",
      base: "main",
      draft: true,
    });
  });
});

function allowAll(): RuleBasedPermissionProvider {
  return new RuleBasedPermissionProvider([{ capability: "*", decision: "allow" }]);
}
