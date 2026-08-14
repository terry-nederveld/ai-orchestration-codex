import type { JsonObject } from "../../domain/json.js";
import type { WorkflowAction, WorkflowActionContext } from "../../ports/extensions.js";
import type { PermissionProvider } from "../../ports/security.js";
import type { SourceControlProvider } from "../../ports/source-control.js";

export class CommitAction implements WorkflowAction {
  public readonly id = "source_control.commit";

  public constructor(
    private readonly sourceControl: SourceControlProvider,
    private readonly permissions: PermissionProvider,
  ) {}

  public async execute(context: WorkflowActionContext): Promise<JsonObject> {
    const workspace = requiredWorkspace(context);
    await authorize(this.permissions, context.runId, "git.write", workspace, this.id);
    const message = requiredString(context.inputs, "message");
    const paths = optionalStrings(context.inputs, "paths") ?? ["."];
    const stage = await this.sourceControl.stage(workspace, paths, context.signal);
    if (stage.exitCode !== 0) throw new Error(`Git stage failed: ${stage.stderr}`);
    const commit = await this.sourceControl.commit(workspace, message, context.signal);
    if (commit.exitCode !== 0)
      throw new Error(`Git commit failed: ${commit.stderr || commit.stdout}`);
    return { exitCode: commit.exitCode, stdout: commit.stdout, durationMs: commit.durationMs };
  }
}

export class PushAction implements WorkflowAction {
  public readonly id = "source_control.push";

  public constructor(
    private readonly sourceControl: SourceControlProvider,
    private readonly permissions: PermissionProvider,
  ) {}

  public async execute(context: WorkflowActionContext): Promise<JsonObject> {
    const workspace = requiredWorkspace(context);
    await authorize(this.permissions, context.runId, "git.write", workspace, this.id);
    const remote = optionalString(context.inputs, "remote") ?? "origin";
    const branch =
      optionalString(context.inputs, "branch") ??
      (await this.sourceControl.currentBranch(workspace, context.signal));
    const result = await this.sourceControl.push(workspace, remote, branch, context.signal);
    if (result.exitCode !== 0) throw new Error(`Git push failed: ${result.stderr}`);
    return { branch, remote, stdout: result.stdout, durationMs: result.durationMs };
  }
}

export class PullRequestAction implements WorkflowAction {
  public readonly id = "source_control.pull_request";

  public constructor(
    private readonly sourceControl: SourceControlProvider,
    private readonly permissions: PermissionProvider,
  ) {}

  public async execute(context: WorkflowActionContext): Promise<JsonObject> {
    const repository = requiredString(context.inputs, "repository");
    await authorize(this.permissions, context.runId, "issue.write", repository, this.id);
    const workspace = requiredWorkspace(context);
    const head =
      optionalString(context.inputs, "head") ??
      (await this.sourceControl.currentBranch(workspace, context.signal));
    const result = await this.sourceControl.createPullRequest(
      {
        repository,
        head,
        base: optionalString(context.inputs, "base") ?? "main",
        title: requiredString(context.inputs, "title"),
        body: optionalString(context.inputs, "body") ?? "",
        draft: context.inputs["draft"] !== false,
      },
      context.signal,
    );
    return { id: result.id, number: result.number, url: result.url, state: result.state };
  }
}

async function authorize(
  permissions: PermissionProvider,
  runId: string,
  capability: "git.write" | "issue.write",
  resource: string,
  operation: string,
): Promise<void> {
  const evaluation = await permissions.evaluate({ capability, resource, operation, runId });
  if (evaluation.decision !== "allow" && evaluation.decision !== "sandbox-only") {
    throw new Error(`${operation} ${evaluation.decision}: ${evaluation.reason}`);
  }
}

function requiredWorkspace(context: WorkflowActionContext): string {
  if (context.workspacePath === undefined)
    throw new Error("Source-control action requires a workspace");
  return context.workspacePath;
}

function requiredString(values: JsonObject, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${key} must be a string`);
  return value;
}

function optionalString(values: JsonObject, key: string): string | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${key} must be a string`);
  return value;
}

function optionalStrings(values: JsonObject, key: string): string[] | undefined {
  const value = values[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${key} must be an array of strings`);
  }
  return value as string[];
}
