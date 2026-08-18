import type { JsonObject } from "./json.js";

export const versionedAssetKinds = [
  "workflow",
  "subworkflow",
  "gate_set",
  "rubric",
  "agent_profile",
  "policy",
  "template",
] as const;

export type VersionedAssetKind = (typeof versionedAssetKinds)[number];

export interface VersionedAssetReference extends JsonObject {
  kind: VersionedAssetKind;
  id: string;
  version: number;
  digest: string;
}

export interface VersionedAssetRecord extends VersionedAssetReference {
  value: JsonObject;
  publishedAt: string;
}

export interface ResolvedAssetSnapshot extends JsonObject {
  id: string;
  root: VersionedAssetReference;
  assets: VersionedAssetReference[];
  digest: string;
  resolvedAt: string;
}

export type WorkflowLifecycle = "DRAFT" | "ENABLED" | "DISABLED";
