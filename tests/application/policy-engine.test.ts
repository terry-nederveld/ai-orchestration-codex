import { describe, expect, it } from "vitest";
import { RuleBasedPermissionProvider } from "../../src/application/policy-engine.js";

describe("RuleBasedPermissionProvider", () => {
  it("uses priority and scoped resources with deny by default", async () => {
    const policy = new RuleBasedPermissionProvider([
      { capability: "filesystem.read", resource: "/workspace/**", decision: "allow" },
      {
        capability: "filesystem.read",
        resource: "/workspace/.env",
        decision: "deny",
        priority: 10,
      },
    ]);

    await expect(
      policy.evaluate({
        capability: "filesystem.read",
        resource: "/workspace/src/index.ts",
        operation: "read",
      }),
    ).resolves.toMatchObject({ decision: "allow" });
    await expect(
      policy.evaluate({
        capability: "filesystem.read",
        resource: "/workspace/.env",
        operation: "read",
      }),
    ).resolves.toMatchObject({ decision: "deny" });
    await expect(
      policy.evaluate({
        capability: "network.connect",
        resource: "https://example.test",
        operation: "connect",
      }),
    ).resolves.toMatchObject({ decision: "deny" });
  });
});
