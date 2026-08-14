import { access, realpath } from "node:fs/promises";
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

export class GitWorktreeWorkspaceProvider implements WorkspaceProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "workspace" } = {
    id: "git-worktree",
    displayName: "Git worktree",
    kind: "workspace",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public constructor(
    private readonly runner: ProcessRunner,
    private readonly defaultRoot = join(tmpdir(), "fable-worktrees"),
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
    const repositoryPath = request.repository?.localPath;
    if (repositoryPath === undefined) {
      throw new Error("Git worktree requires repository.localPath");
    }
    const repository = await realpath(repositoryPath);
    const root = await prepareWorkspaceRoot(request.basePath ?? this.defaultRoot);
    const destination = workspaceDestination(root, request.runId);
    const branch = request.branchName ?? `fable/${safeBranchPart(request.runId)}`;
    if (await exists(join(destination, ".git"))) {
      return workspace({ ...request, branchName: branch }, destination, "git-worktree", {
        reused: true,
        repository,
        workspaceRoot: root,
      });
    }
    if (await exists(destination))
      throw new Error(`Workspace destination already exists: ${destination}`);

    const branchResult = await this.runner.run(
      {
        command: "git",
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        cwd: repository,
      },
      signal,
    );
    const args =
      branchResult.exitCode === 0
        ? ["worktree", "add", "--", destination, branch]
        : ["worktree", "add", "-b", branch, "--", destination, "HEAD"];
    const result = await this.runner.run(
      { command: "git", args, cwd: repository, timeoutMs: 120_000 },
      signal,
    );
    if (result.exitCode !== 0) throw new Error(`Git worktree creation failed: ${result.stderr}`);
    return workspace({ ...request, branchName: branch }, destination, "git-worktree", {
      reused: false,
      repository,
      workspaceRoot: root,
    });
  }

  public async remove(workspaceValue: Workspace, signal?: AbortSignal): Promise<void> {
    if (workspaceValue.strategy !== "git-worktree") {
      throw new Error(`Refusing to remove non-worktree workspace: ${workspaceValue.path}`);
    }
    const repository = workspaceValue.metadata["repository"];
    if (typeof repository !== "string")
      throw new Error("Worktree metadata is missing repository path");
    const root = workspaceValue.metadata["workspaceRoot"];
    if (typeof root !== "string") throw new Error("Worktree metadata is missing its root");
    await assertManagedWorkspacePath(root, workspaceValue.path);
    const result = await this.runner.run(
      {
        command: "git",
        args: ["worktree", "remove", "--force", "--", workspaceValue.path],
        cwd: repository,
      },
      signal,
    );
    if (result.exitCode !== 0) throw new Error(`Git worktree removal failed: ${result.stderr}`);
  }
}

function safeBranchPart(value: string): string {
  const result = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (result.length === 0) throw new Error("Run id cannot produce an empty branch name");
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
