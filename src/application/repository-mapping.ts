import type { RepositoryBinding, RepositoryRole } from "../domain/execution.js";
import type { JsonObject, JsonValue } from "../domain/json.js";

export type MappingCondition =
  | { operator: "equals"; path: string; value: JsonValue }
  | { operator: "in"; path: string; values: JsonValue[] }
  | { operator: "contains"; path: string; value: JsonValue }
  | { operator: "regex"; path: string; pattern: string; flags?: string }
  | { operator: "and"; conditions: MappingCondition[] }
  | { operator: "or"; conditions: MappingCondition[] }
  | { operator: "not"; condition: MappingCondition };

export interface RepositoryMappingRule {
  id: string;
  priority: number;
  when: MappingCondition;
  repositories: RepositoryMappingTarget[];
  mode?: "merge" | "replace";
}

export interface RepositoryMappingTarget {
  id: string;
  cloneUrl: string;
  role: RepositoryRole;
  defaultBranch?: string;
  localPath?: string;
}

export interface RepositoryResolution {
  repositories: RepositoryBinding[];
  matchedRuleIds: string[];
  conflicts: string[];
}

export function evaluateMappingCondition(
  condition: MappingCondition,
  context: JsonObject,
): boolean {
  if (condition.operator === "and")
    return condition.conditions.every((child) => evaluateMappingCondition(child, context));
  if (condition.operator === "or")
    return condition.conditions.some((child) => evaluateMappingCondition(child, context));
  if (condition.operator === "not") return !evaluateMappingCondition(condition.condition, context);
  const value = valueAtPath(context, condition.path);
  if (condition.operator === "equals") return deepEqual(value, condition.value);
  if (condition.operator === "in")
    return condition.values.some((candidate) => deepEqual(value, candidate));
  if (condition.operator === "contains") {
    if (typeof value === "string" && typeof condition.value === "string")
      return value.includes(condition.value);
    if (Array.isArray(value)) return value.some((item) => deepEqual(item, condition.value));
    return false;
  }
  if (typeof value !== "string") return false;
  return safeRegex(condition.pattern, condition.flags).test(value);
}

export class RepositoryMappingResolver {
  public resolve(input: {
    context: JsonObject;
    explicit?: RepositoryBinding[];
    rules: RepositoryMappingRule[];
    discovered?: RepositoryBinding[];
  }): RepositoryResolution {
    const matched = input.rules
      .filter((rule) => evaluateMappingCondition(rule.when, input.context))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    const selected = new Map<string, { binding: RepositoryBinding; precedence: number }>();
    const conflicts: string[] = [];

    for (const binding of input.discovered ?? []) {
      addBinding(selected, { ...binding, source: "agent_discovery" }, 100, conflicts);
    }
    for (const rule of [...matched].reverse()) {
      if (rule.mode === "replace") {
        for (const [id, selectedValue] of selected) {
          if (selectedValue.precedence < 200 + rule.priority) selected.delete(id);
        }
      }
      for (const binding of rule.repositories) {
        addBinding(
          selected,
          { ...binding, source: "mapping", ruleId: rule.id },
          200 + rule.priority,
          conflicts,
        );
      }
    }
    for (const binding of input.explicit ?? []) {
      addBinding(selected, { ...binding, source: "explicit" }, 1_000, conflicts);
    }

    return {
      repositories: [...selected.values()]
        .map(({ binding }) => binding)
        .sort(
          (left, right) => left.role.localeCompare(right.role) || left.id.localeCompare(right.id),
        ),
      matchedRuleIds: matched.map(({ id }) => id),
      conflicts,
    };
  }
}

function addBinding(
  selected: Map<string, { binding: RepositoryBinding; precedence: number }>,
  binding: RepositoryBinding,
  precedence: number,
  conflicts: string[],
): void {
  const previous = selected.get(binding.id);
  if (previous === undefined || precedence > previous.precedence) {
    selected.set(binding.id, { binding: structuredClone(binding), precedence });
    return;
  }
  if (
    precedence === previous.precedence &&
    (previous.binding.cloneUrl !== binding.cloneUrl || previous.binding.role !== binding.role)
  ) {
    conflicts.push(
      `Repository ${binding.id} has equal-precedence mappings for ${previous.binding.role} and ${binding.role}`,
    );
  }
}

function valueAtPath(value: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function deepEqual(left: JsonValue | undefined, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeRegex(pattern: string, flags?: string): RegExp {
  if (pattern.length > 512) throw new Error("Mapping regex exceeds 512 characters");
  if (flags !== undefined && !/^[imsu]*$/.test(flags)) throw new Error("Unsupported regex flags");
  if (/\([^)]*[+*][^)]*\)[+*{]|([+*])\1/.test(pattern)) {
    throw new Error("Mapping regex contains unsafe nested or repeated quantifiers");
  }
  return new RegExp(pattern, flags);
}
