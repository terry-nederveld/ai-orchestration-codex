import { describe, expect, it } from "vitest";
import {
  AttachmentContextResolver,
  RelationshipContextResolver,
} from "../../src/application/context-resolution.js";
import type { WorkItem } from "../../src/domain/work.js";

describe("context resolution", () => {
  it("defaults to one-up, one-down, and direct dependency relationships", async () => {
    const items = new Map<string, WorkItem>([
      ["parent", item("parent", [{ type: "parent", targetId: "grandparent" }])],
      ["child", item("child", [{ type: "child", targetId: "grandchild" }])],
      ["blocker", item("blocker")],
      ["grandparent", item("grandparent")],
      ["grandchild", item("grandchild")],
    ]);
    const active = item("active", [
      { type: "parent", targetId: "parent" },
      { type: "child", targetId: "child" },
      { type: "blocked_by", targetId: "blocker" },
      { type: "related_to", targetId: "ignored" },
    ]);
    const resolver = new RelationshipContextResolver({
      get: async (id) => items.get(id),
    });
    const context = await resolver.resolve({ workItem: active });
    expect(context.map(({ id }) => id).sort()).toEqual(["blocker", "child", "parent"]);
  });

  it("keeps attachments opt-in and obeys type/count/byte budgets", () => {
    const attachments = [
      { id: "1", name: "one.md", mediaType: "text/markdown", sizeBytes: 5, content: "hello" },
      { id: "2", name: "two.md", mediaType: "text/markdown", sizeBytes: 8, content: "too large" },
      { id: "3", name: "image.png", mediaType: "image/png", sizeBytes: 1, content: "x" },
    ];
    expect(
      new AttachmentContextResolver({
        enabled: false,
        allowedMediaTypes: ["text/markdown"],
        maxBytes: 10,
        maxCount: 2,
      }).resolve(attachments),
    ).toEqual([]);
    expect(
      new AttachmentContextResolver({
        enabled: true,
        allowedMediaTypes: ["text/markdown"],
        maxBytes: 10,
        maxCount: 3,
      })
        .resolve(attachments)
        .map(({ id }) => id),
    ).toEqual(["1"]);
  });
});

function item(id: string, relationships: WorkItem["relationships"] = []): WorkItem {
  return {
    id,
    provider: "fixture",
    externalId: id,
    title: id,
    state: "Ready",
    labels: [],
    assignees: [],
    relationships,
    metadata: {},
  };
}
