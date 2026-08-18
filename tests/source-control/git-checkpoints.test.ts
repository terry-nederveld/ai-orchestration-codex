import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { GitRepositoryCheckpointProvider } from "../../src/adapters/source-control/git-checkpoints.js";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { NodeProcessRunner } from "../../src/adapters/process/node-process-runner.js";

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("GitRepositoryCheckpointProvider", () => {
  it("pushes a durable branch and reconstructs work after the original session disappears", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "fable-checkpoint-"));
    temporaryPaths.push(fixture);
    const remote = join(fixture, "remote.git");
    const repository = join(fixture, "repository");
    const recoveryRoot = join(fixture, "recovered");
    const runner = new NodeProcessRunner();
    await git(runner, fixture, ["init", "--bare", remote]);
    await git(runner, fixture, ["clone", remote, repository]);
    await git(runner, repository, ["config", "user.name", "Fable Test"]);
    await git(runner, repository, ["config", "user.email", "test@example.test"]);
    await writeFile(join(repository, "README.md"), "initial\n");
    await git(runner, repository, ["add", "."]);
    await git(runner, repository, ["commit", "-m", "chore: initialize fixture"]);
    await git(runner, repository, ["branch", "-M", "main"]);
    await git(runner, repository, ["push", "-u", "origin", "main"]);
    await git(runner, repository, ["switch", "-c", "fable/run-1"]);
    await writeFile(join(repository, "implementation.txt"), "progress survives\n");

    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const checkpoints = new GitRepositoryCheckpointProvider(runner, persistence, recoveryRoot);
    const checkpoint = await checkpoints.checkpoint({
      runId: "run-1",
      repositoryId: "fixture",
      workspacePath: repository,
      branch: "fable/run-1",
      remote: "origin",
      message: "chore(fable): checkpoint run-1",
      executionSpecRevision: 2,
      workflowCheckpoint: 4,
    });
    expect(checkpoint.sha).toMatch(/^[a-f0-9]{40}$/);

    // Destroy the original workspace/session, then recover only from the remote branch record.
    await rm(repository, { recursive: true, force: true });
    await expect(access(repository)).rejects.toBeDefined();
    const destination = join(recoveryRoot, "run-1");
    await checkpoints.recover({ checkpoint, cloneUrl: remote, destination });
    await expect(readFile(join(destination, "implementation.txt"), "utf8")).resolves.toBe(
      "progress survives\n",
    );
    const recoveredSha = await git(runner, destination, ["rev-parse", "HEAD"]);
    expect(recoveredSha.stdout.trim()).toBe(checkpoint.sha);
    await expect(
      persistence.entities.get("repository_checkpoint", "run-1:fixture"),
    ).resolves.toBeDefined();
  });
});

async function git(runner: NodeProcessRunner, cwd: string, args: string[]) {
  const result = await runner.run({ command: "git", args, cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
