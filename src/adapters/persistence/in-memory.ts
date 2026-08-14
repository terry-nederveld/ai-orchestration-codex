import type { DomainEvent } from "../../domain/events.js";
import type { JsonObject } from "../../domain/json.js";
import type {
  ClaimRecord,
  ClaimRepository,
  EntityRepository,
  EventRepository,
  PersistenceProvider,
  StoredEntity,
} from "../../ports/persistence.js";

export class InMemoryPersistenceProvider implements PersistenceProvider {
  readonly #entityValues = new Map<string, StoredEntity>();
  readonly #eventValues: DomainEvent[] = [];
  readonly #claimValues = new Map<string, ClaimRecord>();

  public readonly entities: EntityRepository = {
    put: async <T extends JsonObject>(
      kind: string,
      id: string,
      value: T,
      expectedVersion?: number,
    ) => {
      const key = entityKey(kind, id);
      const current = this.#entityValues.get(key);
      if (expectedVersion !== undefined && current?.version !== expectedVersion) {
        throw new Error(`Optimistic concurrency conflict for ${kind}:${id}`);
      }
      const now = new Date().toISOString();
      const entity: StoredEntity<T> = {
        kind,
        id,
        value: structuredClone(value),
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      this.#entityValues.set(key, entity);
      return structuredClone(entity);
    },
    get: async <T extends JsonObject>(kind: string, id: string) => {
      const entity = this.#entityValues.get(entityKey(kind, id));
      return entity === undefined ? undefined : (structuredClone(entity) as StoredEntity<T>);
    },
    list: async <T extends JsonObject>(kind: string) =>
      [...this.#entityValues.values()]
        .filter((entity) => entity.kind === kind)
        .map((entity) => structuredClone(entity) as StoredEntity<T>),
    delete: async (kind: string, id: string) => this.#entityValues.delete(entityKey(kind, id)),
  };

  public readonly events: EventRepository = {
    append: async (event) => {
      if (this.#eventValues.some(({ id }) => id === event.id)) return;
      this.#eventValues.push(structuredClone(event));
    },
    list: async (options = {}) => {
      let values = this.#eventValues;
      if (options.runId !== undefined)
        values = values.filter(({ runId }) => runId === options.runId);
      if (options.after !== undefined) {
        values = values.filter(({ occurredAt }) => occurredAt > options.after!);
      }
      return structuredClone(values.slice(0, options.limit ?? 1000));
    },
  };

  public readonly claims: ClaimRepository = {
    acquire: async (claim) => {
      const key = claimKey(claim.provider, claim.externalId);
      const current = this.#claimValues.get(key);
      if (current !== undefined && Date.parse(current.expiresAt) > Date.now()) return false;
      this.#claimValues.set(key, structuredClone(claim));
      return true;
    },
    renew: async (token, expiresAt) => {
      const claim = [...this.#claimValues.values()].find((candidate) => candidate.token === token);
      if (claim === undefined) return false;
      claim.expiresAt = expiresAt;
      return true;
    },
    release: async (token) => {
      const entry = [...this.#claimValues.entries()].find(([, claim]) => claim.token === token);
      return entry === undefined ? false : this.#claimValues.delete(entry[0]);
    },
    get: async (provider, externalId) => {
      const claim = this.#claimValues.get(claimKey(provider, externalId));
      if (claim === undefined || Date.parse(claim.expiresAt) <= Date.now()) return undefined;
      return structuredClone(claim);
    },
  };

  public async initialize(): Promise<void> {}
  public async close(): Promise<void> {}
}

function entityKey(kind: string, id: string): string {
  return `${kind}\0${id}`;
}

function claimKey(provider: string, externalId: string): string {
  return `${provider}\0${externalId}`;
}
