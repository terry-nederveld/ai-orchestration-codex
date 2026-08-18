import type { JsonObject } from "./json.js";

export interface Identity {
  id: string;
  displayName: string;
  email?: string;
  provider?: string;
}

export const workRelationshipTypes = [
  "parent",
  "child",
  "blocks",
  "blocked_by",
  "depends_on",
  "implements",
  "derived_from",
  "supported_by",
  "tests",
  "related_to",
  "regression_of",
] as const;

export type WorkRelationshipType = (typeof workRelationshipTypes)[number];

export interface WorkRelationship {
  type: WorkRelationshipType | (string & {});
  targetId: string;
}

export interface RepositoryReference {
  id: string;
  cloneUrl: string;
  defaultBranch?: string;
  owner?: string;
  name?: string;
  provider?: string;
  localPath?: string;
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
  assignees: Identity[];
  relationships: WorkRelationship[];
  repository?: RepositoryReference;
  metadata: JsonObject;
  url?: string;
  updatedAt?: string;
}

export interface WorkQuery {
  project?: string;
  states?: string[];
  labels?: string[];
  assignee?: string;
  limit?: number;
  cursor?: string;
}

export interface WorkPage {
  items: WorkItem[];
  nextCursor?: string;
}

export interface WorkClaim {
  workItemId: string;
  token: string;
  owner: string;
  expiresAt: string;
}

export interface WorkUpdate {
  state?: string;
  addLabels?: string[];
  removeLabels?: string[];
  comment?: string;
  assignee?: string;
  metadata?: JsonObject;
}
