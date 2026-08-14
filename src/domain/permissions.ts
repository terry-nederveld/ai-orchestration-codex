export const permissionCapabilities = [
  "filesystem.read",
  "filesystem.write",
  "process.execute",
  "network.connect",
  "git.read",
  "git.write",
  "issue.read",
  "issue.write",
  "secret.read",
  "browser.use",
  "computer.use",
  "container.use",
] as const;

export type PermissionCapability = (typeof permissionCapabilities)[number];
export type PermissionDecision = "allow" | "deny" | "ask" | "sandbox-only";

export interface PermissionRequest {
  capability: PermissionCapability;
  resource: string;
  operation: string;
  runId?: string;
  providerId?: string;
}

export interface PermissionRule {
  capability: PermissionCapability | "*";
  resource?: string;
  decision: PermissionDecision;
  priority?: number;
}

export interface PermissionEvaluation {
  decision: PermissionDecision;
  rule?: PermissionRule;
  reason: string;
}
