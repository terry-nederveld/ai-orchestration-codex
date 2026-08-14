import type {
  BudgetCheck,
  BudgetConsumption,
  BudgetDimension,
  BudgetLimits,
} from "../domain/budgets.js";

const consumptionKeys: Readonly<Record<BudgetDimension, keyof BudgetConsumption | undefined>> = {
  maxConcurrentAgents: undefined,
  maxSubagentsPerRun: "subagents",
  maxIterations: "iterations",
  maxWallClockMs: "wallClockMs",
  maxInputTokens: "inputTokens",
  maxOutputTokens: "outputTokens",
  maxEstimatedCostUsd: "estimatedCostUsd",
  maxSubscriptionRequests: "subscriptionRequests",
};

export class BudgetManager {
  public constructor(
    private readonly limits: BudgetLimits,
    private readonly warningRatio = 0.8,
  ) {}

  public check(consumption: BudgetConsumption, concurrentAgents = 0): BudgetCheck {
    const exhausted: BudgetDimension[] = [];
    const warnings: BudgetDimension[] = [];

    for (const [dimension, limit] of Object.entries(this.limits) as [
      BudgetDimension,
      number | undefined,
    ][]) {
      if (limit === undefined) continue;
      const key = consumptionKeys[dimension];
      const used = key === undefined ? concurrentAgents : (consumption[key] ?? 0);
      if (used >= limit) exhausted.push(dimension);
      else if (used >= limit * this.warningRatio) warnings.push(dimension);
    }

    return { allowed: exhausted.length === 0, exhausted, warnings };
  }

  public remaining(
    dimension: BudgetDimension,
    consumption: BudgetConsumption,
    concurrentAgents = 0,
  ): number | undefined {
    const limit = this.limits[dimension];
    if (limit === undefined) return undefined;
    const key = consumptionKeys[dimension];
    return Math.max(0, limit - (key === undefined ? concurrentAgents : (consumption[key] ?? 0)));
  }
}
