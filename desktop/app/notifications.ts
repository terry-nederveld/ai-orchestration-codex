import type { DomainEvent } from "./types.js";

const preferenceKey = "fable.native-notifications";

export interface FableNotification {
  title: string;
  body: string;
}

export function notificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(preferenceKey) === "enabled";
}

export async function enableNotifications(): Promise<boolean> {
  const { isTauri, isPermissionGranted, requestPermission } = await notificationApi();
  if (!isTauri()) return false;
  const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
  window.localStorage.setItem(preferenceKey, granted ? "enabled" : "disabled");
  return granted;
}

export function disableNotifications(): void {
  window.localStorage.setItem(preferenceKey, "disabled");
}

export async function notifyForEvent(event: DomainEvent): Promise<void> {
  const notification = notificationForEvent(event);
  if (notification === undefined || !notificationsEnabled()) return;
  const { isTauri, isPermissionGranted, sendNotification } = await notificationApi();
  if (!isTauri() || !(await isPermissionGranted())) return;
  sendNotification(notification);
}

export function notificationForEvent(event: DomainEvent): FableNotification | undefined {
  if (event.type === "approval.requested") {
    const suffix = event.runId === undefined ? "" : ` · ${event.runId.slice(0, 8)}`;
    return { title: "Fable approval requested", body: `A run needs your decision${suffix}` };
  }
  if (event.type !== "agent.state.changed") return undefined;
  const state = event.payload["to"];
  const suffix = event.runId === undefined ? "" : ` · ${event.runId.slice(0, 8)}`;
  if (state === "COMPLETED") {
    return { title: "Fable run completed", body: `Delivery workflow finished${suffix}` };
  }
  if (state === "FAILED" || state === "BLOCKED") {
    return { title: `Fable run ${state.toLowerCase()}`, body: `Review required${suffix}` };
  }
  return undefined;
}

async function notificationApi() {
  const [core, notification] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/plugin-notification"),
  ]);
  return { isTauri: core.isTauri, ...notification };
}
