import type {
  AppliedInstruction,
  RepositoryBinding,
  ResolvedContextItem,
} from "../domain/execution.js";
import type { WorkItem } from "../domain/work.js";
import type { WorkflowDefinition } from "../domain/workflows.js";
import type { JsonObject } from "../domain/json.js";
import type { RepositoryMappingRule } from "./repository-mapping.js";
import { RepositoryMappingResolver } from "./repository-mapping.js";
import type { InstructionResolver } from "./instruction-resolver.js";
import type { ContextResolver } from "../ports/context.js";
import { WorkflowRouter, type WorkflowRoutingResult } from "./workflow-routing.js";

export interface WorkflowEvaluationPlan {
  sideEffects: false;
  routing: WorkflowRoutingResult;
  repositories: RepositoryBinding[];
  repositoryConflicts: string[];
  instructions: AppliedInstruction[];
  context: ResolvedContextItem[];
  guards: Array<{ stepId: string; expression: string; determinable: boolean }>;
  stateMappings: unknown;
  gates: unknown;
  profiles: unknown;
  permissions: unknown;
  repositoryRules: unknown;
  contextPolicy: unknown;
  scheduling: unknown;
  experiments: unknown;
  pinnedAssets: WorkflowDefinition["assets"];
  profileRequirements: WorkflowDefinition["requirements"];
  expectedSideEffects: string[];
  determinablePath: string[];
  blockers: string[];
}

export class WorkflowEvaluator {
  public constructor(
    private readonly router = new WorkflowRouter(),
    private readonly mappings = new RepositoryMappingResolver(),
  ) {}

  public async evaluate(input: {
    workItem: WorkItem;
    workflows: WorkflowDefinition[];
    repositoryRules?: RepositoryMappingRule[];
    instructionResolver?: InstructionResolver;
    contextResolvers?: ContextResolver[];
    hypotheticalOutputs?: Record<string, unknown>;
  }): Promise<WorkflowEvaluationPlan> {
    const routing = this.router.route(input.workItem, input.workflows);
    const selected = routing.status === "MATCHED" ? routing.selected : undefined;
    const workflow =
      selected === undefined
        ? undefined
        : input.workflows.find(
            (candidate) =>
              candidate.id === selected.workflowId && candidate.version === selected.version,
          );
    const explicit =
      input.workItem.repository === undefined
        ? []
        : [
            {
              id: input.workItem.repository.id,
              cloneUrl: input.workItem.repository.cloneUrl,
              role: "primary" as const,
              source: "explicit" as const,
              ...(input.workItem.repository.defaultBranch === undefined
                ? {}
                : { defaultBranch: input.workItem.repository.defaultBranch }),
              ...(input.workItem.repository.localPath === undefined
                ? {}
                : { localPath: input.workItem.repository.localPath }),
            },
          ];
    const repositoryResolution = this.mappings.resolve({
      context: structuredClone({ issue: input.workItem }) as unknown as JsonObject,
      explicit,
      rules: input.repositoryRules ?? [],
    });
    const primary = repositoryResolution.repositories.find(({ role }) => role === "primary");
    const instructions =
      input.instructionResolver === undefined || primary?.localPath === undefined
        ? []
        : (await input.instructionResolver.resolve({ repositoryRoot: primary.localPath })).applied;
    const context = (
      await Promise.all(
        (input.contextResolvers ?? []).map((resolver) =>
          resolver.resolve({ workItem: input.workItem }),
        ),
      )
    ).flat();
    const guards = (workflow?.steps ?? [])
      .filter((step) => step.when !== undefined)
      .map((step) => ({
        stepId: step.id,
        expression: step.when!,
        determinable: !step.when!.includes("steps.") || input.hypotheticalOutputs !== undefined,
      }));
    const blockers: string[] = [];
    if (routing.status === "NO_MATCH") blockers.push("No workflow matches; routing will not guess");
    if (routing.status === "WORKFLOW_SELECTION_REQUIRED")
      blockers.push("Human workflow selection is required");
    if (repositoryResolution.conflicts.length > 0) blockers.push(...repositoryResolution.conflicts);
    return {
      sideEffects: false,
      routing,
      repositories: repositoryResolution.repositories,
      repositoryConflicts: repositoryResolution.conflicts,
      instructions,
      context,
      guards,
      stateMappings: workflow?.configuration["stateMappings"] ?? {},
      gates: workflow?.configuration["gates"] ?? {},
      profiles: workflow?.configuration["profiles"] ?? {},
      permissions: workflow?.configuration["permissions"] ?? {},
      repositoryRules: workflow?.configuration["repositoryRules"] ?? {},
      contextPolicy: workflow?.configuration["context"] ?? {},
      scheduling: workflow?.configuration["schedule"] ?? workflow?.configuration["lane"] ?? {},
      experiments: workflow?.configuration["experiment"] ?? {},
      pinnedAssets: workflow?.assets ?? [],
      profileRequirements: workflow?.requirements ?? { capabilities: [], providers: [], tools: [] },
      expectedSideEffects: expectedEffects(workflow),
      determinablePath:
        workflow?.steps.filter((step) => step.when === undefined).map(({ id }) => id) ?? [],
      blockers,
    };
  }
}

function expectedEffects(workflow: WorkflowDefinition | undefined): string[] {
  if (workflow === undefined) return [];
  return [
    ...new Set(
      workflow.steps.flatMap((step) => {
        if (step.type === "command") return ["execute process"];
        if (step.type === "tool") return [`call tool ${step.tool}`];
        if (step.type === "action") return [`run action ${step.action}`];
        if (step.type === "agent") return ["invoke agent/model"];
        if (step.type === "human_input" || step.type === "approval") return ["request human input"];
        if (step.type === "subworkflow") return [`execute subworkflow ${step.workflow.id}`];
        return ["suspend until condition"];
      }),
    ),
  ];
}
