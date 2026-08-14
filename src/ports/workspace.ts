import type { JsonObject } from "../domain/json.js";
import type { Provider } from "./providers.js";
import type { RepositoryReference } from "../domain/work.js";

export type WorkspaceStrategy = "git-worktree" | "clone" | "local" | "temporary";

export interface WorkspaceRequest {
  runId: string;
  strategy: WorkspaceStrategy;
  repository?: RepositoryReference;
  basePath?: string;
  branchName?: string;
  retainOnFailure?: boolean;
  metadata?: JsonObject;
}

export interface Workspace {
  id: string;
  runId: string;
  path: string;
  strategy: WorkspaceStrategy;
  branchName?: string;
  createdAt: string;
  metadata: JsonObject;
}

export interface WorkspaceProvider extends Provider {
  readonly descriptor: Provider["descriptor"] & { kind: "workspace" };
  create(request: WorkspaceRequest, signal?: AbortSignal): Promise<Workspace>;
  remove(workspace: Workspace, signal?: AbortSignal): Promise<void>;
}
