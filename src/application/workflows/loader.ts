import { realpath, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parse } from "yaml";
import { ConfigurationError } from "../../domain/errors.js";
import type { JsonObject } from "../../domain/json.js";
import { compileWorkflow, mergeWorkflowDocuments, type CompiledWorkflow } from "./compiler.js";

export async function loadWorkflow(
  path: string,
  allowedRoot = dirname(path),
): Promise<CompiledWorkflow> {
  const root = await realpath(allowedRoot);
  const visited = new Set<string>();
  const { document, fragments } = await loadDocument(path, root, visited);
  return compileWorkflow(mergeWorkflowDocuments(document, fragments));
}

async function loadDocument(
  path: string,
  root: string,
  visited: Set<string>,
): Promise<{ document: JsonObject; fragments: JsonObject[] }> {
  const resolved = await realpath(resolve(path));
  assertWithinRoot(resolved, root);
  if (visited.has(resolved)) throw new ConfigurationError(`Workflow include cycle: ${resolved}`);
  visited.add(resolved);

  try {
    const raw = parse(await readFile(resolved, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ConfigurationError(`Workflow document must be an object: ${resolved}`);
    }
    const document = raw as JsonObject;
    const includes = document["includes"];
    if (
      includes !== undefined &&
      (!Array.isArray(includes) || includes.some((item) => typeof item !== "string"))
    ) {
      throw new ConfigurationError(`Workflow includes must be string paths: ${resolved}`);
    }

    const fragments: JsonObject[] = [];
    for (const include of (includes ?? []) as string[]) {
      if (isAbsolute(include))
        throw new ConfigurationError(`Workflow include must be relative: ${include}`);
      const loaded = await loadDocument(resolve(dirname(resolved), include), root, visited);
      fragments.push(loaded.document, ...loaded.fragments);
    }
    return { document, fragments };
  } finally {
    visited.delete(resolved);
  }
}

function assertWithinRoot(path: string, root: string): void {
  const difference = relative(root, path);
  if (difference.startsWith("..") || isAbsolute(difference)) {
    throw new ConfigurationError(`Workflow include escapes allowed root: ${path}`);
  }
}
