import { describe, expect, it } from "vitest";
import { LaneSelector, type ExecutionLane } from "../../src/application/lanes.js";
import type { WorkItem } from "../../src/domain/work.js";

describe("LaneSelector", () => {
  it("preserves native rank and applies each blocking policy", () => {
    const items = [item("rank-3", 3), item("rank-1-blocked", 1, true), item("rank-2", 2)];
    const selector = new LaneSelector();
    expect(selector.select(input("strict_serial", items))).toEqual([]);
    expect(selector.select(input("skip_blocked", items)).map(({ id }) => id)).toEqual([
      "rank-2",
      "rank-3",
    ]);
    expect(selector.select(input("ranked_parallel", items)).map(({ id }) => id)).toEqual([
      "rank-2",
      "rank-3",
    ]);
  });

  it("holds strict serial while waiting and enforces profile capabilities", () => {
    const selector = new LaneSelector();
    expect(
      selector.select({
        ...input("strict_serial", [item("next", 1)]),
        active: [{ workItemId: "waiting", status: "WAITING_FOR_HUMAN" }],
      }),
    ).toEqual([]);
    expect(
      selector.select({
        ...input("ranked_parallel", [item("next", 1)]),
        profileCapabilities: { builder: ["chat"] },
      }),
    ).toEqual([]);
  });
});

function input(policy: ExecutionLane["policy"], items: WorkItem[]) {
  return {
    lane: {
      id: "delivery",
      workflowId: "delivery",
      policy,
      wipLimit: 2,
      requiredCapabilities: ["tool_use" as const],
      profileIds: ["builder"],
    },
    items,
    active: [],
    profileCapabilities: { builder: ["tool_use" as const, "structured_output" as const] },
  };
}

function item(id: string, rank: number, blocked = false): WorkItem {
  return {
    id,
    provider: "fixture",
    externalId: id,
    title: id,
    state: "Ready",
    labels: blocked ? ["blocked"] : [],
    assignees: [],
    relationships: [],
    metadata: { rank },
  };
}
