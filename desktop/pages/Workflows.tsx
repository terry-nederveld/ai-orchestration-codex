import { useEffect, useMemo, useState } from "react";
import YAML from "yaml";
import type { FableClient } from "../app/client.js";
import type { WorkflowDefinition, WorkflowEvaluationPlan } from "../app/types.js";
import { Button, EmptyState, PageHeader, Panel } from "../components/ui.js";

export function Workflows({
  workflows,
  clients = new Map(),
  onRefresh = async () => undefined,
}: {
  workflows: WorkflowDefinition[];
  clients?: ReadonlyMap<string, FableClient>;
  onRefresh?: () => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected =
    workflows.find((workflow) => workflowKey(workflow) === selectedKey) ?? workflows[0];
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<WorkflowDefinition>();
  const [error, setError] = useState<string>();
  const [evaluation, setEvaluation] = useState<WorkflowEvaluationPlan>();
  const client = selected?.runtimeId === undefined ? undefined : clients.get(selected.runtimeId);

  useEffect(() => {
    if (selected === undefined) return;
    const canonical = canonicalYaml(selected);
    setText(canonical);
    setDraft(parseWorkflow(canonical));
    setError(undefined);
    setEvaluation(undefined);
  }, [selected]);

  const orderedSteps = useMemo(() => draft?.steps ?? [], [draft]);

  function replace(next: WorkflowDefinition): void {
    const canonical = canonicalYaml(next);
    setDraft(parseWorkflow(canonical));
    setText(canonical);
    setError(undefined);
    setEvaluation(undefined);
  }

  function applyText(): void {
    try {
      replace(parseWorkflow(text));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function evaluate(): Promise<void> {
    if (client === undefined || draft === undefined) return;
    try {
      setEvaluation(
        await client.evaluateWorkflow(draft, {
          id: "designer-preview",
          provider: "designer",
          externalId: "PREVIEW-1",
          title: "Workflow designer preview",
          state: draft.trigger?.states[0] ?? "Ready",
          labels: draft.eligibility?.includeLabels ?? [],
          metadata: { preview: true },
        }),
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveNextVersion(): Promise<void> {
    if (client === undefined || draft === undefined) return;
    try {
      const published = await client.publishWorkflow({
        ...draft,
        version: (selected?.version ?? draft.version ?? 1) + 1,
      });
      replace(published);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Automation design"
        title="Workflows"
        description="Edit the graph or canonical YAML, evaluate a side-effect-free plan, then publish an immutable next version."
        actions={
          draft === undefined ? undefined : (
            <>
              <Button
                variant="secondary"
                disabled={client === undefined}
                onClick={() => void evaluate()}
              >
                Evaluate
              </Button>
              <Button disabled={client === undefined} onClick={() => void saveNextVersion()}>
                Save next version
              </Button>
            </>
          )
        }
      />
      {error === undefined ? null : (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {selected === undefined || draft === undefined ? (
        <Panel title="Workflow library">
          <EmptyState
            icon="workflow"
            title="No workflow loaded"
            message="Add a YAML workflow path to fable.config.yaml or connect a runtime with published workflows."
          />
        </Panel>
      ) : (
        <div className="workflow-layout designer-layout">
          <Panel
            title="Workflow library"
            subtitle={`${workflows.length} latest immutable definitions`}
            className="workflow-browser"
          >
            <div className="workflow-list">
              {workflows.map((workflow) => (
                <button
                  className={workflowKey(workflow) === workflowKey(selected) ? "selected" : ""}
                  key={workflowKey(workflow)}
                  onClick={() => setSelectedKey(workflowKey(workflow))}
                >
                  <span>{workflow.name.slice(0, 1)}</span>
                  <div>
                    <strong>{workflow.name}</strong>
                    <small>
                      {workflow.runtimeName ?? "Runtime"} · v{workflow.version ?? 1} ·{" "}
                      {workflow.lifecycle ?? "ENABLED"}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </Panel>
          <div className="designer-main">
            <Panel
              title={draft.name}
              subtitle={`${selected.runtimeName ?? "Runtime"} · draft based on v${selected.version ?? 1}`}
            >
              <div className="workflow-meta">
                <label>
                  <span>Name</span>
                  <input
                    value={draft.name}
                    onChange={(event) => replace({ ...draft, name: event.target.value })}
                  />
                </label>
                <label>
                  <span>Lifecycle</span>
                  <select
                    value={draft.lifecycle ?? "ENABLED"}
                    onChange={(event) =>
                      replace({
                        ...draft,
                        lifecycle: event.target.value as NonNullable<
                          WorkflowDefinition["lifecycle"]
                        >,
                      })
                    }
                  >
                    <option>DRAFT</option>
                    <option>ENABLED</option>
                    <option>DISABLED</option>
                  </select>
                </label>
                <div>
                  <span>Next version</span>
                  <strong>{(selected.version ?? 1) + 1}</strong>
                </div>
              </div>
              <div className="designer-toolbar">
                <strong>Visual graph</strong>
                <Button
                  variant="secondary"
                  onClick={() =>
                    replace({ ...draft, steps: [...draft.steps, newStep(draft.steps)] })
                  }
                >
                  Add node
                </Button>
              </div>
              <div className="workflow-graph editable-graph">
                {orderedSteps.map((step, index) => (
                  <div className="workflow-node" key={step.id}>
                    <span className={`node-kind kind-${step.type}`}>{index + 1}</span>
                    <div className="node-editor">
                      <strong className="node-title">{step.name ?? step.id}</strong>
                      <input
                        aria-label={`Node ${index + 1} ID`}
                        value={step.id}
                        onChange={(event) =>
                          replace({
                            ...draft,
                            steps: draft.steps.map((value) =>
                              value === step ? { ...step, id: event.target.value } : value,
                            ),
                          })
                        }
                      />
                      <select
                        aria-label={`Node ${step.id} type`}
                        value={step.type}
                        onChange={(event) =>
                          replace({
                            ...draft,
                            steps: draft.steps.map((value) =>
                              value === step ? stepForType(step, event.target.value) : value,
                            ),
                          })
                        }
                      >
                        {stepTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                      <input
                        aria-label={`Node ${step.id} dependencies`}
                        value={step.dependsOn.join(", ")}
                        placeholder="depends on"
                        onChange={(event) =>
                          replace({
                            ...draft,
                            steps: draft.steps.map((value) =>
                              value === step
                                ? {
                                    ...step,
                                    dependsOn: event.target.value
                                      .split(",")
                                      .map((value) => value.trim())
                                      .filter(Boolean),
                                  }
                                : value,
                            ),
                          })
                        }
                      />
                    </div>
                    <Button
                      variant="quiet"
                      icon="x"
                      aria-label={`Remove ${step.id}`}
                      onClick={() =>
                        replace({
                          ...draft,
                          steps: draft.steps
                            .filter((value) => value !== step)
                            .map((value) => ({
                              ...value,
                              dependsOn: value.dependsOn.filter((id) => id !== step.id),
                            })),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title="Canonical YAML"
              subtitle="Text and visual edits round-trip through one normalized document."
            >
              <textarea
                className="workflow-yaml"
                spellCheck={false}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onBlur={applyText}
              />
              <div className="designer-toolbar">
                <span>Changes remain local until a new immutable version is published.</span>
                <Button variant="secondary" onClick={applyText}>
                  Apply YAML
                </Button>
              </div>
            </Panel>
            {evaluation === undefined ? null : <Evaluation plan={evaluation} />}
          </div>
        </div>
      )}
    </>
  );
}

function Evaluation({ plan }: { plan: WorkflowEvaluationPlan }) {
  return (
    <Panel
      title="Evaluation plan"
      subtitle="Read-only: no provider, repository, work-item, or persistence effects were executed."
    >
      <div className="evaluation-grid">
        <div>
          <span>Routing</span>
          <strong>{plan.routing.status}</strong>
        </div>
        <div>
          <span>Determinable path</span>
          <strong>{plan.determinablePath.join(" → ") || "none"}</strong>
        </div>
        <div>
          <span>Expected effects</span>
          <strong>{plan.expectedSideEffects.join(", ") || "none"}</strong>
        </div>
        <div>
          <span>Blockers</span>
          <strong>{plan.blockers.join(", ") || "none"}</strong>
        </div>
        <div>
          <span>Repositories / context</span>
          <strong>
            {plan.repositories.length} repositories · {plan.context.length} context items ·{" "}
            {plan.instructions.length} instruction sources
          </strong>
        </div>
        <div>
          <span>Guards</span>
          <strong>
            {plan.guards
              .map(
                ({ stepId, determinable }) =>
                  `${stepId}: ${determinable ? "known" : "needs output"}`,
              )
              .join(", ") || "none"}
          </strong>
        </div>
        <div>
          <span>Profiles / permissions</span>
          <strong>
            {compactConfiguration(plan.profiles)} · {compactConfiguration(plan.permissions)}
          </strong>
        </div>
        <div>
          <span>Gates / experiments / schedule</span>
          <strong>
            {compactConfiguration(plan.gates)} · {compactConfiguration(plan.experiments)} ·{" "}
            {compactConfiguration(plan.scheduling)}
          </strong>
        </div>
      </div>
    </Panel>
  );
}

function compactConfiguration(value: unknown): string {
  if (value === undefined || value === null) return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value.toString();
  if (typeof value !== "object") return "unknown";
  const keys = Object.keys(value);
  return keys.length === 0 ? "none" : keys.slice(0, 4).join(", ");
}

function canonicalYaml(value: WorkflowDefinition): string {
  return YAML.stringify(JSON.parse(JSON.stringify(value)), {
    sortMapEntries: true,
    lineWidth: 100,
  });
}

function parseWorkflow(text: string): WorkflowDefinition {
  const value: unknown = YAML.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Workflow YAML must contain an object");
  const workflow = value as WorkflowDefinition;
  if (
    typeof workflow.id !== "string" ||
    typeof workflow.name !== "string" ||
    !Array.isArray(workflow.steps)
  )
    throw new Error("Workflow id, name, and steps are required");
  return workflow;
}

function workflowKey(workflow: WorkflowDefinition): string {
  return `${workflow.runtimeId ?? "default"}|${workflow.id}|${workflow.version ?? 1}`;
}

function newStep(steps: WorkflowDefinition["steps"]): WorkflowDefinition["steps"][number] {
  let index = steps.length + 1;
  while (steps.some(({ id }) => id === `step_${index}`)) index += 1;
  return {
    id: `step_${index}`,
    type: "command",
    dependsOn: steps.at(-1) === undefined ? [] : [steps.at(-1)!.id],
    command: "true",
    args: [],
    env: {},
    expectedExitCodes: [0],
  };
}

function stepForType(
  step: WorkflowDefinition["steps"][number],
  rawType: string,
): WorkflowDefinition["steps"][number] {
  const type = rawType as WorkflowDefinition["steps"][number]["type"];
  const common = { id: step.id, type, dependsOn: step.dependsOn };
  if (type === "agent")
    return { ...common, agent: "default", goal: "Describe the desired outcome" };
  if (type === "command")
    return { ...common, command: "true", args: [], env: {}, expectedExitCodes: [0] };
  if (type === "tool") return { ...common, tool: "read_file", input: {} };
  if (type === "action") return { ...common, action: "commit", input: {} };
  if (type === "approval")
    return {
      ...common,
      title: "Approval required",
      description: "Confirm this workflow can continue.",
    };
  if (type === "human_input")
    return {
      ...common,
      inputType: "text",
      title: "Input required",
      description: "Provide the missing information.",
      channel: "app",
      required: true,
    };
  if (type === "wait") return { ...common, conditionType: "external_event", predicate: {} };
  return {
    ...common,
    workflow: { kind: "subworkflow", id: "replace_me", version: 1, digest: "0".repeat(64) },
    input: {},
    failure: "fail",
  };
}

const stepTypes = [
  "agent",
  "command",
  "tool",
  "action",
  "approval",
  "human_input",
  "wait",
  "subworkflow",
] as const;
