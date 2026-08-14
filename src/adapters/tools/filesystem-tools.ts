import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type { JsonObject } from "../../domain/json.js";
import type { ToolDefinition } from "../../ports/tools.js";
import { resolveWorkspacePath } from "./path-sandbox.js";

export class ReadFileTool implements ToolDefinition {
  public readonly name = "read_file";
  public readonly description = "Read a UTF-8 file inside the active workspace";
  public readonly inputSchema = {
    type: "object",
    properties: { path: { type: "string" }, maxBytes: { type: "integer", minimum: 1 } },
    required: ["path"],
    additionalProperties: false,
  } satisfies JsonObject;
  public readonly permissions = ["filesystem.read"] as const;

  public async execute(input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) {
    const path = requiredString(input, "path");
    const maximum = optionalPositiveInteger(input, "maxBytes") ?? 1_000_000;
    const resolved = await resolveWorkspacePath(context.workspacePath, path);
    const buffer = await readFile(resolved);
    if (buffer.length > maximum) throw new Error(`File exceeds ${maximum} bytes: ${path}`);
    return { content: buffer.toString("utf8"), metadata: { bytes: buffer.length, path } };
  }
}

export class WriteFileTool implements ToolDefinition {
  public readonly name = "write_file";
  public readonly description = "Atomically write a UTF-8 file inside the active workspace";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      createDirectories: { type: "boolean" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  } satisfies JsonObject;
  public readonly permissions = ["filesystem.write"] as const;

  public async execute(input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) {
    const path = requiredString(input, "path");
    const content = requiredString(input, "content");
    const resolved = await resolveWorkspacePath(context.workspacePath, path, {
      allowMissing: true,
    });
    if (input["createDirectories"] === true) await mkdir(dirname(resolved), { recursive: true });
    const temporary = join(dirname(resolved), `.${basename(resolved)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, resolved);
    } finally {
      await rm(temporary, { force: true });
    }
    return { content: { path, bytes: Buffer.byteLength(content) } };
  }
}

export class ListFilesTool implements ToolDefinition {
  public readonly name = "list_files";
  public readonly description = "List files under a directory in the active workspace";
  public readonly inputSchema = {
    type: "object",
    properties: {
      path: { type: "string" },
      recursive: { type: "boolean" },
      maxEntries: { type: "integer", minimum: 1, maximum: 10000 },
    },
    additionalProperties: false,
  } satisfies JsonObject;
  public readonly permissions = ["filesystem.read"] as const;

  public async execute(input: JsonObject, context: Parameters<ToolDefinition["execute"]>[1]) {
    const requested = typeof input["path"] === "string" ? input["path"] : ".";
    const root = await resolveWorkspacePath(context.workspacePath, requested);
    const recursive = input["recursive"] === true;
    const maximum = optionalPositiveInteger(input, "maxEntries") ?? 1_000;
    const entries: string[] = [];
    await walk(root, root, recursive, maximum, entries, context.signal);
    return { content: entries };
  }
}

async function walk(
  root: string,
  directory: string,
  recursive: boolean,
  maximum: number,
  output: string[],
  signal: AbortSignal,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    signal.throwIfAborted();
    if (output.length >= maximum) return;
    const path = join(directory, entry.name);
    output.push(relative(root, path) || entry.name);
    if (recursive && entry.isDirectory() && !entry.isSymbolicLink()) {
      await walk(root, path, recursive, maximum, output, signal);
    }
  }
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string`);
  return value;
}

function optionalPositiveInteger(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${key} must be a positive integer`);
  }
  return value;
}
