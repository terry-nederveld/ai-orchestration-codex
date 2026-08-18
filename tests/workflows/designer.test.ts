import { describe, expect, it } from "vitest";
import {
  parseCanonicalWorkflow,
  serializeCanonicalWorkflow,
  WorkflowDesignerDocument,
} from "../../src/application/workflows/designer.js";
import { contentDigest } from "../../src/application/versioned-assets.js";
import type { JsonValue } from "../../src/domain/json.js";

const source = `
schemaVersion: 2
id: designer-fixture
version: 3
lifecycle: DRAFT
name: Designer fixture
workspace:
  strategy: temporary
configuration:
  stateMappings:
    complete: Done
  gateSets:
    ready: ready@1
steps:
  - id: resolve
    type: action
    action: context.resolve
    input: {}
  - id: ask
    type: human_input
    inputType: approval
    title: Advance?
    description: Review the package
    channel: both
    dependsOn: [resolve]
`;

describe("workflow designer canonical round-trip", () => {
  it("round-trips visual edits and canonical YAML without semantic loss", () => {
    const parsed = parseCanonicalWorkflow(source);
    const canonical = serializeCanonicalWorkflow(parsed);
    const reparsed = parseCanonicalWorkflow(canonical);
    expect(contentDigest(structuredClone(reparsed) as unknown as JsonValue)).toBe(
      contentDigest(structuredClone(parsed) as unknown as JsonValue),
    );

    const document = new WorkflowDesignerDocument(source);
    document.setLifecycle("ENABLED");
    document.setConfiguration("schedule", { everyMs: 604_800_000 });
    document.upsertStep({
      id: "wait",
      type: "wait",
      conditionType: "external_event",
      predicate: { event: "deployment.verified" },
      dependsOn: ["ask"],
      retry: { maxAttempts: 1, backoffMs: 1_000 },
      onError: "fail",
    });
    const edited = parseCanonicalWorkflow(document.text());
    expect(edited.lifecycle).toBe("ENABLED");
    expect(edited.configuration["schedule"]).toEqual({ everyMs: 604_800_000 });
    expect(edited.steps.at(-1)).toMatchObject({ id: "wait", dependsOn: ["ask"] });
    document.removeStep("ask");
    expect(document.definition().steps.find(({ id }) => id === "wait")?.dependsOn).toEqual([]);
  });
});
