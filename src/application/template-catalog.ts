import type { Capability } from "../domain/capabilities.js";
import type { WorkflowDefinition } from "../domain/workflows.js";
import type { VersionedAssetCatalog } from "./versioned-assets.js";
import type { JsonObject } from "../domain/json.js";

export interface RuntimeCapabilities {
  capabilities: Capability[];
  providers: string[];
  tools: string[];
}

export interface TemplateCompatibility {
  compatible: boolean;
  missingCapabilities: Capability[];
  missingProviders: string[];
  missingTools: string[];
}

export class WorkflowTemplateCatalog {
  public constructor(private readonly assets: VersionedAssetCatalog) {}

  public compatibility(
    template: WorkflowDefinition,
    runtime: RuntimeCapabilities,
  ): TemplateCompatibility {
    const missingCapabilities = template.requirements.capabilities.filter(
      (value) => !runtime.capabilities.includes(value),
    );
    const missingProviders = template.requirements.providers.filter(
      (value) => !runtime.providers.includes(value),
    );
    const missingTools = template.requirements.tools.filter(
      (value) => !runtime.tools.includes(value),
    );
    return {
      compatible:
        missingCapabilities.length === 0 &&
        missingProviders.length === 0 &&
        missingTools.length === 0,
      missingCapabilities,
      missingProviders,
      missingTools,
    };
  }

  public async publish(template: WorkflowDefinition) {
    return this.assets.publish({
      kind: "template",
      id: template.id,
      version: template.version,
      value: structuredClone(template) as unknown as JsonObject,
    });
  }

  public assertActivatable(template: WorkflowDefinition, runtime: RuntimeCapabilities): void {
    if (template.lifecycle === "DRAFT") throw new Error("Draft templates cannot be activated");
    if (template.lifecycle === "DISABLED")
      throw new Error("Disabled templates cannot be activated");
    const result = this.compatibility(template, runtime);
    if (!result.compatible) {
      throw new Error(
        `Template dependencies are unavailable: ${[
          ...result.missingCapabilities,
          ...result.missingProviders,
          ...result.missingTools,
        ].join(", ")}`,
      );
    }
  }
}
