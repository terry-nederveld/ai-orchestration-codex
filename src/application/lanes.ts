import type { Capability } from "../domain/capabilities.js";
import type { WorkItem } from "../domain/work.js";
import type { RunStatus } from "../domain/runs.js";

export type LaneConsumptionPolicy = "strict_serial" | "skip_blocked" | "ranked_parallel";

export interface ExecutionLane {
  id: string;
  workflowId: string;
  policy: LaneConsumptionPolicy;
  wipLimit: number;
  requiredCapabilities: Capability[];
  profileIds: string[];
  budgetId?: string;
}

export interface LaneActiveRun {
  workItemId: string;
  status: RunStatus;
}

export class LaneSelector {
  public select(input: {
    lane: ExecutionLane;
    items: WorkItem[];
    active: LaneActiveRun[];
    profileCapabilities: Readonly<Record<string, Capability[]>>;
  }): WorkItem[] {
    if (!Number.isInteger(input.lane.wipLimit) || input.lane.wipLimit < 1) {
      throw new Error("Lane WIP limit must be positive");
    }
    if (
      !input.lane.profileIds.some((id) =>
        profileEligible(input.lane, input.profileCapabilities[id]),
      )
    ) {
      return [];
    }
    const active = input.active.filter(({ status }) => !terminal.has(status));
    if (input.lane.policy === "strict_serial" && active.length > 0) return [];
    const occupying =
      input.lane.policy === "skip_blocked"
        ? active.filter(({ status }) => !blockedRunStatuses.has(status))
        : active;
    const capacity = Math.max(0, input.lane.wipLimit - occupying.length);
    if (capacity === 0) return [];
    const activeIds = new Set(active.map(({ workItemId }) => workItemId));
    const ranked = [...input.items]
      .filter(({ id }) => !activeIds.has(id))
      .sort(
        (left, right) => nativeRank(left) - nativeRank(right) || left.id.localeCompare(right.id),
      );
    if (input.lane.policy === "strict_serial") {
      const first = ranked[0];
      return first === undefined || isBlocked(first) ? [] : [first];
    }
    return ranked.filter((item) => !isBlocked(item)).slice(0, capacity);
  }
}

function profileEligible(lane: ExecutionLane, capabilities: Capability[] | undefined): boolean {
  return (
    capabilities !== undefined &&
    lane.requiredCapabilities.every((capability) => capabilities.includes(capability))
  );
}

function nativeRank(item: WorkItem): number {
  const rank = item.metadata["rank"];
  if (typeof rank === "number" && Number.isFinite(rank)) return rank;
  const priority = Number(item.priority);
  return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
}

function isBlocked(item: WorkItem): boolean {
  return (
    item.labels.includes("blocked") ||
    item.metadata["blocked"] === true ||
    item.relationships.some(({ type }) => type === "blocked_by")
  );
}

const terminal = new Set<RunStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const blockedRunStatuses = new Set<RunStatus>(["BLOCKED", "WAITING", "WAITING_FOR_HUMAN"]);
