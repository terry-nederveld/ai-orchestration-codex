import { randomUUID } from "node:crypto";
import type { JsonObject } from "../domain/json.js";
import type { PersistenceProvider } from "../ports/persistence.js";
import type { ApprovalProvider } from "../ports/security.js";

export type ApprovalDecision = "approved" | "denied" | "timed_out";

export interface ApprovalRecord extends JsonObject {
  id: string;
  runId: string;
  title: string;
  description: string;
  status: "pending" | ApprovalDecision;
  createdAt: string;
  expiresAt?: string;
  decidedAt?: string;
}

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
  timeout?: NodeJS.Timeout;
}

export class ApprovalManager implements ApprovalProvider {
  readonly #pending = new Map<string, PendingApproval>();

  public constructor(private readonly persistence: PersistenceProvider) {}

  public async request(input: {
    runId: string;
    title: string;
    description: string;
    timeoutMs?: number;
  }): Promise<ApprovalDecision> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const record: ApprovalRecord = {
      id,
      runId: input.runId,
      title: input.title,
      description: input.description,
      status: "pending",
      createdAt,
      ...(input.timeoutMs === undefined
        ? {}
        : { expiresAt: new Date(Date.now() + input.timeoutMs).toISOString() }),
    };
    await this.persistence.entities.put("approval", id, record);
    return new Promise<ApprovalDecision>((resolve) => {
      const pending: PendingApproval = { resolve };
      if (input.timeoutMs !== undefined) {
        pending.timeout = setTimeout(() => {
          void this.resolve(id, "timed_out");
        }, input.timeoutMs);
        pending.timeout.unref();
      }
      this.#pending.set(id, pending);
    });
  }

  public async list(): Promise<ApprovalRecord[]> {
    const records = await this.persistence.entities.list<ApprovalRecord>("approval");
    return records.map((record) => record.value);
  }

  public async resolve(id: string, decision: ApprovalDecision): Promise<boolean> {
    const stored = await this.persistence.entities.get<ApprovalRecord>("approval", id);
    if (stored === undefined || stored.value.status !== "pending") return false;
    const value: ApprovalRecord = {
      ...stored.value,
      status: decision,
      decidedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put("approval", id, value, stored.version);
    const pending = this.#pending.get(id);
    if (pending !== undefined) {
      if (pending.timeout !== undefined) clearTimeout(pending.timeout);
      this.#pending.delete(id);
      pending.resolve(decision);
    }
    return true;
  }
}
