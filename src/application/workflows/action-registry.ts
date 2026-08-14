import { ConfigurationError } from "../../domain/errors.js";
import type { WorkflowAction } from "../../ports/extensions.js";

export class WorkflowActionRegistry {
  readonly #actions = new Map<string, WorkflowAction>();

  public register(action: WorkflowAction): void {
    if (this.#actions.has(action.id)) {
      throw new ConfigurationError(`Workflow action already registered: ${action.id}`);
    }
    this.#actions.set(action.id, action);
  }

  public require(id: string): WorkflowAction {
    const action = this.#actions.get(id);
    if (action === undefined) throw new ConfigurationError(`Unknown workflow action: ${id}`);
    return action;
  }
}
