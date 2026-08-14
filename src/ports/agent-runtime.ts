import type { BudgetLimits } from "../domain/budgets.js";
import type { Capability } from "../domain/capabilities.js";
import type { JsonObject } from "../domain/json.js";
import type { GoalOutcome, ModelMessage, Usage } from "../domain/providers.js";

export interface AgentRuntimeRequest {
  runId: string;
  sessionId?: string;
  goal: string;
  workspacePath: string;
  providerId?: string;
  model: string;
  requiredCapabilities?: Capability[];
  systemPrompt?: string;
  budgets: BudgetLimits;
  metadata?: JsonObject;
}

export interface AgentRuntimeResult {
  runId: string;
  sessionId: string;
  outcome: GoalOutcome;
  summary: string;
  messages: ModelMessage[];
  usage: Usage;
  turns: number;
  toolCalls: number;
  startedAt: string;
  completedAt: string;
}

export interface AgentRuntime {
  run(request: AgentRuntimeRequest, signal?: AbortSignal): Promise<AgentRuntimeResult>;
}

export interface ContextManager {
  compact(messages: ModelMessage[]): Promise<ModelMessage[]>;
}
