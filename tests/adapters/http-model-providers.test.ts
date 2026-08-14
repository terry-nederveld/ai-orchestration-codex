import { describe, expect, it } from "vitest";
import { AnthropicMessagesProvider } from "../../src/adapters/model/anthropic-messages.js";
import type { FetchClient } from "../../src/adapters/model/http-support.js";
import { OpenAICompatibleProvider } from "../../src/adapters/model/openai-compatible.js";
import { OpenAIResponsesProvider } from "../../src/adapters/model/openai-responses.js";
import type { ModelEvent, ModelRequest } from "../../src/domain/providers.js";
import { assertModelProviderContract } from "../contracts/model-provider.contract.js";

const request: ModelRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: [{ type: "text", text: "Be precise" }] },
    { role: "user", content: [{ type: "text", text: "Inspect the repository" }] },
  ],
  tools: [
    {
      name: "list_files",
      description: "List files",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

describe("HTTP model provider adapters", () => {
  it("normalizes OpenAI Responses API streaming", async () => {
    const capture: CapturedRequest[] = [];
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-key",
      baseUrl: "https://openai.test/v1",
      fetch: fixtureFetch(capture, openAIStream),
      models: ["test-model"],
    });

    await assertModelProviderContract(provider);
    const events = await collect(provider.invoke(request));

    expect(events).toContainEqual({ type: "text_delta", delta: "Done" });
    expect(events).toContainEqual({
      type: "tool_call",
      call: { type: "tool_call", id: "call_1", name: "list_files", arguments: { depth: 2 } },
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 11, outputTokens: 7, cachedInputTokens: 3 },
    });
    expect(capture.at(-1)?.url).toBe("https://openai.test/v1/responses");
    expect(capture.at(-1)?.body).toMatchObject({ model: "test-model", stream: true });
  });

  it("normalizes Anthropic Messages API streaming", async () => {
    const capture: CapturedRequest[] = [];
    const provider = new AnthropicMessagesProvider({
      apiKey: "test-key",
      baseUrl: "https://anthropic.test/v1",
      fetch: fixtureFetch(capture, anthropicStream),
      models: ["test-model"],
    });

    await assertModelProviderContract(provider);
    const events = await collect(provider.invoke(request));

    expect(events).toContainEqual({ type: "text_delta", delta: "Done" });
    expect(events).toContainEqual({
      type: "tool_call",
      call: { type: "tool_call", id: "toolu_1", name: "list_files", arguments: { depth: 2 } },
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 13, outputTokens: 8, cachedInputTokens: 2 },
    });
    expect(capture.at(-1)?.body).toMatchObject({ system: "Be precise", max_tokens: 4096 });
  });

  it("normalizes OpenAI-compatible chat completion streaming", async () => {
    const capture: CapturedRequest[] = [];
    const provider = new OpenAICompatibleProvider({
      id: "openrouter",
      displayName: "OpenRouter",
      apiKey: "test-key",
      baseUrl: "https://openrouter.test/api/v1",
      fetch: fixtureFetch(capture, compatibleStream),
      models: ["test-model"],
    });

    await assertModelProviderContract(provider);
    const events = await collect(provider.invoke(request));

    expect(events).toContainEqual({ type: "text_delta", delta: "Done" });
    expect(events).toContainEqual({
      type: "tool_call",
      call: { type: "tool_call", id: "call_2", name: "list_files", arguments: { depth: 2 } },
    });
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 9, outputTokens: 4, cachedInputTokens: 1 },
    });
    expect(capture.at(-1)?.body).toMatchObject({
      model: "test-model",
      stream_options: { include_usage: true },
    });
  });

  it("classifies retryable HTTP failures", async () => {
    const provider = new OpenAIResponsesProvider({
      apiKey: "test-key",
      fetch: async () => new Response("busy", { status: 429 }),
      models: ["test-model"],
    });
    await expect(collect(provider.invoke(request))).resolves.toEqual([
      { type: "error", error: "HTTP 429: busy", retryable: true },
    ]);
  });
});

interface CapturedRequest {
  url: string;
  body?: Record<string, unknown>;
}

function fixtureFetch(capture: CapturedRequest[], stream: string): FetchClient {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    capture.push({ url, ...(body === undefined ? {} : { body }) });
    if (url.endsWith("/models")) return Response.json({ data: [] });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  };
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const result: ModelEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const openAIStream =
  sse("response.output_text.delta", { type: "response.output_text.delta", delta: "Done" }) +
  sse("response.output_item.added", {
    type: "response.output_item.added",
    item: { type: "function_call", id: "item_1", call_id: "call_1", name: "list_files" },
  }) +
  sse("response.function_call_arguments.delta", {
    type: "response.function_call_arguments.delta",
    item_id: "item_1",
    delta: '{"depth":',
  }) +
  sse("response.function_call_arguments.done", {
    type: "response.function_call_arguments.done",
    item_id: "item_1",
    arguments: '{"depth":2}',
  }) +
  sse("response.completed", {
    type: "response.completed",
    response: {
      usage: { input_tokens: 11, output_tokens: 7, input_tokens_details: { cached_tokens: 3 } },
    },
  }) +
  "data: [DONE]\n\n";

const anthropicStream =
  sse("message_start", {
    type: "message_start",
    message: {
      usage: { input_tokens: 13, output_tokens: 1, cache_read_input_tokens: 2 },
    },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Done" },
  }) +
  sse("content_block_start", {
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_1", name: "list_files", input: {} },
  }) +
  sse("content_block_delta", {
    type: "content_block_delta",
    index: 1,
    delta: { type: "input_json_delta", partial_json: '{"depth":2}' },
  }) +
  sse("content_block_stop", { type: "content_block_stop", index: 1 }) +
  sse("message_delta", { type: "message_delta", usage: { output_tokens: 8 } }) +
  sse("message_stop", { type: "message_stop" });

const compatibleStream =
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Done" } }] })}\n\n` +
  `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_2",
              function: { name: "list_files", arguments: '{"depth":' },
            },
          ],
        },
      },
    ],
  })}\n\n` +
  `data: ${JSON.stringify({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "2}" } }] } }],
  })}\n\n` +
  `data: ${JSON.stringify({
    choices: [],
    usage: { prompt_tokens: 9, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 1 } },
  })}\n\n` +
  "data: [DONE]\n\n";
