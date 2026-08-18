import type { JsonObject } from "../domain/json.js";
import type { PersistenceProvider } from "../ports/persistence.js";

export interface RecurringTriggerDefinition extends JsonObject {
  id: string;
  workflowId: string;
  workProviderId: string;
  externalId: string;
  everyMs: number;
  startAt: string;
  enabled: boolean;
  variables: JsonObject;
}

export interface RecurringTriggerState extends JsonObject {
  id: string;
  workflowId: string;
  nextDueAt: string;
  lastDispatchedAt?: string;
  dispatchCount: number;
  definition: RecurringTriggerDefinition;
}

export class RecurringTriggerService {
  public constructor(private readonly persistence: PersistenceProvider) {}

  public async register(definition: RecurringTriggerDefinition): Promise<RecurringTriggerState> {
    if (!Number.isInteger(definition.everyMs) || definition.everyMs < 1_000) {
      throw new Error("Recurring interval must be at least one second");
    }
    if (!Number.isFinite(Date.parse(definition.startAt)))
      throw new Error("Invalid recurring startAt");
    const existing = await this.persistence.entities.get<RecurringTriggerState>(
      "recurring_trigger",
      definition.id,
    );
    if (existing !== undefined) {
      if (JSON.stringify(existing.value.definition) !== JSON.stringify(definition)) {
        const value = { ...existing.value, definition: structuredClone(definition) };
        await this.persistence.entities.put(
          "recurring_trigger",
          definition.id,
          value,
          existing.version,
        );
        return value;
      }
      return existing.value;
    }
    const value: RecurringTriggerState = {
      id: definition.id,
      workflowId: definition.workflowId,
      nextDueAt: definition.startAt,
      dispatchCount: 0,
      definition: structuredClone(definition),
    };
    await this.persistence.entities.put("recurring_trigger", value.id, value);
    return value;
  }

  public async due(now = new Date()): Promise<RecurringTriggerState[]> {
    return (await this.persistence.entities.list<RecurringTriggerState>("recurring_trigger"))
      .map(({ value }) => value)
      .filter(
        ({ definition, nextDueAt }) => definition.enabled && Date.parse(nextDueAt) <= now.getTime(),
      )
      .sort(
        (left, right) =>
          left.nextDueAt.localeCompare(right.nextDueAt) || left.id.localeCompare(right.id),
      );
  }

  public async list(): Promise<RecurringTriggerState[]> {
    return (await this.persistence.entities.list<RecurringTriggerState>("recurring_trigger"))
      .map(({ value }) => value)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public async acknowledge(id: string, dispatchedAt = new Date()): Promise<RecurringTriggerState> {
    const stored = await this.persistence.entities.get<RecurringTriggerState>(
      "recurring_trigger",
      id,
    );
    if (stored === undefined) throw new Error(`Unknown recurring trigger: ${id}`);
    let next = Date.parse(stored.value.nextDueAt);
    do next += stored.value.definition.everyMs;
    while (next <= dispatchedAt.getTime());
    const value: RecurringTriggerState = {
      ...stored.value,
      nextDueAt: new Date(next).toISOString(),
      lastDispatchedAt: dispatchedAt.toISOString(),
      dispatchCount: stored.value.dispatchCount + 1,
    };
    await this.persistence.entities.put("recurring_trigger", id, value, stored.version);
    return value;
  }
}
