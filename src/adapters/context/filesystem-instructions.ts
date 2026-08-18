import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AppliedInstruction } from "../../domain/execution.js";
import type { InstructionDiscoveryRequest, InstructionProvider } from "../../ports/context.js";
import { contentDigest } from "../../application/versioned-assets.js";

const scopedNames = [".github/copilot-instructions.md", "CLAUDE.md", "AGENT.md", "AGENTS.md"];

export class FilesystemInstructionProvider implements InstructionProvider {
  public readonly id = "filesystem";

  public constructor(private readonly options: { maxFileBytes?: number; trusted?: boolean } = {}) {}

  public async discover(request: InstructionDiscoveryRequest): Promise<AppliedInstruction[]> {
    const root = await realpath(request.repositoryRoot);
    const target = await resolveTarget(root, request.targetPath);
    assertWithin(root, target);
    const directories = scopedDirectories(root, target);
    const results: AppliedInstruction[] = [];
    for (const [depth, directory] of directories.entries()) {
      for (const [namePriority, name] of scopedNames.entries()) {
        if (name.startsWith(".github/") && directory !== root) continue;
        const candidate = join(directory, name);
        if (!(await exists(candidate))) continue;
        const resolved = await realpath(candidate);
        assertWithin(root, resolved);
        const information = await stat(resolved);
        if (information.size > (this.options.maxFileBytes ?? 128_000)) {
          throw new Error(`Instruction file exceeds size limit: ${candidate}`);
        }
        const content = await readFile(resolved, "utf8");
        results.push({
          id: `${this.id}:${relative(root, resolved) || name}`,
          path: resolved,
          scope: directory,
          provider: this.id,
          precedence: depth * 100 + namePriority,
          digest: contentDigest(content),
          content,
          trusted: this.options.trusted ?? false,
        });
      }
    }
    return results;
  }
}

async function resolveTarget(root: string, targetPath?: string): Promise<string> {
  if (targetPath === undefined) return root;
  const target = isAbsolute(targetPath) ? targetPath : resolve(root, targetPath);
  try {
    const information = await stat(target);
    return information.isDirectory() ? realpath(target) : realpath(dirname(target));
  } catch {
    return dirname(target);
  }
}

function scopedDirectories(root: string, target: string): string[] {
  const difference = relative(root, target);
  if (difference === "") return [root];
  const segments = difference.split(sep).filter(Boolean);
  return [root, ...segments.map((_, index) => join(root, ...segments.slice(0, index + 1)))];
}

function assertWithin(root: string, candidate: string): void {
  const difference = relative(root, candidate);
  if (difference.startsWith("..") || isAbsolute(difference)) {
    throw new Error(`Instruction path escapes repository root: ${candidate}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
