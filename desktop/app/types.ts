export type ProviderKind =
  | "model"
  | "agent"
  | "work"
  | "source_control"
  | "workspace"
  | "tool"
  | "extension"
  | "secret"
  | "persistence"
  | "notification";

export interface ProviderStatus {
  descriptor: {
    id: string;
    displayName: string;
    kind: ProviderKind;
    version: string;
    capabilities: string[];
    authentication: string[];
  };
  availability: {
    installed: boolean;
    authenticated: boolean;
    available: boolean;
    models?: string[];
    detail?: string;
  };
}

export type RunStatus =
  | "QUEUED"
  | "PREPARING"
  | "RUNNING"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_SUBAGENT"
  | "WAITING_FOR_HUMAN"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export interface AgentRun {
  id: string;
  workItemId: string;
  workflowId: string;
  goal: string;
  status: RunStatus;
  currentStepId?: string;
  workspacePath?: string;
  providerId?: string;
  model?: string;
  outcome?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
    subscriptionRequests?: number;
  };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkItem {
  id: string;
  provider: string;
  externalId: string;
  title: string;
  description?: string;
  state: string;
  type?: string;
  priority?: string;
  labels: string[];
  repository?: { id: string; name?: string; owner?: string };
  url?: string;
  updatedAt?: string;
}

export interface WorkflowDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  workspace: { strategy: string; retainOnFailure: boolean };
  agents: Record<
    string,
    { provider?: string; model?: string; requiredCapabilities: string[]; instructions?: string }
  >;
  steps: Array<{
    id: string;
    name?: string;
    type: "agent" | "command" | "tool" | "action" | "approval";
    dependsOn: string[];
  }>;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  title: string;
  description: string;
  status: "pending" | "approved" | "denied" | "timed_out";
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
}

export interface DomainEvent {
  id: string;
  type: string;
  occurredAt: string;
  source: string;
  runId?: string;
  payload: Record<string, unknown>;
}

export interface ControlPlaneConnection {
  url: string;
  token: string;
  configPath?: string;
}

export interface SchedulerStatus {
  running: boolean;
  activeRuns: number;
  maxConcurrentRuns: number;
  lastPollAt?: string;
  nextPollAt?: string;
  lastError?: string;
}

export interface Snapshot {
  providers: ProviderStatus[];
  runs: AgentRun[];
  workflows: WorkflowDefinition[];
  approvals: ApprovalRecord[];
  scheduler: SchedulerStatus;
}
