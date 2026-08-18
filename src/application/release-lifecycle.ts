import type { ReleaseLifecycleState } from "../domain/execution.js";
import type { JsonObject } from "../domain/json.js";
import type { PersistenceProvider } from "../ports/persistence.js";

export interface ReleaseObservation extends JsonObject {
  runId: string;
  state: ReleaseLifecycleState;
  source: "workflow" | "scm" | "ci" | "deployment" | "work_item";
  evidence: JsonObject;
  observedAt: string;
}

export interface ReleaseLifecycle extends JsonObject {
  runId: string;
  state: ReleaseLifecycleState;
  observations: ReleaseObservation[];
  updatedAt: string;
}

export class ReleaseLifecycleService {
  public constructor(private readonly persistence: PersistenceProvider) {}

  public async observe(observation: ReleaseObservation): Promise<ReleaseLifecycle> {
    const stored = await this.persistence.entities.get<ReleaseLifecycle>(
      "release_lifecycle",
      observation.runId,
    );
    if (stored !== undefined && rank(observation.state) < rank(stored.value.state)) {
      throw new Error(
        `Release lifecycle cannot regress from ${stored.value.state} to ${observation.state}`,
      );
    }
    const value: ReleaseLifecycle = {
      runId: observation.runId,
      state:
        stored === undefined || rank(observation.state) >= rank(stored.value.state)
          ? observation.state
          : stored.value.state,
      observations: [...(stored?.value.observations ?? []), structuredClone(observation)],
      updatedAt: observation.observedAt,
    };
    await this.persistence.entities.put(
      "release_lifecycle",
      observation.runId,
      value,
      ...(stored === undefined ? [] : [stored.version]),
    );
    return value;
  }
}

function rank(state: ReleaseLifecycleState): number {
  return [
    "planned",
    "implemented",
    "pull_request_opened",
    "merged",
    "released",
    "deployed",
    "verified",
  ].indexOf(state);
}
