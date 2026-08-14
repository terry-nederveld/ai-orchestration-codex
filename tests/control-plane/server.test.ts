import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedFableConfig } from "../../src/composition/config.js";
import { FableRuntime } from "../../src/composition/runtime.js";
import { ControlPlaneServer, type ControlPlaneAddress } from "../../src/control-plane/server.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ControlPlaneServer", () => {
  it("allows health checks but protects operational routes with origin and bearer checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fable-control-"));
    temporaryPaths.push(directory);
    const config: LoadedFableConfig = {
      path: join(directory, "fable.config.yaml"),
      directory,
      value: {
        version: 1,
        dataDirectory: ".fable",
        vault: {},
        permissions: [],
        models: [],
        agents: [],
        work: [],
        workflows: [],
        extensions: { paths: [], grants: {} },
        mcp: [],
        sourceControl: { githubSecret: "github.token" },
        concurrency: { workflowSteps: 4 },
        scheduler: {
          enabled: false,
          pollIntervalMs: 30_000,
          maxConcurrentRuns: 2,
          maxAttempts: 3,
          retryBackoffMs: 5_000,
          maxRetryBackoffMs: 300_000,
          sources: [],
        },
      },
    };
    const runtime = await FableRuntime.create(config);
    const server = new ControlPlaneServer(runtime, { port: 0, token: "test-token" });
    try {
      let address: ControlPlaneAddress;
      try {
        address = await server.start();
      } catch (error) {
        if (isErrnoException(error) && error.code === "EPERM") return;
        throw error;
      }
      const health = await fetch(`${address.url}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toMatchObject({ status: "ok" });

      expect((await fetch(`${address.url}/api/providers`)).status).toBe(401);
      expect(
        (
          await fetch(`${address.url}/api/providers`, {
            headers: { authorization: "Bearer test-token", origin: "https://attacker.test" },
          })
        ).status,
      ).toBe(403);

      const providers = await fetch(`${address.url}/api/providers`, {
        headers: { authorization: "Bearer test-token" },
      });
      expect(providers.status).toBe(200);
      const body: unknown = JSON.parse(await providers.text());
      expect(typeof body).toBe("object");
      expect(body).not.toBeNull();
      expect(Array.isArray((body as Record<string, unknown>)["providers"])).toBe(true);
    } finally {
      await server.close();
      await runtime.close();
    }
  });
});

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
