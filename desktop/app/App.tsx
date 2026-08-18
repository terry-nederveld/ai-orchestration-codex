import { useMemo, useState } from "react";
import type { IconName } from "../components/Icon.js";
import { filterSnapshot } from "./federation.js";
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
  const [runtimeFilter, setRuntimeFilter] = useState("all");
  const snapshot = useMemo(
    () => filterSnapshot(fable.snapshot, fable.connections, runtimeFilter),
    [fable.connections, fable.snapshot, runtimeFilter],
  );
  const selectedRunKey = view.startsWith("run:") ? view.slice(4) : undefined;
  const currentView = selectedRunKey === undefined ? view : "runs";
  const pendingApprovals =
    snapshot.approvals.filter((item) => item.status === "pending").length +
    snapshot.waits.filter((item) => item.status === "waiting").length;
  const activeRuns = snapshot.runs.filter((run) => activeStatuses.has(run.status)).length;
  const workSources = useMemo(
    () => snapshot.providers.filter((item) => item.descriptor.kind === "work"),
    [snapshot.providers],
  );
  const agentProviders = useMemo(
    () => snapshot.providers.filter((item) => item.descriptor.kind === "agent"),
    [snapshot.providers],
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
              <strong>
                {fable.runtimes.filter(({ error }) => error === undefined).length}/
                {fable.runtimes.length || 1} runtimes online
              </strong>
              <small>
                {fable.connections.map(({ name }) => name).join(" · ") || "not connected"}
              </small>
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
        <div className="runtime-filter">
          <label>
            <span>Workspace view</span>
            <select
              value={runtimeFilter}
              onChange={(event) => setRuntimeFilter(event.target.value)}
            >
              <option value="all">All runtimes</option>
              {[...new Set(fable.connections.map(({ group }) => group))].map((group) => (
                <option key={group} value={`group:${group}`}>
                  {group}
                </option>
              ))}
              {fable.connections.map((connection) => (
                <option key={connection.id} value={`runtime:${connection.id}`}>
                  {connection.name}
                </option>
              ))}
            </select>
          </label>
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
            runs={snapshot.runs}
            providers={snapshot.providers}
            approvals={snapshot.approvals}
            scheduler={snapshot.scheduler}
            onNavigate={navigate}
          />
        );
      case "work":
        return (
          <Work
            clients={fable.clients}
            providers={snapshot.providers}
            workflows={snapshot.workflows}
            onRunStarted={(runtimeId, id) => navigate(`run:${runtimeId}|${id}`)}
          />
        );
      case "runs":
        return (
          <Runs
            runs={snapshot.runs}
            clients={fable.clients}
            {...(selectedRunKey === undefined ? {} : { selectedKey: selectedRunKey })}
            onSelect={(key) => navigate(key === undefined ? "runs" : `run:${key}`)}
            onRefresh={fable.refresh}
          />
        );
      case "approvals":
        return (
          <Approvals
            approvals={snapshot.approvals}
            waits={snapshot.waits}
            clients={fable.clients}
            onRefresh={fable.refresh}
          />
        );
      case "providers":
        return <Providers providers={snapshot.providers} />;
      case "workflows":
        return (
          <Workflows
            workflows={snapshot.workflows}
            clients={fable.clients}
            onRefresh={fable.refresh}
          />
        );
      case "projects":
        return <Projects workflows={snapshot.workflows} workSources={workSources} />;
      case "agents":
        return <Agents workflows={snapshot.workflows} agents={agentProviders} />;
      case "settings":
        return <Settings connections={fable.connections} onReconnect={fable.reconnect} />;
      default:
        return (
          <Dashboard
            runs={snapshot.runs}
            providers={snapshot.providers}
            approvals={snapshot.approvals}
            scheduler={snapshot.scheduler}
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
  "WAITING",
  "WAITING_FOR_TOOL",
  "WAITING_FOR_SUBAGENT",
  "WAITING_FOR_HUMAN",
  "VERIFYING",
]);
