import { describe, it } from "vitest";
import { ScriptedModelProvider } from "../../src/adapters/fakes/model-provider.js";
import { InMemoryWorkProvider } from "../../src/adapters/fakes/work-provider.js";
import { assertModelProviderContract } from "./model-provider.contract.js";
import { assertWorkProviderContract } from "./work-provider.contract.js";

describe("deterministic provider contract suites", () => {
  it("validates the scripted model provider", async () => {
    await assertModelProviderContract(
      new ScriptedModelProvider([[{ type: "complete", outcome: "GOAL_COMPLETED" }]]),
    );
  });

  it("validates the in-memory work provider", async () => {
    await assertWorkProviderContract(
      new InMemoryWorkProvider([
        {
          id: "fake:1",
          provider: "fake-work",
          externalId: "1",
          title: "Contract item",
          state: "Ready",
          labels: ["agent-ready"],
          assignees: [],
          relationships: [],
          metadata: {},
        },
      ]),
    );
  });
});
