import { useState } from "react";
import type { FableClient } from "../app/client.js";
import { formatRelativeDate } from "../app/format.js";
import type { ApprovalRecord, WaitCondition } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Approvals({
  approvals,
  waits,
  clients,
  onRefresh,
}: {
  approvals: ApprovalRecord[];
  waits: WaitCondition[];
  clients: ReadonlyMap<string, FableClient>;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const pending = approvals.filter((item) => item.status === "pending");
  const needs = waits.filter((item) => item.status === "waiting");
  const history = approvals.filter((item) => item.status !== "pending");

  async function resolve(item: ApprovalRecord, decision: "approved" | "denied"): Promise<void> {
    try {
      await clientFor(clients, item.runtimeId).resolveApproval(item.id, decision);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function respond(item: WaitCondition, value: unknown, promote = false): Promise<void> {
    try {
      await clientFor(clients, item.runtimeId).respondToWait(item.id, {
        actorId: "fable-desktop-operator",
        value,
        promote,
      });
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Human in the loop"
        title="Needs your input"
        description="Approvals and typed questions from every runtime converge here without losing execution context."
      />
      {error === undefined ? null : <div className="inline-error">{error}</div>}
      <Panel
        title="Waiting for you"
        subtitle={`${pending.length + needs.length} pending decisions`}
      >
        {pending.length + needs.length === 0 ? (
          <EmptyState
            icon="approval"
            title="Nothing waiting"
            message="Autonomous work pauses here at configured gates and ambiguity boundaries."
          />
        ) : (
          <div className="approval-list">
            {pending.map((item) => (
              <article key={`${item.runtimeId}:${item.id}`}>
                <div className="approval-icon">!</div>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <small>
                    {item.runtimeName ?? "Runtime"} · run {item.runId.slice(0, 9)} ·{" "}
                    {formatRelativeDate(item.createdAt)}
                  </small>
                </div>
                <div className="approval-actions">
                  <Button variant="danger" icon="x" onClick={() => void resolve(item, "denied")}>
                    Deny
                  </Button>
                  <Button icon="check" onClick={() => void resolve(item, "approved")}>
                    Approve
                  </Button>
                </div>
              </article>
            ))}
            {needs.map((item) => (
              <WaitCard
                key={`${item.runtimeId}:${item.id}`}
                item={item}
                onRespond={(value, promote) => void respond(item, value, promote)}
              />
            ))}
          </div>
        )}
      </Panel>
      {history.length === 0 ? null : (
        <Panel title="Decision history">
          <div className="compact-list">
            {history.map((item) => (
              <div key={`${item.runtimeId}:${item.id}`}>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.runtimeName ?? "Runtime"} ·{" "}
                    {formatRelativeDate(item.decidedAt ?? item.createdAt)}
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

function WaitCard({
  item,
  onRespond,
}: {
  item: WaitCondition;
  onRespond: (value: unknown, promote?: boolean) => void;
}) {
  const request = requestFor(item);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [promote, setPromote] = useState(false);
  const type = stringValue(request["type"], item.type);
  const choices = Array.isArray(request["choices"])
    ? request["choices"].filter((value): value is string => typeof value === "string")
    : [];
  return (
    <article className="human-need">
      <div className="approval-icon">?</div>
      <div>
        <h3>{stringValue(request["title"], `Input for ${item.nodeId}`)}</h3>
        <p>
          {stringValue(
            request["description"],
            `A ${item.type.replaceAll("_", " ")} signal is required.`,
          )}
        </p>
        <small>
          {item.runtimeName ?? "Runtime"} · {type.replaceAll("_", " ")} ·{" "}
          {formatRelativeDate(item.createdAt)}
        </small>
        {type === "text" ||
        type === "free_form" ||
        type === "file_reference" ||
        type === "secret" ? (
          <input
            type={type === "secret" ? "password" : "text"}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              type === "secret" ? "Secret reference (not the secret value)" : "Your response"
            }
          />
        ) : null}
        {choices.length === 0 ? null : (
          <div className="choice-row">
            {choices.map((choice) => (
              <label key={choice}>
                <input
                  type={type === "multiple_choice" ? "checkbox" : "radio"}
                  name={item.id}
                  checked={selected.includes(choice)}
                  onChange={() =>
                    setSelected((values) =>
                      type === "multiple_choice"
                        ? values.includes(choice)
                          ? values.filter((value) => value !== choice)
                          : [...values, choice]
                        : [choice],
                    )
                  }
                />
                {choice}
              </label>
            ))}
          </div>
        )}
        <label className="promote-context">
          <input
            type="checkbox"
            checked={promote}
            onChange={(event) => setPromote(event.target.checked)}
          />
          Promote this response into later execution-spec context
        </label>
      </div>
      <div className="approval-actions">
        {type === "approval" || type === "boolean" ? (
          <>
            <Button variant="danger" onClick={() => onRespond(false, promote)}>
              No
            </Button>
            <Button onClick={() => onRespond(true, promote)}>Yes</Button>
          </>
        ) : (
          <Button
            disabled={choices.length > 0 ? selected.length === 0 : text.length === 0}
            onClick={() =>
              onRespond(
                type === "multiple_choice"
                  ? selected
                  : type === "single_choice"
                    ? selected[0]
                    : type === "secret"
                      ? { secretReference: text }
                      : text,
                promote,
              )
            }
          >
            Submit
          </Button>
        )}
      </div>
    </article>
  );
}

function requestFor(item: WaitCondition): Record<string, unknown> {
  const value = item.predicate["request"];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function clientFor(clients: ReadonlyMap<string, FableClient>, runtimeId?: string): FableClient {
  const client = runtimeId === undefined ? undefined : clients.get(runtimeId);
  if (client === undefined) throw new Error("The owning runtime is unavailable");
  return client;
}
