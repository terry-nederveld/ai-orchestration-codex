import type { Usage } from "./providers.js";

export interface BudgetLimits {
  maxConcurrentAgents?: number;
  maxSubagentsPerRun?: number;
  maxIterations?: number;
  maxWallClockMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCostUsd?: number;
  maxSubscriptionRequests?: number;
}

export interface BudgetConsumption extends Usage {
  iterations: number;
  subagents: number;
  wallClockMs: number;
}

export type BudgetDimension = keyof BudgetLimits;

export interface BudgetCheck {
  allowed: boolean;
  exhausted: BudgetDimension[];
  warnings: BudgetDimension[];
}

export const emptyConsumption = (): BudgetConsumption => ({
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  subscriptionRequests: 0,
  iterations: 0,
  subagents: 0,
  wallClockMs: 0,
});
