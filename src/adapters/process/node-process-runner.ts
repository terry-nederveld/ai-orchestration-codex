import { spawn } from "node:child_process";
import type { ProcessRequest, ProcessRunner } from "../../ports/process.js";
import type { CommandResult } from "../../ports/source-control.js";

export class NodeProcessRunner implements ProcessRunner {
  public async run(request: ProcessRequest, externalSignal?: AbortSignal): Promise<CommandResult> {
    if (
      request.command.includes("\0") ||
      request.args?.some((argument) => argument.includes("\0"))
    ) {
      throw new Error("Process arguments cannot contain null bytes");
    }
    const started = performance.now();
    const timeout =
      request.timeoutMs === undefined
        ? new AbortController().signal
        : AbortSignal.timeout(request.timeoutMs);
    const signal = AbortSignal.any([externalSignal ?? new AbortController().signal, timeout]);
    const maximum = request.maxOutputBytes ?? 2_000_000;

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(request.command, request.args ?? [], {
        cwd: request.cwd,
        env: childEnvironment(request.env),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let truncated = false;

      const collect = (target: Buffer[], chunk: Buffer, current: number): number => {
        const remaining = maximum - current;
        if (remaining <= 0) {
          truncated = true;
          return current;
        }
        target.push(chunk.subarray(0, remaining));
        if (chunk.length > remaining) truncated = true;
        return current + Math.min(chunk.length, remaining);
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes = collect(stdout, chunk, stdoutBytes);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes = collect(stderr, chunk, stderrBytes);
      });

      const onAbort = () => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      child.once("error", (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code, childSignal) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(signal.reason instanceof Error ? signal.reason : new Error("Process aborted"));
          return;
        }
        const suffix = truncated ? "\n[output truncated]" : "";
        resolve({
          command: request.command,
          args: [...(request.args ?? [])],
          cwd: request.cwd,
          exitCode: code ?? (childSignal === null ? 1 : 128),
          stdout: Buffer.concat(stdout).toString("utf8") + (stdoutBytes >= maximum ? suffix : ""),
          stderr: Buffer.concat(stderr).toString("utf8") + (stderrBytes >= maximum ? suffix : ""),
          durationMs: Math.round(performance.now() - started),
        });
      });

      if (request.stdin !== undefined) child.stdin.end(request.stdin);
      else child.stdin.end();
    });
  }
}

function childEnvironment(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const inheritedNames = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of inheritedNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return { ...environment, ...overrides };
}
