import { describe, expect, it } from "vitest";
import { validateCommitMessage } from "../../src/adapters/source-control/conventional-commit.js";

describe("validateCommitMessage", () => {
  it("accepts conventional commits including breaking changes", () => {
    expect(() => validateCommitMessage("feat(runtime): add cancellation")).not.toThrow();
    expect(() =>
      validateCommitMessage(
        "feat(provider)!: replace capability contract\n\nBREAKING CHANGE: adapters must report capabilities",
      ),
    ).not.toThrow();
  });

  it("rejects vague messages and attribution footers", () => {
    expect(() => validateCommitMessage("update stuff")).toThrow("Conventional Commits");
    expect(() =>
      validateCommitMessage("fix(core): correct state\n\nCo-authored-by: Someone <x@example.test>"),
    ).toThrow("forbidden attribution");
  });
});
