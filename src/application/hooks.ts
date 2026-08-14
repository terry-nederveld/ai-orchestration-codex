import type { JsonObject } from "../domain/json.js";
import type { HookName, HookRegistration } from "../ports/extensions.js";

export class HookRegistry {
  readonly #hooks = new Map<HookName, HookRegistration[]>();

  public register(hook: HookRegistration): void {
    const hooks = this.#hooks.get(hook.name) ?? [];
    if (hooks.some(({ id }) => id === hook.id)) {
      throw new Error(`Hook already registered for ${hook.name}: ${hook.id}`);
    }
    hooks.push(hook);
    hooks.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
    this.#hooks.set(hook.name, hooks);
  }

  public async execute(
    name: HookName,
    context: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonObject> {
    let current = structuredClone(context);
    for (const hook of this.#hooks.get(name) ?? []) {
      signal.throwIfAborted();
      const result = await hook.execute(current, signal);
      if (result !== undefined) current = { ...current, ...result };
    }
    return current;
  }
}
