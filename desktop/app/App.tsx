import { useMemo, useState } from "react";
import type { IconName } from "../components/Icon.js";
import { Icon } from "../components/Icon.js";
import { Button } from "../components/ui.js";
import { Approvals } from "../pages/Approvals.js";
import { Agents, Projects } from "../pages/Catalog.js";
import { Dashboard } from "../pages/Dashboard.js";
import { Providers } from "../pages/Providers.js";
import { Runs } from "../pages/Runs.js";
import { Settings } from "../pages/Settings.js";
import { Work } from "../pages/Work.js";
import { Workflows } from "../pages/Workflows.js";
import { useFable } from "./use-fable.js";

const navigation: Array<{ id: string; label: string; icon: IconName; group?: string }> = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "work", label: "Work sources", icon: "source", group: "Operate" },
  { id: "runs", label: "Runs", icon: "runs" },
  { id: "approvals", label: "Approvals", icon: "approval" },
  { id: "providers", label: "Providers", icon: "plug", group: "Configure" },
  { id: "workflows", label: "Workflows", icon: "workflow" },
  { id: "projects", label: "Projects", icon: "project" },
  { id: "agents", label: "Agents", icon: "agents" },
];

export function App() {
  const fable = useFable();
  const [view, setView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const selectedRunId = view.startsWith("run:") ? view.slice(4) : undefined;
  const currentView = selectedRunId === undefined ? view : "runs";
  const pendingApprovals = fable.snapshot.approvals.filter(
    (item) => item.status === "pending",
  ).length;
  const activeRuns = fable.snapshot.runs.filter((run) => activeStatuses.has(run.status)).length;
  const workSources = useMemo(
    () => fable.snapshot.providers.filter((item) => item.descriptor.kind === "work"),
    [fable.snapshot.providers],
  );
  const agentProviders = useMemo(
    () => fable.snapshot.providers.filter((item) => item.descriptor.kind === "agent"),
    [fable.snapshot.providers],
  );

  function navigate(next: string): void {
    setView(next);
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Fable</strong>
            <small>Agent orchestration</small>
          </div>
        </div>
        <nav aria-label="Primary">
          {navigation.map((item, index) => (
            <div key={item.id}>
              {item.group === undefined ? null : <span className="nav-group">{item.group}</span>}
              <button
                className={currentView === item.id ? "active" : ""}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.id === "runs" && activeRuns > 0 ? <em>{activeRuns}</em> : null}
                {item.id === "approvals" && pendingApprovals > 0 ? (
                  <em className="attention">{pendingApprovals}</em>
                ) : null}
              </button>
              {index === 0 ? <span className="nav-divider" /> : null}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button
            className={currentView === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <div className="service-health">
            <span className={fable.error === undefined ? "online" : "offline"} />
            <div>
              <strong>{fable.error === undefined ? "Service online" : "Service offline"}</strong>
              <small>{fable.connection?.url.replace(/^https?:\/\//, "") ?? "not connected"}</small>
            </div>
          </div>
        </div>
      </aside>
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <main>
        <div className="mobile-bar">
          <button aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
            <span />
            <span />
            <span />
          </button>
          <strong>Fable</strong>
          <span className={fable.error === undefined ? "online-dot" : "offline-dot"} />
        </div>
        {fable.error === undefined ? null : (
          <div className="connection-banner">
            <div>
              <Icon name="plug" />
              <span>
                <strong>Control plane unavailable.</strong> {fable.error}
              </span>
            </div>
            <Button variant="secondary" icon="refresh" onClick={fable.reconnect}>
              Reconnect
            </Button>
          </div>
        )}
        {fable.loading ? (
          <div className="loading-state">
            <div className="orbit">
              <span />
              <span />
            </div>
            <strong>Starting Fable</strong>
            <p>Loading providers, workflows, and run history…</p>
          </div>
        ) : (
          <div className="page-content">{renderView()}</div>
        )}
      </main>
    </div>
  );

  function renderView() {
    switch (currentView) {
      case "dashboard":
        return (
          <Dashboard
            runs={fable.snapshot.runs}
            providers={fable.snapshot.providers}
            approvals={fable.snapshot.approvals}
            onNavigate={navigate}
          />
        );
      case "work":
        return (
          <Work
            {...(fable.client === undefined ? {} : { client: fable.client })}
            providers={fable.snapshot.providers}
            workflows={fable.snapshot.workflows}
            onRunStarted={(id) => navigate(`run:${id}`)}
          />
        );
      case "runs":
        return (
          <Runs
            runs={fable.snapshot.runs}
            {...(fable.client === undefined ? {} : { client: fable.client })}
            {...(selectedRunId === undefined ? {} : { selectedId: selectedRunId })}
            onSelect={(id) => navigate(id === undefined ? "runs" : `run:${id}`)}
            onRefresh={fable.refresh}
          />
        );
      case "approvals":
        return (
          <Approvals
            approvals={fable.snapshot.approvals}
            {...(fable.client === undefined ? {} : { client: fable.client })}
            onRefresh={fable.refresh}
          />
        );
      case "providers":
        return <Providers providers={fable.snapshot.providers} />;
      case "workflows":
        return <Workflows workflows={fable.snapshot.workflows} />;
      case "projects":
        return <Projects workflows={fable.snapshot.workflows} workSources={workSources} />;
      case "agents":
        return <Agents workflows={fable.snapshot.workflows} agents={agentProviders} />;
      case "settings":
        return (
          <Settings
            {...(fable.connection === undefined ? {} : { connection: fable.connection })}
            onReconnect={fable.reconnect}
          />
        );
      default:
        return (
          <Dashboard
            runs={fable.snapshot.runs}
            providers={fable.snapshot.providers}
            approvals={fable.snapshot.approvals}
            onNavigate={navigate}
          />
        );
    }
  }
}

const activeStatuses = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_SUBAGENT",
  "VERIFYING",
]);
