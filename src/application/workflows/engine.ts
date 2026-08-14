import type { EventBus } from "../../ports/event-bus.js";
import type { PersistenceProvider } from "../../ports/persistence.js";
import type { WorkflowStepContext } from "../../ports/workflow.js";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { WorkItem } from "../../domain/work.js";
import type {
  WorkflowExecutionResult,
  WorkflowStep,
  WorkflowStepExecution,
} from "../../domain/workflows.js";
import { EventFactory } from "../events.js";
import type { CompiledWorkflow } from "./compiler.js";
import { evaluateCondition } from "./expressions.js";
import type { WorkflowStepHandlerRegistry } from "./handler-registry.js";

export interface WorkflowExecutionInput {
  runId: string;
  workflow: CompiledWorkflow;
  workItem?: WorkItem;
  workspacePath?: string;
  variables?: JsonObject;
  signal?: AbortSignal;
}

export class StepExecutionError extends Error {
  public constructor(
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StepExecutionError";
  }
}

export class WorkflowEngine {
  public constructor(
    private readonly handlers: WorkflowStepHandlerRegistry,
    private readonly eventBus: EventBus,
    private readonly persistence?: PersistenceProvider,
    private readonly maxParallelSteps = 4,
  ) {}

  public async execute(input: WorkflowExecutionInput): Promise<WorkflowExecutionResult> {
    const startedAt = new Date().toISOString();
    const signal = input.signal ?? new AbortController().signal;
    const eventFactory = new EventFactory({ source: "workflow-engine", runId: input.runId });
    const executions = Object.fromEntries(
      input.workflow.definition.steps.map((step) => [step.id, pendingExecution(step.id)]),
    );
    const outputs: JsonObject = {};

    await this.eventBus.publish(
      eventFactory.create("workflow.started", { workflowId: input.workflow.definition.id }),
    );

    while (hasPending(executions)) {
      if (signal.aborted) {
        cancelPending(executions);
        return this.finish(input, executions, outputs, startedAt, "CANCELLED", eventFactory);
      }

      const fatalFailure = input.workflow.definition.steps.some(
        (step) => executions[step.id]?.status === "FAILED" && step.onError === "fail",
      );
      if (fatalFailure) {
        skipPending(executions, "Dependency or workflow failure");
        return this.finish(input, executions, outputs, startedAt, "FAILED", eventFactory);
      }

      const expressionContext = makeExpressionContext(input, executions, outputs);
      const ready = input.workflow.topologicalOrder
        .map((id) => input.workflow.stepsById.get(id))
        .filter((step): step is WorkflowStep => step !== undefined)
        .filter((step) => executions[step.id]?.status === "PENDING")
        .filter((step) => dependenciesComplete(step, executions))
        .slice(0, this.maxParallelSteps);

      if (ready.length === 0) {
        skipPending(executions, "No executable dependency path remains");
        return this.finish(input, executions, outputs, startedAt, "FAILED", eventFactory);
      }

      const executable: WorkflowStep[] = [];
      for (const step of ready) {
        if (step.when !== undefined && !evaluateCondition(step.when, expressionContext)) {
          executions[step.id] = {
            ...executions[step.id]!,
            status: "SKIPPED",
            completedAt: new Date().toISOString(),
          };
          await this.eventBus.publish(
            eventFactory.create("workflow.step.skipped", { stepId: step.id, reason: "condition" }),
          );
        } else {
          executable.push(step);
        }
      }

      await Promise.all(
        executable.map(async (step) => {
          await this.executeStep(step, input, executions, outputs, eventFactory, signal);
          await this.persistSnapshot(
            input.runId,
            input.workflow.definition.id,
            executions,
            outputs,
            startedAt,
          );
        }),
      );
    }

    return this.finish(input, executions, outputs, startedAt, "SUCCEEDED", eventFactory);
  }

  private async executeStep(
    step: WorkflowStep,
    input: WorkflowExecutionInput,
    executions: Record<string, WorkflowStepExecution>,
    outputs: JsonObject,
    eventFactory: EventFactory,
    signal: AbortSignal,
  ): Promise<void> {
    const execution = executions[step.id]!;
    execution.status = "RUNNING";
    execution.startedAt ??= new Date().toISOString();
    await this.eventBus.publish(eventFactory.create("workflow.step.started", { stepId: step.id }));

    try {
      let repeat = true;
      while (repeat) {
        execution.iterations += 1;
        const output = await this.executeWithRetry(
          step,
          input,
          executions,
          outputs,
          execution,
          signal,
        );
        if (output !== undefined) {
          execution.output = output;
          outputs[step.id] = output;
        }
        const context = makeExpressionContext(input, executions, outputs);
        repeat =
          step.repeat !== undefined &&
          execution.iterations < step.repeat.maxIterations &&
          evaluateCondition(step.repeat.while, context);
      }
      execution.status = "SUCCEEDED";
      execution.completedAt = new Date().toISOString();
      await this.eventBus.publish(
        eventFactory.create("workflow.step.completed", {
          stepId: step.id,
          attempts: execution.attempts,
          iterations: execution.iterations,
        }),
      );
    } catch (error) {
      execution.status = signal.aborted ? "CANCELLED" : "FAILED";
      execution.error = error instanceof Error ? error.message : String(error);
      execution.completedAt = new Date().toISOString();
      await this.eventBus.publish(
        eventFactory.create("workflow.step.failed", {
          stepId: step.id,
          error: execution.error,
          attempts: execution.attempts,
        }),
      );
    }
  }

  private async executeWithRetry(
    step: WorkflowStep,
    input: WorkflowExecutionInput,
    executions: Record<string, WorkflowStepExecution>,
    outputs: JsonObject,
    execution: WorkflowStepExecution,
    signal: AbortSignal,
  ): Promise<JsonValue | undefined> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= step.retry.maxAttempts; attempt += 1) {
      execution.attempts += 1;
      signal.throwIfAborted();
      try {
        const timeout = new AbortController();
        const timeoutHandle =
          step.timeoutMs === undefined
            ? undefined
            : setTimeout(
                () =>
                  timeout.abort(
                    new StepExecutionError(`Step timed out after ${step.timeoutMs}ms`, true),
                  ),
                step.timeoutMs,
              );
        try {
          const stepSignal = AbortSignal.any([signal, timeout.signal]);
          const expressionContext = makeExpressionContext(input, executions, outputs);
          const context: WorkflowStepContext = {
            runId: input.runId,
            workflow: input.workflow.definition,
            ...(input.workItem === undefined ? {} : { workItem: input.workItem }),
            ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
            variables: { ...input.workflow.definition.variables, ...input.variables },
            outputs,
            expressionContext,
            signal: stepSignal,
          };
          const result = await this.handlers.require(step.type).execute(step, context);
          return result.output;
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }
      } catch (error) {
        lastError = error;
        const retryable = error instanceof StepExecutionError && error.retryable;
        if (!retryable || attempt === step.retry.maxAttempts) break;
        const delay = Math.min(
          step.retry.backoffMs * 2 ** (attempt - 1),
          step.retry.maxBackoffMs ?? Number.POSITIVE_INFINITY,
        );
        await abortableDelay(delay, signal);
      }
    }
    throw lastError;
  }

  private async finish(
    input: WorkflowExecutionInput,
    executions: Record<string, WorkflowStepExecution>,
    outputs: JsonObject,
    startedAt: string,
    status: WorkflowExecutionResult["status"],
    eventFactory: EventFactory,
  ): Promise<WorkflowExecutionResult> {
    const result: WorkflowExecutionResult = {
      workflowId: input.workflow.definition.id,
      runId: input.runId,
      status,
      steps: executions,
      outputs,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await this.persistSnapshot(
      input.runId,
      input.workflow.definition.id,
      executions,
      outputs,
      startedAt,
      result,
    );
    await this.eventBus.publish(
      eventFactory.create("workflow.completed", { workflowId: result.workflowId, status }),
    );
    return result;
  }

  private async persistSnapshot(
    runId: string,
    workflowId: string,
    executions: Record<string, WorkflowStepExecution>,
    outputs: JsonObject,
    startedAt: string,
    result?: WorkflowExecutionResult,
  ): Promise<void> {
    if (this.persistence === undefined) return;
    const snapshot =
      result ??
      ({
        workflowId,
        runId,
        status: "RUNNING",
        steps: executions,
        outputs,
        startedAt,
        updatedAt: new Date().toISOString(),
      } as const);
    await this.persistence.entities.put("workflow_execution", runId, toJsonObject(snapshot));
  }
}

function pendingExecution(stepId: string): WorkflowStepExecution {
  return { stepId, status: "PENDING", attempts: 0, iterations: 0 };
}

function dependenciesComplete(
  step: WorkflowStep,
  executions: Record<string, WorkflowStepExecution>,
): boolean {
  return step.dependsOn.every((dependency) => {
    const status = executions[dependency]?.status;
    return status === "SUCCEEDED" || status === "SKIPPED" || status === "FAILED";
  });
}

function hasPending(executions: Record<string, WorkflowStepExecution>): boolean {
  return Object.values(executions).some(({ status }) => status === "PENDING");
}

function cancelPending(executions: Record<string, WorkflowStepExecution>): void {
  const now = new Date().toISOString();
  for (const execution of Object.values(executions)) {
    if (execution.status === "PENDING" || execution.status === "RUNNING") {
      execution.status = "CANCELLED";
      execution.completedAt = now;
    }
  }
}

function skipPending(executions: Record<string, WorkflowStepExecution>, error: string): void {
  const now = new Date().toISOString();
  for (const execution of Object.values(executions)) {
    if (execution.status === "PENDING") {
      execution.status = "SKIPPED";
      execution.error = error;
      execution.completedAt = now;
    }
  }
}

function makeExpressionContext(
  input: WorkflowExecutionInput,
  executions: Record<string, WorkflowStepExecution>,
  outputs: JsonObject,
): JsonObject {
  const steps = Object.fromEntries(
    Object.entries(executions).map(([id, execution]) => [
      id,
      {
        status: execution.status.toLowerCase(),
        succeeded: execution.status === "SUCCEEDED",
        failed: execution.status === "FAILED",
        skipped: execution.status === "SKIPPED",
        attempts: execution.attempts,
        iterations: execution.iterations,
        output: execution.output ?? null,
      },
    ]),
  ) as JsonObject;
  return {
    variables: { ...input.workflow.definition.variables, ...input.variables },
    steps,
    outputs,
    work: input.workItem === undefined ? {} : toJsonObject(input.workItem),
    run: { id: input.runId },
  };
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handle = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(handle);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      },
      { once: true },
    );
  });
}
