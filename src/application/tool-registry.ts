import { ConfigurationError } from "../domain/errors.js";
import type { ToolDefinition, ToolProvider } from "../ports/tools.js";

export class ToolRegistry implements ToolProvider {
  public readonly id = "tool-registry";
  readonly #tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    if (this.#tools.has(tool.name))
      throw new ConfigurationError(`Tool already registered: ${tool.name}`);
    this.#tools.set(tool.name, tool);
  }

  public list(): ToolDefinition[] {
    return [...this.#tools.values()];
  }

  public get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }
}
