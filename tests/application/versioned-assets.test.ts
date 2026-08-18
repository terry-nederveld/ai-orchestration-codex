import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { VersionedAssetCatalog } from "../../src/application/versioned-assets.js";

describe("VersionedAssetCatalog", () => {
  it("publishes immutable content and pins a fully resolved snapshot", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const catalog = new VersionedAssetCatalog(persistence);
    const workflow = await catalog.publish({
      kind: "workflow",
      id: "delivery",
      version: 1,
      value: { name: "Delivery", steps: ["ready", "build"] },
    });
    const profile = await catalog.publish({
      kind: "agent_profile",
      id: "builder",
      version: 2,
      value: { provider: "codex", capabilities: ["tool_use"] },
    });

    await expect(
      catalog.publish({
        kind: "workflow",
        id: "delivery",
        version: 1,
        value: { name: "Changed" },
      }),
    ).rejects.toThrow(/immutable/i);

    const snapshot = await catalog.pin(workflow, [profile]);
    expect(snapshot.root).toEqual(expect.objectContaining({ id: "delivery", version: 1 }));
    expect(snapshot.assets).toEqual([
      expect.objectContaining({ kind: "agent_profile", id: "builder", version: 2 }),
    ]);
    await expect(catalog.snapshot(snapshot.id)).resolves.toEqual(snapshot);
  });

  it("uses canonical object ordering for content identity", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const catalog = new VersionedAssetCatalog(persistence);
    const first = await catalog.publish({
      kind: "rubric",
      id: "quality",
      version: 1,
      value: { b: 2, a: { y: true, x: false } },
    });
    const second = await catalog.publish({
      kind: "rubric",
      id: "quality",
      version: 1,
      value: { a: { x: false, y: true }, b: 2 },
    });
    expect(second.digest).toBe(first.digest);
  });
});
