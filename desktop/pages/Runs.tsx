import { useEffect, useState } from "react";
import type { FableClient } from "../app/client.js";
import { formatRelativeDate, truncate } from "../app/format.js";
import type { AgentRun, DomainEvent } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Runs({
  runs,
  client,
  selectedId,
  onSelect,
  onRefresh,
}: {
  runs: AgentRun[];
  client?: FableClient;
  selectedId?: string;
  onSelect: (id?: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const selected = runs.find((run) => run.id === selectedId);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (selected === undefined || client === undefined) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    void client
      .events(selected.id, controller.signal)
      .then(setEvents)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [client, selected]);

  if (selected !== undefined) {
    const tokenTotal = selected.usage.inputTokens + selected.usage.outputTokens;
    return (
      <>
        <PageHeader
          eyebrow="Run detail"
          title={selected.goal}
          description={`${selected.workItemId} · ${selected.workflowId}`}
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
          <Panel title="Execution" subtitle="Current durable run state">
            <dl className="detail-list">
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusPill status={selected.status} />
                </dd>
              </div>
              <div>
                <dt>Current step</dt>
                <dd>{selected.currentStepId ?? "—"}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{selected.providerId ?? "Workflow selected"}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{selected.model ?? "Automatic"}</dd>
              </div>
              <div>
                <dt>Outcome</dt>
                <dd>{selected.outcome?.replaceAll("_", " ") ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Usage</dt>
                <dd>{new Intl.NumberFormat().format(tokenTotal)} tokens</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd className="mono">{selected.id}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd className="mono">{selected.workspacePath ?? "Not prepared"}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Timeline" subtitle={`${events.length} persisted events`}>
            {error === undefined ? null : <div className="inline-error">{error}</div>}
            {events.length === 0 ? (
              <EmptyState
                icon="activity"
                title="No events recorded"
                message="Events appear here as the run advances."
              />
            ) : (
              <ol className="timeline">
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
        description="Inspect execution state, resource use, and the event trail for every orchestration."
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
            message="Runs launched from Work will remain available here across restarts."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Usage</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <strong>{run.goal}</strong>
                      <small>
                        {run.workItemId} · {truncate(run.id)}
                      </small>
                    </td>
                    <td>{run.workflowId}</td>
                    <td>
                      <StatusPill status={run.status} />
                    </td>
                    <td>
                      {new Intl.NumberFormat().format(
                        run.usage.inputTokens + run.usage.outputTokens,
                      )}{" "}
                      tok.
                    </td>
                    <td>{formatRelativeDate(run.updatedAt)}</td>
                    <td>
                      <Button
                        variant="quiet"
                        icon="chevron"
                        aria-label={`Open ${run.goal}`}
                        onClick={() => onSelect(run.id)}
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

const activeStatuses = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_HUMAN",
  "VERIFYING",
]);
