import { realpath } from "node:fs/promises";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { Workspace, WorkspaceProvider, WorkspaceRequest } from "../../ports/workspace.js";
import { workspace } from "./temporary-workspace.js";

export class LocalDirectoryWorkspaceProvider implements WorkspaceProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "workspace" } = {
    id: "local-workspace",
    displayName: "Existing local directory",
    kind: "workspace",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async create(request: WorkspaceRequest): Promise<Workspace> {
    const requested = request.basePath ?? request.repository?.localPath;
    if (requested === undefined)
      throw new Error("Local workspace requires basePath or repository.localPath");
    return workspace(request, await realpath(requested), "local", { owned: false });
  }

  public async remove(workspaceValue: Workspace): Promise<void> {
    if (workspaceValue.strategy !== "local") {
      throw new Error(`Unexpected workspace strategy: ${workspaceValue.strategy}`);
    }
  }
}
