import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export async function prepareWorkspaceRoot(path: string): Promise<string> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return realpath(path);
}

export function workspaceDestination(root: string, runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (safe.length === 0) throw new Error("Run id cannot produce an empty workspace key");
  const destination = resolve(root, safe);
  const difference = relative(root, destination);
  if (difference.startsWith("..") || isAbsolute(difference)) {
    throw new Error(`Workspace destination escapes root: ${destination}`);
  }
  return destination;
}

export async function assertManagedWorkspacePath(
  rootPath: string,
  targetPath: string,
): Promise<void> {
  const root = await realpath(rootPath);
  const target = await realpath(targetPath);
  const difference = relative(root, target);
  if (
    difference.length === 0 ||
    difference === ".." ||
    difference.startsWith(`..${sep}`) ||
    isAbsolute(difference)
  ) {
    throw new Error(`Workspace path is not a managed child of its root: ${target}`);
  }
}
