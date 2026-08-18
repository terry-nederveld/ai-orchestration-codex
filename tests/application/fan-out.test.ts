import { describe, expect, it } from "vitest";
import { FanOutExecutor } from "../../src/application/fan-out.js";

describe("FanOutExecutor", () => {
  it.each([
    [{ mode: "all" } as const, false],
    [{ mode: "any" } as const, true],
    [{ mode: "minimum", count: 2 } as const, true],
    [{ mode: "named", required: ["a", "c"] } as const, true],
    [{ mode: "named", required: ["a", "b"] } as const, false],
  ])("joins deterministic branch results using %o", async (join, expected) => {
    const result = await new FanOutExecutor().execute({
      branches: [
        { id: "a", input: 1 },
        { id: "b", input: 2 },
        { id: "c", input: 3 },
      ],
      join,
      maxConcurrent: 2,
      maxBranches: 3,
      execute: async ({ id, input }) => {
        if (id === "b") throw new Error("branch failed");
        return input * 2;
      },
    });
    expect(result.joined).toBe(expected);
    expect(result.succeeded.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ id: "b", error: "branch failed" }]);
  });

  it("enforces branch budgets before execution", async () => {
    await expect(
      new FanOutExecutor().execute({
        branches: [
          { id: "a", input: 1 },
          { id: "b", input: 2 },
        ],
        join: { mode: "all" },
        maxConcurrent: 1,
        maxBranches: 1,
        execute: async ({ input }) => input,
      }),
    ).rejects.toThrow(/budget/i);
  });
});
