import type { JsonObject, JsonValue } from "../../domain/json.js";

const binaryPattern = /^\s*([a-zA-Z_][\w.-]*)\s*(==|!=)\s*(.*?)\s*$/;

export function evaluateCondition(expression: string, context: JsonObject): boolean {
  const trimmed = unwrap(expression.trim());
  const orParts = splitOperator(trimmed, "||");
  if (orParts.length > 1) return orParts.some((part) => evaluateCondition(part, context));
  const andParts = splitOperator(trimmed, "&&");
  if (andParts.length > 1) return andParts.every((part) => evaluateCondition(part, context));
  if (trimmed.startsWith("!")) return !evaluateCondition(trimmed.slice(1), context);

  const binary = binaryPattern.exec(trimmed);
  if (binary?.[1] !== undefined && binary[2] !== undefined && binary[3] !== undefined) {
    const left = resolvePath(context, binary[1]);
    const right = parseLiteral(binary[3], context);
    return binary[2] === "==" ? deepEqual(left, right) : !deepEqual(left, right);
  }
  return Boolean(resolvePath(context, trimmed));
}

export function interpolate<T extends JsonValue>(value: T, context: JsonObject): T {
  if (typeof value === "string") {
    const exact = /^\s*\$\{\{\s*([\w.-]+)\s*\}\}\s*$/.exec(value);
    if (exact?.[1] !== undefined) return structuredClone(resolvePath(context, exact[1])) as T;
    return value.replace(/\$\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) =>
      stringify(resolvePath(context, path)),
    ) as T;
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, context)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, context)]),
    ) as T;
  }
  return value;
}

export function resolvePath(context: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = context;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

function parseLiteral(value: string, context: JsonObject): JsonValue | undefined {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return resolvePath(context, trimmed);
}

function splitOperator(expression: string, operator: "&&" | "||"): string[] {
  let quote: string | undefined;
  for (let index = 0; index < expression.length - 1; index += 1) {
    const character = expression[index];
    if ((character === '"' || character === "'") && expression[index - 1] !== "\\") {
      quote = quote === undefined ? character : quote === character ? undefined : quote;
    }
    if (quote === undefined && expression.slice(index, index + 2) === operator) {
      return [expression.slice(0, index), expression.slice(index + 2)];
    }
  }
  return [expression];
}

function unwrap(expression: string): string {
  const match = /^\$\{\{([\s\S]*)\}\}$/.exec(expression);
  return match?.[1]?.trim() ?? expression;
}

function stringify(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function deepEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
