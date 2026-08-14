import type { Capability } from "./capabilities.js";
import type { JsonObject, JsonValue } from "./json.js";

export type ProviderKind =
  | "model"
  | "agent"
  | "work"
  | "source_control"
  | "workspace"
  | "tool"
  | "extension"
  | "secret"
  | "persistence"
  | "notification";

export type AuthenticationType =
  "none" | "api_key" | "oauth" | "device_code" | "cli_session" | "workload_identity" | "custom";

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  kind: ProviderKind;
  version: string;
  capabilities: Capability[];
  authentication: AuthenticationType[];
  metadata?: JsonObject;
}

export interface ProviderAvailability {
  installed: boolean;
  authenticated: boolean;
  available: boolean;
  models?: string[];
  detail?: string;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  content: JsonValue;
  isError?: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface ModelMessage {
  role: MessageRole;
  content: MessageContent[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  metadata?: JsonObject;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  estimatedCostUsd?: number;
  subscriptionRequests?: number;
}

export type GoalOutcome =
  | "GOAL_COMPLETED"
  | "GOAL_BLOCKED"
  | "BUDGET_EXHAUSTED"
  | "POLICY_BLOCKED"
  | "HUMAN_INPUT_REQUIRED"
  | "FATAL_FAILURE"
  | "CANCELLED";

export type ModelEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; call: ToolCallContent }
  | { type: "usage"; usage: Usage }
  | { type: "completed"; message: ModelMessage; outcome?: GoalOutcome }
  | { type: "error"; error: string; retryable: boolean };

export interface AgentRequest {
  goal: string;
  workspacePath: string;
  model?: string;
  sessionId?: string;
  metadata?: JsonObject;
}

export type AgentProviderEvent =
  | { type: "message"; text: string }
  | { type: "tool"; name: string; status: "started" | "completed" | "failed" }
  | { type: "usage"; usage: Usage }
  | { type: "session"; sessionId: string }
  | { type: "completed"; outcome: GoalOutcome; summary?: string }
  | { type: "error"; error: string; retryable: boolean };
