import type { Capability } from "./capabilities.js";
import type { JsonObject } from "./json.js";

export interface GateDefinition extends JsonObject {
  id: string;
  name: string;
  evaluation: "deterministic" | "agent" | "human";
  evaluator: string;
  input: JsonObject;
  required: boolean;
  remediation?: {
    action: string;
    maxAttempts: number;
  };
}

export interface GateSetDefinition extends JsonObject {
  id: string;
  version: number;
  name: string;
  kind: "definition_of_ready" | "definition_of_done" | "custom";
  extends: Array<{ id: string; version: number }>;
  gates: GateDefinition[];
}

export interface AgentProfileFallback extends JsonObject {
  provider: string;
  model?: string;
  on: Array<"outage" | "rate_limit" | "transient" | "capability_mismatch" | "budget">;
  requiredCapabilities: Capability[];
  reasoningClass?: "fast" | "balanced" | "strong";
  maxEstimatedCostUsd?: number;
}

export interface AgentProfileDefinition extends JsonObject {
  id: string;
  version: number;
  name: string;
  fragments: Array<{ id: string; version: number }>;
  provider?: string;
  model?: string;
  fallback: AgentProfileFallback[];
  capabilities: Capability[];
  instructionStack: string[];
  contextResolvers: string[];
  tools: string[];
  permissions: string[];
  budgets: JsonObject;
  repositoryPermissions: JsonObject;
  evaluationResponsibilities: string[];
}
