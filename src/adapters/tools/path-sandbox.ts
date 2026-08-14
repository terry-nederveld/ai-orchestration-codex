import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export async function resolveWorkspacePath(
  workspacePath: string,
  requestedPath: string,
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  const root = await realpath(workspacePath);
  const candidate = resolve(root, requestedPath);
  assertContained(root, candidate);

  if (!(options.allowMissing ?? false)) {
    const resolved = await realpath(candidate);
    assertContained(root, resolved);
    return resolved;
  }

  const existingParent = await nearestExistingParent(dirname(candidate));
  const resolvedParent = await realpath(existingParent);
  assertContained(root, resolvedParent);
  return candidate;
}

export function assertContained(root: string, candidate: string): void {
  const difference = relative(root, candidate);
  if (difference.startsWith("..") || isAbsolute(difference)) {
    throw new Error(`Path escapes workspace: ${candidate}`);
  }
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error(`No existing parent for path: ${path}`);
      current = parent;
    }
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
