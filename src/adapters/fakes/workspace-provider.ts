import type { ProviderDescriptor } from "../../domain/providers.js";
import type { Workspace, WorkspaceProvider, WorkspaceRequest } from "../../ports/workspace.js";

export class InMemoryWorkspaceProvider implements WorkspaceProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "workspace" } = {
    id: "fake-workspace",
    displayName: "In-memory workspace",
    kind: "workspace",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public readonly created: WorkspaceRequest[] = [];
  public readonly removed: Workspace[] = [];

  public constructor(private readonly root = "/fable-test-workspaces") {}

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async create(request: WorkspaceRequest): Promise<Workspace> {
    this.created.push(structuredClone(request));
    return {
      id: `fake:${request.runId}`,
      runId: request.runId,
      path: `${this.root}/${request.runId}`,
      strategy: request.strategy,
      ...(request.branchName === undefined ? {} : { branchName: request.branchName }),
      createdAt: new Date(0).toISOString(),
      metadata: { inMemory: true },
    };
  }

  public async remove(workspace: Workspace): Promise<void> {
    this.removed.push(structuredClone(workspace));
  }
}
