import { describe, expect, it } from "vitest";
import { InMemoryPersistenceProvider } from "../../src/adapters/persistence/in-memory.js";
import { WorkflowTemplateCatalog } from "../../src/application/template-catalog.js";
import { VersionedAssetCatalog } from "../../src/application/versioned-assets.js";
import { loadWorkflow } from "../../src/application/workflows/loader.js";

describe("WorkflowTemplateCatalog", () => {
  it("publishes both flagship templates and validates dependencies before activation", async () => {
    const persistence = new InMemoryPersistenceProvider();
    await persistence.initialize();
    const catalog = new WorkflowTemplateCatalog(new VersionedAssetCatalog(persistence));
    const delivery = (await loadWorkflow("workflows/autonomous-delivery.yaml", "workflows"))
      .definition;
    const discovery = (await loadWorkflow("workflows/autonomous-discovery.yaml", "workflows"))
      .definition;
    await catalog.publish(delivery);
    await catalog.publish(discovery);
    expect(
      catalog.compatibility(delivery, {
        capabilities: ["tool_use", "structured_output"],
        providers: [],
        tools: ["git"],
      }),
    ).toEqual({
      compatible: true,
      missingCapabilities: [],
      missingProviders: [],
      missingTools: [],
    });
    expect(
      catalog.compatibility(delivery, {
        capabilities: ["tool_use"],
        providers: [],
        tools: [],
      }),
    ).toMatchObject({
      compatible: false,
      missingCapabilities: ["structured_output"],
      missingTools: ["git"],
    });
    expect(
      (await persistence.entities.list("versioned_asset")).map(({ value }) => value["id"]).sort(),
    ).toEqual(["autonomous-delivery", "autonomous-discovery"]);
  });
});
