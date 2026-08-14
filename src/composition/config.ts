import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { LayeredConfiguration } from "../application/configuration.js";
import type { JsonObject, JsonValue } from "../domain/json.js";
import { permissionCapabilities } from "../domain/permissions.js";

const secretReference = z.string().min(1);
const repositorySchema = z.object({
  id: z.string().min(1),
  cloneUrl: z.string().min(1),
  owner: z.string().optional(),
  name: z.string().optional(),
  defaultBranch: z.string().optional(),
});

const modelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("openai"),
    secret: secretReference.default("openai.api_key"),
    baseUrl: z.string().url().optional(),
    organization: z.string().optional(),
    project: z.string().optional(),
    models: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("anthropic"),
    secret: secretReference.default("anthropic.api_key"),
    baseUrl: z.string().url().optional(),
    models: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("openai-compatible"),
    id: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z.string().url(),
    secret: secretReference.optional(),
    requireApiKey: z.boolean().default(true),
    includeUsage: z.boolean().default(true),
    models: z.array(z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

const agentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("codex"),
    secret: secretReference.optional(),
    baseUrl: z.string().url().optional(),
    executable: z.string().default("codex"),
    network: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("claude-code"),
    executable: z.string().default("claude"),
    permissionMode: z.enum(["default", "acceptEdits", "plan"]).default("acceptEdits"),
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    maxTurns: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    consumption: z.enum(["subscription", "api"]).default("subscription"),
  }),
  z.object({ type: z.literal("copilot") }),
]);

const workSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github"),
    owner: z.string().min(1),
    repository: z.string().min(1),
    secret: secretReference.default("github.token"),
    apiUrl: z.string().url().optional(),
    cloneUrl: z.string().optional(),
  }),
  z.object({
    type: z.enum(["jira-cloud", "jira-data-center"]),
    baseUrl: z.string().url(),
    project: z.string().optional(),
    email: z.string().email().optional(),
    secret: secretReference,
    repository: repositorySchema.optional(),
  }),
  z.object({
    type: z.literal("linear"),
    secret: secretReference.default("linear.token"),
    apiUrl: z.string().url().optional(),
    team: z.string().optional(),
    repository: repositorySchema.optional(),
  }),
]);

const mcpSchema = z.discriminatedUnion("transport", [
  z.object({
    id: z.string().min(1),
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
    permissions: z.array(z.enum(permissionCapabilities)).optional(),
  }),
  z.object({
    id: z.string().min(1),
    transport: z.literal("http"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    permissions: z.array(z.enum(permissionCapabilities)).optional(),
  }),
]);

export const fableConfigSchema = z.object({
  version: z.literal(1),
  dataDirectory: z.string().default(".fable"),
  database: z.string().optional(),
  workspaceRoot: z.string().optional(),
  vault: z.object({ path: z.string().optional() }).default({}),
  permissions: z
    .array(
      z.object({
        capability: z.union([z.enum(permissionCapabilities), z.literal("*")]),
        resource: z.string().optional(),
        decision: z.enum(["allow", "deny", "ask", "sandbox-only"]),
        priority: z.number().optional(),
      }),
    )
    .default([]),
  models: z.array(modelSchema).default([]),
  agents: z.array(agentSchema).default([]),
  work: z.array(workSchema).default([]),
  workflows: z.array(z.string()).default([]),
  extensions: z
    .object({
      paths: z.array(z.string()).default([]),
      grants: z.record(z.string(), z.array(z.enum(permissionCapabilities))).default({}),
    })
    .default({ paths: [], grants: {} }),
  mcp: z.array(mcpSchema).default([]),
  sourceControl: z
    .object({
      githubSecret: secretReference.default("github.token"),
      apiUrl: z.string().url().optional(),
    })
    .default({ githubSecret: "github.token" }),
  concurrency: z.object({ workflowSteps: z.number().int().positive().default(4) }).default({
    workflowSteps: 4,
  }),
  scheduler: z
    .object({
      enabled: z.boolean().default(false),
      pollIntervalMs: z.number().int().min(1_000).max(86_400_000).default(30_000),
      maxConcurrentRuns: z.number().int().positive().max(100).default(2),
      maxAttempts: z.number().int().positive().max(20).default(3),
      retryBackoffMs: z.number().int().min(100).max(86_400_000).default(5_000),
      maxRetryBackoffMs: z.number().int().min(100).max(604_800_000).default(300_000),
      sources: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
            workProvider: z.string().min(1),
            workflow: z.string().min(1),
            query: z
              .object({
                project: z.string().optional(),
                states: z.array(z.string()).optional(),
                labels: z.array(z.string()).optional(),
                assignee: z.string().optional(),
                limit: z.number().int().positive().max(100).optional(),
              })
              .default({}),
          }),
        )
        .default([]),
    })
    .default({
      enabled: false,
      pollIntervalMs: 30_000,
      maxConcurrentRuns: 2,
      maxAttempts: 3,
      retryBackoffMs: 5_000,
      maxRetryBackoffMs: 300_000,
      sources: [],
    }),
});

export type FableConfig = z.infer<typeof fableConfigSchema>;
export type ModelConfig = FableConfig["models"][number];
export type AgentConfig = FableConfig["agents"][number];
export type WorkConfig = FableConfig["work"][number];
export type McpConfig = FableConfig["mcp"][number];

export interface LoadedFableConfig {
  value: FableConfig;
  path: string;
  directory: string;
  sources: string[];
}

export async function loadFableConfig(explicitPath?: string): Promise<LoadedFableConfig> {
  if (explicitPath !== undefined) return loadFableConfigLayers([resolve(explicitPath)]);

  const paths = await existing([
    resolve(homedir(), ".config/fable/config.yaml"),
    resolve(process.cwd(), "fable.config.yaml"),
  ]);
  if (paths.length === 0) {
    throw new Error("No Fable configuration found. Run `fable init` or pass --config.");
  }
  return loadFableConfigLayers(paths);
}

export async function loadFableConfigLayers(paths: string[]): Promise<LoadedFableConfig> {
  if (paths.length === 0) throw new Error("At least one configuration layer is required");
  const resolvedPaths = paths.map((path) => resolve(path));
  const layers = await Promise.all(
    resolvedPaths.map(async (path) => parseConfigLayer(YAML.parse(await readFile(path, "utf8")))),
  );
  const defaults = toJsonObject(fableConfigSchema.parse({ version: 1 }));
  const merged = new LayeredConfiguration([defaults, ...layers]).value();
  const path = resolvedPaths.at(-1)!;
  return {
    value: fableConfigSchema.parse(merged),
    path,
    directory: dirname(path),
    sources: resolvedPaths,
  };
}

export function resolveConfigPath(config: LoadedFableConfig, path: string): string {
  return isAbsolute(path) ? path : resolve(config.directory, path);
}

async function existing(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    try {
      await access(path);
      result.push(path);
    } catch {
      // Continue to the next conventional location.
    }
  }
  return result;
}

function parseConfigLayer(value: unknown): JsonObject {
  if (!isJsonObject(value)) throw new TypeError("Fable configuration must be a YAML object");
  return value;
}

function toJsonObject(value: unknown): JsonObject {
  if (!isJsonObject(value)) throw new TypeError("Fable defaults must be JSON-compatible");
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
