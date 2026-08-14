import type { JsonObject } from "../../domain/json.js";
import type { ProcessRunner } from "../../ports/process.js";
import type { ToolDefinition } from "../../ports/tools.js";
import { resolveWorkspacePath } from "./path-sandbox.js";

export class SearchTextTool implements ToolDefinition {
  public readonly name = "search_text";
  public readonly description = "Search workspace text with ripgrep";
  public readonly inputSchema = {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 1000 },
    },
    required: ["pattern"],
    additionalProperties: false,
  } satisfies JsonObject;
  public readonly permissions = ["filesystem.read", "process.execute"] as const;

  public constructor(private readonly runner: ProcessRunner) {}

  public async execute(input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) {
    const pattern = input["pattern"];
    if (typeof pattern !== "string") throw new TypeError("pattern must be a string");
    const requested = typeof input["path"] === "string" ? input["path"] : ".";
    const directory = await resolveWorkspacePath(context.workspacePath, requested);
    const maximum = typeof input["maxResults"] === "number" ? input["maxResults"] : 200;
    const args = ["--line-number", "--color", "never", "--max-count", String(maximum)];
    if (typeof input["glob"] === "string") args.push("--glob", input["glob"]);
    args.push("--", pattern, ".");
    const result = await this.runner.run({ command: "rg", args, cwd: directory }, context.signal);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return { content: result.stderr, isError: true };
    }
    return { content: result.stdout };
  }
}
