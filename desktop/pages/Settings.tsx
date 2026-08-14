import { useState } from "react";
import type { ControlPlaneConnection } from "../app/types.js";
import { saveConnection } from "../app/connection.js";
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
} from "../app/notifications.js";
import { Button, PageHeader, Panel } from "../components/ui.js";

export function Settings({
  connection,
  onReconnect,
}: {
  connection?: ControlPlaneConnection;
  onReconnect: () => void;
}) {
  const [url, setUrl] = useState(connection?.url ?? "http://127.0.0.1:3210");
  const [token, setToken] = useState(connection?.token ?? "");
  const [notifications, setNotifications] = useState(notificationsEnabled());
  const [notificationMessage, setNotificationMessage] = useState<string>();
  function save(): void {
    saveConnection({ url: url.replace(/\/$/, ""), token });
    onReconnect();
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
        description="Inspect the local service boundary or connect this web build to a headless Fable process."
      />
      <div className="settings-grid">
        <Panel
          title="Control plane"
          subtitle="The desktop app creates an ephemeral bearer token on every launch."
        >
          <div className="stacked-form">
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
            <Button onClick={save}>Save and reconnect</Button>
          </div>
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
          title="Configuration"
          subtitle="Secrets remain outside the renderer and SQLite database."
        >
          <dl className="detail-list">
            <div>
              <dt>Config file</dt>
              <dd className="mono">{connection?.configPath ?? "External service"}</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>Loopback HTTP + SSE</dd>
            </div>
            <div>
              <dt>Authentication</dt>
              <dd>Ephemeral bearer token</dd>
            </div>
            <div>
              <dt>Secret fallback</dt>
              <dd>AES-256-GCM encrypted vault</dd>
            </div>
          </dl>
          <p className="panel-footnote">
            Set FABLE_CONFIG_PATH before launching the desktop app to use a specific configuration.
          </p>
        </Panel>
      </div>
    </>
  );
}
