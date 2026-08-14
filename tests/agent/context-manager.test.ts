import { describe, expect, it } from "vitest";
import { SlidingWindowContextManager } from "../../src/application/agent/context-manager.js";
import type { ModelMessage } from "../../src/domain/providers.js";

describe("SlidingWindowContextManager", () => {
  it("preserves the initial goal and recent tool context while compacting older turns", async () => {
    const messages: ModelMessage[] = Array.from({ length: 8 }, (_, index) => ({
      role: index === 0 ? "system" : index === 1 ? "user" : "assistant",
      content: [{ type: "text", text: `message-${index}` }],
    }));
    const compacted = await new SlidingWindowContextManager(5).compact(messages);

    expect(compacted).toHaveLength(5);
    expect(compacted[0]).toEqual(messages[0]);
    expect(compacted[1]).toEqual(messages[1]);
    const summary = compacted[2]?.content[0];
    expect(summary?.type).toBe("text");
    expect(summary?.type === "text" ? summary.text : "").toContain("Compacted prior context");
    expect(compacted.at(-1)).toEqual(messages.at(-1));
  });
});
