import { randomUUID } from "node:crypto";
import type { JsonObject } from "../domain/json.js";
import type { WorkItem } from "../domain/work.js";
import type { WorkflowDefinition } from "../domain/workflows.js";
import type { PersistenceProvider } from "../ports/persistence.js";

export interface WorkflowMatch {
  workflowId: string;
  version: number;
  description?: string;
  matched: boolean;
  reasons: string[];
  expectedOutputs: string[];
  complexity: "low" | "standard" | "high";
}

export type WorkflowRoutingResult =
  | { status: "NO_MATCH"; candidates: WorkflowMatch[] }
  | { status: "MATCHED"; selected: WorkflowMatch; candidates: WorkflowMatch[] }
  | { status: "WORKFLOW_SELECTION_REQUIRED"; candidates: WorkflowMatch[] };

export class WorkflowRouter {
  public route(
    workItem: WorkItem,
    workflows: readonly WorkflowDefinition[],
  ): WorkflowRoutingResult {
    const candidates = workflows.map((workflow) => matchWorkflow(workItem, workflow));
    const matched = candidates.filter((candidate) => candidate.matched);
    if (matched.length === 0) return { status: "NO_MATCH", candidates };
    if (matched.length === 1) return { status: "MATCHED", selected: matched[0]!, candidates };
    return { status: "WORKFLOW_SELECTION_REQUIRED", candidates: matched };
  }
}

interface RoutingChoice extends JsonObject {
  id: string;
  workItemId: string;
  signature: string;
  workflowId: string;
  workflowVersion: number;
  actorId: string;
  selectedAt: string;
}

export interface RoutingRuleSuggestion extends JsonObject {
  id: string;
  signature: string;
  workflowId: string;
  workflowVersion: number;
  evidenceCount: number;
  status: "proposed" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}

export class RoutingLearningService {
  public constructor(
    private readonly persistence: PersistenceProvider,
    private readonly suggestionThreshold = 3,
  ) {}

  public async recordChoice(input: {
    workItem: WorkItem;
    workflowId: string;
    workflowVersion: number;
    actorId: string;
  }): Promise<{ selected: boolean; suggestion?: RoutingRuleSuggestion }> {
    const existing = (await this.persistence.entities.list<RoutingChoice>("routing_choice")).find(
      ({ value }) => value.workItemId === input.workItem.id,
    );
    if (existing !== undefined) return { selected: false };
    const signature = workSignature(input.workItem);
    const choice: RoutingChoice = {
      id: randomUUID(),
      workItemId: input.workItem.id,
      signature,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      actorId: input.actorId,
      selectedAt: new Date().toISOString(),
    };
    await this.persistence.entities.put("routing_choice", choice.id, choice);
    const all = (await this.persistence.entities.list<RoutingChoice>("routing_choice"))
      .map(({ value }) => value)
      .filter(
        (value) =>
          value.signature === signature &&
          value.workflowId === input.workflowId &&
          value.workflowVersion === input.workflowVersion,
      );
    if (all.length < this.suggestionThreshold) return { selected: true };
    const suggestionId = `${signature}:${input.workflowId}:${input.workflowVersion}`;
    const previous = await this.persistence.entities.get<RoutingRuleSuggestion>(
      "routing_rule_suggestion",
      suggestionId,
    );
    if (previous !== undefined) return { selected: true, suggestion: previous.value };
    const suggestion: RoutingRuleSuggestion = {
      id: suggestionId,
      signature,
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      evidenceCount: all.length,
      status: "proposed",
      createdAt: new Date().toISOString(),
    };
    await this.persistence.entities.put("routing_rule_suggestion", suggestion.id, suggestion);
    return { selected: true, suggestion };
  }

  public async decide(id: string, decision: "approved" | "rejected") {
    const stored = await this.persistence.entities.get<RoutingRuleSuggestion>(
      "routing_rule_suggestion",
      id,
    );
    if (stored === undefined || stored.value.status !== "proposed") return false;
    await this.persistence.entities.put(
      "routing_rule_suggestion",
      id,
      { ...stored.value, status: decision, decidedAt: new Date().toISOString() },
      stored.version,
    );
    return true;
  }
}

function matchWorkflow(workItem: WorkItem, workflow: WorkflowDefinition): WorkflowMatch {
  const reasons: string[] = [];
  if (workflow.lifecycle !== "ENABLED") reasons.push(`lifecycle is ${workflow.lifecycle}`);
  if (!workflow.trigger.states.includes(workItem.state))
    reasons.push(`state ${workItem.state} is not a trigger`);
  const missing = workflow.eligibility.includeLabels.filter(
    (label) => !workItem.labels.includes(label),
  );
  if (missing.length > 0) reasons.push(`missing labels: ${missing.join(", ")}`);
  const excluded = workflow.eligibility.excludeLabels.filter((label) =>
    workItem.labels.includes(label),
  );
  if (excluded.length > 0) reasons.push(`excluded labels: ${excluded.join(", ")}`);
  if (reasons.length === 0) reasons.push("state and label eligibility matched");
  const agentSteps = workflow.steps.filter(({ type }) => type === "agent").length;
  return {
    workflowId: workflow.id,
    version: workflow.version,
    ...(workflow.description === undefined ? {} : { description: workflow.description }),
    matched: reasons.length === 1 && reasons[0] === "state and label eligibility matched",
    reasons,
    expectedOutputs: workflow.steps.map(({ id }) => id),
    complexity: agentSteps >= 4 ? "high" : agentSteps >= 2 ? "standard" : "low",
  };
}

function workSignature(workItem: WorkItem): string {
  const project =
    typeof workItem.metadata["project"] === "string" ? workItem.metadata["project"] : "*";
  return JSON.stringify({
    project,
    type: workItem.type ?? "*",
    labels: [...workItem.labels].sort(),
  });
}
