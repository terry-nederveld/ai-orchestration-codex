import type { DomainEvent } from "../domain/events.js";
import type { JsonObject } from "../domain/json.js";

export interface StoredEntity<T extends JsonObject = JsonObject> {
  kind: string;
  id: string;
  value: T;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimRecord {
  provider: string;
  externalId: string;
  owner: string;
  token: string;
  expiresAt: string;
}

export interface EntityRepository {
  put<T extends JsonObject>(
    kind: string,
    id: string,
    value: T,
    expectedVersion?: number,
  ): Promise<StoredEntity<T>>;
  get<T extends JsonObject>(kind: string, id: string): Promise<StoredEntity<T> | undefined>;
  list<T extends JsonObject>(kind: string): Promise<StoredEntity<T>[]>;
  delete(kind: string, id: string): Promise<boolean>;
}

export interface EventRepository {
  append(event: DomainEvent): Promise<void>;
  list(options?: { runId?: string; after?: string; limit?: number }): Promise<DomainEvent[]>;
}

export interface ClaimRepository {
  acquire(claim: ClaimRecord): Promise<boolean>;
  renew(token: string, expiresAt: string): Promise<boolean>;
  release(token: string): Promise<boolean>;
  get(provider: string, externalId: string): Promise<ClaimRecord | undefined>;
}

export interface PersistenceProvider {
  initialize(): Promise<void>;
  close(): Promise<void>;
  readonly entities: EntityRepository;
  readonly events: EventRepository;
  readonly claims: ClaimRepository;
}
