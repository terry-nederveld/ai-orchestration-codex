import { useState } from "react";
import type { WorkflowDefinition } from "../app/types.js";
import { EmptyState, PageHeader, Panel } from "../components/ui.js";

export function Workflows({ workflows }: { workflows: WorkflowDefinition[] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0];
  return (
    <>
      <PageHeader
        eyebrow="Automation design"
        title="Workflows"
        description="Browse validated YAML workflows and inspect their dependency graph before running them."
      />
      {selected === undefined ? (
        <Panel title="Workflow library">
          <EmptyState
            icon="workflow"
            title="No workflow loaded"
            message="Add a YAML workflow path to fable.config.yaml. The CLI validates it before execution."
          />
        </Panel>
      ) : (
        <div className="workflow-layout">
          <Panel
            title="Workflow library"
            subtitle={`${workflows.length} validated definitions`}
            className="workflow-browser"
          >
            <div className="workflow-list">
              {workflows.map((workflow) => (
                <button
                  className={workflow.id === selected.id ? "selected" : ""}
                  key={workflow.id}
                  onClick={() => setSelectedId(workflow.id)}
                >
                  <span>{workflow.name.slice(0, 1)}</span>
                  <div>
                    <strong>{workflow.name}</strong>
                    <small>
                      {workflow.steps.length} steps · {workflow.workspace.strategy}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title={selected.name} subtitle={selected.description ?? selected.id}>
            <div className="workflow-meta">
              <div>
                <span>Workspace</span>
                <strong>{selected.workspace.strategy}</strong>
              </div>
              <div>
                <span>Agents</span>
                <strong>{Object.keys(selected.agents).length}</strong>
              </div>
              <div>
                <span>Steps</span>
                <strong>{selected.steps.length}</strong>
              </div>
            </div>
            <div className="workflow-graph">
              {selected.steps.map((step, index) => (
                <div className="workflow-node" key={step.id}>
                  <span className={`node-kind kind-${step.type}`}>{index + 1}</span>
                  <div>
                    <strong>{step.name ?? step.id}</strong>
                    <small>
                      {step.type}
                      {step.dependsOn.length === 0
                        ? " · starts workflow"
                        : ` · after ${step.dependsOn.join(", ")}`}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
