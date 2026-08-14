import type { ProviderDescriptor } from "../../domain/providers.js";
import type { Notification, NotificationProvider } from "../../ports/notification.js";

export class InMemoryNotificationProvider implements NotificationProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "notification" } = {
    id: "fake-notification",
    displayName: "In-memory notifications",
    kind: "notification",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public readonly sent: Notification[] = [];

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async send(notification: Notification): Promise<void> {
    this.sent.push(structuredClone(notification));
  }
}
