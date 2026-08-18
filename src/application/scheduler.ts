import { createHash } from "node:crypto";
import type { JsonObject } from "../domain/json.js";
import type { AgentRun } from "../domain/runs.js";
import type { WorkItem, WorkQuery } from "../domain/work.js";
import type { EventBus } from "../ports/event-bus.js";
import type { PersistenceProvider, StoredEntity } from "../ports/persistence.js";
import type { WorkProvider } from "../ports/providers.js";
import { EventFactory } from "./events.js";
import type { OrchestrationResult } from "./orchestrator.js";
import type { ProviderRegistry } from "./provider-registry.js";
import { LaneSelector, type LaneConsumptionPolicy } from "./lanes.js";

export interface SchedulerSource {
  id: string;
  workProviderId: string;
  workflowId: string;
  query: WorkQuery;
  policy?: LaneConsumptionPolicy;
  wipLimit?: number;
}

export interface SchedulerOptions {
  pollIntervalMs: number;
  maxConcurrentRuns: number;
  maxAttempts: number;
  retryBackoffMs: number;
  maxRetryBackoffMs: number;
  owner: string;
}

export interface ScheduledRun {
  runId: string;
  promise: Promise<OrchestrationResult>;
}

export interface SchedulerStatus {
  running: boolean;
  activeRuns: number;
  maxConcurrentRuns: number;
  lastPollAt?: string;
  nextPollAt?: string;
  lastError?: string;
}

interface DispatchRecord extends JsonObject {
  id: string;
  sourceId: string;
  workItemId: string;
  externalId: string;
  runId: string;
  status: "running" | "waiting" | "retry_wait" | "completed" | "exhausted";
  attempts: number;
  updatedAt: string;
  nextAttemptAt?: string;
  error?: string;
}

type RunStarter = (input: {
  workProviderId: string;
  externalId: string;
  workflowId: string;
  owner: string;
}) => ScheduledRun;

export class WorkScheduler {
  readonly #events = new EventFactory({ source: "scheduler" });
  readonly #active = new Map<string, Promise<void>>();
  #running = false;
  #timer: NodeJS.Timeout | undefined;
  #poll: Promise<void> | undefined;
  #lastPollAt: string | undefined;
  #nextPollAt: string | undefined;
  #lastError: string | undefined;

  public constructor(
    private readonly sources: readonly SchedulerSource[],
    private readonly options: SchedulerOptions,
    private readonly providers: ProviderRegistry<WorkProvider>,
    private readonly persistence: PersistenceProvider,
    private readonly eventBus: EventBus,
    private readonly startRun: RunStarter,
  ) {}

  public status(): SchedulerStatus {
    return {
      running: this.#running,
      activeRuns: this.#active.size,
      maxConcurrentRuns: this.options.maxConcurrentRuns,
      ...(this.#lastPollAt === undefined ? {} : { lastPollAt: this.#lastPollAt }),
      ...(this.#nextPollAt === undefined ? {} : { nextPollAt: this.#nextPollAt }),
      ...(this.#lastError === undefined ? {} : { lastError: this.#lastError }),
    };
  }

  public async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    await this.reconcileInterruptedDispatches();
    await this.eventBus.publish(this.#events.create("scheduler.started", {}));
    await this.runOnce();
  }

  public async stop(): Promise<void> {
    if (!this.#running && this.#poll === undefined && this.#active.size === 0) return;
    this.#running = false;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#nextPollAt = undefined;
    await this.#poll;
    await Promise.allSettled(this.#active.values());
    await this.eventBus.publish(this.#events.create("scheduler.stopped", {}));
  }

  public async runOnce(): Promise<void> {
    if (this.#poll !== undefined) return this.#poll;
    this.#poll = this.#pollSources().finally(() => {
      this.#poll = undefined;
      if (this.#running) this.#scheduleNextPoll();
    });
    return this.#poll;
  }

  public async waitForIdle(): Promise<void> {
    await this.#poll;
    await Promise.allSettled(this.#active.values());
  }

  async #pollSources(): Promise<void> {
    this.#lastPollAt = new Date().toISOString();
    this.#lastError = undefined;
    await this.eventBus.publish(
      this.#events.create("scheduler.poll.started", { sources: this.sources.length }),
    );
    try {
      for (const source of this.sources) {
        if (this.#active.size >= this.options.maxConcurrentRuns) break;
        await this.#pollSource(source);
      }
      await this.eventBus.publish(
        this.#events.create("scheduler.poll.completed", { activeRuns: this.#active.size }),
      );
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      await this.eventBus.publish(
        this.#events.create("scheduler.poll.failed", { error: this.#lastError }),
      );
    }
  }

  async #pollSource(source: SchedulerSource): Promise<void> {
    const provider = this.providers.require(source.workProviderId);
    const items: WorkItem[] = [];
    let cursor: string | undefined;
    do {
      const page = await provider.discover({
        ...source.query,
        limit: Math.min(source.query.limit ?? 50, 100),
        ...(cursor === undefined ? {} : { cursor }),
      });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    const dispatches = (await this.persistence.entities.list<DispatchRecord>("scheduler_dispatch"))
      .map(({ value }) => value)
      .filter(({ sourceId }) => sourceId === source.id);
    const active = await Promise.all(
      dispatches
        .filter(({ status }) => status === "running" || status === "waiting")
        .map(async (dispatch) => {
          const run = await this.persistence.entities.get<JsonObject>("run", dispatch.runId);
          return {
            workItemId: dispatch.workItemId,
            status: (run?.value["status"] as AgentRun["status"] | undefined) ?? "WAITING",
          };
        }),
    );
    const selected = new LaneSelector().select({
      lane: {
        id: source.id,
        workflowId: source.workflowId,
        policy: source.policy ?? "ranked_parallel",
        wipLimit: source.wipLimit ?? this.options.maxConcurrentRuns,
        requiredCapabilities: [],
        profileIds: ["runtime"],
      },
      items,
      active,
      profileCapabilities: { runtime: [] },
    });
    for (const item of selected) {
      if (this.#active.size >= this.options.maxConcurrentRuns) return;
      await this.#consider(source, item);
    }
  }

  async #consider(source: SchedulerSource, item: WorkItem): Promise<void> {
    const id = dispatchId(source.id, item.id);
    if (this.#active.has(id)) return;
    const stored = await this.persistence.entities.get<DispatchRecord>("scheduler_dispatch", id);
    if (!eligibleForDispatch(stored)) return;
    const attempts = (stored?.value.attempts ?? 0) + 1;
    const started = this.startRun({
      workProviderId: source.workProviderId,
      externalId: item.externalId,
      workflowId: source.workflowId,
      owner: this.options.owner,
    });
    const record: DispatchRecord = {
      id,
      sourceId: source.id,
      workItemId: item.id,
      externalId: item.externalId,
      runId: started.runId,
      status: "running",
      attempts,
      updatedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put(
      "scheduler_dispatch",
      id,
      record,
      ...(stored === undefined ? [] : [stored.version]),
    );
    await this.eventBus.publish(
      this.#events.create("work.dispatched", {
        sourceId: source.id,
        workItemId: item.id,
        runId: started.runId,
        attempt: attempts,
      }),
    );
    const completion = started.promise
      .then((result) => this.#completeDispatch(record, result.run.status, result.error))
      .catch((error: unknown) =>
        this.#completeDispatch(
          record,
          "FAILED",
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => this.#active.delete(id));
    this.#active.set(id, completion);
  }

  async #completeDispatch(
    dispatch: DispatchRecord,
    runStatus: AgentRun["status"],
    error?: string,
  ): Promise<void> {
    const stored = await this.persistence.entities.get<DispatchRecord>(
      "scheduler_dispatch",
      dispatch.id,
    );
    if (stored === undefined) return;
    const succeeded = runStatus === "COMPLETED";
    const waiting = ["WAITING", "WAITING_FOR_HUMAN", "BLOCKED"].includes(runStatus);
    const exhausted = !succeeded && !waiting && dispatch.attempts >= this.options.maxAttempts;
    const nextAttemptAt =
      succeeded || waiting || exhausted
        ? undefined
        : new Date(Date.now() + this.#retryDelay(dispatch.attempts)).toISOString();
    const value: DispatchRecord = {
      ...stored.value,
      status: succeeded
        ? "completed"
        : waiting
          ? "waiting"
          : exhausted
            ? "exhausted"
            : "retry_wait",
      updatedAt: new Date().toISOString(),
      ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
      ...(error === undefined ? {} : { error }),
    };
    await this.persistence.entities.put("scheduler_dispatch", dispatch.id, value, stored.version);
    await this.eventBus.publish(
      this.#events.create(
        succeeded
          ? "work.dispatch.completed"
          : waiting
            ? "work.dispatch.waiting"
            : "work.dispatch.failed",
        {
          workItemId: dispatch.workItemId,
          runId: dispatch.runId,
          attempt: dispatch.attempts,
          exhausted,
          ...(error === undefined ? {} : { error }),
          ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
        },
      ),
    );
  }

  private async reconcileInterruptedDispatches(): Promise<void> {
    const stored = await this.persistence.entities.list<DispatchRecord>("scheduler_dispatch");
    for (const dispatch of stored) {
      if (dispatch.value.status !== "running") continue;
      const exhausted = dispatch.value.attempts >= this.options.maxAttempts;
      const value: DispatchRecord = {
        ...dispatch.value,
        status: exhausted ? "exhausted" : "retry_wait",
        updatedAt: new Date().toISOString(),
        error: "The previous orchestrator process stopped before this run completed",
        ...(exhausted
          ? {}
          : {
              nextAttemptAt: new Date(
                Date.now() + this.#retryDelay(dispatch.value.attempts),
              ).toISOString(),
            }),
      };
      await this.persistence.entities.put(
        "scheduler_dispatch",
        dispatch.id,
        value,
        dispatch.version,
      );
    }
  }

  #retryDelay(attempt: number): number {
    return Math.min(
      this.options.retryBackoffMs * 2 ** Math.max(0, attempt - 1),
      this.options.maxRetryBackoffMs,
    );
  }

  #scheduleNextPoll(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#nextPollAt = new Date(Date.now() + this.options.pollIntervalMs).toISOString();
    this.#timer = setTimeout(() => void this.runOnce(), this.options.pollIntervalMs);
    this.#timer.unref();
  }
}

function dispatchId(sourceId: string, workItemId: string): string {
  return createHash("sha256").update(`${sourceId}\0${workItemId}`).digest("hex");
}

function eligibleForDispatch(stored: StoredEntity<DispatchRecord> | undefined): boolean {
  if (stored === undefined) return true;
  if (stored.value.status === "completed" || stored.value.status === "exhausted") return false;
  if (stored.value.status === "running") return false;
  return (
    stored.value.nextAttemptAt === undefined ||
    new Date(stored.value.nextAttemptAt).getTime() <= Date.now()
  );
}

export async function reconcileInterruptedRuns(
  persistence: PersistenceProvider,
  events: EventBus,
): Promise<number> {
  const rows = await persistence.entities.list<JsonObject>("run");
  let recovered = 0;
  for (const row of rows) {
    const run = row.value as unknown as AgentRun;
    if (terminalStatuses.has(run.status) || resumableStatuses.has(run.status)) continue;
    const now = new Date().toISOString();
    const value = {
      ...run,
      status: "FAILED",
      outcome: "FATAL_FAILURE",
      completedAt: now,
      updatedAt: now,
      metadata: {
        ...run.metadata,
        recoveryReason: "The orchestrator process stopped before the run reached a terminal state",
      },
      version: row.version + 1,
    } satisfies AgentRun;
    await persistence.entities.put("run", run.id, toJson(value), row.version);
    await events.publish(
      thisEvent(run.id, "agent.recovered", {
        previousStatus: run.status,
        status: "FAILED",
      }),
    );
    recovered += 1;
  }
  return recovered;
}

const terminalStatuses = new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"]);
const resumableStatuses = new Set(["WAITING", "WAITING_FOR_HUMAN"]);

function thisEvent(runId: string, type: string, payload: JsonObject) {
  return new EventFactory({ source: "recovery", runId }).create(type, payload);
}

function toJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
