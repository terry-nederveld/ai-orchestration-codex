import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject } from "../domain/json.js";
import { assertRunTransition, type AgentRun, type RunStatus } from "../domain/runs.js";
import type { WorkClaim, WorkItem } from "../domain/work.js";
import type { WorkflowExecutionResult } from "../domain/workflows.js";
import type { EventBus } from "../ports/event-bus.js";
import type { PersistenceProvider } from "../ports/persistence.js";
import type { WorkProvider } from "../ports/providers.js";
import type { Workspace, WorkspaceProvider, WorkspaceStrategy } from "../ports/workspace.js";
import { EventFactory } from "./events.js";
import type { HookRegistry } from "./hooks.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { CompiledWorkflow } from "./workflows/compiler.js";
import type { WorkflowEngine } from "./workflows/engine.js";

export interface OrchestrationRequest {
  runId?: string;
  workProviderId: string;
  externalId: string;
  workflow: CompiledWorkflow;
  owner: string;
  workspaceBasePath?: string;
  claimTtlMs?: number;
  signal?: AbortSignal;
}

export interface OrchestrationResult {
  run: AgentRun;
  workItem: WorkItem;
  workflow?: WorkflowExecutionResult;
  workspace?: Workspace;
  error?: string;
}

export class Orchestrator {
  public constructor(
    private readonly workProviders: ProviderRegistry<WorkProvider>,
    private readonly workspaceProviders: ProviderRegistry<WorkspaceProvider>,
    private readonly workspaceStrategies: Readonly<Record<WorkspaceStrategy, string>>,
    private readonly workflowEngine: WorkflowEngine,
    private readonly persistence: PersistenceProvider,
    private readonly events: EventBus,
    private readonly hooks: HookRegistry,
  ) {}

  public async run(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const provider = this.workProviders.require(request.workProviderId);
    const workItem = await provider.get(request.externalId, request.signal);
    if (workItem === undefined) throw new Error(`Work item not found: ${request.externalId}`);
    assertEligible(workItem, request.workflow);

    const run = createRun(workItem, request.workflow.definition.id, request.runId);
    const eventFactory = new EventFactory({ source: "orchestrator", runId: run.id });
    await this.persistRun(run);
    await this.events.publish(eventFactory.create("agent.queued", { workItemId: workItem.id }));

    const localClaim = {
      provider: provider.descriptor.id,
      externalId: workItem.externalId,
      owner: request.owner,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + (request.claimTtlMs ?? 600_000)).toISOString(),
    };
    let remoteClaim: WorkClaim | undefined;
    let workspace: Workspace | undefined;
    let workflowResult: WorkflowExecutionResult | undefined;

    try {
      await this.hooks.execute(
        "before_work_claim",
        { runId: run.id, workItemId: workItem.id, provider: provider.descriptor.id },
        request.signal ?? new AbortController().signal,
      );
      if (!(await this.persistence.claims.acquire(localClaim))) {
        throw new Error(`Work item is already claimed: ${workItem.externalId}`);
      }
      remoteClaim = await provider.claim(
        workItem,
        request.owner,
        request.claimTtlMs ?? 600_000,
        request.signal,
      );
      await this.events.publish(
        eventFactory.create("work.claimed", {
          workItemId: workItem.id,
          provider: provider.descriptor.id,
          owner: request.owner,
        }),
      );
      await this.hooks.execute(
        "after_work_claim",
        { runId: run.id, workItemId: workItem.id, provider: provider.descriptor.id },
        request.signal ?? new AbortController().signal,
      );

      await this.transition(run, "PREPARING", eventFactory);
      const workspaceProvider = this.workspaceProviders.require(
        this.workspaceStrategies[request.workflow.definition.workspace.strategy],
      );
      await this.hooks.execute(
        "before_workspace_create",
        { runId: run.id, strategy: request.workflow.definition.workspace.strategy },
        request.signal ?? new AbortController().signal,
      );
      workspace = await workspaceProvider.create(
        {
          runId: run.id,
          strategy: request.workflow.definition.workspace.strategy,
          ...(workItem.repository === undefined ? {} : { repository: workItem.repository }),
          ...(request.workspaceBasePath === undefined
            ? {}
            : { basePath: request.workspaceBasePath }),
          retainOnFailure: request.workflow.definition.workspace.retainOnFailure,
        },
        request.signal,
      );
      run.workspacePath = workspace.path;
      await this.persistRun(run);
      await this.events.publish(
        eventFactory.create("workspace.created", {
          workspaceId: workspace.id,
          path: workspace.path,
          strategy: workspace.strategy,
        }),
      );
      await this.hooks.execute(
        "after_workspace_create",
        { runId: run.id, workspacePath: workspace.path, strategy: workspace.strategy },
        request.signal ?? new AbortController().signal,
      );

      await this.transition(run, "RUNNING", eventFactory);
      workflowResult = await this.workflowEngine.execute({
        runId: run.id,
        workflow: request.workflow,
        workItem,
        workspacePath: workspace.path,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      run.usage = aggregateUsage(workflowResult.outputs);
      await this.persistRun(run);

      if (workflowResult.status === "CANCELLED") {
        run.outcome = "CANCELLED";
        await this.transition(run, "CANCELLED", eventFactory);
      } else if (workflowResult.status === "FAILED") {
        run.outcome = "FATAL_FAILURE";
        await this.transition(run, "FAILED", eventFactory);
      } else {
        await this.transition(run, "VERIFYING", eventFactory);
        const nextState = request.workflow.definition.transitions.success;
        if (nextState !== undefined) {
          await provider.update(workItem.externalId, { state: nextState }, request.signal);
          await this.events.publish(
            eventFactory.create("work.updated", { workItemId: workItem.id, state: nextState }),
          );
        }
        run.outcome = "GOAL_COMPLETED";
        await this.transition(run, "COMPLETED", eventFactory);
        await this.hooks.execute(
          "on_complete",
          { runId: run.id, workItemId: workItem.id },
          request.signal ?? new AbortController().signal,
        );
      }

      return compactResult(run, workItem, workflowResult, workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = request.signal?.aborted === true;
      run.outcome = cancelled ? "CANCELLED" : "FATAL_FAILURE";
      if (run.status !== "FAILED" && run.status !== "CANCELLED" && run.status !== "COMPLETED") {
        await this.transition(run, cancelled ? "CANCELLED" : "FAILED", eventFactory);
      }
      await this.events.publish(eventFactory.create("orchestration.failed", { error: message }));
      await this.hooks.execute(
        "on_failure",
        { runId: run.id, workItemId: workItem.id, error: message },
        new AbortController().signal,
      );
      const nextState = cancelled
        ? request.workflow.definition.transitions.cancelled
        : request.workflow.definition.transitions.failure;
      if (nextState !== undefined) {
        try {
          await provider.update(workItem.externalId, { state: nextState });
        } catch (updateError) {
          await this.events.publish(
            eventFactory.create("work.update.failed", {
              workItemId: workItem.id,
              error: updateError instanceof Error ? updateError.message : String(updateError),
            }),
          );
        }
      }
      return {
        ...compactResult(run, workItem, workflowResult, workspace),
        error: message,
      };
    } finally {
      const shouldRemove =
        workspace !== undefined &&
        (run.status === "COMPLETED" || !request.workflow.definition.workspace.retainOnFailure);
      if (shouldRemove && workspace !== undefined) {
        try {
          const workspaceProvider = this.workspaceProviders.require(
            this.workspaceStrategies[workspace.strategy],
          );
          await this.hooks.execute(
            "on_cleanup",
            { runId: run.id, workspacePath: workspace.path },
            new AbortController().signal,
          );
          await workspaceProvider.remove(workspace);
          await this.events.publish(
            eventFactory.create("workspace.removed", { workspaceId: workspace.id }),
          );
        } catch (cleanupError) {
          await this.events.publish(
            eventFactory.create("workspace.cleanup.failed", {
              workspaceId: workspace.id,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            }),
          );
        }
      }
      if (remoteClaim !== undefined) {
        try {
          await provider.release(remoteClaim);
        } catch (releaseError) {
          await this.events.publish(claimReleaseFailure(eventFactory, releaseError));
        }
      }
      await this.persistence.claims.release(localClaim.token);
    }
  }

  private async transition(
    run: AgentRun,
    status: RunStatus,
    eventFactory: EventFactory,
  ): Promise<void> {
    assertRunTransition(run.status, status);
    const previous = run.status;
    const now = new Date().toISOString();
    run.status = status;
    run.updatedAt = now;
    if (status === "RUNNING") run.startedAt ??= now;
    if (["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"].includes(status)) run.completedAt = now;
    await this.persistRun(run);
    await this.events.publish(
      eventFactory.create("agent.state.changed", { from: previous, to: status }),
    );
  }

  private async persistRun(run: AgentRun): Promise<void> {
    const current = await this.persistence.entities.get("run", run.id);
    run.version = (current?.version ?? 0) + 1;
    await this.persistence.entities.put(
      "run",
      run.id,
      toJsonObject(run),
      ...(current === undefined ? [] : [current.version]),
    );
  }
}

function createRun(workItem: WorkItem, workflowId: string, runId?: string): AgentRun {
  const now = new Date().toISOString();
  return {
    id: runId ?? randomUUID(),
    workItemId: workItem.id,
    workflowId,
    goal: workItem.description ?? workItem.title,
    status: "QUEUED",
    usage: { inputTokens: 0, outputTokens: 0 },
    metadata: {},
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

function assertEligible(workItem: WorkItem, workflow: CompiledWorkflow): void {
  const { trigger, eligibility } = workflow.definition;
  if (!trigger.states.includes(workItem.state)) {
    throw new Error(`Work item state is not eligible: ${workItem.state}`);
  }
  if (!eligibility.includeLabels.every((label) => workItem.labels.includes(label))) {
    throw new Error("Work item is missing required labels");
  }
  const excluded = eligibility.excludeLabels.find((label) => workItem.labels.includes(label));
  if (excluded !== undefined) throw new Error(`Work item has excluded label: ${excluded}`);
}

function compactResult(
  run: AgentRun,
  workItem: WorkItem,
  workflow: WorkflowExecutionResult | undefined,
  workspace: Workspace | undefined,
): OrchestrationResult {
  return {
    run,
    workItem,
    ...(workflow === undefined ? {} : { workflow }),
    ...(workspace === undefined ? {} : { workspace }),
  };
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function claimReleaseFailure(eventFactory: EventFactory, error: unknown): DomainEvent {
  return eventFactory.create("work.claim.release.failed", {
    error: error instanceof Error ? error.message : String(error),
  });
}

function aggregateUsage(outputs: JsonObject): AgentRun["usage"] {
  const usage: AgentRun["usage"] = { inputTokens: 0, outputTokens: 0 };
  for (const output of Object.values(outputs)) {
    if (output === null || typeof output !== "object" || Array.isArray(output)) continue;
    const value = output["usage"];
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    if (typeof value["inputTokens"] === "number") usage.inputTokens += value["inputTokens"];
    if (typeof value["outputTokens"] === "number") usage.outputTokens += value["outputTokens"];
    if (typeof value["estimatedCostUsd"] === "number") {
      usage.estimatedCostUsd = (usage.estimatedCostUsd ?? 0) + value["estimatedCostUsd"];
    }
    if (typeof value["subscriptionRequests"] === "number") {
      usage.subscriptionRequests =
        (usage.subscriptionRequests ?? 0) + value["subscriptionRequests"];
    }
  }
  return usage;
}
