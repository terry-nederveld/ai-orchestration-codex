import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FableClient } from "../app/client.js";
import { formatRelativeDate, truncate } from "../app/format.js";
import type { AgentRun, DomainEvent } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Runs({
  runs,
  clients,
  selectedKey,
  onSelect,
  onRefresh,
}: {
  runs: AgentRun[];
  clients: ReadonlyMap<string, FableClient>;
  selectedKey?: string;
  onSelect: (key?: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const selected = runs.find((run) => runKey(run) === selectedKey);
  const client = selected?.runtimeId === undefined ? undefined : clients.get(selected.runtimeId);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [unseenEvents, setUnseenEvents] = useState(0);
  const [error, setError] = useState<string>();
  const timeline = useRef<HTMLOListElement>(null);
  const previousEventIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (selected === undefined || client === undefined) {
      setEvents([]);
      previousEventIds.current = new Set();
      return;
    }
    const controller = new AbortController();
    void client
      .events(selected.id, controller.signal)
      .then((values) => {
        const ordered = [...values].sort((left, right) =>
          right.occurredAt.localeCompare(left.occurredAt),
        );
        const previous = previousEventIds.current;
        const added = ordered.filter(({ id }) => !previous.has(id)).length;
        if (previous.size > 0 && added > 0 && (timeline.current?.scrollTop ?? 0) > 16) {
          setUnseenEvents((count) => count + added);
        }
        previousEventIds.current = new Set(ordered.map(({ id }) => id));
        setEvents(ordered);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [client, selected]);

  const evidence = useMemo(
    () =>
      events.filter((event) =>
        /test|artifact|experiment|judg|review|release|checkpoint/i.test(event.type),
      ),
    [events],
  );

  if (selected !== undefined) {
    const tokenTotal = selected.usage.inputTokens + selected.usage.outputTokens;
    return (
      <>
        <PageHeader
          eyebrow={`${selected.runtimeName ?? "Runtime"} · ${selected.executionLocation ?? "local"}`}
          title={selected.goal}
          description={`${selected.workItemId} · ${selected.workflowId}@${selected.workflowVersion ?? 1}`}
          actions={
            <>
              <Button variant="secondary" onClick={() => onSelect()}>
                Back
              </Button>
              {activeStatuses.has(selected.status) ? (
                <Button
                  variant="danger"
                  icon="pause"
                  onClick={() => void client?.cancelRun(selected.id).then(onRefresh)}
                >
                  Cancel run
                </Button>
              ) : null}
            </>
          }
        />
        <div className="run-detail-grid">
          <Panel
            title="Work and execution"
            subtitle="Durable state across domain and engine layers"
          >
            <dl className="detail-list">
              <Detail label="Status">
                <StatusPill status={selected.status} />
              </Detail>
              <Detail label="Domain state">{selected.domainState ?? "—"}</Detail>
              <Detail label="External state">{selected.externalState ?? "—"}</Detail>
              <Detail label="Current step">{selected.currentStepId ?? "—"}</Detail>
              <Detail label="Graph checkpoint">
                {selected.graphPosition === undefined
                  ? "—"
                  : `${selected.graphPosition.checkpoint} · ${selected.graphPosition.completedNodeIds.length} completed`}
              </Detail>
              <Detail label="Execution spec">revision {selected.executionSpecRevision ?? 1}</Detail>
              <Detail label="Workflow digest">
                <span className="mono">{selected.workflowDigest?.slice(0, 16) ?? "—"}</span>
              </Detail>
              <Detail label="Repository branch">
                <span className="mono">{selected.repositoryBranch ?? "—"}</span>
              </Detail>
              <Detail label="Checkpoint SHA">
                <span className="mono">{selected.checkpointSha?.slice(0, 12) ?? "—"}</span>
              </Detail>
              <Detail label="Release">{selected.releaseState ?? "not observed"}</Detail>
              <Detail label="Provider">{selected.providerId ?? "Workflow selected"}</Detail>
              <Detail label="Model">{selected.model ?? "Automatic"}</Detail>
              <Detail label="Outcome">{selected.outcome?.replaceAll("_", " ") ?? "Pending"}</Detail>
              <Detail label="Usage">{new Intl.NumberFormat().format(tokenTotal)} tokens</Detail>
              <Detail label="Run ID">
                <span className="mono">{selected.id}</span>
              </Detail>
              <Detail label="Workspace">
                <span className="mono">{selected.workspacePath ?? "Not prepared"}</span>
              </Detail>
            </dl>
            {evidence.length === 0 ? null : (
              <div className="evidence-strip">
                <strong>Evidence and judgments</strong>
                <span>{evidence.length} test, artifact, review, experiment, or release events</span>
              </div>
            )}
          </Panel>
          <Panel title="Timeline" subtitle={`${events.length} persisted events · newest first`}>
            {error === undefined ? null : <div className="inline-error">{error}</div>}
            {unseenEvents === 0 ? null : (
              <button
                className="new-events"
                onClick={() => {
                  timeline.current?.scrollTo({ top: 0, behavior: "smooth" });
                  setUnseenEvents(0);
                }}
              >
                {unseenEvents} new {unseenEvents === 1 ? "event" : "events"}
              </button>
            )}
            {events.length === 0 ? (
              <EmptyState
                icon="activity"
                title="No events recorded"
                message="Events appear here as the run advances."
              />
            ) : (
              <ol
                className="timeline"
                ref={timeline}
                onScroll={(event) => {
                  if (event.currentTarget.scrollTop < 16) setUnseenEvents(0);
                }}
              >
                {events.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-marker" />
                    <div>
                      <strong>{event.type.replaceAll(".", " · ")}</strong>
                      <p>{event.source}</p>
                    </div>
                    <time>{formatRelativeDate(event.occurredAt)}</time>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Runs"
        description="Inspect work-centric state and event history across every connected runtime."
        actions={
          <Button variant="secondary" icon="refresh" onClick={() => void onRefresh()}>
            Refresh
          </Button>
        }
      />
      <Panel title="Run history" subtitle={`${runs.length} persisted runs`}>
        {runs.length === 0 ? (
          <EmptyState
            icon="runs"
            title="No run history"
            message="Runs launched from Work remain available here across restarts."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Runtime</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={runKey(run)}>
                    <td>
                      <strong>{run.goal}</strong>
                      <small>
                        {run.workItemId} · {truncate(run.id)}
                      </small>
                    </td>
                    <td>
                      <span className="runtime-chip">{run.runtimeName ?? "Runtime"}</span>
                    </td>
                    <td>
                      {run.workflowId}@{run.workflowVersion ?? 1}
                    </td>
                    <td>
                      <StatusPill status={run.status} />
                    </td>
                    <td>{run.domainState ?? run.currentStepId ?? "—"}</td>
                    <td>{formatRelativeDate(run.updatedAt)}</td>
                    <td>
                      <Button
                        variant="quiet"
                        icon="chevron"
                        aria-label={`Open ${run.goal}`}
                        onClick={() => onSelect(runKey(run))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function runKey(run: AgentRun): string {
  return `${run.runtimeId ?? "default"}|${run.id}`;
}

const activeStatuses = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_SUBAGENT",
  "WAITING_FOR_HUMAN",
  "VERIFYING",
]);
