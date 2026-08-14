import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { EventFactory } from "../../src/application/events.js";
import type { PersistenceProvider } from "../../src/ports/persistence.js";

export async function assertPersistenceContract(persistence: PersistenceProvider): Promise<void> {
  await persistence.initialize();
  const first = await persistence.entities.put("project", "one", { name: "One" });
  expect(first.version).toBe(1);
  const second = await persistence.entities.put("project", "one", { name: "Updated" }, 1);
  expect(second.version).toBe(2);
  await expect(persistence.entities.put("project", "one", { name: "Conflict" }, 1)).rejects.toThrow(
    "concurrency conflict",
  );
  await expect(persistence.entities.get("project", "one")).resolves.toMatchObject({
    value: { name: "Updated" },
  });

  const event = new EventFactory({ source: "test", runId: "run-1" }).create("run.started", {
    status: "RUNNING",
  });
  await persistence.events.append(event);
  await persistence.events.append(event);
  await expect(persistence.events.list({ runId: "run-1" })).resolves.toEqual([event]);

  const claim = {
    provider: "work",
    externalId: "item-1",
    owner: "worker-1",
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await expect(persistence.claims.acquire(claim)).resolves.toBe(true);
  await expect(persistence.claims.acquire({ ...claim, token: randomUUID() })).resolves.toBe(false);
  await expect(persistence.claims.release(claim.token)).resolves.toBe(true);
  await expect(persistence.claims.acquire({ ...claim, token: randomUUID() })).resolves.toBe(true);

  await persistence.close();
}
