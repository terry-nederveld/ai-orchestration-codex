import { describe, expect, it } from "vitest";
import { evaluateCondition, interpolate } from "../../src/application/workflows/expressions.js";

const context = {
  steps: {
    test: { status: "failed", failed: true, output: { count: 2 } },
  },
  work: { title: "Fix issue" },
};

describe("workflow expressions", () => {
  it("evaluates safe boolean and comparison expressions", () => {
    expect(evaluateCondition("steps.test.failed", context)).toBe(true);
    expect(
      evaluateCondition("steps.test.status == 'failed' && steps.test.output.count == 2", context),
    ).toBe(true);
    expect(evaluateCondition("!steps.test.failed || work.title == 'Other'", context)).toBe(false);
  });

  it("interpolates strings and preserves exact typed values", () => {
    expect(interpolate("Work: ${{ work.title }}", context)).toBe("Work: Fix issue");
    expect(interpolate("${{ steps.test.output }}", context)).toEqual({ count: 2 });
  });
});
