import type { BudgetLimits } from "./budgets.js";
import type { Capability } from "./capabilities.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { WorkspaceStrategy } from "../ports/workspace.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs?: number;
}

export interface RepeatPolicy {
  while: string;
  maxIterations: number;
}

export interface WorkflowStepBase {
  id: string;
  name?: string;
  dependsOn: string[];
  when?: string;
  timeoutMs?: number;
  retry: RetryPolicy;
  repeat?: RepeatPolicy;
  onError: "fail" | "continue";
}

export interface AgentWorkflowStep extends WorkflowStepBase {
  type: "agent";
  agent: string;
  goal: string;
}

export interface CommandWorkflowStep extends WorkflowStepBase {
  type: "command";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  expectedExitCodes: number[];
}

export interface ToolWorkflowStep extends WorkflowStepBase {
  type: "tool";
  tool: string;
  input: JsonObject;
}

export interface ActionWorkflowStep extends WorkflowStepBase {
  type: "action";
  action: string;
  input: JsonObject;
}

export interface ApprovalWorkflowStep extends WorkflowStepBase {
  type: "approval";
  title: string;
  description: string;
}

export type WorkflowStep =
  | AgentWorkflowStep
  | CommandWorkflowStep
  | ToolWorkflowStep
  | ActionWorkflowStep
  | ApprovalWorkflowStep;

export interface AgentRole {
  provider?: string;
  model?: string;
  requiredCapabilities: Capability[];
  instructions?: string;
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  includes: string[];
  trigger: { states: string[] };
  eligibility: { includeLabels: string[]; excludeLabels: string[] };
  workspace: {
    strategy: WorkspaceStrategy;
    retainOnFailure: boolean;
  };
  variables: JsonObject;
  budgets: BudgetLimits;
  agents: Record<string, AgentRole>;
  steps: WorkflowStep[];
  transitions: {
    success?: string;
    failure?: string;
    cancelled?: string;
  };
}

export const workflowStepStatuses = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type WorkflowStepStatus = (typeof workflowStepStatuses)[number];

export interface WorkflowStepExecution {
  stepId: string;
  status: WorkflowStepStatus;
  attempts: number;
  iterations: number;
  output?: JsonValue;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  runId: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  steps: Record<string, WorkflowStepExecution>;
  outputs: JsonObject;
  startedAt: string;
  completedAt: string;
}
