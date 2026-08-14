import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import YAML from "yaml";
import type { JsonObject } from "../../domain/json.js";
import type { SkillDocument, SkillMetadata, SkillProvider } from "../../ports/extensions.js";

export class FilesystemSkillProvider implements SkillProvider {
  readonly #skills = new Map<string, SkillMetadata>();

  public async discover(paths: string[]): Promise<SkillMetadata[]> {
    const found: SkillMetadata[] = [];
    for (const path of paths) {
      for (const skillPath of await findSkills(path, 4)) {
        const skill = await readSkillMetadata(skillPath);
        if (this.#skills.has(skill.id)) throw new Error(`Duplicate skill ID: ${skill.id}`);
        this.#skills.set(skill.id, skill);
        found.push(structuredClone(skill));
      }
    }
    return found;
  }

  public async load(id: string): Promise<SkillDocument> {
    const metadata = this.#skills.get(id);
    if (metadata === undefined) throw new Error(`Unknown skill: ${id}`);
    const source = await readFile(metadata.path, "utf8");
    return { ...structuredClone(metadata), content: source };
  }
}

async function findSkills(root: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(root, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") found.push(path);
    else if (entry.isDirectory() && depth > 0) found.push(...(await findSkills(path, depth - 1)));
  }
  return found;
}

async function readSkillMetadata(path: string): Promise<SkillMetadata> {
  const canonical = await realpath(path);
  const directory = await realpath(dirname(path));
  const relation = relative(directory, canonical);
  if (relation === ".." || relation.startsWith(`..${sep}`))
    throw new Error(`Unsafe skill path: ${path}`);
  const source = await readFile(canonical, "utf8");
  const frontmatter = parseFrontmatter(source);
  const fallback = basename(dirname(canonical));
  const name = text(frontmatter["name"]) ?? fallback;
  return {
    id: text(frontmatter["id"]) ?? slug(name),
    name,
    description: text(frontmatter["description"]) ?? "",
    path: canonical,
    ...(Array.isArray(frontmatter["tags"])
      ? { tags: frontmatter["tags"].filter((tag): tag is string => typeof tag === "string") }
      : {}),
    metadata: normalizeMetadata(frontmatter),
  };
}

function parseFrontmatter(source: string): Record<string, unknown> {
  if (!source.startsWith("---\n")) return {};
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const parsed: unknown = YAML.parse(source.slice(4, end));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function normalizeMetadata(value: Record<string, unknown>): JsonObject {
  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" || typeof nested === "boolean" || typeof nested === "number") {
      result[key] = nested;
    } else if (Array.isArray(nested)) {
      result[key] = nested.filter((item): item is string => typeof item === "string");
    }
  }
  return result;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
