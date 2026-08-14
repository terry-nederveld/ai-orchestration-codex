import type { DomainEvent, EventHandler } from "../domain/events.js";
import type { EventBus, Unsubscribe } from "../ports/event-bus.js";

interface Subscription {
  pattern: string;
  handler: EventHandler;
}

export class InMemoryEventBus implements EventBus {
  readonly #subscriptions = new Set<Subscription>();

  public subscribe(pattern: string, handler: EventHandler): Unsubscribe {
    const subscription = { pattern, handler };
    this.#subscriptions.add(subscription);
    return () => this.#subscriptions.delete(subscription);
  }

  public async publish(event: DomainEvent): Promise<void> {
    const handlers = [...this.#subscriptions]
      .filter(({ pattern }) => matches(pattern, event.type))
      .map(({ handler }) => Promise.resolve(handler(event)));
    await Promise.all(handlers);
  }
}

function matches(pattern: string, eventType: string): boolean {
  if (pattern === "*" || pattern === eventType) return true;
  if (!pattern.endsWith(".*")) return false;
  return eventType.startsWith(pattern.slice(0, -1));
}
