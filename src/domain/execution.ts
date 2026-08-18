import type { JsonObject, JsonValue } from "./json.js";
import type { VersionedAssetReference } from "./assets.js";

export const engineLifecycleStates = [
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING",
  "WAITING_FOR_HUMAN",
  "BLOCKED",
  "VERIFYING",
  "FAILED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type EngineLifecycleState = (typeof engineLifecycleStates)[number];

export interface WorkflowGraphPosition extends JsonObject {
  activeNodeIds: string[];
  completedNodeIds: string[];
  checkpoint: number;
}

export const waitConditionTypes = [
  "human_input",
  "approval",
  "time",
  "external_event",
  "dependency",
  "provider_availability",
  "work_item_event",
] as const;

export type WaitConditionType = (typeof waitConditionTypes)[number];
export type WaitConditionStatus = "waiting" | "satisfied" | "expired" | "cancelled";

export interface WaitSignal extends JsonObject {
  id: string;
  conditionId: string;
  source: "app" | "work_item" | "system";
  actorId: string;
  occurredAt: string;
  payload: JsonObject;
  supplemental: boolean;
}

export interface WaitCondition extends JsonObject {
  id: string;
  runId: string;
  nodeId: string;
  checkpointKey: string;
  type: WaitConditionType;
  status: WaitConditionStatus;
  predicate: JsonObject;
  signals: WaitSignal[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  selectedSignalId?: string;
}

export const humanInputTypes = [
  "text",
  "boolean",
  "single_choice",
  "multiple_choice",
  "approval",
  "secret",
  "file_reference",
  "free_form",
] as const;

export type HumanInputType = (typeof humanInputTypes)[number];

export interface HumanInputRequest extends JsonObject {
  type: HumanInputType;
  title: string;
  description: string;
  channel: "app" | "work_item" | "both";
  required: boolean;
  choices?: string[];
  secretDestination?: string;
  metadata: JsonObject;
}

export interface HumanInputResponse extends JsonObject {
  requestType: HumanInputType;
  value: JsonValue;
  promoted: boolean;
}

export const repositoryRoles = [
  "primary",
  "frontend",
  "backend",
  "infra",
  "docs",
  "dependency",
] as const;

export type RepositoryRole = (typeof repositoryRoles)[number];

export interface RepositoryBinding extends JsonObject {
  id: string;
  cloneUrl: string;
  role: RepositoryRole;
  defaultBranch?: string;
  localPath?: string;
  source: "explicit" | "mapping" | "agent_discovery";
  ruleId?: string;
}

export interface AppliedInstruction extends JsonObject {
  id: string;
  path: string;
  scope: string;
  provider: string;
  precedence: number;
  digest: string;
  content: string;
  trusted: boolean;
}

export interface ResolvedContextItem extends JsonObject {
  id: string;
  kind: string;
  source: string;
  relationship?: string;
  content: JsonValue;
  promoted: boolean;
  digest: string;
}

export interface ExecutionSpecification extends JsonObject {
  id: string;
  runId: string;
  revision: number;
  workflowSnapshotId: string;
  workflow: VersionedAssetReference;
  goal: string;
  acceptanceCriteria: string[];
  completionCriteria: string[];
  work: JsonObject;
  relatedWork: JsonObject[];
  repositories: RepositoryBinding[];
  instructions: AppliedInstruction[];
  context: ResolvedContextItem[];
  workflowOutputs: JsonObject;
  dependencies: JsonObject[];
  tests: string[];
  tools: string[];
  permissions: string[];
  validationRequirements: string[];
  agentProfile?: VersionedAssetReference;
  authoritativeFingerprint: string;
  createdAt: string;
  supersedes?: string;
}

export interface RepositoryCheckpoint extends JsonObject {
  runId: string;
  repositoryId: string;
  branch: string;
  remote: string;
  sha: string;
  executionSpecRevision: number;
  workflowCheckpoint: number;
  pushedAt: string;
}

export type ReleaseLifecycleState =
  | "planned"
  | "implemented"
  | "pull_request_opened"
  | "merged"
  | "released"
  | "deployed"
  | "verified";
