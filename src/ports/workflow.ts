import type { JsonObject, JsonValue } from "../domain/json.js";
import type { WorkflowDefinition, WorkflowStep } from "../domain/workflows.js";
import type { WorkItem } from "../domain/work.js";

export interface WorkflowStepContext {
  runId: string;
  stepId: string;
  workflow: WorkflowDefinition;
  workItem?: WorkItem;
  workspacePath?: string;
  variables: JsonObject;
  outputs: JsonObject;
  expressionContext: JsonObject;
  signal: AbortSignal;
}

export interface WorkflowStepResult {
  output?: JsonValue;
}

export interface WorkflowStepHandler {
  readonly type: WorkflowStep["type"];
  execute(step: WorkflowStep, context: WorkflowStepContext): Promise<WorkflowStepResult>;
}
