import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ClaudeCodeAgentProvider } from "../adapters/agent/claude-code-agent.js";
import { CodexSdkAgentProvider } from "../adapters/agent/codex-sdk-agent.js";
import { CopilotSdkAgentProvider } from "../adapters/agent/copilot-sdk-agent.js";
import { FilesystemSkillProvider } from "../adapters/extensions/filesystem-skills.js";
import { ManifestExtensionProvider } from "../adapters/extensions/manifest-extension-provider.js";
import { McpToolProvider } from "../adapters/mcp/mcp-tool-provider.js";
import { AnthropicMessagesProvider } from "../adapters/model/anthropic-messages.js";
import { OpenAICompatibleProvider } from "../adapters/model/openai-compatible.js";
import { OpenAIResponsesProvider } from "../adapters/model/openai-responses.js";
import { SqlitePersistenceProvider } from "../adapters/persistence/sqlite.js";
import { NodeProcessRunner } from "../adapters/process/node-process-runner.js";
import { CompositeSecretProvider } from "../adapters/security/composite-secrets.js";
import { EncryptedFileSecretProvider } from "../adapters/security/encrypted-file-secrets.js";
import { EnvironmentSecretProvider } from "../adapters/security/environment-secrets.js";
import { InMemorySecretProvider } from "../adapters/security/in-memory-secrets.js";
import { GitHubSourceControlProvider } from "../adapters/source-control/github-source-control.js";
import { GitRepositoryCheckpointProvider } from "../adapters/source-control/git-checkpoints.js";
import { FilesystemInstructionProvider } from "../adapters/context/filesystem-instructions.js";
import { ListFilesTool, ReadFileTool, WriteFileTool } from "../adapters/tools/filesystem-tools.js";
import { ProcessTool } from "../adapters/tools/process-tool.js";
import { SearchTextTool } from "../adapters/tools/search-tool.js";
import { GitHubIssuesProvider } from "../adapters/work/github-issues.js";
import { JiraWorkProvider } from "../adapters/work/jira.js";
import { LinearWorkProvider } from "../adapters/work/linear.js";
import { CloneWorkspaceProvider } from "../adapters/workspace/clone-workspace.js";
import { GitWorktreeWorkspaceProvider } from "../adapters/workspace/git-worktree.js";
import { LocalDirectoryWorkspaceProvider } from "../adapters/workspace/local-workspace.js";
import { TemporaryWorkspaceProvider } from "../adapters/workspace/temporary-workspace.js";
import {
  CommitAction,
  PullRequestAction,
  PushAction,
} from "../application/actions/source-control-actions.js";
import { SlidingWindowContextManager } from "../application/agent/context-manager.js";
import { NativeAgentRuntime } from "../application/agent/native-runtime.js";
import { ApprovalManager, type ApprovalDecision } from "../application/approval-manager.js";
import { ExecutionSpecificationService } from "../application/execution-specifications.js";
import { HumanInputManager, WaitConditionManager } from "../application/wait-manager.js";
import { InstructionResolver } from "../application/instruction-resolver.js";
import { VersionedAssetCatalog } from "../application/versioned-assets.js";
import {
  WorkflowEvaluator,
  type WorkflowEvaluationPlan,
} from "../application/workflow-evaluator.js";
import { InMemoryEventBus } from "../application/event-bus.js";
import { HookRegistry } from "../application/hooks.js";
import { Orchestrator, type OrchestrationResult } from "../application/orchestrator.js";
import { PersistedEventBus } from "../application/persisted-event-bus.js";
import { RuleBasedPermissionProvider } from "../application/policy-engine.js";
import { RecurringTriggerService, type RecurringTriggerState } from "../application/recurrence.js";
import { ProviderRegistry } from "../application/provider-registry.js";
import {
  reconcileInterruptedRuns,
  WorkScheduler,
  type SchedulerStatus,
} from "../application/scheduler.js";
import { ToolRegistry } from "../application/tool-registry.js";
import { WorkflowActionRegistry } from "../application/workflows/action-registry.js";
import {
  ActionStepHandler,
  AgentStepHandler,
  ApprovalStepHandler,
  CommandStepHandler,
  HumanInputStepHandler,
  SubworkflowStepHandler,
  ToolStepHandler,
  WaitStepHandler,
} from "../application/workflows/builtin-handlers.js";
import { compileWorkflow, type CompiledWorkflow } from "../application/workflows/compiler.js";
import { WorkflowEngine, WorkflowSuspendedError } from "../application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../application/workflows/handler-registry.js";
import { loadWorkflow } from "../application/workflows/loader.js";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject, JsonValue } from "../domain/json.js";
import type { AgentRun } from "../domain/runs.js";
import type { WaitCondition } from "../domain/execution.js";
import type { WorkItem, WorkPage, WorkQuery } from "../domain/work.js";
import type { EventBus } from "../ports/event-bus.js";
import type { ExtensionManifest, SkillMetadata } from "../ports/extensions.js";
import type { Provider, AgentProvider, ModelProvider, WorkProvider } from "../ports/providers.js";
import type { SecretProvider } from "../ports/security.js";
import type { WorkspaceProvider } from "../ports/workspace.js";
import {
  resolveConfigPath,
  type AgentConfig,
  type LoadedFableConfig,
  type ModelConfig,
  type WorkConfig,
} from "./config.js";

export interface ProviderStatus {
  descriptor: Provider["descriptor"];
  availability: Awaited<ReturnType<Provider["availability"]>>;
}

export interface StartRunRequest {
  workProviderId: string;
  externalId: string;
  workflowId: string;
  owner?: string;
  variables?: JsonObject;
}

export interface ExtensionStatus {
  manifests: ExtensionManifest[];
  skills: SkillMetadata[];
  mcpServers: Array<{ id: string; tools: string[] }>;
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<OrchestrationResult>;
}

export class FableRuntime {
  public readonly persistence: SqlitePersistenceProvider;
  public readonly events: EventBus;
  public readonly approvals: ApprovalManager;
  public readonly waits: WaitConditionManager;
  public readonly humanInputs: HumanInputManager;
  public readonly assets: VersionedAssetCatalog;
  public readonly specifications: ExecutionSpecificationService;
  public readonly recurring: RecurringTriggerService;
  public readonly secrets: SecretProvider;
  public readonly skills = new FilesystemSkillProvider();

  readonly #config: LoadedFableConfig;
  readonly #models: ProviderRegistry<ModelProvider>;
  readonly #agents: ProviderRegistry<AgentProvider>;
  readonly #work: ProviderRegistry<WorkProvider>;
  readonly #workspaces: ProviderRegistry<WorkspaceProvider>;
  readonly #tools: ToolRegistry;
  readonly #hooks: HookRegistry;
  readonly #workflows = new Map<string, CompiledWorkflow>();
  readonly #mcp: McpToolProvider[] = [];
  readonly #extensionManifests: ExtensionManifest[] = [];
  readonly #skillMetadata: SkillMetadata[] = [];
  readonly #active = new Map<string, ActiveRun>();
  readonly #orchestrator: Orchestrator;
  readonly #sourceControl: GitHubSourceControlProvider;
  #scheduler: WorkScheduler | undefined;
  #recurringTimer: NodeJS.Timeout | undefined;
  #servicesStarted = false;

  private constructor(
    config: LoadedFableConfig,
    persistence: SqlitePersistenceProvider,
    events: EventBus,
    secrets: SecretProvider,
    approvals: ApprovalManager,
    waits: WaitConditionManager,
    humanInputs: HumanInputManager,
    assets: VersionedAssetCatalog,
    specifications: ExecutionSpecificationService,
    recurring: RecurringTriggerService,
    orchestrator: Orchestrator,
    sourceControl: GitHubSourceControlProvider,
    models: ProviderRegistry<ModelProvider>,
    agents: ProviderRegistry<AgentProvider>,
    work: ProviderRegistry<WorkProvider>,
    workspaces: ProviderRegistry<WorkspaceProvider>,
    tools: ToolRegistry,
    hooks: HookRegistry,
  ) {
    this.#config = config;
    this.persistence = persistence;
    this.events = events;
    this.secrets = secrets;
    this.approvals = approvals;
    this.waits = waits;
    this.humanInputs = humanInputs;
    this.assets = assets;
    this.specifications = specifications;
    this.recurring = recurring;
    this.#orchestrator = orchestrator;
    this.#sourceControl = sourceControl;
    this.#models = models;
    this.#agents = agents;
    this.#work = work;
    this.#workspaces = workspaces;
    this.#tools = tools;
    this.#hooks = hooks;
  }

  public static async create(config: LoadedFableConfig): Promise<FableRuntime> {
    const dataDirectory = resolveConfigPath(config, config.value.dataDirectory);
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const databasePath =
      config.value.database === undefined
        ? resolve(dataDirectory, "fable.sqlite")
        : resolveConfigPath(config, config.value.database);
    const persistence = new SqlitePersistenceProvider(databasePath);
    await persistence.initialize();
    const innerEvents = new InMemoryEventBus();
    const events = new PersistedEventBus(innerEvents, persistence.events);
    const secrets = buildSecrets(config, dataDirectory);
    const approvals = new ApprovalManager(persistence, events);
    const waits = new WaitConditionManager(persistence, events);
    const humanInputs = new HumanInputManager(waits);
    const assets = new VersionedAssetCatalog(persistence);
    const specifications = new ExecutionSpecificationService(persistence);
    const recurring = new RecurringTriggerService(persistence);
    const runner = new NodeProcessRunner();
    const permissions = new RuleBasedPermissionProvider(
      config.value.permissions.map((rule) => ({
        capability: rule.capability,
        decision: rule.decision,
        ...(rule.resource === undefined ? {} : { resource: rule.resource }),
        ...(rule.priority === undefined ? {} : { priority: rule.priority }),
      })),
    );
    const models = new ProviderRegistry<ModelProvider>();
    const agents = new ProviderRegistry<AgentProvider>();
    const work = new ProviderRegistry<WorkProvider>();
    const workspaces = new ProviderRegistry<WorkspaceProvider>();
    const tools = new ToolRegistry();
    const hooks = new HookRegistry();
    const workflowActions = new WorkflowActionRegistry();

    for (const model of config.value.models) registerModel(models, model, secrets);
    for (const agent of config.value.agents)
      registerAgent(agents, agent, secrets, permissions, runner);
    for (const provider of config.value.work) registerWork(work, provider, secrets);

    tools.register(new ReadFileTool());
    tools.register(new WriteFileTool());
    tools.register(new ListFilesTool());
    tools.register(new SearchTextTool(runner));
    tools.register(new ProcessTool(runner));

    const workspaceRoot =
      config.value.workspaceRoot === undefined
        ? resolve(dataDirectory, "workspaces")
        : resolveConfigPath(config, config.value.workspaceRoot);
    workspaces.register(new LocalDirectoryWorkspaceProvider());
    workspaces.register(new TemporaryWorkspaceProvider(workspaceRoot));
    workspaces.register(new CloneWorkspaceProvider(runner, workspaceRoot));
    workspaces.register(new GitWorktreeWorkspaceProvider(runner, workspaceRoot));

    const sourceControl = new GitHubSourceControlProvider(runner, secrets, events, {
      tokenReference: config.value.sourceControl.githubSecret,
      ...(config.value.sourceControl.apiUrl === undefined
        ? {}
        : { apiBaseUrl: config.value.sourceControl.apiUrl }),
    });
    workflowActions.register(new CommitAction(sourceControl, permissions, hooks));
    workflowActions.register(new PushAction(sourceControl, permissions, hooks));
    workflowActions.register(new PullRequestAction(sourceControl, permissions, hooks));

    const runtime = new NativeAgentRuntime(
      models,
      tools,
      permissions,
      events,
      new SlidingWindowContextManager(),
      persistence,
      hooks,
    );
    const handlers = new WorkflowStepHandlerRegistry();
    handlers.register(new AgentStepHandler(runtime, agents, hooks));
    handlers.register(new CommandStepHandler(runner, permissions));
    handlers.register(new ToolStepHandler(tools, permissions));
    handlers.register(new ActionStepHandler(workflowActions));
    handlers.register(new ApprovalStepHandler(approvals));
    handlers.register(new HumanInputStepHandler(humanInputs));
    handlers.register(new WaitStepHandler(waits));
    handlers.register(
      new SubworkflowStepHandler(async (step, context) => {
        const asset = await assets.get(step.workflow);
        if (asset === undefined) {
          throw new Error(
            `Pinned subworkflow is unavailable: ${step.workflow.id}@${step.workflow.version}`,
          );
        }
        const workflow = compileWorkflow(asset.value);
        const result = await workflowEngine.execute({
          runId: `${context.runId}:${context.stepId}`,
          workflow,
          ...(context.workItem === undefined ? {} : { workItem: context.workItem }),
          ...(context.workspacePath === undefined ? {} : { workspacePath: context.workspacePath }),
          variables: { ...context.variables, ...step.input },
          signal: context.signal,
        });
        if (result.status === "WAITING") {
          const conditionId = result.waitConditionIds?.[0];
          if (conditionId === undefined)
            throw new Error("Subworkflow suspended without a wait condition");
          throw new WorkflowSuspendedError(conditionId, "subworkflow");
        }
        if (result.status !== "SUCCEEDED") {
          throw new Error(`Subworkflow ${step.workflow.id} ${result.status.toLowerCase()}`);
        }
        return result.outputs;
      }),
    );
    const workflowEngine = new WorkflowEngine(
      handlers,
      events,
      persistence,
      config.value.concurrency.workflowSteps,
    );
    const orchestrator = new Orchestrator(
      work,
      workspaces,
      {
        local: "local-workspace",
        temporary: "temporary-workspace",
        clone: "clone-workspace",
        "git-worktree": "git-worktree",
      },
      workflowEngine,
      persistence,
      events,
      hooks,
      assets,
      specifications,
      new GitRepositoryCheckpointProvider(runner, persistence, workspaceRoot),
      new InstructionResolver([new FilesystemInstructionProvider()]),
    );
    const result = new FableRuntime(
      config,
      persistence,
      events,
      secrets,
      approvals,
      waits,
      humanInputs,
      assets,
      specifications,
      recurring,
      orchestrator,
      sourceControl,
      models,
      agents,
      work,
      workspaces,
      tools,
      hooks,
    );
    await result.#loadExtensions(workflowActions);
    await result.#loadMcp();
    await result.#loadWorkflows();
    await result.#configureRecurring();
    result.#configureScheduler();
    return result;
  }

  public workflowIds(): string[] {
    return [...this.#workflows.keys()].sort();
  }

  public workflow(id: string): CompiledWorkflow {
    const workflow = this.#workflows.get(id);
    if (workflow === undefined) throw new Error(`Unknown workflow: ${id}`);
    return workflow;
  }

  public async publishWorkflowDefinition(input: unknown) {
    const workflow = compileWorkflow(input);
    await this.assets.publish({
      kind: "workflow",
      id: workflow.definition.id,
      version: workflow.definition.version,
      value: JSON.parse(JSON.stringify(workflow.definition)) as JsonObject,
    });
    const current = this.#workflows.get(workflow.definition.id);
    if (current === undefined || workflow.definition.version >= current.definition.version) {
      this.#workflows.set(workflow.definition.id, workflow);
    }
    return structuredClone(workflow.definition);
  }

  public evaluateWorkflowDefinition(input: {
    definition: unknown;
    workItem: WorkItem;
  }): Promise<WorkflowEvaluationPlan> {
    const workflow = compileWorkflow(input.definition);
    return new WorkflowEvaluator().evaluate({
      workItem: input.workItem,
      workflows: [workflow.definition],
    });
  }

  public workflowDefinitions() {
    return this.workflowIds().map((id) => structuredClone(this.workflow(id).definition));
  }

  public extensionStatus(): ExtensionStatus {
    return {
      manifests: structuredClone(this.#extensionManifests),
      skills: structuredClone(this.#skillMetadata),
      mcpServers: this.#mcp.map((server) => ({
        id: server.id,
        tools: server.list().map((tool) => tool.name),
      })),
    };
  }

  public async providerStatuses(): Promise<ProviderStatus[]> {
    const providers: Provider[] = [
      ...this.#models.list(),
      ...this.#agents.list(),
      ...this.#work.list(),
      ...this.#workspaces.list(),
      this.#sourceControl,
    ];
    return Promise.all(
      providers.map(async (provider) => ({
        descriptor: provider.descriptor,
        availability: await provider.availability(),
      })),
    );
  }

  public async discoverWork(providerId: string, query: WorkQuery): Promise<WorkPage> {
    return this.#work.require(providerId).discover(query);
  }

  public startRun(request: StartRunRequest): {
    runId: string;
    promise: Promise<OrchestrationResult>;
  } {
    const selectedWorkflow = this.workflow(request.workflowId);
    if (selectedWorkflow.definition.lifecycle !== "ENABLED") {
      throw new Error(`Workflow ${request.workflowId} is ${selectedWorkflow.definition.lifecycle}`);
    }
    const runId = randomUUID();
    const controller = new AbortController();
    const promise = this.#orchestrator
      .run({
        runId,
        workProviderId: request.workProviderId,
        externalId: request.externalId,
        workflow: selectedWorkflow,
        owner: request.owner ?? `fable-${process.pid}`,
        ...(request.variables === undefined ? {} : { variables: request.variables }),
        ...(this.#config.value.workspaceRoot === undefined
          ? {}
          : {
              workspaceBasePath: resolveConfigPath(this.#config, this.#config.value.workspaceRoot),
            }),
        signal: controller.signal,
      })
      .finally(() => this.#active.delete(runId));
    this.#active.set(runId, { controller, promise });
    void promise.catch(() => undefined);
    return { runId, promise };
  }

  public async run(request: StartRunRequest): Promise<OrchestrationResult> {
    return this.startRun(request).promise;
  }

  public cancelRun(runId: string): boolean {
    const active = this.#active.get(runId);
    if (active === undefined) return false;
    active.controller.abort(new Error("Run cancelled by operator"));
    return true;
  }

  public async listRuns(): Promise<AgentRun[]> {
    const rows = await this.persistence.entities.list<JsonObject>("run");
    return rows.map((row) => row.value as unknown as AgentRun);
  }

  public async getRun(runId: string): Promise<AgentRun | undefined> {
    const row = await this.persistence.entities.get<JsonObject>("run", runId);
    return row?.value as unknown as AgentRun | undefined;
  }

  public async eventsForRun(runId: string): Promise<DomainEvent[]> {
    return this.persistence.events.list({ runId, limit: 10_000 });
  }

  public async resolveApproval(id: string, decision: ApprovalDecision): Promise<boolean> {
    return this.approvals.resolve(id, decision);
  }

  public listWaits(): Promise<WaitCondition[]> {
    return this.waits.list();
  }

  public async submitHumanInput(
    conditionId: string,
    input: {
      source: "app" | "work_item";
      actorId: string;
      value: JsonValue;
      promote?: boolean;
    },
  ) {
    const response = await this.humanInputs.respond(conditionId, input);
    if (response.selected && response.condition !== undefined) {
      const resumed = await this.resumeRun(response.condition.runId);
      void resumed.promise.catch(() => undefined);
    }
    return response;
  }

  public async resumeRun(runId: string): Promise<{
    runId: string;
    promise: Promise<OrchestrationResult>;
  }> {
    if (this.#active.has(runId)) throw new Error(`Run is already active: ${runId}`);
    const run = await this.getRun(runId);
    if (
      run?.workflowVersion === undefined ||
      run.workflowDigest === undefined ||
      run.workflowId.length === 0
    ) {
      throw new Error(`Run ${runId} has no pinned workflow identity`);
    }
    const stored = await this.assets.get({
      kind: "workflow",
      id: run.workflowId,
      version: run.workflowVersion,
      digest: run.workflowDigest,
    });
    if (stored === undefined) throw new Error(`Pinned workflow is unavailable for run ${runId}`);
    const workflow = compileWorkflow(stored.value);
    const controller = new AbortController();
    const promise = this.#orchestrator
      .resume({
        runId,
        workflow,
        owner: `fable-resume-${process.pid}`,
        ...(this.#config.value.workspaceRoot === undefined
          ? {}
          : {
              workspaceBasePath: resolveConfigPath(this.#config, this.#config.value.workspaceRoot),
            }),
        signal: controller.signal,
      })
      .finally(() => this.#active.delete(runId));
    this.#active.set(runId, { controller, promise });
    return { runId, promise };
  }

  public schedulerStatus(): SchedulerStatus {
    return (
      this.#scheduler?.status() ?? {
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: this.#config.value.scheduler.maxConcurrentRuns,
      }
    );
  }

  public recurringStatus(): Promise<RecurringTriggerState[]> {
    return this.recurring.list();
  }

  public async runRecurringOnce(now = new Date()): Promise<number> {
    const due = await this.recurring.due(now);
    for (const trigger of due) {
      const started = this.startRun({
        workProviderId: trigger.definition.workProviderId,
        externalId: trigger.definition.externalId,
        workflowId: trigger.definition.workflowId,
        variables: trigger.definition.variables,
        owner: `fable-recurring-${trigger.id}`,
      });
      await this.recurring.acknowledge(trigger.id, now);
      await this.events.publish({
        id: randomUUID(),
        type: "recurring.dispatched",
        occurredAt: now.toISOString(),
        source: "recurring-trigger",
        runId: started.runId,
        payload: { triggerId: trigger.id, workflowId: trigger.workflowId },
      });
    }
    return due.length;
  }

  public async startServices(): Promise<void> {
    if (this.#servicesStarted) return;
    this.#servicesStarted = true;
    await reconcileInterruptedRuns(this.persistence, this.events);
    await this.approvals.reconcileInterrupted();
    await this.runRecurringOnce();
    if (this.#config.value.recurring.length > 0) {
      this.#recurringTimer = setInterval(() => void this.runRecurringOnce(), 30_000);
      this.#recurringTimer.unref();
    }
    if (this.#config.value.scheduler.enabled) await this.#scheduler?.start();
  }

  public async startScheduler(): Promise<void> {
    await this.#scheduler?.start();
  }

  public async stopScheduler(): Promise<void> {
    await this.#scheduler?.stop();
  }

  public async runSchedulerOnce(): Promise<void> {
    await this.#scheduler?.runOnce();
  }

  public async close(): Promise<void> {
    if (this.#recurringTimer !== undefined) clearInterval(this.#recurringTimer);
    for (const active of this.#active.values())
      active.controller.abort(new Error("Runtime closing"));
    await this.#scheduler?.stop();
    await Promise.allSettled([...this.#active.values()].map((active) => active.promise));
    await Promise.allSettled(this.#mcp.map((provider) => provider.close()));
    await this.persistence.close();
  }

  async #loadExtensions(actions: WorkflowActionRegistry): Promise<void> {
    if (this.#config.value.extensions.paths.length === 0) return;
    const provider = new ManifestExtensionProvider({
      grants: this.#config.value.extensions.grants,
    });
    const paths = this.#config.value.extensions.paths.map((path) =>
      resolveConfigPath(this.#config, path),
    );
    const manifests = await provider.discover(paths);
    this.#extensionManifests.push(...structuredClone(manifests));
    for (const manifest of manifests) {
      const contribution = await provider.load(manifest);
      for (const tool of contribution.tools ?? []) this.#tools.register(tool);
      for (const action of contribution.workflowActions ?? []) actions.register(action);
      for (const hook of contribution.hooks ?? []) this.#hooks.register(hook);
    }
    this.#skillMetadata.push(...(await this.skills.discover(paths)));
  }

  async #loadMcp(): Promise<void> {
    for (const config of this.#config.value.mcp) {
      const provider =
        config.transport === "stdio"
          ? new McpToolProvider({
              id: config.id,
              transport: "stdio",
              command: config.command,
              ...(config.args === undefined ? {} : { args: config.args }),
              ...(config.cwd === undefined
                ? {}
                : { cwd: resolveConfigPath(this.#config, config.cwd) }),
              ...(config.env === undefined ? {} : { env: config.env }),
              ...(config.permissions === undefined ? {} : { permissions: config.permissions }),
            })
          : new McpToolProvider({
              id: config.id,
              transport: "http",
              url: config.url,
              ...(config.headers === undefined ? {} : { headers: config.headers }),
              ...(config.permissions === undefined ? {} : { permissions: config.permissions }),
            });
      await provider.connect();
      this.#mcp.push(provider);
      for (const tool of provider.list()) this.#tools.register(tool);
    }
  }

  async #loadWorkflows(): Promise<void> {
    for (const configuredPath of this.#config.value.workflows) {
      const path = resolveConfigPath(this.#config, configuredPath);
      const workflow = await loadWorkflow(path, this.#config.directory);
      if (this.#workflows.has(workflow.definition.id)) {
        throw new Error(`Duplicate workflow ID: ${workflow.definition.id}`);
      }
      const published = await this.assets.publish({
        kind: "workflow",
        id: workflow.definition.id,
        version: workflow.definition.version,
        value: JSON.parse(JSON.stringify(workflow.definition)) as JsonObject,
      });
      if (published.digest !== workflow.reference.digest) {
        throw new Error(`Workflow digest mismatch while publishing ${workflow.definition.id}`);
      }
      this.#workflows.set(workflow.definition.id, workflow);
    }
    for (const asset of await this.assets.list("workflow")) {
      const workflow = compileWorkflow(asset.value);
      if (workflow.reference.digest !== asset.digest) {
        throw new Error(`Stored workflow digest mismatch for ${asset.id}@${asset.version}`);
      }
      const current = this.#workflows.get(asset.id);
      if (current === undefined || workflow.definition.version > current.definition.version) {
        this.#workflows.set(asset.id, workflow);
      }
    }
  }

  async #configureRecurring(): Promise<void> {
    for (const definition of this.#config.value.recurring) {
      this.#work.require(definition.workProvider);
      this.workflow(definition.workflow);
      await this.recurring.register({
        id: definition.id,
        workProviderId: definition.workProvider,
        externalId: definition.externalId,
        workflowId: definition.workflow,
        everyMs: definition.everyMs,
        startAt: definition.startAt,
        enabled: definition.enabled,
        variables: definition.variables,
      });
    }
  }

  #configureScheduler(): void {
    const scheduler = this.#config.value.scheduler;
    const sourceIds = new Set<string>();
    for (const source of scheduler.sources) {
      if (sourceIds.has(source.id)) throw new Error(`Duplicate scheduler source ID: ${source.id}`);
      sourceIds.add(source.id);
      this.#work.require(source.workProvider);
      this.workflow(source.workflow);
    }
    this.#scheduler = new WorkScheduler(
      scheduler.sources.map((source) => ({
        id: source.id,
        workProviderId: source.workProvider,
        workflowId: source.workflow,
        policy: source.policy,
        ...(source.wipLimit === undefined ? {} : { wipLimit: source.wipLimit }),
        query: {
          ...(source.query.project === undefined ? {} : { project: source.query.project }),
          ...(source.query.states === undefined ? {} : { states: source.query.states }),
          ...(source.query.labels === undefined ? {} : { labels: source.query.labels }),
          ...(source.query.assignee === undefined ? {} : { assignee: source.query.assignee }),
          ...(source.query.limit === undefined ? {} : { limit: source.query.limit }),
        },
      })),
      {
        pollIntervalMs: scheduler.pollIntervalMs,
        maxConcurrentRuns: scheduler.maxConcurrentRuns,
        maxAttempts: scheduler.maxAttempts,
        retryBackoffMs: scheduler.retryBackoffMs,
        maxRetryBackoffMs: scheduler.maxRetryBackoffMs,
        owner: `fable-scheduler-${process.pid}`,
      },
      this.#work,
      this.persistence,
      this.events,
      (request) => this.startRun(request),
    );
  }
}

function buildSecrets(config: LoadedFableConfig, dataDirectory: string): SecretProvider {
  const environment = new EnvironmentSecretProvider({
    "openai.api_key": "OPENAI_API_KEY",
    "anthropic.api_key": "ANTHROPIC_API_KEY",
    "openrouter.api_key": "OPENROUTER_API_KEY",
    "github.token": "GITHUB_TOKEN",
    "linear.token": "LINEAR_API_KEY",
  });
  const password = process.env["FABLE_VAULT_PASSWORD"];
  const writable =
    password === undefined
      ? new InMemorySecretProvider()
      : new EncryptedFileSecretProvider(
          config.value.vault.path === undefined
            ? resolve(dataDirectory, "secrets.vault")
            : resolveConfigPath(config, config.value.vault.path),
          password,
        );
  return new CompositeSecretProvider([environment, writable], writable.id);
}

function registerModel(
  registry: ProviderRegistry<ModelProvider>,
  config: ModelConfig,
  secrets: SecretProvider,
): void {
  if (config.type === "openai") {
    registry.register(
      new OpenAIResponsesProvider({
        secrets,
        apiKeyReference: config.secret,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.organization === undefined ? {} : { organization: config.organization }),
        ...(config.project === undefined ? {} : { project: config.project }),
        ...(config.models === undefined ? {} : { models: config.models }),
      }),
    );
  } else if (config.type === "anthropic") {
    registry.register(
      new AnthropicMessagesProvider({
        secrets,
        apiKeyReference: config.secret,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.models === undefined ? {} : { models: config.models }),
      }),
    );
  } else {
    registry.register(
      new OpenAICompatibleProvider({
        id: config.id,
        displayName: config.name,
        baseUrl: config.baseUrl,
        secrets,
        requireApiKey: config.requireApiKey,
        includeUsage: config.includeUsage,
        ...(config.secret === undefined ? {} : { apiKeyReference: config.secret }),
        ...(config.models === undefined ? {} : { models: config.models }),
        ...(config.headers === undefined ? {} : { headers: config.headers }),
      }),
    );
  }
}

function registerAgent(
  registry: ProviderRegistry<AgentProvider>,
  config: AgentConfig,
  secrets: SecretProvider,
  permissions: RuleBasedPermissionProvider,
  runner: NodeProcessRunner,
): void {
  if (config.type === "codex") {
    registry.register(
      new CodexSdkAgentProvider({
        secrets,
        networkAccessEnabled: config.network,
        ...(config.secret === undefined ? {} : { apiKeyReference: config.secret }),
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
        ...(config.executable === undefined ? {} : { codexPathOverride: config.executable }),
      }),
    );
  } else if (config.type === "claude-code") {
    registry.register(
      new ClaudeCodeAgentProvider({
        runner,
        executable: config.executable,
        permissionMode: config.permissionMode,
        consumption: config.consumption,
        ...(config.allowedTools === undefined ? {} : { allowedTools: config.allowedTools }),
        ...(config.disallowedTools === undefined
          ? {}
          : { disallowedTools: config.disallowedTools }),
        ...(config.maxTurns === undefined ? {} : { maxTurns: config.maxTurns }),
        ...(config.maxBudgetUsd === undefined ? {} : { maxBudgetUsd: config.maxBudgetUsd }),
      }),
    );
  } else {
    registry.register(new CopilotSdkAgentProvider({ permissions }));
  }
}

function registerWork(
  registry: ProviderRegistry<WorkProvider>,
  config: WorkConfig,
  secrets: SecretProvider,
): void {
  if (config.type === "github") {
    registry.register(
      new GitHubIssuesProvider({
        owner: config.owner,
        repository: config.repository,
        secrets,
        tokenReference: config.secret,
        ...(config.apiUrl === undefined ? {} : { apiUrl: config.apiUrl }),
        ...(config.cloneUrl === undefined ? {} : { cloneUrl: config.cloneUrl }),
      }),
    );
  } else if (config.type === "linear") {
    registry.register(
      new LinearWorkProvider({
        secrets,
        tokenReference: config.secret,
        ...(config.apiUrl === undefined ? {} : { apiUrl: config.apiUrl }),
        ...(config.team === undefined ? {} : { team: config.team }),
        ...(config.repository === undefined
          ? {}
          : { repository: normalizeRepository(config.repository) }),
      }),
    );
  } else {
    registry.register(
      new JiraWorkProvider({
        deployment: config.type === "jira-cloud" ? "cloud" : "data-center",
        baseUrl: config.baseUrl,
        secrets,
        tokenReference: config.secret,
        ...(config.project === undefined ? {} : { project: config.project }),
        ...(config.email === undefined ? {} : { email: config.email }),
        ...(config.repository === undefined
          ? {}
          : { repository: normalizeRepository(config.repository) }),
      }),
    );
  }
}

function normalizeRepository(repository: {
  id: string;
  cloneUrl: string;
  owner?: string | undefined;
  name?: string | undefined;
  defaultBranch?: string | undefined;
}) {
  return {
    id: repository.id,
    cloneUrl: repository.cloneUrl,
    ...(repository.owner === undefined ? {} : { owner: repository.owner }),
    ...(repository.name === undefined ? {} : { name: repository.name }),
    ...(repository.defaultBranch === undefined ? {} : { defaultBranch: repository.defaultBranch }),
  };
}
