import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

interface EntityRow {
  kind: string;
  id: string;
  value_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_json: string;
}

interface ClaimRow {
  provider: string;
  external_id: string;
  owner: string;
  token: string;
  expires_at: string;
}

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        value_json TEXT NOT NULL CHECK(json_valid(value_json)),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS entities_kind_updated_idx
      ON entities(kind, updated_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        run_id TEXT,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        event_json TEXT NOT NULL CHECK(json_valid(event_json))
      ) STRICT;

      CREATE INDEX IF NOT EXISTS events_run_sequence_idx ON events(run_id, sequence);
      CREATE INDEX IF NOT EXISTS events_type_sequence_idx ON events(type, sequence);

      CREATE TABLE IF NOT EXISTS claims (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        owner TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (provider, external_id)
      ) STRICT;
    `,
  },
] as const;

export class SqlitePersistenceProvider implements PersistenceProvider {
  #database: DatabaseSync | undefined;

  public constructor(private readonly path: string) {}

  public readonly entities: EntityRepository = {
    put: async <T extends JsonObject>(
      kind: string,
      id: string,
      value: T,
      expectedVersion?: number,
    ) => {
      const database = this.database();
      const current = this.readEntity<T>(kind, id);
      if (expectedVersion !== undefined && current?.version !== expectedVersion) {
        throw new Error(`Optimistic concurrency conflict for ${kind}:${id}`);
      }
      const now = new Date().toISOString();
      const entity: StoredEntity<T> = {
        kind,
        id,
        value,
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      database
        .prepare(
          `INSERT INTO entities(kind, id, value_json, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(kind, id) DO UPDATE SET
             value_json = excluded.value_json,
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .run(kind, id, JSON.stringify(value), entity.version, entity.createdAt, now);
      return structuredClone(entity);
    },
    get: async <T extends JsonObject>(kind: string, id: string) => this.readEntity<T>(kind, id),
    list: async <T extends JsonObject>(kind: string) => {
      const rows = this.database()
        .prepare("SELECT * FROM entities WHERE kind = ? ORDER BY updated_at DESC")
        .all(kind) as unknown as EntityRow[];
      return rows.map((row) => fromEntityRow<T>(row));
    },
    delete: async (kind, id) =>
      this.database().prepare("DELETE FROM entities WHERE kind = ? AND id = ?").run(kind, id)
        .changes > 0,
  };

  public readonly events: EventRepository = {
    append: async (event) => {
      this.database()
        .prepare(
          `INSERT OR IGNORE INTO events(id, run_id, type, occurred_at, event_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(event.id, event.runId ?? null, event.type, event.occurredAt, JSON.stringify(event));
    },
    list: async (options = {}) => {
      const clauses: string[] = [];
      const parameters: (string | number)[] = [];
      if (options.runId !== undefined) {
        clauses.push("run_id = ?");
        parameters.push(options.runId);
      }
      if (options.after !== undefined) {
        clauses.push("occurred_at > ?");
        parameters.push(options.after);
      }
      parameters.push(options.limit ?? 1000);
      const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
      const rows = this.database()
        .prepare(`SELECT event_json FROM events ${where} ORDER BY sequence ASC LIMIT ?`)
        .all(...parameters) as unknown as EventRow[];
      return rows.map(({ event_json }) => JSON.parse(event_json) as DomainEvent);
    },
  };

  public readonly claims: ClaimRepository = {
    acquire: async (claim) => {
      const database = this.database();
      database.prepare("DELETE FROM claims WHERE expires_at <= ?").run(new Date().toISOString());
      return (
        database
          .prepare(
            `INSERT OR IGNORE INTO claims(provider, external_id, owner, token, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(claim.provider, claim.externalId, claim.owner, claim.token, claim.expiresAt)
          .changes > 0
      );
    },
    renew: async (token, expiresAt) =>
      this.database()
        .prepare("UPDATE claims SET expires_at = ? WHERE token = ?")
        .run(expiresAt, token).changes > 0,
    release: async (token) =>
      this.database().prepare("DELETE FROM claims WHERE token = ?").run(token).changes > 0,
    get: async (provider, externalId) => {
      const row = this.database()
        .prepare(
          `SELECT provider, external_id, owner, token, expires_at FROM claims
           WHERE provider = ? AND external_id = ? AND expires_at > ?`,
        )
        .get(provider, externalId, new Date().toISOString()) as ClaimRow | undefined;
      return row === undefined ? undefined : fromClaimRow(row);
    },
  };

  public async initialize(): Promise<void> {
    if (this.#database !== undefined) return;
    if (this.path !== ":memory:") await mkdir(dirname(this.path), { recursive: true });
    const database = new DatabaseSync(this.path, { timeout: 5_000 });
    database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;",
    );
    database.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;`,
    );
    this.#database = database;
    this.applyMigrations();
  }

  public async close(): Promise<void> {
    this.#database?.close();
    this.#database = undefined;
  }

  private database(): DatabaseSync {
    if (this.#database === undefined) throw new Error("Persistence provider is not initialized");
    return this.#database;
  }

  private applyMigrations(): void {
    const database = this.database();
    const current = database
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    for (const migration of migrations) {
      if (migration.version <= current.version) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(migration.version, new Date().toISOString());
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private readEntity<T extends JsonObject>(kind: string, id: string): StoredEntity<T> | undefined {
    const row = this.database()
      .prepare("SELECT * FROM entities WHERE kind = ? AND id = ?")
      .get(kind, id) as EntityRow | undefined;
    return row === undefined ? undefined : fromEntityRow<T>(row);
  }
}

function fromEntityRow<T extends JsonObject>(row: EntityRow): StoredEntity<T> {
  return {
    kind: row.kind,
    id: row.id,
    value: JSON.parse(row.value_json) as T,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromClaimRow(row: ClaimRow): ClaimRecord {
  return {
    provider: row.provider,
    externalId: row.external_id,
    owner: row.owner,
    token: row.token,
    expiresAt: row.expires_at,
  };
}
