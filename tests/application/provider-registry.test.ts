import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/application/provider-registry.js";
import { ScriptedModelProvider } from "../../src/adapters/fakes/model-provider.js";

describe("ProviderRegistry", () => {
  it("selects by capabilities without vendor branching", async () => {
    const registry = new ProviderRegistry<ScriptedModelProvider>();
    const provider = new ScriptedModelProvider([]);
    registry.register(provider);

    await expect(registry.select({ capabilities: ["tool_use", "streaming"] })).resolves.toBe(
      provider,
    );
    await expect(registry.select({ capabilities: ["vision"] })).rejects.toThrow(
      "No suitable provider found",
    );
  });

  it("rejects duplicate identifiers", () => {
    const registry = new ProviderRegistry<ScriptedModelProvider>();
    registry.register(new ScriptedModelProvider([]));
    expect(() => registry.register(new ScriptedModelProvider([]))).toThrow("already registered");
  });
});
