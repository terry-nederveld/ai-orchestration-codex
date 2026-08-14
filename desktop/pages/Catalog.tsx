import type { ProviderStatus, WorkflowDefinition } from "../app/types.js";
import { EmptyState, PageHeader, Panel } from "../components/ui.js";

export function Projects({
  workflows,
  workSources,
}: {
  workflows: WorkflowDefinition[];
  workSources: ProviderStatus[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="Composition"
        title="Projects"
        description="Projects bind repositories, work sources, workflows, providers, policies, budgets, and extensions."
      />
      <Panel
        title="Configured building blocks"
        subtitle="Project composition is configuration-driven in this release."
      >
        <div className="catalog-stats">
          <div>
            <span>Work sources</span>
            <strong>{workSources.length}</strong>
          </div>
          <div>
            <span>Workflows</span>
            <strong>{workflows.length}</strong>
          </div>
          <div>
            <span>Repository file</span>
            <strong>.fable/workflow.yaml</strong>
          </div>
        </div>
        <EmptyState
          icon="project"
          title="Compose in configuration"
          message="Keep non-secret project configuration beside the repository, then reference its workflow from your user configuration."
        />
      </Panel>
    </>
  );
}

export function Agents({
  workflows,
  agents,
}: {
  workflows: WorkflowDefinition[];
  agents: ProviderStatus[];
}) {
  const roles = workflows.flatMap((workflow) =>
    Object.entries(workflow.agents).map(([name, role]) => ({
      name,
      workflow: workflow.name,
      ...role,
    })),
  );
  return (
    <>
      <PageHeader
        eyebrow="Agent roster"
        title="Agents"
        description="Roles are declared by workflows and routed through capability-aware model or coding-agent providers."
      />
      <Panel
        title="Configured roles"
        subtitle={`${roles.length} roles across ${workflows.length} workflows`}
      >
        {roles.length === 0 ? (
          <EmptyState
            icon="agents"
            title="No agent roles"
            message="Add agent steps and roles to a workflow; names like planner or reviewer are never hardcoded."
          />
        ) : (
          <div className="role-grid">
            {roles.map((role) => (
              <article key={`${role.workflow}:${role.name}`}>
                <span className="role-avatar">{role.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <h3>{role.name}</h3>
                  <p>{role.workflow}</p>
                  <small>
                    {role.provider ?? "automatic routing"}
                    {role.model === undefined ? "" : ` · ${role.model}`}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Agent providers" subtitle={`${agents.length} configured adapters`}>
        <div className="compact-list">
          {agents.map((provider) => (
            <div key={provider.descriptor.id}>
              <div>
                <strong>{provider.descriptor.displayName}</strong>
                <small>{provider.descriptor.capabilities.join(" · ").replaceAll("_", " ")}</small>
              </div>
              <span>{provider.availability.available ? "ready" : "setup needed"}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
