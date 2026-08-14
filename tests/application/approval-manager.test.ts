import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { ApprovalManager } from "../../src/application/approval-manager.js";

describe("ApprovalManager", () => {
  it("persists, lists, and resolves a pending approval", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const approvals = new ApprovalManager(persistence);

    const decision = approvals.request({
      runId: "run-1",
      title: "Publish change",
      description: "Create a pull request",
    });
    await expect(approvals.list()).resolves.toMatchObject([
      { runId: "run-1", title: "Publish change", status: "pending" },
    ]);

    const [record] = await approvals.list();
    expect(record).toBeDefined();
    await expect(approvals.resolve(record!.id, "approved")).resolves.toBe(true);
    await expect(decision).resolves.toBe("approved");
    await expect(approvals.resolve(record!.id, "denied")).resolves.toBe(false);
    await expect(approvals.list()).resolves.toMatchObject([{ status: "approved" }]);
  });

  it("turns an expired gate into an explicit timeout decision", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const approvals = new ApprovalManager(persistence);

    await expect(
      approvals.request({ runId: "run-2", title: "Wait", description: "Short gate", timeoutMs: 5 }),
    ).resolves.toBe("timed_out");
    await expect(approvals.list()).resolves.toMatchObject([{ status: "timed_out" }]);
  });
});
