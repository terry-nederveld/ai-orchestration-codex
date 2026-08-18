import type { JsonObject } from "../domain/json.js";
import type { GateDefinition, GateSetDefinition } from "../domain/policies.js";

export interface GateResult {
  passed: boolean;
  message: string;
  evidence?: JsonObject;
}

export interface GateEvaluationRecord {
  gateId: string;
  passed: boolean;
  required: boolean;
  attempts: number;
  evaluations: GateResult[];
  remediations: JsonObject[];
}

export interface GateSetResult {
  gateSetId: string;
  gateSetVersion: number;
  passed: boolean;
  gates: GateEvaluationRecord[];
}

export type GateEvaluator = (gate: GateDefinition, context: JsonObject) => Promise<GateResult>;
export type GateRemediator = (
  gate: GateDefinition,
  context: JsonObject,
  failure: GateResult,
) => Promise<JsonObject>;

export class GateService {
  public constructor(
    private readonly evaluators: ReadonlyMap<string, GateEvaluator>,
    private readonly remediators: ReadonlyMap<string, GateRemediator> = new Map(),
  ) {}

  public async evaluate(gateSet: GateSetDefinition, context: JsonObject): Promise<GateSetResult> {
    const records: GateEvaluationRecord[] = [];
    for (const gate of gateSet.gates) {
      const evaluator = this.evaluators.get(gate.evaluator);
      if (evaluator === undefined) throw new Error(`Unknown gate evaluator: ${gate.evaluator}`);
      const evaluations: GateResult[] = [];
      const remediations: JsonObject[] = [];
      let attempts = 0;
      let result = await evaluator(gate, context);
      evaluations.push(result);
      const remediation = gate.remediation;
      while (!result.passed && remediation !== undefined && attempts < remediation.maxAttempts) {
        const remediator = this.remediators.get(remediation.action);
        if (remediator === undefined)
          throw new Error(`Unknown gate remediator: ${remediation.action}`);
        attempts += 1;
        remediations.push(await remediator(gate, context, result));
        result = await evaluator(gate, context);
        evaluations.push(result);
      }
      records.push({
        gateId: gate.id,
        passed: result.passed,
        required: gate.required,
        attempts,
        evaluations,
        remediations,
      });
    }
    return {
      gateSetId: gateSet.id,
      gateSetVersion: gateSet.version,
      passed: records.every((record) => !record.required || record.passed),
      gates: records,
    };
  }
}
