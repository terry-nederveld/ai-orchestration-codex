import type { PermissionEvaluation, PermissionRequest } from "../domain/permissions.js";

export interface PermissionProvider {
  evaluate(request: PermissionRequest): Promise<PermissionEvaluation>;
}

export interface SecretProvider {
  readonly id: string;
  available(): Promise<boolean>;
  get(reference: string): Promise<string | undefined>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<boolean>;
}

export interface ApprovalProvider {
  request(input: {
    runId: string;
    title: string;
    description: string;
    timeoutMs?: number;
  }): Promise<"approved" | "denied" | "timed_out">;
}
