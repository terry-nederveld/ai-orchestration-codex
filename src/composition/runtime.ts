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
import { InMemoryEventBus } from "../application/event-bus.js";
import { HookRegistry } from "../application/hooks.js";
import { Orchestrator, type OrchestrationResult } from "../application/orchestrator.js";
import { PersistedEventBus } from "../application/persisted-event-bus.js";
import { RuleBasedPermissionProvider } from "../application/policy-engine.js";
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
  ToolStepHandler,
} from "../application/workflows/builtin-handlers.js";
import type { CompiledWorkflow } from "../application/workflows/compiler.js";
import { WorkflowEngine } from "../application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../application/workflows/handler-registry.js";
import { loadWorkflow } from "../application/workflows/loader.js";
import type { DomainEvent } from "../domain/events.js";
import type { JsonObject } from "../domain/json.js";
import type { AgentRun } from "../domain/runs.js";
import type { WorkPage, WorkQuery } from "../domain/work.js";
import type { EventBus } from "../ports/event-bus.js";
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
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<OrchestrationResult>;
}

export class FableRuntime {
  public readonly persistence: SqlitePersistenceProvider;
  public readonly events: EventBus;
  public readonly approvals: ApprovalManager;
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
  readonly #active = new Map<string, ActiveRun>();
  readonly #orchestrator: Orchestrator;
  readonly #sourceControl: GitHubSourceControlProvider;
  #scheduler: WorkScheduler | undefined;
  #servicesStarted = false;

  private constructor(
    config: LoadedFableConfig,
    persistence: SqlitePersistenceProvider,
    events: EventBus,
    secrets: SecretProvider,
    approvals: ApprovalManager,
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
    const approvals = new ApprovalManager(persistence);
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
    workflowActions.register(new CommitAction(sourceControl, permissions));
    workflowActions.register(new PushAction(sourceControl, permissions));
    workflowActions.register(new PullRequestAction(sourceControl, permissions));

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
    handlers.register(new AgentStepHandler(runtime, agents));
    handlers.register(new CommandStepHandler(runner, permissions));
    handlers.register(new ToolStepHandler(tools, permissions));
    handlers.register(new ActionStepHandler(workflowActions));
    handlers.register(new ApprovalStepHandler(approvals));
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
    );
    const result = new FableRuntime(
      config,
      persistence,
      events,
      secrets,
      approvals,
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
    const runId = randomUUID();
    const controller = new AbortController();
    const promise = this.#orchestrator
      .run({
        runId,
        workProviderId: request.workProviderId,
        externalId: request.externalId,
        workflow: this.workflow(request.workflowId),
        owner: request.owner ?? `fable-${process.pid}`,
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

  public schedulerStatus(): SchedulerStatus {
    return (
      this.#scheduler?.status() ?? {
        running: false,
        activeRuns: 0,
        maxConcurrentRuns: this.#config.value.scheduler.maxConcurrentRuns,
      }
    );
  }

  public async startServices(): Promise<void> {
    if (this.#servicesStarted) return;
    this.#servicesStarted = true;
    await reconcileInterruptedRuns(this.persistence, this.events);
    await this.approvals.reconcileInterrupted();
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
    for (const manifest of await provider.discover(paths)) {
      const contribution = await provider.load(manifest);
      for (const tool of contribution.tools ?? []) this.#tools.register(tool);
      for (const action of contribution.workflowActions ?? []) actions.register(action);
      for (const hook of contribution.hooks ?? []) this.#hooks.register(hook);
    }
    await this.skills.discover(paths);
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
      this.#workflows.set(workflow.definition.id, workflow);
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
