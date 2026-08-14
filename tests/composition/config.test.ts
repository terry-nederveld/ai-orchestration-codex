import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFableConfig } from "../../src/composition/config.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Fable configuration", () => {
  it("applies safe defaults and preserves provider configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fable-config-"));
    temporaryPaths.push(directory);
    const path = join(directory, "fable.config.yaml");
    await writeFile(
      path,
      `version: 1
models:
  - type: openai-compatible
    id: local
    name: Local
    baseUrl: http://127.0.0.1:11434/v1
    requireApiKey: false
`,
    );

    const loaded = await loadFableConfig(path);

    expect(loaded.directory).toBe(directory);
    expect(loaded.value).toMatchObject({
      dataDirectory: ".fable",
      concurrency: { workflowSteps: 4 },
      models: [{ id: "local", requireApiKey: false }],
    });
  });

  it("rejects invalid permission capabilities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fable-config-"));
    temporaryPaths.push(directory);
    const path = join(directory, "fable.config.yaml");
    await writeFile(
      path,
      "version: 1\npermissions:\n  - capability: root.everything\n    decision: allow\n",
    );

    await expect(loadFableConfig(path)).rejects.toThrow();
  });
});
