import type {
  AgentRun,
  ApprovalRecord,
  ControlPlaneConnection,
  DomainEvent,
  ProviderStatus,
  Snapshot,
  SchedulerStatus,
  WorkItem,
  WaitCondition,
  WorkflowDefinition,
  WorkflowEvaluationPlan,
} from "./types.js";

interface Envelope {
  error?: string;
}

export class FableClient {
  public constructor(private readonly connection: ControlPlaneConnection) {}

  public async snapshot(signal?: AbortSignal): Promise<Snapshot> {
    const [providers, runs, workflows, approvals, waits, scheduler] = await Promise.all([
      this.request<{ providers: ProviderStatus[] }>("/api/providers", withSignal(signal)),
      this.request<{ runs: AgentRun[] }>("/api/runs", withSignal(signal)),
      this.request<{ workflows: WorkflowDefinition[] }>("/api/workflows", withSignal(signal)),
      this.request<{ approvals: ApprovalRecord[] }>("/api/approvals", withSignal(signal)),
      this.request<{ waits: WaitCondition[] }>("/api/waits", withSignal(signal)),
      this.request<{ scheduler: SchedulerStatus }>("/api/scheduler", withSignal(signal)),
    ]);
    return {
      providers: providers.providers,
      runs: runs.runs,
      workflows: workflows.workflows,
      approvals: approvals.approvals,
      waits: waits.waits,
      scheduler: scheduler.scheduler,
    };
  }

  public async work(provider: string, signal?: AbortSignal): Promise<WorkItem[]> {
    const result = await this.request<{ items: WorkItem[] }>(
      `/api/work?provider=${encodeURIComponent(provider)}&limit=100`,
      withSignal(signal),
    );
    return result.items;
  }

  public async events(runId: string, signal?: AbortSignal): Promise<DomainEvent[]> {
    const result = await this.request<{ events: DomainEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/events`,
      withSignal(signal),
    );
    return result.events;
  }

  public async startRun(input: {
    workProviderId: string;
    externalId: string;
    workflowId: string;
  }): Promise<string> {
    const result = await this.request<{ runId: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.runId;
  }

  public async publishWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    const result = await this.request<{ workflow: WorkflowDefinition }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ definition }),
    });
    return result.workflow;
  }

  public async evaluateWorkflow(
    definition: WorkflowDefinition,
    workItem: WorkItem,
  ): Promise<WorkflowEvaluationPlan> {
    const result = await this.request<{ evaluation: WorkflowEvaluationPlan }>(
      "/api/workflows/evaluate",
      { method: "POST", body: JSON.stringify({ definition, workItem }) },
    );
    return result.evaluation;
  }

  public async cancelRun(runId: string): Promise<boolean> {
    const result = await this.request<{ cancelled: boolean }>(
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    );
    return result.cancelled;
  }

  public async resolveApproval(id: string, decision: "approved" | "denied"): Promise<boolean> {
    const result = await this.request<{ resolved: boolean }>(
      `/api/approvals/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify({ decision }) },
    );
    return result.resolved;
  }

  public async respondToWait(
    id: string,
    input: { actorId: string; value: unknown; promote?: boolean },
  ): Promise<{ accepted: boolean; selected: boolean }> {
    return this.request(`/api/waits/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      body: JSON.stringify({ source: "app", ...input }),
    });
  }

  public async subscribe(
    onEvent: (event: DomainEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.connection.url}/api/events`, {
      headers: this.headers(),
      signal,
    });
    if (!response.ok || response.body === null) throw await responseError(response);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!frame.startsWith("event: domain-event")) continue;
        const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
        if (line !== undefined) onEvent(JSON.parse(line.slice(6)) as DomainEvent);
      }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.connection.url}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    });
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as T;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.connection.token}`,
      "content-type": "application/json",
    };
  }
}

async function responseError(response: Response): Promise<Error> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as Envelope;
    if (typeof body.error === "string") message = body.error;
  } catch {
    // Preserve the useful HTTP fallback when the response is not JSON.
  }
  return new Error(message);
}

function withSignal(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? {} : { signal };
}
