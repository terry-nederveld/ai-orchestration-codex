import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { ProcessRunner } from "../../ports/process.js";
import type { Workspace, WorkspaceProvider, WorkspaceRequest } from "../../ports/workspace.js";
import { workspace } from "./temporary-workspace.js";
import {
  assertManagedWorkspacePath,
  prepareWorkspaceRoot,
  workspaceDestination,
} from "./workspace-utils.js";

export class CloneWorkspaceProvider implements WorkspaceProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "workspace" } = {
    id: "clone-workspace",
    displayName: "Isolated Git clone",
    kind: "workspace",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public constructor(
    private readonly runner: ProcessRunner,
    private readonly defaultRoot = join(tmpdir(), "fable-workspaces"),
  ) {}

  public async availability() {
    try {
      const result = await this.runner.run({
        command: "git",
        args: ["--version"],
        cwd: process.cwd(),
      });
      return {
        installed: result.exitCode === 0,
        authenticated: true,
        available: result.exitCode === 0,
      };
    } catch (error) {
      return {
        installed: false,
        authenticated: true,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async create(request: WorkspaceRequest, signal?: AbortSignal): Promise<Workspace> {
    const url = request.repository?.cloneUrl;
    if (url === undefined) throw new Error("Clone workspace requires a repository clone URL");
    const root = await prepareWorkspaceRoot(request.basePath ?? this.defaultRoot);
    const destination = workspaceDestination(root, request.runId);
    if (await exists(join(destination, ".git"))) {
      return workspace(request, destination, "clone", {
        reused: true,
        repository: url,
        workspaceRoot: root,
      });
    }
    if (await exists(destination))
      throw new Error(`Workspace destination already exists: ${destination}`);
    const result = await this.runner.run(
      { command: "git", args: ["clone", "--", url, destination], cwd: root, timeoutMs: 600_000 },
      signal,
    );
    if (result.exitCode !== 0) throw new Error(`Git clone failed: ${result.stderr}`);
    return workspace(request, destination, "clone", {
      reused: false,
      repository: url,
      workspaceRoot: root,
    });
  }

  public async remove(workspaceValue: Workspace): Promise<void> {
    if (workspaceValue.strategy !== "clone") {
      throw new Error(`Refusing to remove non-clone workspace: ${workspaceValue.path}`);
    }
    const root = workspaceValue.metadata["workspaceRoot"];
    if (typeof root !== "string") throw new Error("Clone workspace metadata is missing its root");
    await assertManagedWorkspacePath(root, workspaceValue.path);
    await rm(workspaceValue.path, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
