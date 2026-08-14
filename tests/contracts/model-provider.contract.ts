import { expect } from "vitest";
import type { ModelProvider } from "../../src/ports/providers.js";

export async function assertModelProviderContract(provider: ModelProvider): Promise<void> {
  expect(provider.descriptor.kind).toBe("model");
  expect(provider.descriptor.id).not.toBe("");
  const availability = await provider.availability();
  expect(typeof availability.available).toBe("boolean");

  const events = [];
  for await (const event of provider.invoke({
    model: "scripted",
    messages: [{ role: "user", content: [{ type: "text", text: "complete" }] }],
    tools: [],
  })) {
    events.push(event);
  }
  expect(events.at(-1)?.type).toBe("completed");
}
