import YAML from "yaml";
import type { WorkflowDefinition, WorkflowStep } from "../../domain/workflows.js";
import type { JsonValue } from "../../domain/json.js";
import { compileWorkflow } from "./compiler.js";

export function parseCanonicalWorkflow(text: string): WorkflowDefinition {
  return compileWorkflow(YAML.parse(text) as unknown).definition;
}

export function serializeCanonicalWorkflow(definition: WorkflowDefinition): string {
  const compiled = compileWorkflow(JSON.parse(JSON.stringify(definition))).definition;
  return YAML.stringify(JSON.parse(JSON.stringify(compiled)), {
    sortMapEntries: true,
    lineWidth: 100,
  });
}

export class WorkflowDesignerDocument {
  #definition: WorkflowDefinition;

  public constructor(text: string) {
    this.#definition = parseCanonicalWorkflow(text);
  }

  public definition(): WorkflowDefinition {
    return structuredClone(this.#definition);
  }

  public text(): string {
    return serializeCanonicalWorkflow(this.#definition);
  }

  public setLifecycle(lifecycle: WorkflowDefinition["lifecycle"]): void {
    this.#replace({ ...this.#definition, lifecycle });
  }

  public upsertStep(step: WorkflowStep): void {
    const steps = this.#definition.steps.some(({ id }) => id === step.id)
      ? this.#definition.steps.map((current) => (current.id === step.id ? step : current))
      : [...this.#definition.steps, step];
    this.#replace({ ...this.#definition, steps });
  }

  public removeStep(id: string): void {
    this.#replace({
      ...this.#definition,
      steps: this.#definition.steps
        .filter((step) => step.id !== id)
        .map((step) => ({
          ...step,
          dependsOn: step.dependsOn.filter((dependency) => dependency !== id),
        })),
    });
  }

  public setConfiguration(key: string, value: JsonValue): void {
    this.#replace({
      ...this.#definition,
      configuration: { ...this.#definition.configuration, [key]: value },
    });
  }

  #replace(definition: WorkflowDefinition): void {
    this.#definition = compileWorkflow(JSON.parse(JSON.stringify(definition))).definition;
  }
}
