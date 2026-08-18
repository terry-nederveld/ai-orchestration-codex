// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FableClient } from "../../desktop/app/client.js";
import { Runs } from "../../desktop/pages/Runs.js";

afterEach(cleanup);

describe("Runs", () => {
  it("loads events from the owning runtime and displays the newest event first", async () => {
    const events = vi.fn().mockResolvedValue([
      {
        id: "old",
        type: "run.started",
        occurredAt: "2026-01-01T00:00:00Z",
        source: "engine",
        payload: {},
      },
      {
        id: "new",
        type: "test.passed",
        occurredAt: "2026-01-01T00:01:00Z",
        source: "verifier",
        payload: {},
      },
    ]);
    const client = { events, cancelRun: vi.fn() } as unknown as FableClient;
    render(
      <Runs
        runs={[
          {
            runtimeId: "remote",
            runtimeName: "Staging",
            executionLocation: "remote",
            id: "run-1",
            workItemId: "ISSUE-1",
            workflowId: "delivery",
            workflowVersion: 2,
            goal: "Ship it",
            status: "RUNNING",
            domainState: "Implementation",
            executionSpecRevision: 3,
            usage: { inputTokens: 1, outputTokens: 2 },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:01:00Z",
          },
        ]}
        clients={new Map([["remote", client]])}
        selectedKey="remote|run-1"
        onSelect={() => undefined}
        onRefresh={async () => undefined}
      />,
    );

    await waitFor(() => expect(events).toHaveBeenCalledWith("run-1", expect.any(AbortSignal)));
    const items = await screen.findAllByRole("listitem");
    expect(within(items[0]!).getByText(/test · passed/)).toBeTruthy();
    expect(screen.getByText("revision 3")).toBeTruthy();
    expect(screen.getByText(/Staging · remote/)).toBeTruthy();
  });
});
