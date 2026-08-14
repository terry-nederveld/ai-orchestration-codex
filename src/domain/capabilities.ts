export const capabilities = [
  "chat",
  "reasoning",
  "tool_use",
  "parallel_tool_use",
  "structured_output",
  "vision",
  "web_search",
  "computer_use",
  "code_execution",
  "long_context",
  "context_compaction",
  "subagents",
  "background_tasks",
  "mcp",
  "skills",
  "hooks",
  "streaming",
  "resume_session",
] as const;

export type Capability = (typeof capabilities)[number];

export class CapabilitySet {
  readonly #values: ReadonlySet<Capability>;

  public constructor(values: Iterable<Capability> = []) {
    this.#values = new Set(values);
  }

  public supports(capability: Capability): boolean {
    return this.#values.has(capability);
  }

  public supportsAll(required: Iterable<Capability>): boolean {
    return [...required].every((capability) => this.supports(capability));
  }

  public toArray(): Capability[] {
    return [...this.#values].sort();
  }
}
