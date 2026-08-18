import type { EventBus } from "../../ports/event-bus.js";
import type { PersistenceProvider } from "../../ports/persistence.js";
import type { WorkflowStepContext } from "../../ports/workflow.js";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { WorkItem } from "../../domain/work.js";
import type {
  ActionWorkflowStep,
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

export class WorkflowSuspendedError extends Error {
  public constructor(
    public readonly conditionId: string,
    public readonly conditionType: string,
  ) {
    super(`Workflow suspended for ${conditionType}: ${conditionId}`);
    this.name = "WorkflowSuspendedError";
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
    const restored = await this.restoreSnapshot(input);
    if (
      restored?.status === "SUCCEEDED" ||
      restored?.status === "FAILED" ||
      restored?.status === "CANCELLED"
    ) {
      return restored;
    }
    const startedAt = restored?.startedAt ?? new Date().toISOString();
    const signal = input.signal ?? new AbortController().signal;
    const eventFactory = new EventFactory({ source: "workflow-engine", runId: input.runId });
    const executions =
      restored?.steps ??
      Object.fromEntries(
        input.workflow.definition.steps.map((step) => [step.id, pendingExecution(step.id)]),
      );
    for (const execution of Object.values(executions)) {
      if (execution.status === "WAITING") execution.status = "PENDING";
    }
    const outputs: JsonObject = restored?.outputs ?? {};

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
            input.workflow.definition.version,
            input.workflow.reference.digest,
            executions,
            outputs,
            startedAt,
          );
        }),
      );
      if (Object.values(executions).some(({ status }) => status === "WAITING")) {
        return this.finish(input, executions, outputs, startedAt, "WAITING", eventFactory);
      }
    }

    const terminalStatus = input.workflow.definition.steps.some(
      (step) => executions[step.id]?.status === "FAILED" && step.onError === "fail",
    )
      ? "FAILED"
      : Object.values(executions).some(({ status }) => status === "CANCELLED")
        ? "CANCELLED"
        : "SUCCEEDED";
    return this.finish(input, executions, outputs, startedAt, terminalStatus, eventFactory);
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
      if (execution.entered !== true) {
        await this.executeLifecycleActions(
          step,
          "on_enter",
          step.onEnter ?? [],
          input,
          executions,
          outputs,
          signal,
        );
        execution.entered = true;
      }
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
      if (execution.exited !== true) {
        await this.executeLifecycleActions(
          step,
          "on_exit",
          step.onExit ?? [],
          input,
          executions,
          outputs,
          signal,
        );
        execution.exited = true;
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
      if (error instanceof WorkflowSuspendedError) {
        execution.status = "WAITING";
        execution.waitConditionId = error.conditionId;
        delete execution.error;
        delete execution.completedAt;
        await this.eventBus.publish(
          eventFactory.create("workflow.step.waiting", {
            stepId: step.id,
            conditionId: error.conditionId,
            conditionType: error.conditionType,
          }),
        );
        return;
      }
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

  private async executeLifecycleActions(
    parent: WorkflowStep,
    phase: "on_enter" | "on_exit",
    actions: NonNullable<WorkflowStep["onEnter"]>,
    input: WorkflowExecutionInput,
    executions: Record<string, WorkflowStepExecution>,
    outputs: JsonObject,
    signal: AbortSignal,
  ): Promise<void> {
    for (const [index, action] of actions.entries()) {
      const step: ActionWorkflowStep = {
        id: `${parent.id}_${phase}_${index + 1}`,
        type: "action",
        action: action.action,
        input: action.input,
        dependsOn: [],
        retry: { maxAttempts: 1, backoffMs: 0 },
        onEnter: [],
        onExit: [],
        onError: "fail",
      };
      const expressionContext = makeExpressionContext(input, executions, outputs);
      const result = await this.handlers.require("action").execute(step, {
        runId: input.runId,
        stepId: step.id,
        workflow: input.workflow.definition,
        ...(input.workItem === undefined ? {} : { workItem: input.workItem }),
        ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
        variables: { ...input.workflow.definition.variables, ...input.variables },
        outputs,
        expressionContext,
        signal,
      });
      if (result.output !== undefined) outputs[step.id] = result.output;
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
            stepId: step.id,
            workflow: input.workflow.definition,
            ...(input.workItem === undefined ? {} : { workItem: input.workItem }),
            ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
            variables: { ...input.workflow.definition.variables, ...input.variables },
            outputs,
            expressionContext,
            signal: stepSignal,
          };
          const result = await this.handlers.require(step.type).execute(step, context);
          if (step.outputSchema !== undefined) {
            validateStructuredOutput(result.output, step.outputSchema, step.id);
          }
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
      workflowVersion: input.workflow.definition.version,
      workflowDigest: input.workflow.reference.digest,
      status,
      steps: executions,
      outputs,
      startedAt,
      updatedAt: new Date().toISOString(),
      ...(status === "WAITING" ? {} : { completedAt: new Date().toISOString() }),
      ...(status === "WAITING"
        ? {
            waitConditionIds: Object.values(executions)
              .filter(({ status }) => status === "WAITING")
              .map(({ waitConditionId }) => waitConditionId)
              .filter((value): value is string => value !== undefined),
          }
        : {}),
    };
    await this.persistSnapshot(
      input.runId,
      input.workflow.definition.id,
      input.workflow.definition.version,
      input.workflow.reference.digest,
      executions,
      outputs,
      startedAt,
      result,
    );
    await this.eventBus.publish(
      eventFactory.create(status === "WAITING" ? "workflow.suspended" : "workflow.completed", {
        workflowId: result.workflowId,
        status,
        ...(result.waitConditionIds === undefined
          ? {}
          : { waitConditionIds: result.waitConditionIds }),
      }),
    );
    return result;
  }

  private async persistSnapshot(
    runId: string,
    workflowId: string,
    workflowVersion: number,
    workflowDigest: string,
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
        workflowVersion,
        workflowDigest,
        status: "RUNNING",
        steps: executions,
        outputs,
        startedAt,
        updatedAt: new Date().toISOString(),
      } as const);
    await this.persistence.entities.put("workflow_execution", runId, toJsonObject(snapshot));
  }

  private async restoreSnapshot(
    input: WorkflowExecutionInput,
  ): Promise<WorkflowExecutionResult | undefined> {
    if (this.persistence === undefined) return undefined;
    const row = await this.persistence.entities.get<JsonObject>("workflow_execution", input.runId);
    if (row === undefined) return undefined;
    const value = row.value as unknown as WorkflowExecutionResult;
    if (value.workflowId !== input.workflow.definition.id) {
      throw new Error(
        `Workflow checkpoint belongs to ${value.workflowId}, not ${input.workflow.definition.id}`,
      );
    }
    if (
      value.workflowDigest !== undefined &&
      value.workflowDigest !== input.workflow.reference.digest
    ) {
      throw new Error("Workflow checkpoint digest does not match the pinned definition");
    }
    return structuredClone(value);
  }
}

function pendingExecution(stepId: string): WorkflowStepExecution {
  return { stepId, status: "PENDING", attempts: 0, iterations: 0 };
}

function dependenciesComplete(
  step: WorkflowStep,
  executions: Record<string, WorkflowStepExecution>,
): boolean {
  const statuses = step.dependsOn.map((dependency) => ({
    id: dependency,
    status: executions[dependency]?.status,
  }));
  if (!statuses.every(({ status }) => terminalDependencyStatuses.has(status ?? "PENDING"))) {
    return false;
  }
  const succeeded = statuses
    .filter(({ status }) => status === "SUCCEEDED" || status === "SKIPPED")
    .map(({ id }) => id);
  const join = step.join ?? { mode: "all" as const };
  if (join.mode === "all") return succeeded.length === statuses.length;
  if (join.mode === "any") return succeeded.length >= 1;
  if (join.mode === "minimum") return succeeded.length >= join.count;
  return join.required.every((id) => succeeded.includes(id));
}

const terminalDependencyStatuses = new Set(["SUCCEEDED", "SKIPPED", "FAILED", "CANCELLED"]);

function validateStructuredOutput(
  value: JsonValue | undefined,
  schema: JsonObject,
  path: string,
): void {
  const type = schema["type"];
  if (typeof type === "string" && !matchesJsonType(value, type)) {
    throw new StepExecutionError(`Step ${path} output must be ${type}`);
  }
  const allowed = schema["enum"];
  if (
    Array.isArray(allowed) &&
    !allowed.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))
  ) {
    throw new StepExecutionError(`Step ${path} output is not an allowed enum value`);
  }
  if (
    type !== "object" ||
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return;
  const required = schema["required"];
  if (Array.isArray(required)) {
    const missing = required.find((key) => typeof key === "string" && value[key] === undefined);
    if (typeof missing === "string")
      throw new StepExecutionError(`Step ${path} output is missing ${missing}`);
  }
  const properties = schema["properties"];
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return;
  for (const [key, childSchema] of Object.entries(properties)) {
    if (
      value[key] === undefined ||
      childSchema === null ||
      typeof childSchema !== "object" ||
      Array.isArray(childSchema)
    )
      continue;
    validateStructuredOutput(value[key], childSchema, `${path}.${key}`);
  }
}

function matchesJsonType(value: JsonValue | undefined, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return (
      value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
    );
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  return typeof value === type;
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
