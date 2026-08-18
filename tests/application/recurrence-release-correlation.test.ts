import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { RecurringTriggerService } from "../../src/application/recurrence.js";
import { ReleaseLifecycleService } from "../../src/application/release-lifecycle.js";
import { SupportCorrelationService } from "../../src/application/support-correlation.js";

describe("recurrence, release lifecycle, and support correlation", () => {
  it("persists recurring due state and advances missed intervals idempotently", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const recurring = new RecurringTriggerService(persistence);
    const definition = {
      id: "weekly-support",
      workflowId: "discovery",
      workProviderId: "support",
      externalId: "OUTCOME-1",
      everyMs: 7 * 24 * 60 * 60 * 1_000,
      startAt: "2026-08-01T00:00:00.000Z",
      enabled: true,
      variables: {},
    };
    await recurring.register(definition);
    await recurring.register(structuredClone(definition));
    await expect(recurring.due(new Date("2026-08-18T00:00:00.000Z"))).resolves.toHaveLength(1);
    const advanced = await recurring.acknowledge(
      "weekly-support",
      new Date("2026-08-18T00:00:00.000Z"),
    );
    expect(advanced).toMatchObject({ dispatchCount: 1, nextDueAt: "2026-08-22T00:00:00.000Z" });
    const recreated = new RecurringTriggerService(persistence);
    await expect(recreated.due(new Date("2026-08-18T00:00:00.000Z"))).resolves.toEqual([]);
  });

  it("projects monotonic release observations", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const releases = new ReleaseLifecycleService(persistence);
    await releases.observe({
      runId: "run-1",
      state: "pull_request_opened",
      source: "scm",
      evidence: { number: 12 },
      observedAt: "2026-08-18T01:00:00.000Z",
    });
    const deployed = await releases.observe({
      runId: "run-1",
      state: "deployed",
      source: "deployment",
      evidence: { environment: "production" },
      observedAt: "2026-08-18T02:00:00.000Z",
    });
    expect(deployed).toMatchObject({ state: "deployed" });
    expect(deployed.observations).toHaveLength(2);
    await expect(
      releases.observe({
        runId: "run-1",
        state: "implemented",
        source: "workflow",
        evidence: {},
        observedAt: "2026-08-18T03:00:00.000Z",
      }),
    ).rejects.toThrow(/cannot regress/i);
  });

  it("distinguishes unresolved, unreleased, regression, new, and ignorable evidence", () => {
    const correlation = new SupportCorrelationService();
    expect(correlation.correlate({ signature: "setup", count: 0 }, [])).toMatchObject({
      action: "ignore",
    });
    expect(correlation.correlate({ signature: "new", count: 5 }, [])).toEqual({ action: "create" });
    expect(
      correlation.correlate({ signature: "setup", count: 5 }, [
        { workItemId: "A", signature: "setup", resolved: false },
      ]),
    ).toEqual({ action: "append_evidence", workItemId: "A" });
    expect(
      correlation.correlate({ signature: "setup", count: 5 }, [
        { workItemId: "A", signature: "setup", resolved: true, releaseState: "merged" },
      ]),
    ).toEqual({ action: "update_unreleased", workItemId: "A" });
    expect(
      correlation.correlate({ signature: "setup", count: 5, regressionIndicated: true }, [
        { workItemId: "A", signature: "setup", resolved: true, releaseState: "verified" },
      ]),
    ).toEqual({ action: "create_regression", relatedTo: "A" });
  });
});
