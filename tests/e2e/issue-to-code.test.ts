import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "../../src/adapters/fakes/model-provider.js";
import { InMemoryWorkProvider } from "../../src/adapters/fakes/work-provider.js";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { NodeProcessRunner } from "../../src/adapters/process/node-process-runner.js";
import { InMemorySecretProvider } from "../../src/adapters/security/in-memory-secrets.js";
import { GitHubSourceControlProvider } from "../../src/adapters/source-control/github-source-control.js";
import {
  ListFilesTool,
  ReadFileTool,
  WriteFileTool,
} from "../../src/adapters/tools/filesystem-tools.js";
import { ProcessTool } from "../../src/adapters/tools/process-tool.js";
import { GitWorktreeWorkspaceProvider } from "../../src/adapters/workspace/git-worktree.js";
import { CommitAction } from "../../src/application/actions/source-control-actions.js";
import { SlidingWindowContextManager } from "../../src/application/agent/context-manager.js";
import { NativeAgentRuntime } from "../../src/application/agent/native-runtime.js";
import { InMemoryEventBus } from "../../src/application/event-bus.js";
import { HookRegistry } from "../../src/application/hooks.js";
import { Orchestrator } from "../../src/application/orchestrator.js";
import { PersistedEventBus } from "../../src/application/persisted-event-bus.js";
import { RuleBasedPermissionProvider } from "../../src/application/policy-engine.js";
import { ProviderRegistry } from "../../src/application/provider-registry.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { WorkflowActionRegistry } from "../../src/application/workflows/action-registry.js";
import {
  ActionStepHandler,
  AgentStepHandler,
  CommandStepHandler,
} from "../../src/application/workflows/builtin-handlers.js";
import { compileWorkflow } from "../../src/application/workflows/compiler.js";
import { WorkflowEngine } from "../../src/application/workflows/engine.js";
import { WorkflowStepHandlerRegistry } from "../../src/application/workflows/handler-registry.js";
import type { AgentProvider, ModelProvider, WorkProvider } from "../../src/ports/providers.js";
import type { WorkspaceProvider } from "../../src/ports/workspace.js";

const temporaryPaths: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("autonomous issue-to-code workflow", () => {
  it("claims an issue, isolates a worktree, edits, tests, reviews, commits, delivers, and transitions", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "fable-e2e-"));
    temporaryPaths.push(fixture);
    const repository = join(fixture, "repository");
    const worktrees = join(fixture, "worktrees");
    const runner = new NodeProcessRunner();
    await runGit(runner, fixture, ["init", "--initial-branch=main", repository]);
    await runGit(runner, repository, ["config", "user.name", "Fable Test"]);
    await runGit(runner, repository, ["config", "user.email", "test@example.test"]);
    await writeFile(join(repository, "README.md"), "# Fixture\n");
    await runGit(runner, repository, ["add", "."]);
    await runGit(runner, repository, ["commit", "-m", "chore: initialize fixture"]);

    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const events = new PersistedEventBus(new InMemoryEventBus(), persistence.events);
    const permissions = new RuleBasedPermissionProvider([{ capability: "*", decision: "allow" }]);
    const tools = new ToolRegistry();
    tools.register(new ReadFileTool());
    tools.register(new WriteFileTool());
    tools.register(new ListFilesTool());
    tools.register(new ProcessTool(runner));

    const scriptedModel = new ScriptedModelProvider([
      [
        {
          type: "tool_call",
          name: "write_file",
          arguments: { path: "result.txt", content: "implemented\n" },
        },
        { type: "usage", usage: { inputTokens: 20, outputTokens: 5 } },
        { type: "complete" },
      ],
      [{ type: "complete", text: "Implementation validated. GOAL_COMPLETED" }],
      [
        { type: "tool_call", name: "read_file", arguments: { path: "result.txt" } },
        { type: "complete" },
      ],
      [{ type: "complete", text: "Review passed. GOAL_COMPLETED" }],
    ]);
    const modelProviders = new ProviderRegistry<ModelProvider>();
    modelProviders.register(scriptedModel);
    const nativeRuntime = new NativeAgentRuntime(
      modelProviders,
      tools,
      permissions,
      events,
      new SlidingWindowContextManager(),
      persistence,
    );
    const agentProviders = new ProviderRegistry<AgentProvider>();

    const sourceControl = new GitHubSourceControlProvider(
      runner,
      new InMemorySecretProvider(),
      events,
    );
    const actions = new WorkflowActionRegistry();
    actions.register(new CommitAction(sourceControl, permissions));
    actions.register({
      id: "test.pull_request",
      execute: async () => ({ number: 1, url: "https://example.test/pull/1", state: "open" }),
    });
    const handlers = new WorkflowStepHandlerRegistry();
    handlers.register(new AgentStepHandler(nativeRuntime, agentProviders));
    handlers.register(new CommandStepHandler(runner, permissions));
    handlers.register(new ActionStepHandler(actions));

    const workflow = compileWorkflow({
      schemaVersion: 1,
      id: "software-development",
      name: "Software development",
      trigger: { states: ["Ready"] },
      eligibility: { includeLabels: ["agent-ready"], excludeLabels: ["blocked"] },
      workspace: { strategy: "git-worktree", retainOnFailure: true },
      budgets: { maxIterations: 6, maxInputTokens: 10_000 },
      agents: {
        coder: { provider: "fake-model", model: "scripted", requiredCapabilities: ["tool_use"] },
        reviewer: { provider: "fake-model", model: "scripted", requiredCapabilities: ["tool_use"] },
      },
      steps: [
        {
          id: "implement",
          type: "agent",
          agent: "coder",
          goal: "Implement ${{ work.title }} completely.",
        },
        {
          id: "test",
          type: "command",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('node:fs'); if(fs.readFileSync('result.txt','utf8')!=='implemented\\n') process.exit(1)",
          ],
          dependsOn: ["implement"],
        },
        {
          id: "review",
          type: "agent",
          agent: "reviewer",
          goal: "Independently review the implementation and tests.",
          dependsOn: ["implement"],
        },
        {
          id: "commit",
          type: "action",
          action: "source_control.commit",
          input: { message: "feat(fixture): implement requested result" },
          dependsOn: ["test", "review"],
        },
        {
          id: "deliver",
          type: "action",
          action: "test.pull_request",
          input: {},
          dependsOn: ["commit"],
        },
      ],
      transitions: { success: "Done", failure: "Agent Failed" },
    });

    const workProvider = new InMemoryWorkProvider([
      {
        id: "fake:ISSUE-1",
        provider: "fake-work",
        externalId: "ISSUE-1",
        title: "create the result artifact",
        description: "Create result.txt with the required content.",
        state: "Ready",
        labels: ["agent-ready"],
        assignees: [],
        relationships: [],
        repository: { id: "fixture", cloneUrl: repository, localPath: repository },
        metadata: {},
      },
    ]);
    const workProviders = new ProviderRegistry<WorkProvider>();
    workProviders.register(workProvider);
    const workspaceProviders = new ProviderRegistry<WorkspaceProvider>();
    workspaceProviders.register(new GitWorktreeWorkspaceProvider(runner, worktrees));
    const orchestrator = new Orchestrator(
      workProviders,
      workspaceProviders,
      {
        "git-worktree": "git-worktree",
        clone: "clone-workspace",
        local: "local-workspace",
        temporary: "temporary-workspace",
      },
      new WorkflowEngine(handlers, events, persistence),
      persistence,
      events,
      new HookRegistry(),
    );

    const result = await orchestrator.run({
      workProviderId: "fake-work",
      externalId: "ISSUE-1",
      workflow,
      owner: "e2e-worker",
    });

    expect(result.error).toBeUndefined();
    expect(result.run).toMatchObject({ status: "COMPLETED", outcome: "GOAL_COMPLETED" });
    expect(result.workflow?.status).toBe("SUCCEEDED");
    expect(result.run.usage.inputTokens).toBe(20);
    expect(await workProvider.get("ISSUE-1")).toMatchObject({ state: "Done" });
    expect(result.workspace?.branchName).toBeDefined();
    const committedFile = await runGit(
      runner,
      repository,
      ["show", `${result.workspace!.branchName}:result.txt`],
      true,
    );
    expect(committedFile.stdout).toBe("implemented\n");
    const log = await runGit(
      runner,
      repository,
      ["log", "-1", "--format=%s", result.workspace!.branchName!],
      true,
    );
    expect(log.stdout.trim()).toBe("feat(fixture): implement requested result");
    await expect(persistence.claims.get("fake-work", "ISSUE-1")).resolves.toBeUndefined();
    const persistedEvents = await persistence.events.list({ runId: result.run.id });
    expect(persistedEvents.map(({ type }) => type)).toContain("workflow.completed");
  });
});

async function runGit(
  runner: NodeProcessRunner,
  cwd: string,
  args: string[],
  returnResult = false,
) {
  const result = await runner.run({ command: "git", args, cwd });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return returnResult ? result : result;
}
