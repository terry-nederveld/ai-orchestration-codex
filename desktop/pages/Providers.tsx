import type { ProviderStatus } from "../app/types.js";
import { EmptyState, PageHeader, Panel, StatusPill } from "../components/ui.js";

export function Providers({ providers }: { providers: ProviderStatus[] }) {
  const groups = groupProviders(providers);
  return (
    <>
      <PageHeader
        eyebrow="Connections"
        title="Providers"
        description="Capability, authentication, and availability are negotiated per adapter—never inferred from a vendor name."
      />
      {providers.length === 0 ? (
        <Panel title="Configured providers">
          <EmptyState
            icon="plug"
            title="No providers configured"
            message="Add a direct model, coding agent, or work source to fable.config.yaml."
          />
        </Panel>
      ) : (
        [...groups].map(([kind, entries]) => (
          <Panel
            key={kind}
            title={labels[kind] ?? kind}
            subtitle={`${entries.filter((entry) => entry.availability.available).length} of ${entries.length} available`}
          >
            <div className="provider-grid">
              {entries.map((provider) => (
                <article className="provider-card" key={provider.descriptor.id}>
                  <header>
                    <span className={`provider-mark provider-${kind}`}>
                      {provider.descriptor.displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3>{provider.descriptor.displayName}</h3>
                      <code>{provider.descriptor.id}</code>
                    </div>
                    <StatusPill
                      status={
                        provider.availability.available
                          ? "available"
                          : provider.availability.installed
                            ? "unavailable"
                            : "not installed"
                      }
                    />
                  </header>
                  <p>{provider.availability.detail ?? availabilityMessage(provider)}</p>
                  <div className="tag-row">
                    {provider.descriptor.capabilities.slice(0, 6).map((capability) => (
                      <span key={capability}>{capability.replaceAll("_", " ")}</span>
                    ))}
                  </div>
                  <footer>
                    <span>Auth</span>
                    <strong>
                      {provider.descriptor.authentication.join(" · ").replaceAll("_", " ") ||
                        "none"}
                    </strong>
                  </footer>
                </article>
              ))}
            </div>
          </Panel>
        ))
      )}
    </>
  );
}

function groupProviders(providers: ProviderStatus[]): Map<string, ProviderStatus[]> {
  const groups = new Map<string, ProviderStatus[]>();
  for (const provider of providers) {
    const group = groups.get(provider.descriptor.kind) ?? [];
    group.push(provider);
    groups.set(provider.descriptor.kind, group);
  }
  return groups;
}

const labels: Record<string, string> = {
  model: "Direct models",
  agent: "Coding agents",
  work: "Work sources",
  workspace: "Workspace strategies",
  source_control: "Source control",
};

function availabilityMessage(provider: ProviderStatus): string {
  if (!provider.availability.installed)
    return "The required local executable is not installed or is outside the application path.";
  if (!provider.availability.authenticated)
    return "The provider is installed but needs a supported authentication method.";
  return "Installed, authenticated, and ready for orchestration.";
}
