// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { scopeSnapshot } from "../../desktop/app/use-fable.js";
import { filterSnapshot } from "../../desktop/app/federation.js";
import type { ControlPlaneConnection, Snapshot } from "../../desktop/app/types.js";

describe("federated runtime scoping", () => {
  it("gives identical provider and run IDs distinct owning runtime identities", () => {
    const local = scopeSnapshot(snapshot(), connection("local", "Local", "local"));
    const remote = scopeSnapshot(snapshot(), connection("remote", "Staging", "remote"));

    expect(local.runs[0]).toMatchObject({ runtimeId: "local", executionLocation: "local" });
    expect(remote.runs[0]).toMatchObject({ runtimeId: "remote", executionLocation: "remote" });
    expect(`${local.runs[0]!.runtimeId}|${local.runs[0]!.id}`).not.toBe(
      `${remote.runs[0]!.runtimeId}|${remote.runs[0]!.id}`,
    );
    expect(remote.providers[0]).toMatchObject({ runtimeName: "Staging" });
  });

  it("filters the federated view by UI-only workspace group", () => {
    const localConnection = connection("local", "Local", "local");
    const remoteConnection = connection("remote", "Staging", "remote");
    const combined: Snapshot = {
      ...snapshot(),
      providers: [
        ...scopeSnapshot(snapshot(), localConnection).providers,
        ...scopeSnapshot(snapshot(), remoteConnection).providers,
      ],
      runs: [
        ...scopeSnapshot(snapshot(), localConnection).runs,
        ...scopeSnapshot(snapshot(), remoteConnection).runs,
      ],
    };
    const filtered = filterSnapshot(combined, [localConnection, remoteConnection], "group:Remote");
    expect(filtered.runs.map(({ runtimeId }) => runtimeId)).toEqual(["remote"]);
    expect(filtered.providers.map(({ runtimeId }) => runtimeId)).toEqual(["remote"]);
  });
});

function snapshot(): Snapshot {
  return {
    providers: [
      {
        descriptor: {
          id: "shared",
          displayName: "Shared",
          kind: "work",
          version: "1",
          capabilities: [],
          authentication: [],
        },
        availability: { installed: true, authenticated: true, available: true },
      },
    ],
    runs: [
      {
        id: "same-run",
        workItemId: "ISSUE-1",
        workflowId: "delivery",
        goal: "Deliver",
        status: "RUNNING",
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    workflows: [],
    approvals: [],
    waits: [],
    scheduler: { running: false, activeRuns: 0, maxConcurrentRuns: 1 },
  };
}

function connection(
  id: string,
  name: string,
  location: "local" | "remote",
): ControlPlaneConnection {
  return {
    id,
    name,
    group: location === "local" ? "Local" : "Remote",
    location,
    url: `http://${id}.test`,
    token: "token",
  };
}
