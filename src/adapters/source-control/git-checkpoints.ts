import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { RepositoryCheckpoint } from "../../domain/execution.js";
import type { JsonObject } from "../../domain/json.js";
import type { RepositoryCheckpointProvider } from "../../ports/checkpoints.js";
import type { PersistenceProvider } from "../../ports/persistence.js";
import type { ProcessRunner } from "../../ports/process.js";
import { validateCommitMessage } from "./conventional-commit.js";

export class GitRepositoryCheckpointProvider implements RepositoryCheckpointProvider {
  public constructor(
    private readonly runner: ProcessRunner,
    private readonly persistence: PersistenceProvider,
    private readonly recoveryRoot: string,
  ) {}

  public async checkpoint(input: {
    runId: string;
    repositoryId: string;
    workspacePath: string;
    branch: string;
    remote: string;
    message: string;
    executionSpecRevision: number;
    workflowCheckpoint: number;
    signal?: AbortSignal;
  }): Promise<RepositoryCheckpoint> {
    validateCommitMessage(input.message);
    const currentBranch = await this.git(
      input.workspacePath,
      ["branch", "--show-current"],
      input.signal,
    );
    if (currentBranch.stdout.trim() !== input.branch) {
      throw new Error(`Checkpoint branch mismatch: expected ${input.branch}`);
    }
    const status = await this.git(input.workspacePath, ["status", "--porcelain"], input.signal);
    if (status.stdout.trim().length > 0) {
      await this.git(input.workspacePath, ["add", "--", "."], input.signal);
      await this.git(input.workspacePath, ["commit", "-m", input.message], input.signal);
    }
    const revision = await this.git(input.workspacePath, ["rev-parse", "HEAD"], input.signal);
    const sha = revision.stdout.trim();
    await this.git(
      input.workspacePath,
      ["push", "--set-upstream", input.remote, input.branch],
      input.signal,
    );
    const checkpoint: RepositoryCheckpoint = {
      runId: input.runId,
      repositoryId: input.repositoryId,
      branch: input.branch,
      remote: input.remote,
      sha,
      executionSpecRevision: input.executionSpecRevision,
      workflowCheckpoint: input.workflowCheckpoint,
      pushedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put(
      "repository_checkpoint",
      `${input.runId}:${input.repositoryId}`,
      checkpoint,
    );
    return checkpoint;
  }

  public async recover(input: {
    checkpoint: RepositoryCheckpoint;
    cloneUrl: string;
    destination: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const root = await ensureRoot(this.recoveryRoot);
    const configuredRoot = resolve(this.recoveryRoot);
    const requested = resolve(input.destination);
    const requestedDifference = relative(configuredRoot, requested);
    if (
      requestedDifference.startsWith("..") ||
      isAbsolute(requestedDifference) ||
      requestedDifference === ""
    ) {
      throw new Error(`Checkpoint recovery destination must be inside ${root}`);
    }
    const destination = resolve(root, requestedDifference);
    assertWithin(root, destination);
    const parent = await ensureRoot(dirname(destination));
    assertWithin(root, parent, true);
    await this.git(
      parent,
      [
        "clone",
        "--branch",
        input.checkpoint.branch,
        "--single-branch",
        "--",
        input.cloneUrl,
        destination,
      ],
      input.signal,
    );
    const revision = await this.git(destination, ["rev-parse", "HEAD"], input.signal);
    if (revision.stdout.trim() !== input.checkpoint.sha) {
      throw new Error("Recovered branch does not match the durable checkpoint SHA");
    }
    return destination;
  }

  private async git(cwd: string, args: string[], signal?: AbortSignal) {
    const result = await this.runner.run({ command: "git", args, cwd, timeoutMs: 120_000 }, signal);
    if (result.exitCode !== 0) {
      throw new Error(`Git ${args[0] ?? "command"} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  }
}

async function ensureRoot(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return realpath(path);
}

function assertWithin(root: string, candidate: string, allowRoot = false): void {
  const difference = relative(root, candidate);
  if (difference.startsWith("..") || isAbsolute(difference) || (difference === "" && !allowRoot)) {
    throw new Error(`Checkpoint recovery destination must be inside ${root}`);
  }
}

export function checkpointToJson(value: RepositoryCheckpoint): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
