import { describe, expect, it } from "vitest";
import { notificationForEvent } from "../../desktop/app/notifications.js";

describe("desktop notification privacy", () => {
  it("creates generic terminal-state alerts without copying event payload text", () => {
    const notification = notificationForEvent({
      id: "event-1",
      type: "agent.state.changed",
      occurredAt: new Date(0).toISOString(),
      source: "orchestrator",
      runId: "12345678-secret-run-id",
      payload: { to: "FAILED", error: "sensitive issue and prompt content" },
    });

    expect(notification).toEqual({
      title: "Fable run failed",
      body: "Review required · 12345678",
    });
    expect(JSON.stringify(notification)).not.toContain("sensitive");
  });

  it("creates a generic approval alert without copying its title or description", () => {
    const notification = notificationForEvent({
      id: "event-2",
      type: "approval.requested",
      occurredAt: new Date(0).toISOString(),
      source: "approval-manager",
      runId: "abcdefgh-private",
      payload: { title: "private release", description: "secret details" },
    });

    expect(notification).toEqual({
      title: "Fable approval requested",
      body: "A run needs your decision · abcdefgh",
    });
    expect(JSON.stringify(notification)).not.toContain("private release");
  });
});
