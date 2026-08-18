import type { AppliedInstruction, ResolvedContextItem } from "../domain/execution.js";
import type { WorkItem } from "../domain/work.js";

export interface InstructionDiscoveryRequest {
  repositoryRoot: string;
  targetPath?: string;
}

export interface InstructionProvider {
  readonly id: string;
  discover(request: InstructionDiscoveryRequest): Promise<AppliedInstruction[]>;
}

export interface WorkGraphProvider {
  get(id: string, signal?: AbortSignal): Promise<WorkItem | undefined>;
}

export interface ContextResolver {
  readonly id: string;
  resolve(input: { workItem: WorkItem; signal?: AbortSignal }): Promise<ResolvedContextItem[]>;
}
