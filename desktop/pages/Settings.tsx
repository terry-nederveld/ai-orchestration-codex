import { useState } from "react";
import type { ControlPlaneConnection } from "../app/types.js";
import { removeConnection, saveConnection } from "../app/connection.js";
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
} from "../app/notifications.js";
import { Button, PageHeader, Panel } from "../components/ui.js";

export function Settings({
  connections,
  onReconnect,
}: {
  connections: ControlPlaneConnection[];
  onReconnect: () => void;
}) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("Remote");
  const [url, setUrl] = useState("http://127.0.0.1:3210");
  const [token, setToken] = useState("");
  const [connectionError, setConnectionError] = useState<string>();
  const [notifications, setNotifications] = useState(notificationsEnabled());
  const [notificationMessage, setNotificationMessage] = useState<string>();

  function save(): void {
    try {
      const normalizedUrl = url.replace(/\/$/, "");
      saveConnection({
        id: connectionId(name || normalizedUrl),
        name: name || normalizedUrl,
        group: group || "Remote",
        location: "remote",
        url: normalizedUrl,
        token,
      });
      setName("");
      setToken("");
      setConnectionError(undefined);
      onReconnect();
    } catch (cause) {
      setConnectionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function toggleNotifications(): Promise<void> {
    if (notifications) {
      disableNotifications();
      setNotifications(false);
      setNotificationMessage("Native notifications are disabled.");
      return;
    }
    const granted = await enableNotifications();
    setNotifications(granted);
    setNotificationMessage(
      granted
        ? "Native notifications are enabled for approvals and terminal run states."
        : "Notification permission was not granted or this is the browser build.",
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Application"
        title="Settings"
        description="Connect one local control plane and any number of remote runtimes without sharing execution authority."
      />
      <div className="settings-grid">
        <Panel
          title="Connected runtimes"
          subtitle={`${connections.length} independent control planes`}
        >
          <div className="runtime-list">
            {connections.map((connection) => (
              <article key={connection.id}>
                <div>
                  <strong>{connection.name}</strong>
                  <small>
                    {connection.group} · {connection.location} · {connection.url}
                  </small>
                </div>
                {connection.location === "local" ? (
                  <span className="runtime-chip">managed</span>
                ) : (
                  <Button
                    variant="quiet"
                    icon="x"
                    aria-label={`Remove ${connection.name}`}
                    onClick={() => {
                      removeConnection(connection.id);
                      onReconnect();
                    }}
                  />
                )}
              </article>
            ))}
          </div>
        </Panel>
        <Panel
          title="Add remote runtime"
          subtitle="Each runtime keeps its own workflows, runs, approvals, and credentials."
        >
          <div className="stacked-form">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Staging"
              />
            </label>
            <label>
              <span>Group</span>
              <input
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                placeholder="Remote"
              />
            </label>
            <label>
              <span>Service URL</span>
              <input value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label>
              <span>Bearer token</span>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <Button disabled={url.length === 0 || token.length === 0} onClick={save}>
              Add and reconnect
            </Button>
          </div>
          {connectionError === undefined ? null : (
            <div className="inline-error">{connectionError}</div>
          )}
          <p className="panel-footnote">
            Browser connections persist locally. Tauri keeps remote tokens only for the current
            application session.
          </p>
        </Panel>
        <Panel
          title="Native notifications"
          subtitle="Opt in to generic approval and terminal-state alerts from the desktop app."
        >
          <p className="panel-footnote">
            Alerts contain a shortened run ID only. Work-item text, prompts, logs, and secrets are
            never included.
          </p>
          <Button variant="secondary" onClick={() => void toggleNotifications()}>
            {notifications ? "Disable notifications" : "Enable notifications"}
          </Button>
          {notificationMessage === undefined ? null : (
            <p className="panel-footnote" role="status">
              {notificationMessage}
            </p>
          )}
        </Panel>
        <Panel
          title="Security boundary"
          subtitle="Local and remote runtimes never share control-plane authority."
        >
          <dl className="detail-list">
            <div>
              <dt>Transport</dt>
              <dd>Loopback HTTP + SSE per runtime</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>Independent bearer token per connection</dd>
            </div>
            <div>
              <dt>Local secrets</dt>
              <dd>Outside renderer and SQLite run records</dd>
            </div>
            <div>
              <dt>Secret fallback</dt>
              <dd>AES-256-GCM encrypted vault</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </>
  );
}

function connectionId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : `runtime-${Date.now()}`;
}
