import { z } from "zod";
import { capabilities } from "../../domain/capabilities.js";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const retrySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(20).default(1),
    backoffMs: z.number().int().min(0).max(3_600_000).default(1_000),
    maxBackoffMs: z.number().int().min(0).max(86_400_000).optional(),
  })
  .default({ maxAttempts: 1, backoffMs: 1_000 });

const repeatSchema = z.object({
  while: z.string().min(1),
  maxIterations: z.number().int().min(1).max(100),
});

const commonStep = {
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1).optional(),
  dependsOn: z.array(z.string()).default([]),
  when: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  retry: retrySchema,
  repeat: repeatSchema.optional(),
  onError: z.enum(["fail", "continue"]).default("fail"),
};

const stepSchema = z.discriminatedUnion("type", [
  z.object({
    ...commonStep,
    type: z.literal("agent"),
    agent: z.string().min(1),
    goal: z.string().min(1),
  }),
  z.object({
    ...commonStep,
    type: z.literal("command"),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    env: z.record(z.string()).default({}),
    expectedExitCodes: z.array(z.number().int()).min(1).default([0]),
  }),
  z.object({
    ...commonStep,
    type: z.literal("tool"),
    tool: z.string().min(1),
    input: z.record(jsonValueSchema).default({}),
  }),
  z.object({
    ...commonStep,
    type: z.literal("action"),
    action: z.string().min(1),
    input: z.record(jsonValueSchema).default({}),
  }),
  z.object({
    ...commonStep,
    type: z.literal("approval"),
    title: z.string().min(1),
    description: z.string().min(1),
  }),
]);

const agentRoleSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  requiredCapabilities: z.array(z.enum(capabilities)).default([]),
  instructions: z.string().optional(),
});

export const workflowInputSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  description: z.string().optional(),
  includes: z.array(z.string()).default([]),
  trigger: z.object({ states: z.array(z.string()).min(1).default(["Ready"]) }).default({}),
  eligibility: z
    .object({
      includeLabels: z.array(z.string()).default([]),
      excludeLabels: z.array(z.string()).default([]),
    })
    .default({}),
  workspace: z
    .object({
      strategy: z.enum(["git-worktree", "clone", "local", "temporary"]).default("git-worktree"),
      retainOnFailure: z.boolean().default(true),
    })
    .default({}),
  variables: z.record(jsonValueSchema).default({}),
  budgets: z
    .object({
      maxConcurrentAgents: z.number().int().positive().optional(),
      maxSubagentsPerRun: z.number().int().nonnegative().optional(),
      maxIterations: z.number().int().positive().optional(),
      maxWallClockMs: z.number().int().positive().optional(),
      maxInputTokens: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      maxEstimatedCostUsd: z.number().nonnegative().optional(),
      maxSubscriptionRequests: z.number().int().nonnegative().optional(),
    })
    .default({}),
  agents: z.record(agentRoleSchema).default({}),
  steps: z.array(stepSchema).min(1),
  transitions: z
    .object({
      success: z.string().optional(),
      failure: z.string().optional(),
      cancelled: z.string().optional(),
    })
    .default({}),
});
