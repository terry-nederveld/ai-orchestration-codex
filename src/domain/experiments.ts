import type { JsonObject, JsonValue } from "./json.js";

export interface EvaluationCriterion extends JsonObject {
  id: string;
  name: string;
  description: string;
  weight: number;
  hardKillBelow?: number;
}

export interface EvaluationRubric extends JsonObject {
  id: string;
  version: number;
  name: string;
  criteria: EvaluationCriterion[];
}

export interface ExperimentCandidate extends JsonObject {
  id: string;
  name: string;
  iteration: number;
  payload: JsonObject;
}

export interface CandidateEvidence extends JsonObject {
  source: string;
  summary: string;
  value?: JsonValue;
}

export interface CandidateArtifact extends JsonObject {
  id: string;
  kind: "prototype" | "test" | "simulation" | "document" | "screenshot" | "other";
  name: string;
  reference: string;
}

export interface CandidateResult extends JsonObject {
  candidate: ExperimentCandidate;
  artifacts: CandidateArtifact[];
  evidence: CandidateEvidence[];
  scores: JsonObject;
  totalScore: number;
  killed: boolean;
  advanced: boolean;
  reasons: string[];
  durationMs: number;
}

export interface JudgmentPackage extends JsonObject {
  experimentId: string;
  outcome: string;
  hypothesis: string;
  criteria: EvaluationCriterion[];
  survivors: CandidateResult[];
  recommendation: string;
  risks: string[];
  decisions: Array<"Kill" | "Advance" | "Iterate" | "Need More Evidence">;
}

export interface ExperimentResult extends JsonObject {
  id: string;
  outcome: string;
  hypothesis: string;
  rubricId: string;
  rubricVersion: number;
  rubricDigest: string;
  candidates: CandidateResult[];
  rejected: CandidateResult[];
  survivors: CandidateResult[];
  lessons: string[];
  judgment: JudgmentPackage;
  metrics: {
    ideasTested: number;
    candidates: number;
    killRate: number;
    advanceRate: number;
    humanOverrides: number;
    iterations: number;
    timeToPrototypeMs: number;
  };
}
