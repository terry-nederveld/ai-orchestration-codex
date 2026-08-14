import { useState } from "react";
import type { FableClient } from "../app/client.js";
import { formatRelativeDate } from "../app/format.js";
import type { ApprovalRecord } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Approvals({
  approvals,
  client,
  onRefresh,
}: {
  approvals: ApprovalRecord[];
  client?: FableClient;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  async function resolve(id: string, decision: "approved" | "denied"): Promise<void> {
    try {
      await client?.resolveApproval(id, decision);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  const pending = approvals.filter((item) => item.status === "pending");
  const history = approvals.filter((item) => item.status !== "pending");
  return (
    <>
      <PageHeader
        eyebrow="Human in the loop"
        title="Approvals"
        description="Consequential workflow steps pause here with an explicit reason and durable decision record."
      />
      {error === undefined ? null : <div className="inline-error">{error}</div>}
      <Panel title="Waiting for you" subtitle={`${pending.length} pending decisions`}>
        {pending.length === 0 ? (
          <EmptyState
            icon="approval"
            title="No approvals waiting"
            message="Autonomous work will pause here when a workflow reaches a configured gate."
          />
        ) : (
          <div className="approval-list">
            {pending.map((item) => (
              <article key={item.id}>
                <div className="approval-icon">!</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <small>
                    Run {item.runId.slice(0, 9)} · requested {formatRelativeDate(item.createdAt)}
                  </small>
                </div>
                <div className="approval-actions">
                  <Button variant="danger" icon="x" onClick={() => void resolve(item.id, "denied")}>
                    Deny
                  </Button>
                  <Button icon="check" onClick={() => void resolve(item.id, "approved")}>
                    Approve
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
      {history.length === 0 ? null : (
        <Panel title="Decision history">
          <div className="compact-list">
            {history.map((item) => (
              <div key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.decidedAt === undefined
                      ? formatRelativeDate(item.createdAt)
                      : formatRelativeDate(item.decidedAt)}
                  </small>
                </div>
                <StatusPill status={item.status} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
