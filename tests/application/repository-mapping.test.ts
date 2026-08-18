import { describe, expect, it } from "vitest";
import {
  evaluateMappingCondition,
  RepositoryMappingResolver,
} from "../../src/application/repository-mapping.js";

describe("RepositoryMappingResolver", () => {
  it("evaluates nested conditions and applies explicit > mapping > discovery precedence", () => {
    const resolver = new RepositoryMappingResolver();
    const result = resolver.resolve({
      context: {
        issue: { type: "Story", project: "WEB", labels: ["frontend", "agent-ready"] },
        parent: { fields: { portfolio: "Customer" } },
      },
      discovered: [
        {
          id: "web",
          cloneUrl: "https://discovered.invalid/web.git",
          role: "primary",
          source: "agent_discovery",
        },
      ],
      rules: [
        {
          id: "customer-web",
          priority: 10,
          when: {
            operator: "and",
            conditions: [
              { operator: "equals", path: "issue.project", value: "WEB" },
              { operator: "contains", path: "issue.labels", value: "frontend" },
              { operator: "regex", path: "parent.fields.portfolio", pattern: "^Cust" },
            ],
          },
          repositories: [
            { id: "web", cloneUrl: "https://mapping.invalid/web.git", role: "frontend" },
            { id: "docs", cloneUrl: "https://mapping.invalid/docs.git", role: "docs" },
          ],
        },
      ],
      explicit: [
        {
          id: "web",
          cloneUrl: "https://explicit.invalid/web.git",
          role: "primary",
          source: "explicit",
        },
      ],
    });

    expect(result.matchedRuleIds).toEqual(["customer-web"]);
    expect(result.repositories).toEqual([
      expect.objectContaining({ id: "docs", source: "mapping", role: "docs" }),
      expect.objectContaining({
        id: "web",
        source: "explicit",
        cloneUrl: "https://explicit.invalid/web.git",
      }),
    ]);
  });

  it("supports OR/NOT/in and reports equal-precedence conflicts deterministically", () => {
    const context = { issue: { type: "Bug", project: "API" } };
    expect(
      evaluateMappingCondition(
        {
          operator: "and",
          conditions: [
            { operator: "in", path: "issue.type", values: ["Bug", "Incident"] },
            {
              operator: "not",
              condition: { operator: "equals", path: "issue.project", value: "WEB" },
            },
          ],
        },
        context,
      ),
    ).toBe(true);
    const result = new RepositoryMappingResolver().resolve({
      context,
      rules: [
        {
          id: "a",
          priority: 5,
          when: { operator: "equals", path: "issue.type", value: "Bug" },
          repositories: [{ id: "api", cloneUrl: "a", role: "backend" }],
        },
        {
          id: "b",
          priority: 5,
          when: { operator: "equals", path: "issue.type", value: "Bug" },
          repositories: [{ id: "api", cloneUrl: "b", role: "infra" }],
        },
      ],
    });
    expect(result.conflicts).toHaveLength(1);
  });

  it("rejects regex forms with obvious catastrophic-backtracking structure", () => {
    expect(() =>
      evaluateMappingCondition(
        { operator: "regex", path: "issue.title", pattern: "(a+)+$" },
        { issue: { title: "aaaaaaaaaaaaaaaa!" } },
      ),
    ).toThrow(/unsafe/);
  });
});
