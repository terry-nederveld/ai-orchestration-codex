import type { AgentRuntime } from "../../ports/agent-runtime.js";
import type { ProcessRunner } from "../../ports/process.js";
import type { AgentProvider } from "../../ports/providers.js";
import type { ApprovalProvider, PermissionProvider } from "../../ports/security.js";
import type { ToolProvider, ToolResult } from "../../ports/tools.js";
import type { WorkflowStepContext, WorkflowStepHandler } from "../../ports/workflow.js";
import type {
  ActionWorkflowStep,
  AgentWorkflowStep,
  ApprovalWorkflowStep,
  CommandWorkflowStep,
  ToolWorkflowStep,
  WorkflowStep,
} from "../../domain/workflows.js";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import type { GoalOutcome, Usage } from "../../domain/providers.js";
import type { ProviderRegistry } from "../provider-registry.js";
import { resolveWorkspacePath } from "../../adapters/tools/path-sandbox.js";
import { StepExecutionError } from "./engine.js";
import { interpolate } from "./expressions.js";
import type { WorkflowActionRegistry } from "./action-registry.js";

export class AgentStepHandler implements WorkflowStepHandler {
  public readonly type = "agent" as const;

  public constructor(
    private readonly nativeRuntime: AgentRuntime,
    private readonly agentProviders: ProviderRegistry<AgentProvider>,
  ) {}

  public async execute(stepValue: WorkflowStep, context: WorkflowStepContext) {
    const step = stepValue as AgentWorkflowStep;
    const role = context.workflow.agents[step.agent];
    if (role === undefined) throw new StepExecutionError(`Unknown agent role: ${step.agent}`);
    const goal = interpolate(step.goal, context.expressionContext);
    const agentProvider =
      role.provider === undefined ? undefined : this.agentProviders.get(role.provider);

    if (agentProvider !== undefined) {
      let outcome: GoalOutcome | undefined;
      let summary = "";
      let sessionId: string | undefined;
      const usage: Usage = { inputTokens: 0, outputTokens: 0 };
      for await (const event of agentProvider.run(
        {
          goal,
          workspacePath: requiredWorkspace(context),
          ...(role.model === undefined ? {} : { model: role.model }),
          metadata: { runId: context.runId, role: step.agent },
        },
        context.signal,
      )) {
        if (event.type === "completed") {
          outcome = event.outcome;
          summary = event.summary ?? summary;
        } else if (event.type === "message") summary += event.text;
        else if (event.type === "session") sessionId = event.sessionId;
        else if (event.type === "usage") addUsage(usage, event.usage);
        else if (event.type === "error" && !event.retryable) {
          throw new StepExecutionError(event.error);
        }
      }
      if (outcome !== "GOAL_COMPLETED") {
        throw new StepExecutionError(
          `Agent ${step.agent} ended with ${outcome ?? "no outcome"}: ${summary}`,
        );
      }
      return {
        output: {
          outcome,
          summary,
          usage: toJson(usage),
          ...(sessionId === undefined ? {} : { sessionId }),
        },
      };
    }

    const result = await this.nativeRuntime.run(
      {
        runId: context.runId,
        goal,
        workspacePath: requiredWorkspace(context),
        ...(role.provider === undefined ? {} : { providerId: role.provider }),
        model: role.model ?? "auto",
        requiredCapabilities: role.requiredCapabilities,
        ...(role.instructions === undefined ? {} : { systemPrompt: role.instructions }),
        budgets: context.workflow.budgets,
        metadata: { role: step.agent },
      },
      context.signal,
    );
    if (result.outcome !== "GOAL_COMPLETED") {
      throw new StepExecutionError(
        `Agent ${step.agent} ended with ${result.outcome}: ${result.summary}`,
      );
    }
    return {
      output: {
        outcome: result.outcome,
        summary: result.summary,
        sessionId: result.sessionId,
        usage: toJson(result.usage),
        turns: result.turns,
        toolCalls: result.toolCalls,
      },
    };
  }
}

export class CommandStepHandler implements WorkflowStepHandler {
  public readonly type = "command" as const;

  public constructor(
    private readonly runner: ProcessRunner,
    private readonly permissions: PermissionProvider,
  ) {}

  public async execute(stepValue: WorkflowStep, context: WorkflowStepContext) {
    const step = stepValue as CommandWorkflowStep;
    const command = interpolate(step.command, context.expressionContext);
    const permission = await this.permissions.evaluate({
      capability: "process.execute",
      resource: command,
      operation: "workflow.command",
      runId: context.runId,
    });
    if (permission.decision !== "allow" && permission.decision !== "sandbox-only") {
      throw new StepExecutionError(
        `Process execution ${permission.decision}: ${permission.reason}`,
      );
    }
    const cwd = await resolveWorkspacePath(
      requiredWorkspace(context),
      step.cwd === undefined ? "." : interpolate(step.cwd, context.expressionContext),
    );
    const result = await this.runner.run(
      {
        command,
        args: interpolate(step.args, context.expressionContext),
        cwd,
        env: interpolate(step.env, context.expressionContext),
        ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
      },
      context.signal,
    );
    if (!step.expectedExitCodes.includes(result.exitCode)) {
      throw new StepExecutionError(
        `Command exited with ${result.exitCode}: ${result.stderr || result.stdout}`,
      );
    }
    return {
      output: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      },
    };
  }
}

export class ToolStepHandler implements WorkflowStepHandler {
  public readonly type = "tool" as const;

  public constructor(
    private readonly tools: ToolProvider,
    private readonly permissions: PermissionProvider,
  ) {}

  public async execute(stepValue: WorkflowStep, context: WorkflowStepContext) {
    const step = stepValue as ToolWorkflowStep;
    const tool = this.tools.get(step.tool);
    if (tool === undefined) throw new StepExecutionError(`Unknown tool: ${step.tool}`);
    const input = interpolate(step.input, context.expressionContext);
    const resource = inferResource(input, tool.name);
    for (const capability of tool.permissions) {
      const permission = await this.permissions.evaluate({
        capability,
        resource,
        operation: tool.name,
        runId: context.runId,
      });
      if (permission.decision !== "allow" && permission.decision !== "sandbox-only") {
        throw new StepExecutionError(
          `Tool permission ${permission.decision}: ${permission.reason}`,
        );
      }
    }
    const result = await tool.execute(input, {
      runId: context.runId,
      workspacePath: requiredWorkspace(context),
      signal: context.signal,
      metadata: {},
    });
    assertToolSuccess(result, tool.name);
    return { output: result.content };
  }
}

export class ActionStepHandler implements WorkflowStepHandler {
  public readonly type = "action" as const;

  public constructor(private readonly actions: WorkflowActionRegistry) {}

  public async execute(stepValue: WorkflowStep, context: WorkflowStepContext) {
    const step = stepValue as ActionWorkflowStep;
    const result = await this.actions.require(step.action).execute({
      runId: context.runId,
      ...(context.workspacePath === undefined ? {} : { workspacePath: context.workspacePath }),
      inputs: interpolate(step.input, context.expressionContext),
      signal: context.signal,
    });
    return { output: result };
  }
}

export class ApprovalStepHandler implements WorkflowStepHandler {
  public readonly type = "approval" as const;

  public constructor(private readonly approvals: ApprovalProvider) {}

  public async execute(stepValue: WorkflowStep, context: WorkflowStepContext) {
    const step = stepValue as ApprovalWorkflowStep;
    const decision = await this.approvals.request({
      runId: context.runId,
      title: interpolate(step.title, context.expressionContext),
      description: interpolate(step.description, context.expressionContext),
      ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    });
    if (decision !== "approved") throw new StepExecutionError(`Approval ${decision}`);
    return { output: { decision } };
  }
}

function requiredWorkspace(context: WorkflowStepContext): string {
  if (context.workspacePath === undefined)
    throw new StepExecutionError("Step requires a workspace");
  return context.workspacePath;
}

function inferResource(input: JsonObject, fallback: string): string {
  for (const key of ["path", "url", "command", "resource"]) {
    if (typeof input[key] === "string") return input[key];
  }
  return fallback;
}

function assertToolSuccess(result: ToolResult, name: string): void {
  if (result.isError === true)
    throw new StepExecutionError(`Tool ${name} failed: ${JSON.stringify(result.content)}`);
}

function addUsage(target: Usage, value: Usage): void {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.estimatedCostUsd = (target.estimatedCostUsd ?? 0) + (value.estimatedCostUsd ?? 0);
  target.subscriptionRequests =
    (target.subscriptionRequests ?? 0) + (value.subscriptionRequests ?? 0);
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
