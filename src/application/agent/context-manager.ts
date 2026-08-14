import type { ModelMessage } from "../../domain/providers.js";
import type { ContextManager } from "../../ports/agent-runtime.js";

export class SlidingWindowContextManager implements ContextManager {
  public constructor(
    private readonly maxMessages = 40,
    private readonly summaryCharacters = 4_000,
  ) {
    if (maxMessages < 4) throw new RangeError("maxMessages must be at least 4");
  }

  public async compact(messages: ModelMessage[]): Promise<ModelMessage[]> {
    if (messages.length <= this.maxMessages) return structuredClone(messages);
    const preserved = messages.slice(0, 2);
    const tailCount = this.maxMessages - 3;
    const removed = messages.slice(2, -tailCount);
    const tail = messages.slice(-tailCount);
    const summary = removed
      .flatMap((message) =>
        message.content.map((content) => {
          if (content.type === "text") return `${message.role}: ${content.text}`;
          if (content.type === "tool_call") return `assistant requested tool ${content.name}`;
          return `tool result for ${content.toolCallId}: ${JSON.stringify(content.content)}`;
        }),
      )
      .join("\n")
      .slice(-this.summaryCharacters);
    return [
      ...structuredClone(preserved),
      {
        role: "system",
        content: [{ type: "text", text: `Compacted prior context:\n${summary}` }],
      },
      ...structuredClone(tail),
    ];
  }
}
