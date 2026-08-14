import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { JsonObject } from "../../domain/json.js";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { Workspace, WorkspaceProvider, WorkspaceRequest } from "../../ports/workspace.js";
import { prepareWorkspaceRoot } from "./workspace-utils.js";

export class TemporaryWorkspaceProvider implements WorkspaceProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "workspace" } = {
    id: "temporary-workspace",
    displayName: "Temporary sandbox directory",
    kind: "workspace",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public constructor(private readonly defaultRoot = join(tmpdir(), "fable-workspaces")) {}

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async create(request: WorkspaceRequest): Promise<Workspace> {
    const root = await prepareWorkspaceRoot(request.basePath ?? this.defaultRoot);
    const path = await mkdtemp(join(root, "temporary-"));
    return workspace(request, path, "temporary", {});
  }

  public async remove(workspaceValue: Workspace): Promise<void> {
    if (workspaceValue.strategy !== "temporary") {
      throw new Error(`Refusing to remove non-temporary workspace: ${workspaceValue.path}`);
    }
    await rm(workspaceValue.path, { recursive: true, force: true, maxRetries: 3 });
  }
}

export function workspace(
  request: WorkspaceRequest,
  path: string,
  strategy: Workspace["strategy"],
  metadata: JsonObject,
): Workspace {
  return {
    id: `${strategy}:${request.runId}`,
    runId: request.runId,
    path,
    strategy,
    ...(request.branchName === undefined ? {} : { branchName: request.branchName }),
    createdAt: new Date().toISOString(),
    metadata,
  };
}
