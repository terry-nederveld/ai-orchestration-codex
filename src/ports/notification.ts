import type { Provider } from "./providers.js";

export interface Notification {
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "error";
  runId?: string;
}

export interface NotificationProvider extends Provider {
  readonly descriptor: Provider["descriptor"] & { kind: "notification" };
  send(notification: Notification): Promise<void>;
}
