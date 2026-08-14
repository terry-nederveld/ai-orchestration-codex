import type { ProviderDescriptor } from "../../domain/providers.js";
import type {
  CommandResult,
  PullRequestRequest,
  PullRequestResult,
  SourceControlProvider,
} from "../../ports/source-control.js";

export interface SourceControlInvocation {
  operation: string;
  repositoryPath?: string;
  values?: string[];
  pullRequest?: PullRequestRequest;
}

export class InMemorySourceControlProvider implements SourceControlProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "source_control" } = {
    id: "fake-source-control",
    displayName: "In-memory source control",
    kind: "source_control",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  public readonly invocations: SourceControlInvocation[] = [];
  public branch = "fable/test";
  public pullRequest: PullRequestResult = {
    id: "pr-1",
    number: 1,
    url: "https://example.invalid/pull/1",
    state: "open",
  };

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async clone(url: string, destination: string): Promise<CommandResult> {
    this.invocations.push({ operation: "clone", values: [url, destination] });
    return command("clone", destination);
  }

  public async fetch(repositoryPath: string): Promise<CommandResult> {
    return this.record("fetch", repositoryPath);
  }

  public async status(repositoryPath: string): Promise<CommandResult> {
    return this.record("status", repositoryPath);
  }

  public async diff(repositoryPath: string): Promise<CommandResult> {
    return this.record("diff", repositoryPath);
  }

  public async stage(repositoryPath: string, paths = ["."]): Promise<CommandResult> {
    return this.record("stage", repositoryPath, paths);
  }

  public async currentBranch(repositoryPath: string): Promise<string> {
    this.invocations.push({ operation: "currentBranch", repositoryPath });
    return this.branch;
  }

  public async commit(repositoryPath: string, message: string): Promise<CommandResult> {
    return this.record("commit", repositoryPath, [message]);
  }

  public async push(
    repositoryPath: string,
    remote: string,
    branch: string,
  ): Promise<CommandResult> {
    return this.record("push", repositoryPath, [remote, branch]);
  }

  public async createPullRequest(request: PullRequestRequest): Promise<PullRequestResult> {
    this.invocations.push({
      operation: "createPullRequest",
      pullRequest: structuredClone(request),
    });
    return structuredClone(this.pullRequest);
  }

  private record(operation: string, repositoryPath: string, values?: string[]): CommandResult {
    this.invocations.push({
      operation,
      repositoryPath,
      ...(values === undefined ? {} : { values }),
    });
    return command(operation, repositoryPath);
  }
}

function command(operation: string, cwd: string): CommandResult {
  return {
    command: "git",
    args: [operation],
    cwd,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 1,
  };
}
