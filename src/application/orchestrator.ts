import { randomUUID } from "node:crypto";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject, JsonValue } from "../domain/json.js";
import { assertRunTransition, type AgentRun, type RunStatus } from "../domain/runs.js";
import type { RepositoryReference, WorkClaim, WorkItem } from "../domain/work.js";
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
import type { VersionedAssetCatalog } from "./versioned-assets.js";
import type { ExecutionSpecificationService } from "./execution-specifications.js";
import type { RepositoryCheckpointProvider } from "../ports/checkpoints.js";
import type { InstructionResolver } from "./instruction-resolver.js";
import {
  AttachmentContextResolver,
  RelationshipContextResolver,
  type AttachmentReference,
  type RelationshipContextPolicy,
} from "./context-resolution.js";
import type {
  AppliedInstruction,
  RepositoryBinding,
  ResolvedContextItem,
  WaitCondition,
} from "../domain/execution.js";
import { contentDigest } from "./versioned-assets.js";
import { RepositoryMappingResolver, type RepositoryMappingRule } from "./repository-mapping.js";

export interface OrchestrationRequest {
  runId?: string;
  workProviderId: string;
  externalId: string;
  workflow: CompiledWorkflow;
  owner: string;
  workspaceBasePath?: string;
  claimTtlMs?: number;
  variables?: JsonObject;
  signal?: AbortSignal;
}

export interface OrchestrationResult {
  run: AgentRun;
  workItem: WorkItem;
  workflow?: WorkflowExecutionResult;
  workspace?: Workspace;
  error?: string;
}

export interface ResumeOrchestrationRequest {
  runId: string;
  workflow: CompiledWorkflow;
  owner: string;
  workspaceBasePath?: string;
  claimTtlMs?: number;
  signal?: AbortSignal;
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
    private readonly assets?: VersionedAssetCatalog,
    private readonly specifications?: ExecutionSpecificationService,
    private readonly checkpoints?: RepositoryCheckpointProvider,
    private readonly instructions?: InstructionResolver,
  ) {}

  public async run(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const provider = this.workProviders.require(request.workProviderId);
    const workItem = await provider.get(request.externalId, request.signal);
    if (workItem === undefined) throw new Error(`Work item not found: ${request.externalId}`);
    assertEligible(workItem, request.workflow);
    const repositories = resolveRepositories(workItem, request.workflow);
    const primaryRepository = repositories.find(({ role }) => role === "primary");

    const snapshotId = await this.pinWorkflow(request.workflow);
    const run = createRun(workItem, request, snapshotId);
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
          ...(primaryRepository === undefined
            ? {}
            : { repository: repositoryReference(primaryRepository) }),
          ...(request.workspaceBasePath === undefined
            ? {}
            : { basePath: request.workspaceBasePath }),
          retainOnFailure: request.workflow.definition.workspace.retainOnFailure,
        },
        request.signal,
      );
      run.workspacePath = workspace.path;
      if (workspace.branchName === undefined) delete run.repositoryBranch;
      else run.repositoryBranch = workspace.branchName;
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
      const effectiveInstructions = await this.reconcileSpecification(
        run,
        workItem,
        request.workflow,
        workspace.path,
        provider,
        request.signal,
        repositories,
      );
      workflowResult = await this.workflowEngine.execute({
        runId: run.id,
        workflow: request.workflow,
        workItem,
        workspacePath: workspace.path,
        variables: {
          ...request.variables,
          ...(effectiveInstructions.content.length === 0
            ? {}
            : { effectiveInstructions: effectiveInstructions.content }),
          ...(effectiveInstructions.context.length === 0
            ? {}
            : { resolvedContext: effectiveInstructions.context }),
        },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (workflowResult.status === "WAITING") {
        await this.checkpointRun(run, primaryRepository, workflowResult);
      }
      run.usage = aggregateUsage(workflowResult.outputs);
      await this.persistRun(run);
      await this.applyWorkflowResult(
        run,
        workItem,
        request.workflow,
        workflowResult,
        provider,
        eventFactory,
        request.signal,
      );

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
        (run.status === "COMPLETED" ||
          ((run.status === "FAILED" || run.status === "CANCELLED") &&
            !request.workflow.definition.workspace.retainOnFailure));
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

  public async resume(request: ResumeOrchestrationRequest): Promise<OrchestrationResult> {
    const row = await this.persistence.entities.get<JsonObject>("run", request.runId);
    if (row === undefined) throw new Error(`Run not found: ${request.runId}`);
    const run = row.value as unknown as AgentRun;
    if (
      run.status !== "WAITING" &&
      run.status !== "WAITING_FOR_HUMAN" &&
      run.status !== "BLOCKED"
    ) {
      throw new Error(`Run ${run.id} is not resumable from ${run.status}`);
    }
    if (run.workflowDigest !== request.workflow.reference.digest) {
      throw new Error("Resume workflow does not match the pinned workflow digest");
    }
    if (run.workflowSnapshotId !== undefined && this.assets !== undefined) {
      const snapshot = await this.assets.snapshot(run.workflowSnapshotId);
      if (snapshot === undefined || snapshot.root.digest !== run.workflowDigest) {
        throw new Error("Pinned workflow snapshot is missing or invalid");
      }
    }
    const providerId = stringMetadata(run.metadata, "workProviderId");
    const externalId = stringMetadata(run.metadata, "externalId");
    const provider = this.workProviders.require(providerId);
    const workItem = await provider.get(externalId, request.signal);
    if (workItem === undefined) throw new Error(`Work item not found: ${externalId}`);
    const repositories = resolveRepositories(workItem, request.workflow);
    const primaryRepository = repositories.find(({ role }) => role === "primary");
    const eventFactory = new EventFactory({ source: "orchestrator", runId: run.id });
    const localClaim = {
      provider: provider.descriptor.id,
      externalId,
      owner: request.owner,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + (request.claimTtlMs ?? 600_000)).toISOString(),
    };
    let remoteClaim: WorkClaim | undefined;
    let workspace: Workspace | undefined;
    let workflowResult: WorkflowExecutionResult | undefined;
    try {
      if (!(await this.persistence.claims.acquire(localClaim))) {
        throw new Error(`Work item is already claimed: ${externalId}`);
      }
      remoteClaim = await provider.claim(
        workItem,
        request.owner,
        request.claimTtlMs ?? 600_000,
        request.signal,
      );
      const workspaceProvider = this.workspaceProviders.require(
        this.workspaceStrategies[request.workflow.definition.workspace.strategy],
      );
      workspace = await workspaceProvider.create(
        {
          runId: run.id,
          strategy: request.workflow.definition.workspace.strategy,
          ...(primaryRepository === undefined
            ? {}
            : { repository: repositoryReference(primaryRepository) }),
          ...(request.workspaceBasePath === undefined
            ? {}
            : { basePath: request.workspaceBasePath }),
          retainOnFailure: request.workflow.definition.workspace.retainOnFailure,
          ...(run.repositoryBranch === undefined ? {} : { branchName: run.repositoryBranch }),
        },
        request.signal,
      );
      run.workspacePath = workspace.path;
      if (workspace.branchName === undefined) delete run.repositoryBranch;
      else run.repositoryBranch = workspace.branchName;
      await this.transition(run, "RUNNING", eventFactory);
      const effectiveInstructions = await this.reconcileSpecification(
        run,
        workItem,
        request.workflow,
        workspace.path,
        provider,
        request.signal,
        repositories,
      );
      workflowResult = await this.workflowEngine.execute({
        runId: run.id,
        workflow: request.workflow,
        workItem,
        workspacePath: workspace.path,
        variables: {
          ...run.workflowVariables,
          ...(effectiveInstructions.content.length === 0
            ? {}
            : { effectiveInstructions: effectiveInstructions.content }),
          ...(effectiveInstructions.context.length === 0
            ? {}
            : { resolvedContext: effectiveInstructions.context }),
        },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      if (workflowResult.status === "WAITING") {
        await this.checkpointRun(run, primaryRepository, workflowResult);
      }
      run.usage = aggregateUsage(workflowResult.outputs);
      await this.persistRun(run);
      await this.applyWorkflowResult(
        run,
        workItem,
        request.workflow,
        workflowResult,
        provider,
        eventFactory,
        request.signal,
      );
      return compactResult(run, workItem, workflowResult, workspace);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !["FAILED", "CANCELLED", "COMPLETED", "WAITING", "WAITING_FOR_HUMAN"].includes(run.status)
      ) {
        run.outcome = "FATAL_FAILURE";
        await this.transition(run, "FAILED", eventFactory);
      }
      return { ...compactResult(run, workItem, workflowResult, workspace), error: message };
    } finally {
      if (remoteClaim !== undefined) await provider.release(remoteClaim).catch(() => undefined);
      await this.persistence.claims.release(localClaim.token);
    }
  }

  private async applyWorkflowResult(
    run: AgentRun,
    workItem: WorkItem,
    workflow: CompiledWorkflow,
    result: WorkflowExecutionResult,
    provider: WorkProvider,
    eventFactory: EventFactory,
    signal?: AbortSignal,
  ): Promise<void> {
    run.graphPosition = {
      activeNodeIds: Object.values(result.steps)
        .filter(({ status }) => status === "RUNNING" || status === "WAITING")
        .map(({ stepId }) => stepId),
      completedNodeIds: Object.values(result.steps)
        .filter(({ status }) => status === "SUCCEEDED" || status === "SKIPPED")
        .map(({ stepId }) => stepId),
      checkpoint: Object.values(result.steps).filter(({ status }) => status !== "PENDING").length,
    };
    const activeStep = run.graphPosition.activeNodeIds[0];
    if (activeStep === undefined) delete run.currentStepId;
    else run.currentStepId = activeStep;
    if (result.status === "WAITING") {
      const step = workflow.stepsById.get(run.currentStepId ?? "");
      await this.transition(
        run,
        step?.type === "human_input" || step?.type === "approval" ? "WAITING_FOR_HUMAN" : "WAITING",
        eventFactory,
      );
      return;
    }
    if (result.status === "CANCELLED") {
      run.outcome = "CANCELLED";
      await this.transition(run, "CANCELLED", eventFactory);
      return;
    }
    if (result.status === "FAILED") {
      run.outcome = "FATAL_FAILURE";
      await this.transition(run, "FAILED", eventFactory);
      return;
    }
    await this.transition(run, "VERIFYING", eventFactory);
    const nextState = workflow.definition.transitions.success;
    if (nextState !== undefined) {
      await provider.update(workItem.externalId, { state: nextState }, signal);
      run.externalState = nextState;
      await this.events.publish(
        eventFactory.create("work.updated", { workItemId: workItem.id, state: nextState }),
      );
    }
    run.outcome = "GOAL_COMPLETED";
    await this.transition(run, "COMPLETED", eventFactory);
    await this.hooks.execute(
      "on_complete",
      { runId: run.id, workItemId: workItem.id },
      signal ?? new AbortController().signal,
    );
  }

  private async pinWorkflow(workflow: CompiledWorkflow): Promise<string> {
    if (this.assets === undefined) return `ephemeral:${workflow.reference.digest}`;
    const root = await this.assets.publish({
      kind: "workflow",
      id: workflow.definition.id,
      version: workflow.definition.version,
      value: toJsonObject(workflow.definition),
    });
    return (await this.assets.pin(root, workflow.definition.assets)).id;
  }

  private async reconcileSpecification(
    run: AgentRun,
    workItem: WorkItem,
    workflow: CompiledWorkflow,
    workspacePath: string,
    provider: WorkProvider,
    signal?: AbortSignal,
    repositories: RepositoryBinding[] = [],
  ): Promise<{
    content: string;
    applied: AppliedInstruction[];
    context: ResolvedContextItem[];
  }> {
    const effective =
      this.instructions === undefined
        ? { content: "", applied: [] }
        : await this.instructions.resolve({ repositoryRoot: workspacePath });
    const contextConfiguration = workflow.definition.configuration["context"];
    const policy = relationshipPolicy(contextConfiguration);
    const relationshipContext = await new RelationshipContextResolver(
      { get: (id, childSignal) => provider.get(id, childSignal).catch(() => undefined) },
      policy,
    ).resolve({ workItem, ...(signal === undefined ? {} : { signal }) });
    const nestedAttachments =
      contextConfiguration !== null &&
      typeof contextConfiguration === "object" &&
      !Array.isArray(contextConfiguration)
        ? contextConfiguration["attachments"]
        : undefined;
    const attachmentContext = new AttachmentContextResolver(
      attachmentPolicy(workflow.definition.configuration["attachments"] ?? nestedAttachments),
    ).resolve(attachmentReferences(workItem.metadata["attachments"]));
    const waits = await this.persistence.entities.list<WaitCondition>("wait_condition");
    const promotedContext: ResolvedContextItem[] = waits
      .map(({ value }) => value)
      .filter(({ runId }) => runId === run.id)
      .flatMap((condition) =>
        condition.signals
          .filter((signal) => {
            const response = signal.payload["humanInput"];
            return (
              response !== null &&
              typeof response === "object" &&
              !Array.isArray(response) &&
              response["promoted"] === true
            );
          })
          .map((signal) => ({
            id: signal.id,
            kind: "human_input",
            source: signal.source,
            relationship: "promoted",
            content: signal.payload,
            promoted: true,
            digest: contentDigest(signal.payload),
          })),
      );
    const context = [...relationshipContext, ...attachmentContext, ...promotedContext];
    const resolution = { ...effective, context };
    if (this.specifications === undefined) return resolution;
    const workflowExecution = await this.persistence.entities.get<JsonObject>(
      "workflow_execution",
      run.id,
    );
    const persistedOutputs = workflowExecution?.value["outputs"];
    const specification = await this.specifications.reconcile({
      runId: run.id,
      workflowSnapshotId: run.workflowSnapshotId ?? `ephemeral:${workflow.reference.digest}`,
      workflow: workflow.reference,
      goal: run.goal,
      acceptanceCriteria: stringArray(workItem.metadata["acceptanceCriteria"]),
      completionCriteria: stringArray(workItem.metadata["completionCriteria"]),
      work: toJsonObject(workItem),
      relatedWork: [],
      repositories,
      instructions: effective.applied,
      context,
      workflowOutputs:
        persistedOutputs !== null &&
        typeof persistedOutputs === "object" &&
        !Array.isArray(persistedOutputs)
          ? persistedOutputs
          : {},
      dependencies: [],
      tests: stringArray(workItem.metadata["tests"]),
      tools: [],
      permissions: [],
      validationRequirements: [],
    });
    run.executionSpecRevision = specification.revision;
    await this.persistRun(run);
    return resolution;
  }

  private async checkpointRun(
    run: AgentRun,
    repository: RepositoryBinding | undefined,
    result: WorkflowExecutionResult,
  ): Promise<void> {
    if (
      this.checkpoints === undefined ||
      run.workspacePath === undefined ||
      run.repositoryBranch === undefined ||
      repository === undefined
    )
      return;
    const checkpoint = await this.checkpoints.checkpoint({
      runId: run.id,
      repositoryId: repository.id,
      workspacePath: run.workspacePath,
      branch: run.repositoryBranch,
      remote: "origin",
      message: `chore(fable): checkpoint ${run.id}`,
      executionSpecRevision: run.executionSpecRevision ?? 1,
      workflowCheckpoint: Object.values(result.steps).filter(({ status }) => status !== "PENDING")
        .length,
    });
    run.checkpointSha = checkpoint.sha;
    await this.persistRun(run);
    await this.events.publish(
      new EventFactory({ source: "orchestrator", runId: run.id }).create(
        "repository.checkpoint.pushed",
        {
          repositoryId: checkpoint.repositoryId,
          branch: checkpoint.branch,
          sha: checkpoint.sha,
          executionSpecRevision: checkpoint.executionSpecRevision,
        },
      ),
    );
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

function createRun(
  workItem: WorkItem,
  request: OrchestrationRequest,
  workflowSnapshotId: string,
): AgentRun {
  const now = new Date().toISOString();
  return {
    id: request.runId ?? randomUUID(),
    workItemId: workItem.id,
    workflowId: request.workflow.definition.id,
    workflowVersion: request.workflow.definition.version,
    workflowDigest: request.workflow.reference.digest,
    workflowSnapshotId,
    ...(request.variables === undefined
      ? {}
      : { workflowVariables: structuredClone(request.variables) }),
    goal: workItem.description ?? workItem.title,
    status: "QUEUED",
    usage: { inputTokens: 0, outputTokens: 0 },
    externalState: workItem.state,
    releaseState: "planned",
    metadata: {
      workProviderId: request.workProviderId,
      externalId: request.externalId,
      owner: request.owner,
    },
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

function assertEligible(workItem: WorkItem, workflow: CompiledWorkflow): void {
  if (workflow.definition.lifecycle !== "ENABLED") {
    throw new Error(
      `Workflow ${workflow.definition.id}@${workflow.definition.version} is ${workflow.definition.lifecycle}`,
    );
  }
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

function resolveRepositories(workItem: WorkItem, workflow: CompiledWorkflow): RepositoryBinding[] {
  const explicit: RepositoryBinding[] =
    workItem.repository === undefined
      ? []
      : [
          {
            id: workItem.repository.id,
            cloneUrl: workItem.repository.cloneUrl,
            role: "primary",
            source: "explicit",
            ...(workItem.repository.defaultBranch === undefined
              ? {}
              : { defaultBranch: workItem.repository.defaultBranch }),
            ...(workItem.repository.localPath === undefined
              ? {}
              : { localPath: workItem.repository.localPath }),
          },
        ];
  const configured = workflow.definition.configuration["repositoryRules"];
  const nested = workflow.definition.configuration["repositoryResolution"];
  const nestedRules =
    nested !== null && typeof nested === "object" && !Array.isArray(nested)
      ? nested["rules"]
      : undefined;
  const rules = parseRepositoryRules(configured ?? nestedRules);
  const resolution = new RepositoryMappingResolver().resolve({
    context: { issue: toJsonObject(workItem) },
    explicit,
    rules,
  });
  if (resolution.conflicts.length > 0) {
    throw new Error(`Repository mapping conflict: ${resolution.conflicts.join("; ")}`);
  }
  return resolution.repositories;
}

function parseRepositoryRules(value: JsonValue | undefined): RepositoryMappingRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("repositoryRules must be an array");
  for (const rule of value) {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Array.isArray(rule) ||
      typeof rule["id"] !== "string" ||
      typeof rule["priority"] !== "number" ||
      rule["when"] === null ||
      typeof rule["when"] !== "object" ||
      Array.isArray(rule["when"]) ||
      !Array.isArray(rule["repositories"])
    ) {
      throw new Error("repositoryRules contains an invalid rule");
    }
  }
  return structuredClone(value) as unknown as RepositoryMappingRule[];
}

function repositoryReference(repository: RepositoryBinding): RepositoryReference {
  return {
    id: repository.id,
    cloneUrl: repository.cloneUrl,
    ...(repository.defaultBranch === undefined ? {} : { defaultBranch: repository.defaultBranch }),
    ...(repository.localPath === undefined ? {} : { localPath: repository.localPath }),
  };
}

function stringMetadata(metadata: JsonObject, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Run metadata is missing ${key}`);
  return value;
}

function relationshipPolicy(value: JsonValue | undefined): Partial<RelationshipContextPolicy> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    ...(typeof value["upwardDepth"] === "number" ? { upwardDepth: value["upwardDepth"] } : {}),
    ...(typeof value["downwardDepth"] === "number"
      ? { downwardDepth: value["downwardDepth"] }
      : {}),
    ...(typeof value["maxItems"] === "number" ? { maxItems: value["maxItems"] } : {}),
    ...(Array.isArray(value["relationships"]) &&
    value["relationships"].every((item) => typeof item === "string")
      ? { relationships: value["relationships"] }
      : Array.isArray(value["directRelationships"]) &&
          value["directRelationships"].every((item) => typeof item === "string")
        ? {
            relationships: ["parent", "child", ...value["directRelationships"]],
          }
        : {}),
  };
}

function attachmentPolicy(value: JsonValue | undefined) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { enabled: false, allowedMediaTypes: [] as string[], maxBytes: 0, maxCount: 0 };
  }
  const mediaTypes = value["allowedMediaTypes"];
  return {
    enabled: value["enabled"] === true,
    allowedMediaTypes:
      Array.isArray(mediaTypes) && mediaTypes.every((item) => typeof item === "string")
        ? mediaTypes
        : [],
    maxBytes: typeof value["maxBytes"] === "number" ? value["maxBytes"] : 1_000_000,
    maxCount: typeof value["maxCount"] === "number" ? value["maxCount"] : 5,
  };
}

function attachmentReferences(value: JsonValue | undefined): AttachmentReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (
      typeof entry["id"] !== "string" ||
      typeof entry["name"] !== "string" ||
      typeof entry["mediaType"] !== "string" ||
      typeof entry["sizeBytes"] !== "number" ||
      entry["content"] === undefined
    )
      return [];
    return [
      {
        id: entry["id"],
        name: entry["name"],
        mediaType: entry["mediaType"],
        sizeBytes: entry["sizeBytes"],
        content: entry["content"],
      },
    ];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
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
