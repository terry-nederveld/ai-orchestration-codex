import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
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
    executable: z.string().optional(),
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
}

export async function loadFableConfig(explicitPath?: string): Promise<LoadedFableConfig> {
  const candidates =
    explicitPath === undefined
      ? [
          resolve(process.cwd(), "fable.config.yaml"),
          resolve(homedir(), ".config/fable/config.yaml"),
        ]
      : [resolve(explicitPath)];
  const path = await firstExisting(candidates);
  if (path === undefined) {
    throw new Error("No Fable configuration found. Run `fable init` or pass --config.");
  }
  const parsed: unknown = YAML.parse(await readFile(path, "utf8"));
  return { value: fableConfigSchema.parse(parsed), path, directory: dirname(path) };
}

export function resolveConfigPath(config: LoadedFableConfig, path: string): string {
  return isAbsolute(path) ? path : resolve(config.directory, path);
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Continue to the next conventional location.
    }
  }
  return undefined;
}
