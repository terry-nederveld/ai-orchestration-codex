import type { JsonObject, JsonValue } from "../domain/json.js";
import type { PermissionCapability } from "../domain/permissions.js";

export interface ToolContext {
  runId: string;
  workspacePath: string;
  signal: AbortSignal;
  metadata: JsonObject;
}

export interface ToolResult {
  content: JsonValue;
  isError?: boolean;
  metadata?: JsonObject;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  permissions: PermissionCapability[];
  execute(input: JsonObject, context: ToolContext): Promise<ToolResult>;
}

export interface ToolProvider {
  readonly id: string;
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
}
