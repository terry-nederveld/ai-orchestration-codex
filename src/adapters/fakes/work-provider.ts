import { randomUUID } from "node:crypto";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type { WorkClaim, WorkItem, WorkPage, WorkQuery, WorkUpdate } from "../../domain/work.js";
import type { WorkProvider } from "../../ports/providers.js";

export class InMemoryWorkProvider implements WorkProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "work" } = {
    id: "fake-work",
    displayName: "In-memory work",
    kind: "work",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  readonly #items = new Map<string, WorkItem>();
  readonly #claims = new Map<string, WorkClaim>();

  public constructor(items: WorkItem[]) {
    for (const item of items) this.#items.set(item.externalId, structuredClone(item));
  }

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
  }> {
    return { installed: true, authenticated: true, available: true };
  }

  public async discover(query: WorkQuery): Promise<WorkPage> {
    const items = [...this.#items.values()]
      .filter((item) => query.states === undefined || query.states.includes(item.state))
      .filter(
        (item) =>
          query.labels === undefined || query.labels.every((label) => item.labels.includes(label)),
      )
      .slice(0, query.limit ?? 100)
      .map((item) => structuredClone(item));
    return { items };
  }

  public async get(externalId: string): Promise<WorkItem | undefined> {
    const item = this.#items.get(externalId);
    return item === undefined ? undefined : structuredClone(item);
  }

  public async claim(item: WorkItem, owner: string, ttlMs: number): Promise<WorkClaim> {
    const current = this.#claims.get(item.externalId);
    if (current !== undefined && Date.parse(current.expiresAt) > Date.now()) {
      throw new Error(`Work item is already claimed: ${item.externalId}`);
    }
    const claim = {
      workItemId: item.id,
      token: randomUUID(),
      owner,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    this.#claims.set(item.externalId, claim);
    return structuredClone(claim);
  }

  public async update(externalId: string, update: WorkUpdate): Promise<WorkItem> {
    const item = this.#items.get(externalId);
    if (item === undefined) throw new Error(`Unknown work item: ${externalId}`);
    if (update.state !== undefined) item.state = update.state;
    if (update.addLabels !== undefined)
      item.labels = [...new Set([...item.labels, ...update.addLabels])];
    if (update.removeLabels !== undefined) {
      item.labels = item.labels.filter((label) => !update.removeLabels!.includes(label));
    }
    if (update.assignee !== undefined) {
      item.assignees = [{ id: update.assignee, displayName: update.assignee }];
    }
    item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  }

  public async release(claim: WorkClaim): Promise<void> {
    const entry = [...this.#claims.entries()].find(([, value]) => value.token === claim.token);
    if (entry !== undefined) this.#claims.delete(entry[0]);
  }
}
