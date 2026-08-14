import { describe, expect, it } from "vitest";
import { ScriptedModelProvider } from "../../src/adapters/fakes/model-provider.js";

describe("ScriptedModelProvider", () => {
  it("streams chunks, tool calls, usage, and explicit completion", async () => {
    const provider = new ScriptedModelProvider([
      [
        { type: "text", text: "hello", chunkSize: 2 },
        { type: "tool_call", name: "read", arguments: { path: "README.md" } },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 3 } },
        { type: "complete", outcome: "GOAL_COMPLETED" },
      ],
    ]);

    const events = [];
    for await (const event of provider.invoke({ model: "scripted", messages: [], tools: [] })) {
      events.push(event);
    }

    expect(events.map(({ type }) => type)).toEqual([
      "text_delta",
      "text_delta",
      "text_delta",
      "tool_call",
      "usage",
      "completed",
    ]);
    expect(events.at(-1)).toMatchObject({ type: "completed", outcome: "GOAL_COMPLETED" });
  });
});
