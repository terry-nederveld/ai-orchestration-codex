import { ConfigurationError } from "../../domain/errors.js";
import type { JsonObject } from "../../domain/json.js";
import type { WorkflowDefinition, WorkflowStep } from "../../domain/workflows.js";
import { workflowInputSchema } from "./schema.js";

export interface CompiledWorkflow {
  definition: WorkflowDefinition;
  stepsById: ReadonlyMap<string, WorkflowStep>;
  dependents: ReadonlyMap<string, ReadonlySet<string>>;
  topologicalOrder: string[];
}

export function compileWorkflow(input: unknown): CompiledWorkflow {
  const parsed = workflowInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigurationError(
      `Invalid workflow: ${parsed.error.issues.map(formatIssue).join("; ")}`,
    );
  }
  const definition = parsed.data as WorkflowDefinition;
  const stepsById = new Map<string, WorkflowStep>();
  for (const step of definition.steps) {
    if (stepsById.has(step.id)) throw new ConfigurationError(`Duplicate workflow step: ${step.id}`);
    stepsById.set(step.id, step);
    if (step.type === "agent" && definition.agents[step.agent] === undefined) {
      throw new ConfigurationError(`Step ${step.id} references unknown agent role: ${step.agent}`);
    }
  }

  const dependents = new Map<string, Set<string>>();
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) {
      if (!stepsById.has(dependency)) {
        throw new ConfigurationError(`Step ${step.id} has unknown dependency: ${dependency}`);
      }
      const values = dependents.get(dependency) ?? new Set<string>();
      values.add(step.id);
      dependents.set(dependency, values);
    }
  }

  const topologicalOrder = topologicalSort(definition.steps, dependents);
  return { definition, stepsById, dependents, topologicalOrder };
}

function topologicalSort(steps: WorkflowStep[], dependents: Map<string, Set<string>>): string[] {
  const inDegree = new Map(steps.map((step) => [step.id, step.dependsOn.length]));
  const ready = steps.filter((step) => step.dependsOn.length === 0).map(({ id }) => id);
  const result: string[] = [];

  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift();
    if (id === undefined) break;
    result.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  if (result.length !== steps.length) {
    const cyclic = steps.filter(({ id }) => !result.includes(id)).map(({ id }) => id);
    throw new ConfigurationError(`Workflow dependency cycle detected: ${cyclic.join(", ")}`);
  }
  return result;
}

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.join(".") || "workflow"}: ${issue.message}`;
}

export function mergeWorkflowDocuments(base: unknown, fragments: unknown[]): JsonObject {
  const documents = [base, ...fragments].map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new ConfigurationError("Workflow documents must be objects");
    }
    return value as JsonObject;
  });
  const root = structuredClone(documents[0] ?? {});
  root["steps"] = documents.flatMap((document) => {
    const steps = document["steps"];
    return Array.isArray(steps) ? steps : [];
  });
  root["agents"] = Object.assign(
    {},
    ...documents.map((document) => {
      const agents = document["agents"];
      return agents !== null && typeof agents === "object" && !Array.isArray(agents) ? agents : {};
    }),
  ) as JsonObject;
  root["variables"] = Object.assign(
    {},
    ...documents.map((document) => {
      const variables = document["variables"];
      return variables !== null && typeof variables === "object" && !Array.isArray(variables)
        ? variables
        : {};
    }),
  ) as JsonObject;
  root["includes"] = [];
  return root;
}
