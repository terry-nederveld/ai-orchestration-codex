import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject } from "../domain/json.js";

export interface EventFactoryDefaults {
  source: string;
  runId?: string;
  correlationId?: string;
}

export class EventFactory {
  public constructor(private readonly defaults: EventFactoryDefaults) {}

  public create(
    type: string,
    payload: JsonObject,
    overrides: Partial<EventFactoryDefaults> = {},
  ): DomainEvent {
    const runId = overrides.runId ?? this.defaults.runId;
    const correlationId = overrides.correlationId ?? this.defaults.correlationId;
    return {
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      source: overrides.source ?? this.defaults.source,
      ...(runId === undefined ? {} : { runId }),
      ...(correlationId === undefined ? {} : { correlationId }),
      payload,
    };
  }
}
