import type { BudgetLimits } from "./budgets.js";
import type { Capability } from "./capabilities.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { WorkspaceStrategy } from "../ports/workspace.js";
import type { VersionedAssetReference, WorkflowLifecycle } from "./assets.js";
import type { HumanInputType } from "./execution.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  maxBackoffMs?: number;
}

export interface RepeatPolicy {
  while: string;
  maxIterations: number;
}

export interface NodeLifecycleAction {
  action: string;
  input: JsonObject;
}

export type DependencyJoin =
  | { mode: "all" }
  | { mode: "any" }
  | { mode: "minimum"; count: number }
  | { mode: "named"; required: string[] };

export interface WorkflowStepBase {
  id: string;
  name?: string;
  dependsOn: string[];
  join?: DependencyJoin;
  when?: string;
  timeoutMs?: number;
  retry: RetryPolicy;
  repeat?: RepeatPolicy;
  outputSchema?: JsonObject;
  onEnter?: NodeLifecycleAction[];
  onExit?: NodeLifecycleAction[];
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

export interface HumanInputWorkflowStep extends WorkflowStepBase {
  type: "human_input";
  inputType: HumanInputType;
  title: string;
  description: string;
  channel: "app" | "work_item" | "both";
  required: boolean;
  choices?: string[];
  secretDestination?: string;
}

export interface WaitWorkflowStep extends WorkflowStepBase {
  type: "wait";
  conditionType:
    "time" | "external_event" | "dependency" | "provider_availability" | "work_item_event";
  predicate: JsonObject;
  until?: string;
}

export interface SubworkflowWorkflowStep extends WorkflowStepBase {
  type: "subworkflow";
  workflow: VersionedAssetReference;
  input: JsonObject;
  failure: "fail" | "continue";
}

export type WorkflowStep =
  | AgentWorkflowStep
  | CommandWorkflowStep
  | ToolWorkflowStep
  | ActionWorkflowStep
  | ApprovalWorkflowStep
  | HumanInputWorkflowStep
  | WaitWorkflowStep
  | SubworkflowWorkflowStep;

export interface AgentRole {
  provider?: string;
  model?: string;
  requiredCapabilities: Capability[];
  instructions?: string;
}

export interface WorkflowDefinition {
  schemaVersion: 1 | 2;
  id: string;
  version: number;
  lifecycle: WorkflowLifecycle;
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
  domainStates: string[];
  assets: VersionedAssetReference[];
  requirements: {
    capabilities: Capability[];
    providers: string[];
    tools: string[];
  };
  configuration: JsonObject;
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
  "WAITING",
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
  waitConditionId?: string;
  entered?: boolean;
  exited?: boolean;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowExecutionResult {
  workflowId: string;
  runId: string;
  workflowVersion: number;
  workflowDigest: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "WAITING";
  steps: Record<string, WorkflowStepExecution>;
  outputs: JsonObject;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  waitConditionIds?: string[];
}
