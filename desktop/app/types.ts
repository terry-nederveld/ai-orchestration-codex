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
  runtimeId?: string;
  runtimeName?: string;
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
  | "WAITING"
  | "WAITING_FOR_TOOL"
  | "WAITING_FOR_SUBAGENT"
  | "WAITING_FOR_HUMAN"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED";

export interface AgentRun {
  runtimeId?: string;
  runtimeName?: string;
  executionLocation?: "local" | "remote";
  id: string;
  workItemId: string;
  workflowId: string;
  workflowVersion?: number;
  workflowDigest?: string;
  workflowSnapshotId?: string;
  goal: string;
  status: RunStatus;
  currentStepId?: string;
  graphPosition?: { activeNodeIds: string[]; completedNodeIds: string[]; checkpoint: number };
  domainState?: string;
  externalState?: string;
  executionSpecRevision?: number;
  repositoryBranch?: string;
  checkpointSha?: string;
  releaseState?: string;
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
  repository?: {
    id: string;
    cloneUrl?: string;
    defaultBranch?: string;
    localPath?: string;
    name?: string;
    owner?: string;
  };
  metadata?: Record<string, unknown>;
  url?: string;
  updatedAt?: string;
}

export interface WorkflowDefinition {
  runtimeId?: string;
  runtimeName?: string;
  schemaVersion: 1 | 2;
  id: string;
  version?: number;
  lifecycle?: "DRAFT" | "ENABLED" | "DISABLED";
  name: string;
  description?: string;
  trigger?: { states: string[] };
  eligibility?: { includeLabels: string[]; excludeLabels: string[] };
  domainStates?: string[];
  assets?: Array<{ kind: string; id: string; version: number; digest: string }>;
  requirements?: { capabilities: string[]; providers: string[]; tools: string[] };
  configuration?: Record<string, unknown>;
  workspace: { strategy: string; retainOnFailure: boolean };
  agents: Record<
    string,
    { provider?: string; model?: string; requiredCapabilities: string[]; instructions?: string }
  >;
  steps: Array<{
    id: string;
    name?: string;
    type:
      "agent" | "command" | "tool" | "action" | "approval" | "human_input" | "wait" | "subworkflow";
    dependsOn: string[];
    [key: string]: unknown;
  }>;
}

export interface WorkflowEvaluationPlan {
  sideEffects: false;
  routing: { status: string; candidates: Array<Record<string, unknown>> };
  repositories: Array<Record<string, unknown>>;
  repositoryConflicts: string[];
  instructions: Array<Record<string, unknown>>;
  context: Array<Record<string, unknown>>;
  guards: Array<{ stepId: string; expression: string; determinable: boolean }>;
  stateMappings?: unknown;
  gates?: unknown;
  profiles?: unknown;
  permissions?: unknown;
  repositoryRules?: unknown;
  contextPolicy?: unknown;
  scheduling?: unknown;
  experiments?: unknown;
  pinnedAssets: unknown[];
  profileRequirements: Record<string, unknown>;
  expectedSideEffects: string[];
  determinablePath: string[];
  blockers: string[];
}

export interface ApprovalRecord {
  runtimeId?: string;
  runtimeName?: string;
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
  id: string;
  name: string;
  group: string;
  location: "local" | "remote";
  url: string;
  token: string;
  configPath?: string;
}

export interface WaitCondition {
  runtimeId?: string;
  runtimeName?: string;
  id: string;
  runId: string;
  nodeId: string;
  type: string;
  status: "waiting" | "satisfied" | "expired" | "cancelled";
  predicate: Record<string, unknown>;
  signals: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
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
  waits: WaitCondition[];
  scheduler: SchedulerStatus;
}

export interface RuntimeSnapshot {
  connection: ControlPlaneConnection;
  snapshot: Snapshot;
  loading: boolean;
  error?: string;
}
