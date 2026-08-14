import type { DomainEvent, EventHandler } from "../domain/events.js";
import type { EventBus, Unsubscribe } from "../ports/event-bus.js";
import type { EventRepository } from "../ports/persistence.js";

export class PersistedEventBus implements EventBus {
  public constructor(
    private readonly inner: EventBus,
    private readonly events: EventRepository,
  ) {}

  public async publish(event: DomainEvent): Promise<void> {
    await this.events.append(event);
    await this.inner.publish(event);
  }

  public subscribe(pattern: string, handler: EventHandler): Unsubscribe {
    return this.inner.subscribe(pattern, handler);
  }
}
