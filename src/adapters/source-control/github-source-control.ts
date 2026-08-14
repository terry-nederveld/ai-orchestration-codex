import type { ProviderDescriptor } from "../../domain/providers.js";
import { ProviderError } from "../../domain/errors.js";
import type { EventBus } from "../../ports/event-bus.js";
import type { ProcessRunner } from "../../ports/process.js";
import type { SecretProvider } from "../../ports/security.js";
import type {
  CommandResult,
  PullRequestRequest,
  PullRequestResult,
  SourceControlProvider,
} from "../../ports/source-control.js";
import { EventFactory } from "../../application/events.js";
import { validateCommitMessage } from "./conventional-commit.js";

interface GitHubPullResponse {
  id: number;
  number: number;
  html_url: string;
  state: string;
}

export interface GitHubSourceControlOptions {
  apiBaseUrl?: string;
  tokenReference?: string;
  enforceConventionalCommits?: boolean;
}

export class GitHubSourceControlProvider implements SourceControlProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "source_control" } = {
    id: "github-git",
    displayName: "Git and GitHub",
    kind: "source_control",
    version: "1.0.0",
    capabilities: [],
    authentication: ["api_key", "oauth", "cli_session"],
  };

  readonly #apiBaseUrl: string;
  readonly #tokenReference: string;
  readonly #enforceConventionalCommits: boolean;

  public constructor(
    private readonly runner: ProcessRunner,
    private readonly secrets: SecretProvider,
    private readonly events?: EventBus,
    options: GitHubSourceControlOptions = {},
  ) {
    this.#apiBaseUrl = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.#tokenReference = options.tokenReference ?? "github.token";
    this.#enforceConventionalCommits = options.enforceConventionalCommits ?? true;
  }

  public async availability(signal?: AbortSignal) {
    try {
      const git = await this.runner.run(
        { command: "git", args: ["--version"], cwd: process.cwd() },
        signal,
      );
      const authenticated = (await this.secrets.get(this.#tokenReference)) !== undefined;
      return {
        installed: git.exitCode === 0,
        authenticated,
        available: git.exitCode === 0,
        detail: authenticated
          ? "GitHub API authenticated"
          : "Git is available; GitHub API token is not configured",
      };
    } catch (error) {
      return {
        installed: false,
        authenticated: false,
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public clone(url: string, destination: string, signal?: AbortSignal): Promise<CommandResult> {
    return this.git(process.cwd(), ["clone", "--", url, destination], signal);
  }

  public fetch(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult> {
    return this.git(repositoryPath, ["fetch", "--all", "--prune"], signal);
  }

  public status(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult> {
    return this.git(repositoryPath, ["status", "--porcelain=v2", "--branch"], signal);
  }

  public diff(repositoryPath: string, signal?: AbortSignal): Promise<CommandResult> {
    return this.git(repositoryPath, ["diff", "--no-ext-diff", "--binary"], signal);
  }

  public stage(
    repositoryPath: string,
    paths: string[] = ["."],
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    return this.git(repositoryPath, ["add", "--", ...paths], signal);
  }

  public async currentBranch(repositoryPath: string, signal?: AbortSignal): Promise<string> {
    const result = await this.git(repositoryPath, ["branch", "--show-current"], signal);
    if (result.exitCode !== 0) throw new Error(`Unable to read current branch: ${result.stderr}`);
    return result.stdout.trim();
  }

  public async commit(
    repositoryPath: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    if (this.#enforceConventionalCommits) validateCommitMessage(message);
    return this.git(repositoryPath, ["commit", "-m", message], signal);
  }

  public push(
    repositoryPath: string,
    remote: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    return this.git(repositoryPath, ["push", "--set-upstream", remote, branch], signal);
  }

  public async createPullRequest(
    request: PullRequestRequest,
    signal?: AbortSignal,
  ): Promise<PullRequestResult> {
    const [owner, repository, extra] = request.repository.split("/");
    if (owner === undefined || repository === undefined || extra !== undefined) {
      throw new Error("GitHub repository must have the form owner/name");
    }
    const token = await this.secrets.get(this.#tokenReference);
    if (token === undefined)
      throw new ProviderError("GitHub authentication is not configured", false);
    const response = await fetch(
      `${this.#apiBaseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          title: request.title,
          body: request.body,
          head: request.head,
          base: request.base,
          draft: request.draft ?? true,
        }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (!response.ok) {
      throw new ProviderError(
        `GitHub pull request failed (${response.status}): ${await boundedResponse(response)}`,
        response.status === 429 || response.status >= 500,
      );
    }
    const body = (await response.json()) as GitHubPullResponse;
    const result = {
      id: String(body.id),
      number: body.number,
      url: body.html_url,
      state: body.state,
    };
    await this.events?.publish(
      new EventFactory({ source: "github-source-control" }).create("pull_request.created", result),
    );
    return result;
  }

  private async git(cwd: string, args: string[], signal?: AbortSignal): Promise<CommandResult> {
    await this.events?.publish(
      new EventFactory({ source: "github-source-control" }).create(
        "source_control.command.started",
        {
          command: "git",
          args,
          cwd,
        },
      ),
    );
    const result = await this.runner.run({ command: "git", args, cwd, timeoutMs: 600_000 }, signal);
    await this.events?.publish(
      new EventFactory({ source: "github-source-control" }).create(
        "source_control.command.completed",
        {
          command: "git",
          args,
          cwd,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
      ),
    );
    return result;
  }
}

async function boundedResponse(response: Response): Promise<string> {
  return (await response.text()).slice(0, 8_000);
}
