import type { Capability } from "../domain/capabilities.js";
import type { AgentProfileDefinition, AgentProfileFallback } from "../domain/policies.js";

export class AgentProfileComposer {
  readonly #profiles = new Map<string, AgentProfileDefinition>();

  public constructor(profiles: readonly AgentProfileDefinition[]) {
    for (const profile of profiles) this.#profiles.set(key(profile.id, profile.version), profile);
  }

  public compose(
    id: string,
    version: number,
    overrides: Partial<AgentProfileDefinition> = {},
  ): AgentProfileDefinition {
    const visiting = new Set<string>();
    const resolved = this.#compose(id, version, visiting);
    return mergeProfiles(resolved, overrides);
  }

  #compose(id: string, version: number, visiting: Set<string>): AgentProfileDefinition {
    const identity = key(id, version);
    if (visiting.has(identity)) throw new Error(`Agent profile fragment cycle: ${identity}`);
    const profile = this.#profiles.get(identity);
    if (profile === undefined) throw new Error(`Unknown agent profile: ${identity}`);
    visiting.add(identity);
    let result = emptyProfile(profile.id, profile.version, profile.name);
    for (const fragment of profile.fragments) {
      result = mergeProfiles(result, this.#compose(fragment.id, fragment.version, visiting));
    }
    visiting.delete(identity);
    return mergeProfiles(result, profile);
  }
}

export type FallbackReason =
  "outage" | "rate_limit" | "transient" | "capability_mismatch" | "budget";

export interface ExecutionCandidate {
  provider: string;
  model?: string;
  available: boolean;
  capabilities: Capability[];
  reasoningClass: "fast" | "balanced" | "strong";
  estimatedCostUsd?: number;
}

export interface FallbackDecision {
  selected?: ExecutionCandidate;
  attempted: Array<{ provider: string; model?: string; reason: string }>;
}

export class DeterministicFallbackRouter {
  public select(input: {
    profile: AgentProfileDefinition;
    candidates: ExecutionCandidate[];
    failureReason?: FallbackReason;
    remainingCostUsd?: number;
  }): FallbackDecision {
    const attempted: FallbackDecision["attempted"] = [];
    const routes: AgentProfileFallback[] = [
      ...(input.profile.provider === undefined
        ? []
        : [
            {
              provider: input.profile.provider,
              ...(input.profile.model === undefined ? {} : { model: input.profile.model }),
              on: [
                "outage",
                "rate_limit",
                "transient",
                "capability_mismatch",
                "budget",
              ] as FallbackReason[],
              requiredCapabilities: input.profile.capabilities,
            },
          ]),
      ...input.profile.fallback,
    ];
    for (const route of routes) {
      if (
        route !== routes[0] &&
        input.failureReason !== undefined &&
        !route.on.includes(input.failureReason)
      ) {
        attempted.push(describe(route, `not enabled for ${input.failureReason}`));
        continue;
      }
      const candidate = input.candidates.find(
        (value) => value.provider === route.provider && value.model === route.model,
      );
      if (candidate === undefined || !candidate.available) {
        attempted.push(describe(route, "unavailable"));
        continue;
      }
      const required = new Set([...input.profile.capabilities, ...route.requiredCapabilities]);
      if ([...required].some((capability) => !candidate.capabilities.includes(capability))) {
        attempted.push(describe(route, "capability mismatch"));
        continue;
      }
      if (
        route.reasoningClass !== undefined &&
        reasoningRank(candidate.reasoningClass) < reasoningRank(route.reasoningClass)
      ) {
        attempted.push(describe(route, "reasoning class below minimum"));
        continue;
      }
      const costLimit = Math.min(
        route.maxEstimatedCostUsd ?? Number.POSITIVE_INFINITY,
        input.remainingCostUsd ?? Number.POSITIVE_INFINITY,
      );
      if ((candidate.estimatedCostUsd ?? 0) > costLimit) {
        attempted.push(describe(route, "budget exceeded"));
        continue;
      }
      attempted.push(describe(route, "selected"));
      return { selected: candidate, attempted };
    }
    return { attempted };
  }
}

function mergeProfiles(
  base: AgentProfileDefinition,
  overlay: Partial<AgentProfileDefinition>,
): AgentProfileDefinition {
  return {
    ...base,
    ...overlay,
    fragments: uniqueObjects([...(base.fragments ?? []), ...(overlay.fragments ?? [])]),
    fallback: uniqueObjects([...(base.fallback ?? []), ...(overlay.fallback ?? [])]),
    capabilities: unique([...(base.capabilities ?? []), ...(overlay.capabilities ?? [])]),
    instructionStack: unique([
      ...(base.instructionStack ?? []),
      ...(overlay.instructionStack ?? []),
    ]),
    contextResolvers: unique([
      ...(base.contextResolvers ?? []),
      ...(overlay.contextResolvers ?? []),
    ]),
    tools: unique([...(base.tools ?? []), ...(overlay.tools ?? [])]),
    permissions: unique([...(base.permissions ?? []), ...(overlay.permissions ?? [])]),
    budgets: { ...base.budgets, ...overlay.budgets },
    repositoryPermissions: {
      ...base.repositoryPermissions,
      ...overlay.repositoryPermissions,
    },
    evaluationResponsibilities: unique([
      ...(base.evaluationResponsibilities ?? []),
      ...(overlay.evaluationResponsibilities ?? []),
    ]),
  };
}

function emptyProfile(id: string, version: number, name: string): AgentProfileDefinition {
  return {
    id,
    version,
    name,
    fragments: [],
    fallback: [],
    capabilities: [],
    instructionStack: [],
    contextResolvers: [],
    tools: [],
    permissions: [],
    budgets: {},
    repositoryPermissions: {},
    evaluationResponsibilities: [],
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueObjects<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function key(id: string, version: number): string {
  return `${id}@${version}`;
}

function describe(route: AgentProfileFallback, reason: string) {
  return {
    provider: route.provider,
    ...(route.model === undefined ? {} : { model: route.model }),
    reason,
  };
}

function reasoningRank(value: ExecutionCandidate["reasoningClass"]): number {
  return { fast: 1, balanced: 2, strong: 3 }[value];
}
