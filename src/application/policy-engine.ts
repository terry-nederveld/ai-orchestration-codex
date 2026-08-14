import type {
  PermissionEvaluation,
  PermissionRequest,
  PermissionRule,
} from "../domain/permissions.js";
import type { PermissionProvider } from "../ports/security.js";

export class RuleBasedPermissionProvider implements PermissionProvider {
  readonly #rules: PermissionRule[];

  public constructor(
    rules: PermissionRule[],
    private readonly defaultDecision = "deny" as const,
  ) {
    this.#rules = [...rules].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  }

  public async evaluate(request: PermissionRequest): Promise<PermissionEvaluation> {
    const rule = this.#rules.find(
      (candidate) =>
        (candidate.capability === "*" || candidate.capability === request.capability) &&
        resourceMatches(candidate.resource, request.resource),
    );

    if (rule === undefined) {
      return {
        decision: this.defaultDecision,
        reason: `No permission rule matched ${request.capability} on ${request.resource}`,
      };
    }

    return {
      decision: rule.decision,
      rule,
      reason: `Matched ${rule.capability}${rule.resource === undefined ? "" : `:${rule.resource}`}`,
    };
  }
}

function resourceMatches(pattern: string | undefined, resource: string): boolean {
  if (pattern === undefined || pattern === "*") return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -2);
    return resource === prefix.slice(0, -1) || resource.startsWith(prefix);
  }
  return pattern === resource;
}
