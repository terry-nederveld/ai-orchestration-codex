import { describe, expect, it } from "vitest";
import { LayeredConfiguration } from "../../src/application/configuration.js";

describe("LayeredConfiguration", () => {
  it("deep merges objects and replaces arrays in deterministic order", () => {
    const configuration = new LayeredConfiguration([
      { runtime: { timeout: 100, labels: ["default"] }, provider: "fake" },
      { runtime: { timeout: 200 } },
      { runtime: { labels: ["run"] } },
    ]);

    expect(configuration.value()).toEqual({
      runtime: { timeout: 200, labels: ["run"] },
      provider: "fake",
    });
    expect(configuration.get("runtime.timeout")).toBe(200);
  });
});
