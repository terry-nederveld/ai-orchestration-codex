import type { JsonObject } from "../domain/json.js";
import type { PermissionCapability } from "../domain/permissions.js";
import type { Provider } from "./providers.js";
import type { ToolDefinition } from "./tools.js";

export interface ExtensionManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  entry: string;
  provides: {
    tools?: string[];
    workflowActions?: string[];
    providers?: string[];
    hooks?: string[];
    skills?: string[];
  };
  permissions: PermissionCapability[];
  metadata?: JsonObject;
}

export interface ExtensionContribution {
  tools?: ToolDefinition[];
  workflowActions?: WorkflowAction[];
  hooks?: HookRegistration[];
}

export interface ExtensionProvider extends Provider {
  readonly descriptor: Provider["descriptor"] & { kind: "extension" };
  discover(paths: string[]): Promise<ExtensionManifest[]>;
  load(manifest: ExtensionManifest): Promise<ExtensionContribution>;
}

export interface WorkflowActionContext {
  runId: string;
  workspacePath?: string;
  inputs: JsonObject;
  signal: AbortSignal;
}

export interface WorkflowAction {
  id: string;
  execute(context: WorkflowActionContext): Promise<JsonObject>;
}

export type HookName =
  | "before_work_claim"
  | "after_work_claim"
  | "before_workspace_create"
  | "after_workspace_create"
  | "before_agent_start"
  | "after_agent_turn"
  | "before_tool_call"
  | "after_tool_call"
  | "before_subagent"
  | "after_subagent"
  | "before_commit"
  | "after_commit"
  | "before_pull_request"
  | "after_pull_request"
  | "on_failure"
  | "on_complete"
  | "on_cleanup";

export interface HookRegistration {
  name: HookName;
  id: string;
  priority?: number;
  execute(context: JsonObject, signal: AbortSignal): Promise<JsonObject | void>;
}
