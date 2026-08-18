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
  join: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("all") }),
      z.object({ mode: z.literal("any") }),
      z.object({ mode: z.literal("minimum"), count: z.number().int().positive() }),
      z.object({ mode: z.literal("named"), required: z.array(z.string()).min(1) }),
    ])
    .optional(),
  when: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  retry: retrySchema,
  repeat: repeatSchema.optional(),
  outputSchema: z.record(jsonValueSchema).optional(),
  onEnter: z
    .array(z.object({ action: z.string().min(1), input: z.record(jsonValueSchema).default({}) }))
    .default([]),
  onExit: z
    .array(z.object({ action: z.string().min(1), input: z.record(jsonValueSchema).default({}) }))
    .default([]),
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
  z.object({
    ...commonStep,
    type: z.literal("human_input"),
    inputType: z.enum([
      "text",
      "boolean",
      "single_choice",
      "multiple_choice",
      "approval",
      "secret",
      "file_reference",
      "free_form",
    ]),
    title: z.string().min(1),
    description: z.string().min(1),
    channel: z.enum(["app", "work_item", "both"]).default("app"),
    required: z.boolean().default(true),
    choices: z.array(z.string()).optional(),
    secretDestination: z.string().optional(),
  }),
  z.object({
    ...commonStep,
    type: z.literal("wait"),
    conditionType: z.enum([
      "time",
      "external_event",
      "dependency",
      "provider_availability",
      "work_item_event",
    ]),
    predicate: z.record(jsonValueSchema).default({}),
    until: z.string().datetime().optional(),
  }),
  z.object({
    ...commonStep,
    type: z.literal("subworkflow"),
    workflow: z.object({
      kind: z.literal("subworkflow"),
      id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
      version: z.number().int().positive(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    input: z.record(jsonValueSchema).default({}),
    failure: z.enum(["fail", "continue"]).default("fail"),
  }),
]);

const agentRoleSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  requiredCapabilities: z.array(z.enum(capabilities)).default([]),
  instructions: z.string().optional(),
});

export const workflowInputSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  version: z.number().int().positive().default(1),
  lifecycle: z.enum(["DRAFT", "ENABLED", "DISABLED"]).default("ENABLED"),
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
  domainStates: z.array(z.string()).default([]),
  assets: z
    .array(
      z.object({
        kind: z.enum([
          "workflow",
          "subworkflow",
          "gate_set",
          "rubric",
          "agent_profile",
          "policy",
          "template",
        ]),
        id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
        version: z.number().int().positive(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .default([]),
  requirements: z
    .object({
      capabilities: z.array(z.enum(capabilities)).default([]),
      providers: z.array(z.string()).default([]),
      tools: z.array(z.string()).default([]),
    })
    .default({}),
  configuration: z.record(jsonValueSchema).default({}),
  budgets: z
    .object({
      maxConcurrentAgents: z.number().int().positive().optional(),
      maxSubagentsPerRun: z.number().int().nonnegative().optional(),
      maxIterations: z.number().int().positive().max(1_000).optional(),
      maxWallClockMs: z.number().int().positive().max(2_592_000_000).optional(),
      maxInputTokens: z.number().int().positive().max(1_000_000_000).optional(),
      maxOutputTokens: z.number().int().positive().max(1_000_000_000).optional(),
      maxEstimatedCostUsd: z.number().nonnegative().max(1_000_000).optional(),
      maxSubscriptionRequests: z.number().int().nonnegative().max(1_000_000).optional(),
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
