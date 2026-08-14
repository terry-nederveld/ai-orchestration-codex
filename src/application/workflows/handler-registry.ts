import { ConfigurationError } from "../../domain/errors.js";
import type { WorkflowStep } from "../../domain/workflows.js";
import type { WorkflowStepHandler } from "../../ports/workflow.js";

export class WorkflowStepHandlerRegistry {
  readonly #handlers = new Map<WorkflowStep["type"], WorkflowStepHandler>();

  public register(handler: WorkflowStepHandler): void {
    if (this.#handlers.has(handler.type)) {
      throw new ConfigurationError(`Workflow handler already registered: ${handler.type}`);
    }
    this.#handlers.set(handler.type, handler);
  }

  public require(type: WorkflowStep["type"]): WorkflowStepHandler {
    const handler = this.#handlers.get(type);
    if (handler === undefined)
      throw new ConfigurationError(`No workflow handler registered: ${type}`);
    return handler;
  }
}
