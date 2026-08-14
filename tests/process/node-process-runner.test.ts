import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { NodeProcessRunner } from "../../src/adapters/process/node-process-runner.js";

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("NodeProcessRunner", () => {
  it("passes arguments without invoking a shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fable-process-test-"));
    temporaryPaths.push(directory);
    const marker = join(directory, "injected");
    const suspicious = `$(touch ${marker})`;
    const result = await new NodeProcessRunner().run({
      command: process.execPath,
      args: ["-e", "console.log(process.argv[1])", suspicious],
      cwd: directory,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(suspicious);
    await expect(access(marker)).rejects.toThrow();
  });

  it("enforces timeout and output bounds", async () => {
    const runner = new NodeProcessRunner();
    await expect(
      runner.run({
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 1000)"],
        cwd: process.cwd(),
        timeoutMs: 10,
      }),
    ).rejects.toThrow();

    const result = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1000))"],
      cwd: process.cwd(),
      maxOutputBytes: 20,
    });
    expect(result.stdout).toContain("[output truncated]");
    expect(result.stdout.length).toBeLessThan(100);
  });
});
