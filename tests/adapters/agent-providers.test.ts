import type { SessionConfig, SessionEvent } from "@github/copilot-sdk";
import type { ThreadEvent } from "@openai/codex-sdk";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAgentProvider } from "../../src/adapters/agent/claude-code-agent.js";
import { CodexSdkAgentProvider } from "../../src/adapters/agent/codex-sdk-agent.js";
import { CopilotSdkAgentProvider } from "../../src/adapters/agent/copilot-sdk-agent.js";
import type { AgentProviderEvent } from "../../src/domain/providers.js";
import type {
  ProcessOutputEvent,
  ProcessRequest,
  StreamingProcessRunner,
} from "../../src/ports/process.js";
import type { PermissionProvider } from "../../src/ports/security.js";

const agentRequest = {
  goal: "Fix the failing test",
  workspacePath: "/workspace/repository",
  model: "test-model",
  metadata: { runId: "run-1" },
};

describe("coding agent providers", () => {
  it("normalizes Codex SDK events and resumes sessions", async () => {
    let resumedSession: string | undefined;
    const provider = new CodexSdkAgentProvider({
      clientFactory: () => ({
        startThread: () => codexThread(),
        resumeThread: (id) => {
          resumedSession = id;
          return codexThread();
        },
      }),
    });

    const events = await collect(
      provider.run({ ...agentRequest, sessionId: "existing-codex-session" }),
    );

    expect(resumedSession).toBe("existing-codex-session");
    expect(events).toContainEqual({ type: "session", sessionId: "codex-session" });
    expect(events).toContainEqual({ type: "tool", name: "command", status: "started" });
    expect(events).toContainEqual({ type: "message", text: "Implemented the fix" });
    expect(events).toContainEqual({
      type: "completed",
      outcome: "GOAL_COMPLETED",
      summary: "Implemented the fix",
    });
  });

  it("uses Claude Code's documented JSON stream without bypassing permissions", async () => {
    const runner = new ClaudeFixtureRunner();
    const provider = new ClaudeCodeAgentProvider({
      runner,
      allowedTools: ["Read", "Edit", "Bash(npm test:*)"],
      maxTurns: 10,
    });

    await expect(provider.availability()).resolves.toMatchObject({
      installed: true,
      authenticated: true,
      available: true,
    });
    const events = await collect(provider.run(agentRequest));

    expect(runner.request?.args).not.toContain("--dangerously-skip-permissions");
    expect(runner.request?.args).toContain("--include-partial-messages");
    expect(events).toContainEqual({ type: "session", sessionId: "claude-session" });
    expect(events).toContainEqual({ type: "message", text: "Fixed" });
    expect(events).toContainEqual({ type: "tool", name: "Edit", status: "completed" });
    expect(events).toContainEqual({
      type: "completed",
      outcome: "GOAL_COMPLETED",
      summary: "Fixed the test",
    });
  });

  it("streams Copilot SDK events and delegates permissions to policy", async () => {
    let capturedConfig: SessionConfig | undefined;
    let stopped = false;
    const permissionRequests: string[] = [];
    const permissions: PermissionProvider = {
      evaluate: async (request) => {
        permissionRequests.push(`${request.capability}:${request.resource}`);
        return { decision: "allow", reason: "test rule" };
      },
    };
    const provider = new CopilotSdkAgentProvider({
      permissions,
      clientFactory: () => ({
        start: async () => undefined,
        stop: async () => {
          stopped = true;
          return [];
        },
        getAuthStatus: async () => ({ isAuthenticated: true }),
        listModels: async () => [{ id: "test-model" }],
        createSession: async (config) => {
          capturedConfig = config;
          return copilotSession(config);
        },
        resumeSession: async (_id, config) => copilotSession(config),
      }),
    });

    const events = await collect(provider.run(agentRequest));
    const decision = await capturedConfig?.onPermissionRequest?.(
      {
        kind: "write",
        canOfferSessionApproval: false,
        diff: "+fixed",
        fileName: "/workspace/repository/test.ts",
        intention: "Fix test",
      },
      { sessionId: "copilot-session" },
    );

    expect(decision).toEqual({ kind: "approved" });
    expect(permissionRequests).toEqual(["filesystem.write:/workspace/repository/test.ts"]);
    expect(events).toContainEqual({ type: "message", text: "Fixed" });
    expect(events).toContainEqual({ type: "tool", name: "edit", status: "completed" });
    expect(events).toContainEqual({
      type: "usage",
      usage: { inputTokens: 15, outputTokens: 5, cachedInputTokens: 2, subscriptionRequests: 1 },
    });
    expect(events.at(-1)).toEqual({
      type: "completed",
      outcome: "GOAL_COMPLETED",
      summary: "Fixed",
    });
    expect(stopped).toBe(true);
  });
});

function codexThread() {
  return {
    runStreamed: async () => ({ events: codexEvents() }),
  };
}

async function* codexEvents(): AsyncGenerator<ThreadEvent> {
  yield { type: "thread.started", thread_id: "codex-session" };
  yield {
    type: "item.started",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "npm test",
      aggregated_output: "",
      status: "in_progress",
    },
  };
  yield {
    type: "item.completed",
    item: { id: "message-1", type: "agent_message", text: "Implemented the fix" },
  };
  yield {
    type: "item.completed",
    item: {
      id: "command-1",
      type: "command_execution",
      command: "npm test",
      aggregated_output: "passed",
      exit_code: 0,
      status: "completed",
    },
  };
  yield {
    type: "turn.completed",
    usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 4 },
  };
}

class ClaudeFixtureRunner implements StreamingProcessRunner {
  public request?: ProcessRequest;

  public async run(request: ProcessRequest) {
    return {
      command: request.command,
      args: request.args ?? [],
      cwd: request.cwd,
      exitCode: 0,
      stdout: '{"loggedIn":true}',
      stderr: "",
      durationMs: 1,
    };
  }

  public async *stream(request: ProcessRequest): AsyncIterable<ProcessOutputEvent> {
    this.request = request;
    const lines = [
      { type: "system", subtype: "init", session_id: "claude-session" },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "tool-1", name: "Edit" }] },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Fixed" } },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Fixed the test",
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 },
      },
    ];
    const stdout = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
    yield { type: "stdout", data: stdout.slice(0, 80) };
    yield { type: "stdout", data: stdout.slice(80) };
    yield {
      type: "exit",
      result: {
        command: request.command,
        args: request.args ?? [],
        cwd: request.cwd,
        exitCode: 0,
        stdout,
        stderr: "",
        durationMs: 1,
      },
    };
  }
}

function copilotSession(config: SessionConfig) {
  let handler: ((event: SessionEvent) => void) | undefined;
  return {
    sessionId: config.sessionId ?? "copilot-session",
    on: (value: (event: SessionEvent) => void) => {
      handler = value;
      return () => {
        handler = undefined;
      };
    },
    send: async () => {
      for (const event of copilotEvents()) handler?.(event);
      return "message-id";
    },
    abort: async () => undefined,
    disconnect: async () => undefined,
  };
}

function copilotEvents(): SessionEvent[] {
  const base = { id: "event-id", parentId: null, timestamp: new Date(0).toISOString() };
  return [
    {
      ...base,
      type: "assistant.message_delta",
      ephemeral: true,
      data: { messageId: "message-1", deltaContent: "Fixed" },
    },
    {
      ...base,
      type: "tool.execution_start",
      data: { toolCallId: "tool-1", toolName: "edit" },
    },
    {
      ...base,
      type: "tool.execution_complete",
      data: { toolCallId: "tool-1", success: true },
    },
    {
      ...base,
      type: "assistant.message",
      data: { messageId: "message-1", content: "Fixed" },
    },
    {
      ...base,
      type: "assistant.usage",
      ephemeral: true,
      data: { model: "test-model", inputTokens: 15, outputTokens: 5, cacheReadTokens: 2 },
    },
    {
      ...base,
      type: "session.idle",
      ephemeral: true,
      data: {},
    },
  ];
}

async function collect(events: AsyncIterable<AgentProviderEvent>): Promise<AgentProviderEvent[]> {
  const result: AgentProviderEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
