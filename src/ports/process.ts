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

export type ProcessOutputEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; result: CommandResult };

export interface StreamingProcessRunner extends ProcessRunner {
  stream(request: ProcessRequest, signal?: AbortSignal): AsyncIterable<ProcessOutputEvent>;
}
