import type { RepositoryCheckpoint } from "../domain/execution.js";

export interface RepositoryCheckpointProvider {
  checkpoint(input: {
    runId: string;
    repositoryId: string;
    workspacePath: string;
    branch: string;
    remote: string;
    message: string;
    executionSpecRevision: number;
    workflowCheckpoint: number;
    signal?: AbortSignal;
  }): Promise<RepositoryCheckpoint>;
  recover(input: {
    checkpoint: RepositoryCheckpoint;
    cloneUrl: string;
    destination: string;
    signal?: AbortSignal;
  }): Promise<string>;
}
