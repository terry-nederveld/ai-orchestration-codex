import type { DomainEvent, EventHandler } from "../domain/events.js";

export type Unsubscribe = () => void;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(pattern: string, handler: EventHandler): Unsubscribe;
}
