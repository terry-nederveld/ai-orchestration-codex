import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { JsonObject, JsonValue } from "../../domain/json.js";
import { permissionCapabilities, type PermissionCapability } from "../../domain/permissions.js";
import type { ProviderDescriptor } from "../../domain/providers.js";
import type {
  ExtensionContribution,
  ExtensionManifest,
  ExtensionProvider,
  HookRegistration,
  WorkflowAction,
} from "../../ports/extensions.js";
import type { ToolDefinition } from "../../ports/tools.js";

export interface ManifestExtensionProviderOptions {
  apiVersion?: string;
  grants?: Record<string, PermissionCapability[]>;
}

interface DiscoveredExtension {
  manifest: ExtensionManifest;
  directory: string;
}

export class ManifestExtensionProvider implements ExtensionProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "extension" } = {
    id: "manifest-extensions",
    displayName: "Fable manifest extensions",
    kind: "extension",
    version: "1.0.0",
    capabilities: [],
    authentication: ["none"],
  };

  readonly #apiVersion: string;
  readonly #grants: Record<string, PermissionCapability[]>;
  readonly #extensions = new Map<string, DiscoveredExtension>();

  public constructor(options: ManifestExtensionProviderOptions = {}) {
    this.#apiVersion = options.apiVersion ?? "1";
    this.#grants = options.grants ?? {};
  }

  public async availability() {
    return { installed: true, authenticated: true, available: true };
  }

  public async discover(paths: string[]): Promise<ExtensionManifest[]> {
    const manifests: ExtensionManifest[] = [];
    for (const path of paths) {
      for (const manifestPath of await findManifests(path, 3)) {
        const manifest = parseManifest(await readFile(manifestPath, "utf8"));
        if (manifest.apiVersion !== this.#apiVersion) {
          throw new Error(
            `Extension ${manifest.id} requires API ${manifest.apiVersion}; Fable provides ${this.#apiVersion}`,
          );
        }
        if (this.#extensions.has(manifest.id)) {
          throw new Error(`Duplicate extension ID: ${manifest.id}`);
        }
        const discovered = { manifest, directory: dirname(manifestPath) };
        this.#extensions.set(manifest.id, discovered);
        manifests.push(structuredClone(manifest));
      }
    }
    return manifests;
  }

  public async load(manifest: ExtensionManifest): Promise<ExtensionContribution> {
    const discovered = this.#extensions.get(manifest.id);
    if (discovered === undefined) throw new Error(`Extension was not discovered: ${manifest.id}`);
    if (
      discovered.manifest.version !== manifest.version ||
      discovered.manifest.entry !== manifest.entry
    ) {
      throw new Error(`Extension manifest changed after discovery: ${manifest.id}`);
    }
    const granted = new Set(this.#grants[manifest.id] ?? []);
    const missing = manifest.permissions.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw new Error(`Extension ${manifest.id} lacks grants for: ${missing.join(", ")}`);
    }
    const entry = await safeEntry(discovered.directory, manifest.entry);
    const loaded: unknown = await import(pathToFileURL(entry).href);
    if (!isUnknownRecord(loaded) || typeof loaded["activate"] !== "function") {
      throw new Error(`Extension ${manifest.id} must export an activate function`);
    }
    const activate = loaded["activate"] as (context: {
      manifest: ExtensionManifest;
      apiVersion: string;
    }) => unknown;
    const contribution: unknown = await activate({
      manifest: structuredClone(manifest),
      apiVersion: this.#apiVersion,
    });
    return validateContribution(contribution, manifest);
  }
}

async function findManifests(root: string, remainingDepth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(root, entry.name);
    if (entry.isFile() && entry.name === "fable-extension.json") manifests.push(path);
    else if (entry.isDirectory() && remainingDepth > 0) {
      manifests.push(...(await findManifests(path, remainingDepth - 1)));
    }
  }
  return manifests;
}

async function safeEntry(directory: string, entry: string): Promise<string> {
  const root = await realpath(directory);
  const target = await realpath(resolve(directory, entry));
  const relation = relative(root, target);
  if (relation === ".." || relation.startsWith(`..${sep}`) || relation.startsWith(sep)) {
    throw new Error(`Extension entry escapes its directory: ${entry}`);
  }
  return target;
}

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
    name: z.string().min(1),
    version: z.string().min(1),
    apiVersion: z.string().min(1),
    entry: z.string().min(1),
    provides: z
      .object({
        tools: z.array(z.string()).optional(),
        workflowActions: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        hooks: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
      })
      .strict(),
    permissions: z.array(z.enum(permissionCapabilities)),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function parseManifest(source: string): ExtensionManifest {
  const parsed: unknown = JSON.parse(source);
  const value = manifestSchema.parse(parsed);
  return {
    schemaVersion: 1,
    id: value.id,
    name: value.name,
    version: value.version,
    apiVersion: value.apiVersion,
    entry: value.entry,
    provides: {
      ...(value.provides.tools === undefined ? {} : { tools: value.provides.tools }),
      ...(value.provides.workflowActions === undefined
        ? {}
        : { workflowActions: value.provides.workflowActions }),
      ...(value.provides.providers === undefined ? {} : { providers: value.provides.providers }),
      ...(value.provides.hooks === undefined ? {} : { hooks: value.provides.hooks }),
      ...(value.provides.skills === undefined ? {} : { skills: value.provides.skills }),
    },
    permissions: value.permissions,
    ...(value.metadata === undefined ? {} : { metadata: normalizeObject(value.metadata) }),
  };
}

function validateContribution(value: unknown, manifest: ExtensionManifest): ExtensionContribution {
  if (!isUnknownRecord(value)) throw new Error(`Extension ${manifest.id} returned no contribution`);
  const tools = validateArray<ToolDefinition>(value["tools"], "tools", (item) => {
    return (
      isUnknownRecord(item) &&
      typeof item["name"] === "string" &&
      typeof item["execute"] === "function"
    );
  });
  const actions = validateArray<WorkflowAction>(
    value["workflowActions"],
    "workflowActions",
    (item) => {
      return (
        isUnknownRecord(item) &&
        typeof item["id"] === "string" &&
        typeof item["execute"] === "function"
      );
    },
  );
  const hooks = validateArray<HookRegistration>(value["hooks"], "hooks", (item) => {
    return (
      isUnknownRecord(item) &&
      typeof item["id"] === "string" &&
      typeof item["execute"] === "function"
    );
  });
  return {
    ...(tools === undefined ? {} : { tools }),
    ...(actions === undefined ? {} : { workflowActions: actions }),
    ...(hooks === undefined ? {} : { hooks }),
  };
}

function validateArray<T>(
  value: unknown,
  name: string,
  predicate: (item: unknown) => boolean,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(predicate)) {
    throw new Error(`Invalid extension contribution: ${name}`);
  }
  return value as T[];
}

function normalizeObject(value: Record<string, unknown>): JsonObject {
  const normalized = normalizeValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== "object") return {};
  return normalized;
}

function normalizeValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (isUnknownRecord(value)) {
    const result: JsonObject = {};
    for (const [key, nested] of Object.entries(value)) {
      if (nested !== undefined) result[key] = normalizeValue(nested);
    }
    return result;
  }
  return `[unsupported:${typeof value}]`;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
