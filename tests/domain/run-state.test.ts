import { describe, expect, it } from "vitest";
import {
  InvalidRunTransitionError,
  assertRunTransition,
  canTransitionRun,
} from "../../src/domain/runs.js";

describe("run state machine", () => {
  it("allows the normal execution path", () => {
    expect(canTransitionRun("QUEUED", "PREPARING")).toBe(true);
    expect(canTransitionRun("PREPARING", "RUNNING")).toBe(true);
    expect(canTransitionRun("RUNNING", "VERIFYING")).toBe(true);
    expect(canTransitionRun("VERIFYING", "COMPLETED")).toBe(true);
  });

  it("rejects transitions out of a completed run", () => {
    expect(() => assertRunTransition("COMPLETED", "RUNNING")).toThrow(InvalidRunTransitionError);
  });
});
