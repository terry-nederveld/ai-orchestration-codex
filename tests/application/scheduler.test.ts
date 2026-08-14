import { describe, expect, it } from "vitest";
import { InMemoryWorkProvider } from "../../src/adapters/fakes/work-provider.js";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { ProviderRegistry } from "../../src/application/provider-registry.js";
import { reconcileInterruptedRuns, WorkScheduler } from "../../src/application/scheduler.js";
import type { AgentRun } from "../../src/domain/runs.js";
import type { WorkItem } from "../../src/domain/work.js";
import type { WorkProvider } from "../../src/ports/providers.js";

describe("WorkScheduler", () => {
  it("dispatches eligible work once and records a completed idempotency key", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const item = workItem("ISSUE-1");
    const providers = providerRegistry([item]);
    let launches = 0;
    const scheduler = new WorkScheduler(
      [source()],
      options(),
      providers,
      persistence,
      events,
      () => {
        launches += 1;
        return {
          runId: `run-${launches}`,
          promise: Promise.resolve(result(item, `run-${launches}`, "COMPLETED")),
        };
      },
    );

    await scheduler.runOnce();
    await scheduler.waitForIdle();
    await scheduler.runOnce();
    await scheduler.waitForIdle();

    expect(launches).toBe(1);
    await expect(persistence.entities.list("scheduler_dispatch")).resolves.toMatchObject([
      { value: { status: "completed", attempts: 1 } },
    ]);
  });

  it("bounds concurrency and retries failed dispatches with a durable attempt count", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const first = workItem("ISSUE-1");
    const second = workItem("ISSUE-2");
    const providers = providerRegistry([first, second]);
    let launches = 0;
    const scheduler = new WorkScheduler(
      [source()],
      { ...options(), maxConcurrentRuns: 1, retryBackoffMs: 0, maxRetryBackoffMs: 0 },
      providers,
      persistence,
      events,
      () => {
        launches += 1;
        const status = launches === 1 ? "FAILED" : "COMPLETED";
        return {
          runId: `run-${launches}`,
          promise: Promise.resolve(result(first, `run-${launches}`, status)),
        };
      },
    );

    await scheduler.runOnce();
    expect(scheduler.status().activeRuns).toBeLessThanOrEqual(1);
    await scheduler.waitForIdle();
    await scheduler.runOnce();
    await scheduler.waitForIdle();

    expect(launches).toBe(2);
    const dispatches = await persistence.entities.list("scheduler_dispatch");
    expect(dispatches.map((entry) => entry.value)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "completed", attempts: 2 })]),
    );
  });
});

describe("run recovery", () => {
  it("moves non-terminal persisted runs to an explicit failed state after restart", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new InMemoryEventBus();
    const run = agentRun("run-interrupted", "RUNNING");
    await persistence.entities.put("run", run.id, JSON.parse(JSON.stringify(run)));

    await expect(reconcileInterruptedRuns(persistence, events)).resolves.toBe(1);

    await expect(persistence.entities.get("run", run.id)).resolves.toMatchObject({
      value: { status: "FAILED", outcome: "FATAL_FAILURE" },
    });
  });
});

function providerRegistry(items: WorkItem[]): ProviderRegistry<WorkProvider> {
  const providers = new ProviderRegistry<WorkProvider>();
  providers.register(new InMemoryWorkProvider(items));
  return providers;
}

function source() {
  return {
    id: "ready-work",
    workProviderId: "fake-work",
    workflowId: "delivery",
    query: { states: ["Ready"] },
  };
}

function options() {
  return {
    pollIntervalMs: 60_000,
    maxConcurrentRuns: 2,
    maxAttempts: 3,
    retryBackoffMs: 1,
    maxRetryBackoffMs: 10,
    owner: "test-scheduler",
  };
}

function workItem(externalId: string): WorkItem {
  return {
    id: `fake-work:${externalId}`,
    provider: "fake-work",
    externalId,
    title: `Work ${externalId}`,
    state: "Ready",
    labels: [],
    assignees: [],
    relationships: [],
    metadata: {},
  };
}

function result(item: WorkItem, runId: string, status: "COMPLETED" | "FAILED") {
  return {
    run: agentRun(runId, status),
    workItem: item,
    ...(status === "FAILED" ? { error: "failed" } : {}),
  };
}

function agentRun(id: string, status: AgentRun["status"]): AgentRun {
  const now = new Date().toISOString();
  return {
    id,
    workItemId: "fake-work:ISSUE-1",
    workflowId: "delivery",
    goal: "Deliver",
    status,
    usage: { inputTokens: 0, outputTokens: 0 },
    metadata: {},
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
