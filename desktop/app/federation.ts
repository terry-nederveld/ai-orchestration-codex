import type { Snapshot } from "./types.js";

export function filterSnapshot(
  snapshot: Snapshot,
  connections: Array<{ id: string; group: string }>,
  filter: string,
): Snapshot {
  if (filter === "all") return snapshot;
  const runtimeIds = filter.startsWith("runtime:")
    ? new Set([filter.slice(8)])
    : new Set(connections.filter(({ group }) => filter === `group:${group}`).map(({ id }) => id));
  const includes = (value: { runtimeId?: string }) =>
    value.runtimeId !== undefined && runtimeIds.has(value.runtimeId);
  return {
    providers: snapshot.providers.filter(includes),
    runs: snapshot.runs.filter(includes),
    workflows: snapshot.workflows.filter(includes),
    approvals: snapshot.approvals.filter(includes),
    waits: snapshot.waits.filter(includes),
    scheduler: snapshot.scheduler,
  };
}
