import { spawn } from "node:child_process";
import type {
  ProcessOutputEvent,
  ProcessRequest,
  StreamingProcessRunner,
} from "../../ports/process.js";
import type { CommandResult } from "../../ports/source-control.js";

export class NodeProcessRunner implements StreamingProcessRunner {
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

  public async *stream(
    request: ProcessRequest,
    externalSignal?: AbortSignal,
  ): AsyncIterable<ProcessOutputEvent> {
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
    const events = new ProcessEventQueue();
    const child = spawn(request.command, request.args ?? [], {
      cwd: request.cwd,
      env: childEnvironment(request.env),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let truncated = false;

    const collect = (target: Buffer[], chunk: Buffer, type: "stdout" | "stderr") => {
      const remaining = maximum - outputBytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      outputBytes += accepted.length;
      target.push(accepted);
      events.push({ type, data: accepted.toString("utf8") });
      if (chunk.length > remaining) truncated = true;
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk, "stderr"));

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => events.fail(error));
    child.once("close", (code, childSignal) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        events.fail(signal.reason instanceof Error ? signal.reason : new Error("Process aborted"));
        return;
      }
      const suffix = truncated ? "\n[output truncated]" : "";
      events.push({
        type: "exit",
        result: {
          command: request.command,
          args: [...(request.args ?? [])],
          cwd: request.cwd,
          exitCode: code ?? (childSignal === null ? 1 : 128),
          stdout: Buffer.concat(stdout).toString("utf8") + suffix,
          stderr: Buffer.concat(stderr).toString("utf8") + suffix,
          durationMs: Math.round(performance.now() - started),
        },
      });
      events.end();
    });
    if (request.stdin !== undefined) child.stdin.end(request.stdin);
    else child.stdin.end();
    yield* events;
  }
}

class ProcessEventQueue implements AsyncIterable<ProcessOutputEvent> {
  readonly #events: ProcessOutputEvent[] = [];
  readonly #waiters: Array<() => void> = [];
  #ended = false;
  #error: Error | undefined;

  public push(event: ProcessOutputEvent): void {
    if (this.#ended) return;
    this.#events.push(event);
    this.#wake();
  }

  public end(): void {
    this.#ended = true;
    this.#wake();
  }

  public fail(error: unknown): void {
    this.#error = error instanceof Error ? error : new Error(String(error));
    this.#ended = true;
    this.#wake();
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<ProcessOutputEvent> {
    while (true) {
      const event = this.#events.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      if (this.#ended) {
        if (this.#error !== undefined) throw this.#error;
        return;
      }
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  #wake(): void {
    for (const waiter of this.#waiters.splice(0)) waiter();
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
