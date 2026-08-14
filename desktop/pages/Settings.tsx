import { useState } from "react";
import type { ControlPlaneConnection } from "../app/types.js";
import { saveConnection } from "../app/connection.js";
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
  function save(): void {
    saveConnection({ url: url.replace(/\/$/, ""), token });
    onReconnect();
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
