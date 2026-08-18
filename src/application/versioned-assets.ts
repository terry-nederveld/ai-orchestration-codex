import { createHash, randomUUID } from "node:crypto";
import type {
  ResolvedAssetSnapshot,
  VersionedAssetKind,
  VersionedAssetRecord,
  VersionedAssetReference,
} from "../domain/assets.js";
import type { JsonObject, JsonValue } from "../domain/json.js";
import type { PersistenceProvider } from "../ports/persistence.js";

const assetKind = "versioned_asset";
const snapshotKind = "asset_snapshot";

export class VersionedAssetCatalog {
  public constructor(private readonly persistence: PersistenceProvider) {}

  public async publish(input: {
    kind: VersionedAssetKind;
    id: string;
    version: number;
    value: JsonObject;
  }): Promise<VersionedAssetRecord> {
    assertIdentity(input.id, input.version);
    const digest = contentDigest(input.value);
    const storageId = assetStorageId(input.kind, input.id, input.version);
    const existing = await this.persistence.entities.get<VersionedAssetRecord>(
      assetKind,
      storageId,
    );
    if (existing !== undefined) {
      if (existing.value.digest !== digest) {
        throw new Error(
          `Immutable ${input.kind} ${input.id}@${input.version} already has different content`,
        );
      }
      return existing.value;
    }
    const record: VersionedAssetRecord = {
      kind: input.kind,
      id: input.id,
      version: input.version,
      digest,
      value: structuredClone(input.value),
      publishedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put(assetKind, storageId, record);
    return record;
  }

  public async get(reference: {
    kind: VersionedAssetKind;
    id: string;
    version: number;
    digest?: string;
  }) {
    const row = await this.persistence.entities.get<VersionedAssetRecord>(
      assetKind,
      assetStorageId(reference.kind, reference.id, reference.version),
    );
    if (row === undefined) return undefined;
    if (reference.digest !== undefined && row.value.digest !== reference.digest) {
      throw new Error(
        `Asset digest mismatch for ${reference.kind} ${reference.id}@${reference.version}`,
      );
    }
    return row.value;
  }

  public async list(kind?: VersionedAssetKind): Promise<VersionedAssetRecord[]> {
    const rows = await this.persistence.entities.list<VersionedAssetRecord>(assetKind);
    return rows
      .map(({ value }) => value)
      .filter((value) => kind === undefined || value.kind === kind)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
  }

  public async pin(
    root: VersionedAssetReference,
    references: VersionedAssetReference[],
  ): Promise<ResolvedAssetSnapshot> {
    const unique = deduplicate([root, ...references]);
    for (const reference of unique) {
      const asset = await this.get(reference);
      if (asset === undefined) {
        throw new Error(
          `Cannot pin missing ${reference.kind} ${reference.id}@${reference.version}`,
        );
      }
    }
    const assets = unique
      .filter((reference) => !sameReference(reference, root))
      .sort(compareReferences);
    const digest = contentDigest({ root, assets });
    const snapshot: ResolvedAssetSnapshot = {
      id: randomUUID(),
      root: structuredClone(root),
      assets: structuredClone(assets),
      digest,
      resolvedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put(snapshotKind, snapshot.id, snapshot);
    return snapshot;
  }

  public async snapshot(id: string): Promise<ResolvedAssetSnapshot | undefined> {
    return (await this.persistence.entities.get<ResolvedAssetSnapshot>(snapshotKind, id))?.value;
  }
}

export function contentDigest(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function assertIdentity(id: string, version: number): void {
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error(`Invalid asset ID: ${id}`);
  if (!Number.isInteger(version) || version < 1) throw new Error("Asset version must be positive");
}

function assetStorageId(kind: VersionedAssetKind, id: string, version: number): string {
  return `${kind}:${id}:${version}`;
}

function deduplicate(references: VersionedAssetReference[]): VersionedAssetReference[] {
  const result = new Map<string, VersionedAssetReference>();
  for (const reference of references) {
    const key = assetStorageId(reference.kind, reference.id, reference.version);
    const previous = result.get(key);
    if (previous !== undefined && previous.digest !== reference.digest) {
      throw new Error(`Conflicting asset digests for ${key}`);
    }
    result.set(key, structuredClone(reference));
  }
  return [...result.values()];
}

function compareReferences(left: VersionedAssetReference, right: VersionedAssetReference): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id) ||
    left.version - right.version
  );
}

function sameReference(left: VersionedAssetReference, right: VersionedAssetReference): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  );
}
