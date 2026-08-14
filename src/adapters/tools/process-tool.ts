import type { JsonObject } from "../../domain/json.js";
import type { ProcessRunner } from "../../ports/process.js";
import type { ToolDefinition } from "../../ports/tools.js";
import { resolveWorkspacePath } from "./path-sandbox.js";

export class ProcessTool implements ToolDefinition {
  public readonly name = "run_process";
  public readonly description =
    "Run an executable with an argument array inside the active workspace";
  public readonly inputSchema = {
    type: "object",
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1 },
    },
    required: ["command"],
    additionalProperties: false,
  } satisfies JsonObject;
  public readonly permissions = ["process.execute"] as const;

  public constructor(private readonly runner: ProcessRunner) {}

  public async execute(input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) {
    const command = input["command"];
    if (typeof command !== "string" || command.length === 0) {
      throw new TypeError("command must be a non-empty string");
    }
    const argsValue = input["args"] ?? [];
    if (!Array.isArray(argsValue) || argsValue.some((value) => typeof value !== "string")) {
      throw new TypeError("args must be an array of strings");
    }
    const cwdValue = input["cwd"];
    if (cwdValue !== undefined && typeof cwdValue !== "string") {
      throw new TypeError("cwd must be a string");
    }
    const timeoutValue = input["timeoutMs"];
    if (timeoutValue !== undefined && (typeof timeoutValue !== "number" || timeoutValue <= 0)) {
      throw new TypeError("timeoutMs must be a positive number");
    }
    const cwd = await resolveWorkspacePath(context.workspacePath, cwdValue ?? ".");
    const result = await this.runner.run(
      {
        command,
        args: argsValue as string[],
        cwd,
        ...(timeoutValue === undefined ? {} : { timeoutMs: timeoutValue }),
      },
      context.signal,
    );
    return {
      content: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      },
      isError: result.exitCode !== 0,
    };
  }
}
