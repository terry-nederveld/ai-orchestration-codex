import type { Capability } from "../domain/capabilities.js";
import type {
  AgentProviderEvent,
  AgentRequest,
  ModelEvent,
  ModelRequest,
  ProviderAvailability,
  ProviderDescriptor,
} from "../domain/providers.js";
import type { WorkClaim, WorkItem, WorkPage, WorkQuery, WorkUpdate } from "../domain/work.js";

export interface Provider {
  readonly descriptor: ProviderDescriptor;
  availability(signal?: AbortSignal): Promise<ProviderAvailability>;
}

export interface ModelProvider extends Provider {
  readonly descriptor: ProviderDescriptor & { kind: "model" };
  invoke(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}

export interface AgentProvider extends Provider {
  readonly descriptor: ProviderDescriptor & { kind: "agent" };
  run(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentProviderEvent>;
  cancel?(sessionId: string): Promise<void>;
}

export interface WorkProvider extends Provider {
  readonly descriptor: ProviderDescriptor & { kind: "work" };
  discover(query: WorkQuery, signal?: AbortSignal): Promise<WorkPage>;
  get(externalId: string, signal?: AbortSignal): Promise<WorkItem | undefined>;
  claim(item: WorkItem, owner: string, ttlMs: number, signal?: AbortSignal): Promise<WorkClaim>;
  update(externalId: string, update: WorkUpdate, signal?: AbortSignal): Promise<WorkItem>;
  release(claim: WorkClaim, signal?: AbortSignal): Promise<void>;
}

export interface ProviderSelection {
  providerId?: string;
  model?: string;
  requiredCapabilities?: Capability[];
  costClass?: "free" | "low" | "standard" | "premium";
  reasoningClass?: "fast" | "balanced" | "strong";
  latencyClass?: "interactive" | "background";
  localOnly?: boolean;
}
