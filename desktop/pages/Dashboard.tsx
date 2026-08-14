import type { AgentRun, ApprovalRecord, ProviderStatus } from "../app/types.js";
import { formatRelativeDate } from "../app/format.js";
import { Button, EmptyState, MetricCard, Panel, StatusPill } from "../components/ui.js";

export function Dashboard({
  runs,
  providers,
  approvals,
  onNavigate,
}: {
  runs: AgentRun[];
  providers: ProviderStatus[];
  approvals: ApprovalRecord[];
  onNavigate: (view: string) => void;
}) {
  const active = runs.filter((run) => activeStatuses.has(run.status));
  const failures = runs.filter((run) => run.status === "FAILED");
  const blocked = runs.filter((run) => ["BLOCKED", "WAITING_FOR_HUMAN"].includes(run.status));
  const available = providers.filter((provider) => provider.availability.available).length;
  const inputTokens = runs.reduce((total, run) => total + run.usage.inputTokens, 0);
  const outputTokens = runs.reduce((total, run) => total + run.usage.outputTokens, 0);

  return (
    <>
      <header className="hero">
        <div>
          <span className="eyebrow">Orchestration overview</span>
          <h1>Good work should keep moving.</h1>
          <p>
            Fable turns eligible work into isolated, observable agent runs—and keeps you in control
            at every consequential gate.
          </p>
        </div>
        <Button icon="play" onClick={() => onNavigate("work")}>
          Launch work
        </Button>
      </header>

      <div className="metrics-grid">
        <MetricCard
          label="Active runs"
          value={active.length}
          note="executing or verifying"
          tone="blue"
          icon="activity"
        />
        <MetricCard
          label="Needs attention"
          value={blocked.length + approvals.filter((item) => item.status === "pending").length}
          note="blocked or awaiting approval"
          tone="amber"
          icon="approval"
        />
        <MetricCard
          label="Provider health"
          value={`${available}/${providers.length}`}
          note="configured providers available"
          tone="mint"
          icon="plug"
        />
        <MetricCard
          label="Failures"
          value={failures.length}
          note="across retained run history"
          tone="rose"
          icon="x"
        />
      </div>

      <div className="dashboard-grid">
        <Panel
          title="Recent runs"
          subtitle="Latest agent activity across every work source"
          action={
            <Button variant="quiet" icon="arrow" onClick={() => onNavigate("runs")}>
              All runs
            </Button>
          }
        >
          {runs.length === 0 ? (
            <EmptyState
              icon="runs"
              title="No runs yet"
              message="Connect a work source and launch an eligible item to begin."
            />
          ) : (
            <div className="run-list">
              {runs.slice(0, 6).map((run) => (
                <button
                  className="run-row"
                  key={run.id}
                  onClick={() => onNavigate(`run:${run.id}`)}
                >
                  <span className="run-glyph">{run.workItemId.slice(0, 2).toUpperCase()}</span>
                  <span className="run-copy">
                    <strong>{run.goal}</strong>
                    <small>
                      {run.workItemId} · {run.workflowId}
                    </small>
                  </span>
                  <StatusPill status={run.status} />
                  <time>{formatRelativeDate(run.updatedAt)}</time>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Consumption" subtitle="Aggregate usage from persisted run history">
          <div className="usage-total">
            <span>Tokens processed</span>
            <strong>{new Intl.NumberFormat().format(inputTokens + outputTokens)}</strong>
          </div>
          <div className="usage-split">
            <div>
              <span className="legend-dot input" />
              <p>Input</p>
              <strong>{new Intl.NumberFormat().format(inputTokens)}</strong>
            </div>
            <div>
              <span className="legend-dot output" />
              <p>Output</p>
              <strong>{new Intl.NumberFormat().format(outputTokens)}</strong>
            </div>
          </div>
          <p className="panel-footnote">
            Usage is collected from direct models and coding-agent providers when they expose it.
          </p>
        </Panel>
      </div>
    </>
  );
}

const activeStatuses = new Set(["QUEUED", "PREPARING", "RUNNING", "WAITING_FOR_TOOL", "VERIFYING"]);
