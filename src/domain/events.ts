import type { JsonObject } from "./json.js";

export interface DomainEvent<TPayload extends JsonObject = JsonObject> {
  id: string;
  type: string;
  occurredAt: string;
  source: string;
  runId?: string;
  correlationId?: string;
  payload: TPayload;
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;
