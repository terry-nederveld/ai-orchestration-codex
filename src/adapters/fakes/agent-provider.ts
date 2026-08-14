import type {
  AgentProviderEvent,
  AgentRequest,
  ProviderDescriptor,
} from "../../domain/providers.js";
import type { AgentProvider } from "../../ports/providers.js";

export class ScriptedAgentProvider implements AgentProvider {
  public readonly descriptor: ProviderDescriptor & { kind: "agent" } = {
    id: "fake-agent",
    displayName: "Scripted agent",
    kind: "agent",
    version: "1.0.0",
    capabilities: ["streaming", "resume_session", "tool_use"],
    authentication: ["none"],
  };

  public readonly requests: AgentRequest[] = [];

  public constructor(private readonly scripts: AgentProviderEvent[][]) {}

  public async availability(): Promise<{
    installed: boolean;
    authenticated: boolean;
    available: boolean;
  }> {
    return { installed: true, authenticated: true, available: true };
  }

  public async *run(
    request: AgentRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentProviderEvent> {
    this.requests.push(structuredClone(request));
    const script = this.scripts.shift();
    if (script === undefined) throw new Error("No scripted agent response remains");
    for (const event of script) {
      signal?.throwIfAborted();
      yield structuredClone(event);
    }
  }
}
