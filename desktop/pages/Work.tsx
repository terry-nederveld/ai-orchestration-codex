import { useEffect, useMemo, useState } from "react";
import type { FableClient } from "../app/client.js";
import { formatRelativeDate } from "../app/format.js";
import type { ProviderStatus, WorkItem, WorkflowDefinition } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Work({
  client,
  providers,
  workflows,
  onRunStarted,
}: {
  client?: FableClient;
  providers: ProviderStatus[];
  workflows: WorkflowDefinition[];
  onRunStarted: (id: string) => void;
}) {
  const sources = useMemo(
    () => providers.filter((item) => item.descriptor.kind === "work"),
    [providers],
  );
  const [providerId, setProviderId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (providerId.length === 0 && sources[0] !== undefined)
      setProviderId(sources[0].descriptor.id);
    if (workflowId.length === 0 && workflows[0] !== undefined) setWorkflowId(workflows[0].id);
  }, [providerId, sources, workflowId, workflows]);

  async function discover(): Promise<void> {
    if (client === undefined || providerId.length === 0) return;
    setLoading(true);
    try {
      setItems(await client.work(providerId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function launch(item: WorkItem): Promise<void> {
    if (client === undefined || workflowId.length === 0) return;
    try {
      onRunStarted(
        await client.startRun({
          workProviderId: providerId,
          externalId: item.externalId,
          workflowId,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Work intake"
        title="Ready work"
        description="Discover eligible work, choose a declarative workflow, and launch an isolated run."
        actions={
          <Button
            icon="refresh"
            disabled={providerId.length === 0 || loading}
            onClick={() => void discover()}
          >
            {loading ? "Discovering…" : "Discover work"}
          </Button>
        }
      />
      <Panel
        title="Intake controls"
        subtitle="Provider queries are read-only until you explicitly launch a run."
      >
        <div className="form-grid">
          <label>
            <span>Work source</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              <option value="">Choose a source</option>
              {sources.map((source) => (
                <option key={source.descriptor.id} value={source.descriptor.id}>
                  {source.descriptor.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Workflow</span>
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
              <option value="">Choose a workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error === undefined ? null : <div className="inline-error">{error}</div>}
      </Panel>
      <Panel title="Discovered items" subtitle={`${items.length} items in the current result`}>
        {sources.length === 0 ? (
          <EmptyState
            icon="source"
            title="No work source configured"
            message="Add GitHub, Jira, or Linear in your Fable configuration, then reconnect."
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="layers"
            title="Nothing discovered yet"
            message="Select a source and ask Fable to discover its current work queue."
          />
        ) : (
          <div className="work-grid">
            {items.map((item) => (
              <article className="work-card" key={item.id}>
                <div className="work-card-head">
                  <StatusPill status={item.state} />
                  <span>{item.priority ?? item.type ?? "work item"}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.description ?? "No description provided."}</p>
                <div className="tag-row">
                  {item.labels.slice(0, 4).map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <footer>
                  <small>
                    {item.externalId}
                    {item.updatedAt === undefined ? "" : ` · ${formatRelativeDate(item.updatedAt)}`}
                  </small>
                  <Button
                    icon="play"
                    disabled={workflowId.length === 0}
                    onClick={() => void launch(item)}
                  >
                    Launch
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
