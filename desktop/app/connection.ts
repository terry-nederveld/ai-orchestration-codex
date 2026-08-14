import type { ControlPlaneConnection } from "./types.js";

const storageKey = "fable.control-plane.connection";

export async function connectControlPlane(): Promise<ControlPlaneConnection> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<ControlPlaneConnection>("start_control_plane");
  }
  const stored = localStorage.getItem(storageKey);
  if (stored !== null) return JSON.parse(stored) as ControlPlaneConnection;
  throw new Error("Start `fable serve`, then connect its URL and token in Settings.");
}

export function saveConnection(connection: ControlPlaneConnection): void {
  localStorage.setItem(storageKey, JSON.stringify(connection));
}

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
