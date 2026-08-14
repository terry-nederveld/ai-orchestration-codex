import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { NodeProcessRunner } from "../../src/adapters/process/node-process-runner.js";
import { GitWorktreeWorkspaceProvider } from "../../src/adapters/workspace/git-worktree.js";
import { TemporaryWorkspaceProvider } from "../../src/adapters/workspace/temporary-workspace.js";

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("workspace providers", () => {
  it("creates and removes owned temporary workspaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-temp-root-"));
    temporaryPaths.push(root);
    const provider = new TemporaryWorkspaceProvider(root);
    const workspace = await provider.create({ runId: "run-1", strategy: "temporary" });
    await expect(access(workspace.path)).resolves.toBeUndefined();
    await provider.remove(workspace);
    await expect(access(workspace.path)).rejects.toThrow();
  });

  it("isolates changes in a Git worktree", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "fable-worktree-test-"));
    const repository = join(fixtureRoot, "repository");
    const worktrees = join(fixtureRoot, "worktrees");
    temporaryPaths.push(fixtureRoot);
    const runner = new NodeProcessRunner();
    await runGit(runner, fixtureRoot, ["init", repository]);
    await runGit(runner, repository, ["config", "user.name", "Fable Test"]);
    await runGit(runner, repository, ["config", "user.email", "test@example.test"]);
    await writeFile(join(repository, "file.txt"), "base");
    await runGit(runner, repository, ["add", "file.txt"]);
    await runGit(runner, repository, ["commit", "-m", "chore: initialize fixture"]);

    const provider = new GitWorktreeWorkspaceProvider(runner, worktrees);
    const workspace = await provider.create({
      runId: "issue-123",
      strategy: "git-worktree",
      repository: { id: "fixture", cloneUrl: repository, localPath: repository },
    });
    await writeFile(join(workspace.path, "file.txt"), "changed");

    expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("base");
    expect(await readFile(join(workspace.path, "file.txt"), "utf8")).toBe("changed");
    await provider.remove(workspace);
    await expect(access(workspace.path)).rejects.toThrow();
  });
});

async function runGit(runner: NodeProcessRunner, cwd: string, args: string[]): Promise<void> {
  const result = await runner.run({ command: "git", args, cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr);
}
