import type { JsonObject, JsonValue } from "../domain/json.js";

export type ConfigurationLayer = JsonObject;

export class LayeredConfiguration {
  readonly #value: JsonObject;

  public constructor(layers: ConfigurationLayer[]) {
    this.#value = layers.reduce<JsonObject>((merged, layer) => deepMerge(merged, layer), {});
  }

  public value(): JsonObject {
    return structuredClone(this.#value);
  }

  public get(path: string): JsonValue | undefined {
    let current: JsonValue = this.#value;
    for (const part of path.split(".")) {
      if (current === null || Array.isArray(current) || typeof current !== "object")
        return undefined;
      const next: JsonValue | undefined = current[part];
      if (next === undefined) return undefined;
      current = next;
    }
    return structuredClone(current);
  }
}

export function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isObject(existing) && isObject(value)) result[key] = deepMerge(existing, value);
    else result[key] = structuredClone(value);
  }
  return result;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}
