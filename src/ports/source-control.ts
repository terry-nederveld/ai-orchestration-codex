import type { JsonObject } from "../domain/json.js";
import type { Provider } from "./providers.js";

export interface CommandResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PullRequestRequest {
  repository: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
  metadata?: JsonObject;
}

export interface PullRequestResult {
  id: string;
  number: number;
  url: string;
  state: string;
}

export interface SourceControlProvider extends Provider {
  readonly descriptor: Provider["descriptor"] & { kind: "source_control" };
  clone(url: string, destination: string, signal?: AbortSignal): Promise<CommandResult>;
  fetch(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult>;
  status(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult>;
  diff(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult>;
  commit(repositoryPath: string, message: string, signal?: AbortSignal): Promise<CommandResult>;
  push(
    repositoryPath: string,
    remote: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<CommandResult>;
  createPullRequest(request: PullRequestRequest, signal?: AbortSignal): Promise<PullRequestResult>;
}
