// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dashboard } from "../../desktop/pages/Dashboard.js";

afterEach(cleanup);

describe("Dashboard", () => {
  it("summarizes active work, attention, provider health, and usage", () => {
    render(
      <Dashboard
        approvals={[
          {
            id: "approval-1",
            runId: "run-1",
            title: "Deliver",
            description: "Create pull request",
            status: "pending",
            createdAt: new Date().toISOString(),
          },
        ]}
        scheduler={{ running: true, activeRuns: 1, maxConcurrentRuns: 2 }}
        providers={[
          {
            descriptor: {
              id: "model",
              displayName: "Model",
              kind: "model",
              version: "1",
              capabilities: [],
              authentication: [],
            },
            availability: { installed: true, authenticated: true, available: true },
          },
        ]}
        runs={[
          {
            id: "run-1",
            workItemId: "ISSUE-1",
            workflowId: "delivery",
            goal: "Ship the feature",
            status: "RUNNING",
            usage: { inputTokens: 120, outputTokens: 30 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByText("Active runs").parentElement?.textContent).toContain("1");
    expect(screen.getByText("Needs attention").parentElement?.textContent).toContain("1");
    expect(screen.getByText("1/1")).toBeTruthy();
    expect(screen.getByText("150")).toBeTruthy();
    expect(screen.getByText("Ship the feature")).toBeTruthy();
  });
});
