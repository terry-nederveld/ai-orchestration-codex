import type { ControlPlaneConnection } from "./types.js";

const storageKey = "fable.control-plane.connections.v2";
const legacyStorageKey = "fable.control-plane.connection";

export async function connectControlPlanes(): Promise<ControlPlaneConnection[]> {
  const stored = loadConnections();
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const local = await invoke<Partial<ControlPlaneConnection> & { url: string; token: string }>(
      "start_control_plane",
    );
    return [normalizeConnection(local, "local"), ...stored.filter(({ id }) => id !== "local")];
  }
  if (stored.length > 0) return stored;
  throw new Error("Start `fable serve`, then add its URL and token in Settings.");
}

export async function connectControlPlane(): Promise<ControlPlaneConnection> {
  return (await connectControlPlanes())[0]!;
}

export function saveConnection(
  connection: Partial<ControlPlaneConnection> & { url: string; token: string },
): void {
  const id = connection.id ?? "default";
  const connections = loadConnections().filter((value) => value.id !== id);
  connections.push(normalizeConnection(connection, id));
  saveConnections(connections);
  if (!isTauri()) window.localStorage.setItem(legacyStorageKey, JSON.stringify(connection));
}

export function saveConnections(connections: ControlPlaneConnection[]): void {
  connectionStorage().setItem(storageKey, JSON.stringify(connections));
}

export function removeConnection(id: string): void {
  saveConnections(loadConnections().filter((connection) => connection.id !== id));
}

export function loadConnections(): ControlPlaneConnection[] {
  const value = connectionStorage().getItem(storageKey);
  if (value !== null)
    return (JSON.parse(value) as ControlPlaneConnection[]).map((item) =>
      normalizeConnection(item, item.id),
    );
  const legacy = window.localStorage.getItem(legacyStorageKey);
  if (legacy === null) return [];
  const parsed = JSON.parse(legacy) as { url: string; token: string; configPath?: string };
  const migrated = normalizeConnection(parsed, "default");
  saveConnections([migrated]);
  window.localStorage.removeItem(legacyStorageKey);
  return [migrated];
}

function normalizeConnection(
  connection: Partial<ControlPlaneConnection> & { url: string; token: string },
  fallbackId: string,
): ControlPlaneConnection {
  const url = new URL(connection.url);
  if (
    url.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Remote control-plane connections must use HTTPS or a loopback tunnel");
  }
  return {
    id: connection.id ?? fallbackId,
    name: connection.name ?? (fallbackId === "local" ? "Local" : connection.url),
    group: connection.group ?? (fallbackId === "local" ? "Local" : "Remote"),
    location: connection.location ?? (fallbackId === "local" ? "local" : "remote"),
    url: connection.url.replace(/\/$/, ""),
    token: connection.token,
    ...(connection.configPath === undefined ? {} : { configPath: connection.configPath }),
  };
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function connectionStorage(): Storage {
  return isTauri() ? window.sessionStorage : window.localStorage;
}
