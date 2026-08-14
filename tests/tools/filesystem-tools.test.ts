import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
} from "../../src/adapters/tools/filesystem-tools.js";

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("filesystem tools", () => {
  it("reads, writes, and lists within the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "fable-tools-test-"));
    temporaryPaths.push(workspace);
    const context = {
      runId: "run",
      workspacePath: workspace,
      signal: new AbortController().signal,
      metadata: {},
    };
    await new WriteFileTool().execute(
      { path: "src/file.txt", content: "hello", createDirectories: true },
      context,
    );
    await expect(
      new ReadFileTool().execute({ path: "src/file.txt" }, context),
    ).resolves.toMatchObject({
      content: "hello",
    });
    await expect(
      new ListFilesTool().execute({ path: ".", recursive: true }, context),
    ).resolves.toMatchObject({ content: ["src", "src/file.txt"] });
  });

  it("rejects traversal and symlink escapes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "fable-tools-test-"));
    const outside = await mkdtemp(join(tmpdir(), "fable-outside-test-"));
    temporaryPaths.push(workspace, outside);
    await writeFile(join(outside, "secret"), "hidden");
    await symlink(outside, join(workspace, "escape"));
    const context = {
      runId: "run",
      workspacePath: workspace,
      signal: new AbortController().signal,
      metadata: {},
    };

    await expect(new ReadFileTool().execute({ path: "../secret" }, context)).rejects.toThrow(
      "escapes workspace",
    );
    await expect(new ReadFileTool().execute({ path: "escape/secret" }, context)).rejects.toThrow(
      "escapes workspace",
    );
    await expect(
      new WriteFileTool().execute({ path: "escape/new", content: "no" }, context),
    ).rejects.toThrow("escapes workspace");
  });
});
