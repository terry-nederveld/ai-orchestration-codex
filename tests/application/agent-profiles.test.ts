import { describe, expect, it } from "vitest";
import {
  AgentProfileComposer,
  DeterministicFallbackRouter,
} from "../../src/application/agent-profiles.js";
import type { AgentProfileDefinition } from "../../src/domain/policies.js";

describe("agent profiles", () => {
  it("composes fragments and node overrides without inheritance", () => {
    const composer = new AgentProfileComposer([
      profile("base", 1, {
        capabilities: ["tool_use"],
        tools: ["read"],
        permissions: ["filesystem.read"],
        budgets: { maxInputTokens: 10_000 },
      }),
      profile("delivery", 2, {
        fragments: [{ id: "base", version: 1 }],
        provider: "codex",
        model: "strong",
        tools: ["write"],
      }),
    ]);
    const result = composer.compose("delivery", 2, {
      tools: ["test"],
      budgets: { maxEstimatedCostUsd: 4 },
    });
    expect(result.tools).toEqual(["read", "write", "test"]);
    expect(result.capabilities).toEqual(["tool_use"]);
    expect(result.budgets).toEqual({ maxInputTokens: 10_000, maxEstimatedCostUsd: 4 });
  });

  it("routes fallback only for declared reasons and enforces capabilities and budget", () => {
    const value = profile("delivery", 1, {
      provider: "primary",
      model: "p1",
      capabilities: ["tool_use", "structured_output"],
      fallback: [
        {
          provider: "cheap",
          model: "c1",
          on: ["outage"],
          requiredCapabilities: ["structured_output"],
          maxEstimatedCostUsd: 1,
        },
        {
          provider: "strong",
          model: "s1",
          on: ["outage", "rate_limit"],
          requiredCapabilities: ["structured_output"],
          reasoningClass: "strong",
        },
      ],
    });
    const decision = new DeterministicFallbackRouter().select({
      profile: value,
      failureReason: "outage",
      remainingCostUsd: 2,
      candidates: [
        {
          provider: "primary",
          model: "p1",
          available: false,
          capabilities: ["tool_use", "structured_output"],
          reasoningClass: "strong",
        },
        {
          provider: "cheap",
          model: "c1",
          available: true,
          capabilities: ["tool_use"],
          reasoningClass: "balanced",
          estimatedCostUsd: 0.5,
        },
        {
          provider: "strong",
          model: "s1",
          available: true,
          capabilities: ["tool_use", "structured_output"],
          reasoningClass: "strong",
          estimatedCostUsd: 1.5,
        },
      ],
    });
    expect(decision.selected).toMatchObject({ provider: "strong", model: "s1" });
    expect(decision.attempted.map(({ reason }) => reason)).toEqual([
      "unavailable",
      "capability mismatch",
      "selected",
    ]);
  });
});

function profile(
  id: string,
  version: number,
  overrides: Partial<AgentProfileDefinition>,
): AgentProfileDefinition {
  return {
    id,
    version,
    name: id,
    fragments: [],
    fallback: [],
    capabilities: [],
    instructionStack: [],
    contextResolvers: [],
    tools: [],
    permissions: [],
    budgets: {},
    repositoryPermissions: {},
    evaluationResponsibilities: [],
    ...overrides,
  };
}
