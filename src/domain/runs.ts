import type { JsonObject } from "./json.js";
import type { GoalOutcome, Usage } from "./providers.js";

export const runStatuses = [
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_SUBAGENT",
  "WAITING_FOR_HUMAN",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
] as const;

export type RunStatus = (typeof runStatuses)[number];

const allowedTransitions: Readonly<Record<RunStatus, ReadonlySet<RunStatus>>> = {
  QUEUED: new Set(["PREPARING", "CANCELLED"]),
  PREPARING: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED"]),
  RUNNING: new Set([
    "WAITING",
    "WAITING_FOR_TOOL",
    "WAITING_FOR_SUBAGENT",
    "WAITING_FOR_HUMAN",
    "VERIFYING",
    "COMPLETED",
    "FAILED",
    "BLOCKED",
    "CANCELLED",
  ]),
  WAITING: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED"]),
  WAITING_FOR_TOOL: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED"]),
  WAITING_FOR_SUBAGENT: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED"]),
  WAITING_FOR_HUMAN: new Set(["RUNNING", "BLOCKED", "CANCELLED"]),
  VERIFYING: new Set(["RUNNING", "COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]),
  COMPLETED: new Set(),
  FAILED: new Set(["QUEUED"]),
  BLOCKED: new Set(["QUEUED", "RUNNING", "CANCELLED"]),
  CANCELLED: new Set(["QUEUED"]),
};

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return allowedTransitions[from].has(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new InvalidRunTransitionError(from, to);
  }
}

export class InvalidRunTransitionError extends Error {
  public constructor(
    public readonly from: RunStatus,
    public readonly to: RunStatus,
  ) {
    super(`Invalid run transition: ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

export interface AgentRun {
  id: string;
  workItemId: string;
  workflowId: string;
  workflowVersion?: number;
  workflowDigest?: string;
  workflowSnapshotId?: string;
  workflowVariables?: JsonObject;
  goal: string;
  status: RunStatus;
  currentStepId?: string;
  graphPosition?: {
    activeNodeIds: string[];
    completedNodeIds: string[];
    checkpoint: number;
  };
  domainState?: string;
  externalState?: string;
  executionSpecRevision?: number;
  repositoryBranch?: string;
  checkpointSha?: string;
  releaseState?: string;
  workspacePath?: string;
  providerId?: string;
  model?: string;
  outcome?: GoalOutcome;
  usage: Usage;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  version: number;
}

export interface RunTransition {
  runId: string;
  from: RunStatus;
  to: RunStatus;
  reason?: string;
  at: string;
}
