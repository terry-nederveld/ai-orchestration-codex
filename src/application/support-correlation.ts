import type { ReleaseLifecycleState } from "../domain/execution.js";

export interface SupportEvidence {
  signature: string;
  count: number;
  regressionIndicated?: boolean;
}

export interface PriorSupportWork {
  workItemId: string;
  signature: string;
  resolved: boolean;
  releaseState?: ReleaseLifecycleState;
}

export type CorrelationDecision =
  | { action: "create" }
  | { action: "append_evidence"; workItemId: string }
  | { action: "update_unreleased"; workItemId: string }
  | { action: "create_regression"; relatedTo: string }
  | { action: "ignore"; reason: string };

export class SupportCorrelationService {
  public correlate(evidence: SupportEvidence, prior: PriorSupportWork[]): CorrelationDecision {
    if (evidence.count < 1) return { action: "ignore", reason: "No qualifying evidence" };
    const matched = prior
      .filter(({ signature }) => signature === evidence.signature)
      .sort((left, right) => left.workItemId.localeCompare(right.workItemId))[0];
    if (matched === undefined) return { action: "create" };
    if (!matched.resolved) return { action: "append_evidence", workItemId: matched.workItemId };
    if (
      matched.releaseState === undefined ||
      ["planned", "implemented", "pull_request_opened", "merged"].includes(matched.releaseState)
    ) {
      return { action: "update_unreleased", workItemId: matched.workItemId };
    }
    if (
      evidence.regressionIndicated ||
      ["released", "deployed", "verified"].includes(matched.releaseState)
    ) {
      return { action: "create_regression", relatedTo: matched.workItemId };
    }
    return { action: "create" };
  }
}
