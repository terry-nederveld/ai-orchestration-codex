import { randomUUID } from "node:crypto";
import type {
  HumanInputRequest,
  HumanInputResponse,
  WaitCondition,
  WaitConditionType,
  WaitSignal,
} from "../domain/execution.js";
import type { JsonObject, JsonValue } from "../domain/json.js";
import type { EventBus } from "../ports/event-bus.js";
import type { PersistenceProvider } from "../ports/persistence.js";
import { EventFactory } from "./events.js";

export type SignalAuthorizer = (
  condition: WaitCondition,
  signal: WaitSignalCandidate,
) => Promise<boolean> | boolean;

interface WaitSignalCandidate {
  id: string;
  conditionId: string;
  source: WaitSignal["source"];
  actorId: string;
  occurredAt: string;
  payload: JsonObject;
}

export class WaitConditionManager {
  public constructor(
    private readonly persistence: PersistenceProvider,
    private readonly events?: EventBus,
    private readonly authorize: SignalAuthorizer = () => true,
  ) {}

  public async create(input: {
    runId: string;
    nodeId: string;
    checkpointKey: string;
    type: WaitConditionType;
    predicate?: JsonObject;
    expiresAt?: string;
  }): Promise<WaitCondition> {
    const existing = (await this.list({ runId: input.runId })).find(
      (condition) => condition.checkpointKey === input.checkpointKey,
    );
    if (existing !== undefined) return existing;
    const now = new Date().toISOString();
    const value: WaitCondition = {
      id: randomUUID(),
      runId: input.runId,
      nodeId: input.nodeId,
      checkpointKey: input.checkpointKey,
      type: input.type,
      status: "waiting",
      predicate: structuredClone(input.predicate ?? {}),
      signals: [],
      createdAt: now,
      updatedAt: now,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };
    await this.persistence.entities.put("wait_condition", value.id, value);
    await this.events?.publish(
      new EventFactory({ source: "wait-manager", runId: value.runId }).create("wait.requested", {
        conditionId: value.id,
        nodeId: value.nodeId,
        type: value.type,
      }),
    );
    if (value.type === "human_input" || value.type === "approval") {
      await this.events?.publish(
        new EventFactory({ source: "wait-manager", runId: value.runId }).create(
          "human_input.requested",
          { conditionId: value.id, nodeId: value.nodeId, type: value.type },
        ),
      );
    }
    return value;
  }

  public async signal(
    conditionId: string,
    input: {
      id?: string;
      source: WaitSignal["source"];
      actorId: string;
      occurredAt?: string;
      payload: JsonObject;
    },
  ): Promise<{ accepted: boolean; selected: boolean; condition?: WaitCondition }> {
    const stored = await this.persistence.entities.get<WaitCondition>(
      "wait_condition",
      conditionId,
    );
    if (stored === undefined) return { accepted: false, selected: false };
    const duplicate = stored.value.signals.find((signal) => signal.id === input.id);
    if (duplicate !== undefined) {
      return {
        accepted: true,
        selected: stored.value.selectedSignalId === duplicate.id,
        condition: stored.value,
      };
    }
    const candidate: WaitSignalCandidate = {
      id: input.id ?? randomUUID(),
      conditionId,
      source: input.source,
      actorId: input.actorId,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      payload: structuredClone(input.payload),
    };
    if (!(await this.authorize(stored.value, candidate))) {
      await this.events?.publish(
        new EventFactory({ source: "wait-manager", runId: stored.value.runId }).create(
          "wait.signal.rejected",
          { conditionId, actorId: input.actorId },
        ),
      );
      return { accepted: false, selected: false, condition: stored.value };
    }
    const selected = stored.value.status === "waiting";
    const signal: WaitSignal = { ...candidate, supplemental: !selected };
    const value: WaitCondition = {
      ...stored.value,
      status: selected ? "satisfied" : stored.value.status,
      signals: [...stored.value.signals, signal],
      updatedAt: new Date().toISOString(),
      ...(selected ? { selectedSignalId: signal.id } : {}),
    };
    await this.persistence.entities.put("wait_condition", conditionId, value, stored.version);
    await this.events?.publish(
      new EventFactory({ source: "wait-manager", runId: value.runId }).create(
        selected ? "wait.satisfied" : "wait.signal.supplemental",
        { conditionId, signalId: signal.id, actorId: signal.actorId },
      ),
    );
    if (candidate.payload["humanInput"] !== undefined) {
      await this.events?.publish(
        new EventFactory({ source: "wait-manager", runId: value.runId }).create(
          "human_input.received",
          {
            conditionId,
            signalId: signal.id,
            actorId: signal.actorId,
            responseSource: signal.source,
            selected,
            supplemental: signal.supplemental,
          },
        ),
      );
    }
    return { accepted: true, selected, condition: value };
  }

  public async get(id: string): Promise<WaitCondition | undefined> {
    return (await this.persistence.entities.get<WaitCondition>("wait_condition", id))?.value;
  }

  public async list(filter: { runId?: string; status?: WaitCondition["status"] } = {}) {
    const rows = await this.persistence.entities.list<WaitCondition>("wait_condition");
    return rows
      .map(({ value }) => value)
      .filter((value) => filter.runId === undefined || value.runId === filter.runId)
      .filter((value) => filter.status === undefined || value.status === filter.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public async expireDue(now = new Date()): Promise<number> {
    let expired = 0;
    for (const condition of await this.list({ status: "waiting" })) {
      if (condition.expiresAt === undefined || new Date(condition.expiresAt) > now) continue;
      const stored = await this.persistence.entities.get<WaitCondition>(
        "wait_condition",
        condition.id,
      );
      if (stored === undefined || stored.value.status !== "waiting") continue;
      await this.persistence.entities.put(
        "wait_condition",
        condition.id,
        { ...stored.value, status: "expired", updatedAt: now.toISOString() },
        stored.version,
      );
      expired += 1;
    }
    return expired;
  }
}

export class HumanInputManager {
  public constructor(private readonly waits: WaitConditionManager) {}

  public request(input: {
    runId: string;
    nodeId: string;
    checkpointKey: string;
    request: HumanInputRequest;
    expiresAt?: string;
  }): Promise<WaitCondition> {
    validateRequest(input.request);
    return this.waits.create({
      runId: input.runId,
      nodeId: input.nodeId,
      checkpointKey: input.checkpointKey,
      type: input.request.type === "approval" ? "approval" : "human_input",
      predicate: { request: input.request },
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
  }

  public async respond(
    conditionId: string,
    input: {
      id?: string;
      source: "app" | "work_item";
      actorId: string;
      value: JsonValue;
      promote?: boolean;
    },
  ) {
    const condition = await this.waits.get(conditionId);
    if (condition === undefined) return { accepted: false, selected: false };
    const request = requestFrom(condition);
    if (
      (request.channel === "app" && input.source !== "app") ||
      (request.channel === "work_item" && input.source !== "work_item")
    ) {
      return { accepted: false, selected: false, condition };
    }
    validateResponse(request, input.value);
    const response: HumanInputResponse = {
      requestType: request.type,
      value: input.value,
      promoted: input.promote ?? false,
    };
    return this.waits.signal(conditionId, {
      ...(input.id === undefined ? {} : { id: input.id }),
      source: input.source,
      actorId: input.actorId,
      payload: { humanInput: response },
    });
  }
}

function requestFrom(condition: WaitCondition): HumanInputRequest {
  const request = condition.predicate["request"];
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new Error(`Wait condition ${condition.id} has no human input request`);
  }
  return request as HumanInputRequest;
}

function validateRequest(request: HumanInputRequest): void {
  if (request.title.trim().length === 0 || request.description.trim().length === 0) {
    throw new Error("Human input title and description are required");
  }
  if (
    (request.type === "single_choice" || request.type === "multiple_choice") &&
    (request.choices === undefined || request.choices.length < 2)
  ) {
    throw new Error("Choice requests require at least two choices");
  }
  if (request.type === "secret" && request.secretDestination === undefined) {
    throw new Error("Secret requests require a secretDestination reference");
  }
}

function validateResponse(request: HumanInputRequest, value: JsonValue): void {
  if (request.type === "text" && typeof value !== "string") invalid(request.type);
  if (request.type === "boolean" && typeof value !== "boolean") invalid(request.type);
  if (request.type === "approval" && typeof value !== "boolean") invalid(request.type);
  if (request.type === "single_choice") {
    if (typeof value !== "string" || !request.choices?.includes(value)) invalid(request.type);
  }
  if (request.type === "multiple_choice") {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || !request.choices?.includes(item))
    )
      invalid(request.type);
  }
  if (request.type === "secret") {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value["secretReference"] !== "string"
    )
      invalid(request.type);
  }
  if (request.type === "file_reference" && typeof value !== "string") invalid(request.type);
}

function invalid(type: HumanInputRequest["type"]): never {
  throw new TypeError(`Invalid response for ${type} request`);
}
