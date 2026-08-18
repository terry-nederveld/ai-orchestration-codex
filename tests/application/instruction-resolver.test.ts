import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemInstructionProvider } from "../../src/adapters/context/filesystem-instructions.js";
import { InstructionResolver } from "../../src/application/instruction-resolver.js";

const paths: string[] = [];
afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("instruction discovery", () => {
  it("applies root and nested conventions with provenance and refreshes changed content", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-instructions-"));
    paths.push(root);
    await mkdir(join(root, ".github"));
    await mkdir(join(root, "packages", "web"), { recursive: true });
    await writeFile(join(root, ".github", "copilot-instructions.md"), "Use TypeScript.\n");
    await writeFile(join(root, "AGENTS.md"), "Run all tests.\n");
    await writeFile(join(root, "packages", "web", "CLAUDE.md"), "Use accessible HTML.\n");
    const resolver = new InstructionResolver([new FilesystemInstructionProvider()]);
    const first = await resolver.resolve({
      repositoryRoot: root,
      targetPath: "packages/web/src/App.tsx",
    });
    const resolvedRoot = await realpath(root);
    expect(first.applied.map(({ path }) => path)).toEqual([
      join(resolvedRoot, ".github", "copilot-instructions.md"),
      join(resolvedRoot, "AGENTS.md"),
      join(resolvedRoot, "packages", "web", "CLAUDE.md"),
    ]);
    expect(first.applied.every(({ trusted }) => !trusted)).toBe(true);
    expect(first.content).toContain("sha256=");

    await writeFile(join(root, "packages", "web", "CLAUDE.md"), "Use semantic HTML.\n");
    const refreshed = await resolver.resolve({ repositoryRoot: root, targetPath: "packages/web" });
    expect(refreshed.applied.at(-1)?.digest).not.toBe(first.applied.at(-1)?.digest);
  });

  it("enforces instruction file size policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "fable-instructions-"));
    paths.push(root);
    await writeFile(join(root, "AGENTS.md"), "x".repeat(20));
    const provider = new FilesystemInstructionProvider({ maxFileBytes: 10 });
    await expect(provider.discover({ repositoryRoot: root })).rejects.toThrow(/size limit/i);
  });
});
