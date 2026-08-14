import { describe, expect, it } from "vitest";
import { BudgetManager } from "../../src/application/budget-manager.js";
import { emptyConsumption } from "../../src/domain/budgets.js";

describe("BudgetManager", () => {
  it("warns before exhaustion and rejects at the limit", () => {
    const manager = new BudgetManager({ maxIterations: 10, maxInputTokens: 1_000 });
    const consumption = { ...emptyConsumption(), iterations: 8, inputTokens: 999 };

    expect(manager.check(consumption)).toEqual({
      allowed: true,
      exhausted: [],
      warnings: ["maxIterations", "maxInputTokens"],
    });

    consumption.inputTokens = 1_000;
    expect(manager.check(consumption)).toMatchObject({
      allowed: false,
      exhausted: ["maxInputTokens"],
    });
  });
});
