import type { CommandResult } from "./source-control.js";

export interface ProcessRequest {
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ProcessRunner {
  run(request: ProcessRequest, signal?: AbortSignal): Promise<CommandResult>;
}
