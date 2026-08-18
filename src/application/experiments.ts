import { randomUUID } from "node:crypto";
import type {
  CandidateArtifact,
  CandidateEvidence,
  CandidateResult,
  EvaluationCriterion,
  EvaluationRubric,
  ExperimentCandidate,
  ExperimentResult,
  JudgmentPackage,
} from "../domain/experiments.js";
import type { JsonObject } from "../domain/json.js";
import { contentDigest } from "./versioned-assets.js";

export interface ExperimentBounds {
  maxCandidates: number;
  maxIterations: number;
  maxWallClockMs: number;
  maxEvaluations: number;
  maxConcurrent: number;
}

export type CandidateExecutor = (
  candidate: ExperimentCandidate,
  signal: AbortSignal,
) => Promise<{ artifacts: CandidateArtifact[]; evidence: CandidateEvidence[] }>;

export type CriterionEvaluator = (
  criterion: EvaluationCriterion,
  candidate: ExperimentCandidate,
  evidence: CandidateEvidence[],
) => Promise<{ score: number; reason: string }>;

export class ExperimentService {
  public async run(input: {
    outcome: string;
    hypothesis: string;
    candidates: ExperimentCandidate[];
    rubric: EvaluationRubric;
    killThreshold: number;
    advanceThreshold: number;
    survivorCount: number;
    bounds: ExperimentBounds;
    executor: CandidateExecutor;
    evaluator: CriterionEvaluator;
    signal?: AbortSignal;
  }): Promise<ExperimentResult> {
    validateExperiment(input);
    const started = Date.now();
    const rubricDigest = contentDigest(input.rubric);
    const controller = new AbortController();
    const signal =
      input.signal === undefined
        ? controller.signal
        : AbortSignal.any([input.signal, controller.signal]);
    const timer = setTimeout(
      () => controller.abort(new Error("Experiment wall-clock budget exhausted")),
      input.bounds.maxWallClockMs,
    );
    timer.unref();
    let evaluationCount = 0;
    try {
      const executed = await mapConcurrent(
        input.candidates,
        input.bounds.maxConcurrent,
        async (candidate) => {
          const candidateStarted = Date.now();
          const execution = await input.executor(candidate, signal);
          const scores: JsonObject = {};
          const reasons: string[] = [];
          let weighted = 0;
          let hardKilled = false;
          for (const criterion of input.rubric.criteria) {
            signal.throwIfAborted();
            evaluationCount += 1;
            if (evaluationCount > input.bounds.maxEvaluations) {
              throw new Error("Experiment evaluation budget exhausted");
            }
            const evaluation = await input.evaluator(criterion, candidate, execution.evidence);
            if (
              !Number.isFinite(evaluation.score) ||
              evaluation.score < 0 ||
              evaluation.score > 100
            )
              throw new Error(`Criterion ${criterion.id} returned an invalid score`);
            scores[criterion.id] = {
              score: evaluation.score,
              reason: evaluation.reason,
            };
            weighted += evaluation.score * criterion.weight;
            if (
              criterion.hardKillBelow !== undefined &&
              evaluation.score < criterion.hardKillBelow
            ) {
              hardKilled = true;
              reasons.push(`${criterion.name} triggered its hard kill criterion`);
            }
          }
          const totalScore = weighted / totalWeight(input.rubric.criteria);
          if (totalScore < input.killThreshold) reasons.push("Score is below the kill threshold");
          const killed = hardKilled || totalScore < input.killThreshold;
          return {
            candidate,
            artifacts: execution.artifacts,
            evidence: execution.evidence,
            scores,
            totalScore,
            killed,
            advanced: !killed && totalScore >= input.advanceThreshold,
            reasons,
            durationMs: Date.now() - candidateStarted,
          } satisfies CandidateResult;
        },
      );
      if (contentDigest(input.rubric) !== rubricDigest) {
        throw new Error("Evaluation rubric mutated after experiment start");
      }
      const ranked = executed.sort(
        (left, right) =>
          right.totalScore - left.totalScore || left.candidate.id.localeCompare(right.candidate.id),
      );
      const survivors = ranked
        .filter((candidate) => !candidate.killed && candidate.advanced)
        .slice(0, input.survivorCount);
      for (const candidate of ranked) candidate.advanced = survivors.includes(candidate);
      const rejected = ranked.filter((candidate) => !candidate.advanced);
      const lessons = rejected.map(
        (candidate) =>
          `${candidate.candidate.name} rejected at ${candidate.totalScore.toFixed(1)}: ${candidate.reasons.join("; ") || "out-ranked"}`,
      );
      const id = randomUUID();
      const judgment = judgmentPackage(
        id,
        input.outcome,
        input.hypothesis,
        input.rubric.criteria,
        survivors,
      );
      return {
        id,
        outcome: input.outcome,
        hypothesis: input.hypothesis,
        rubricId: input.rubric.id,
        rubricVersion: input.rubric.version,
        rubricDigest,
        candidates: ranked,
        rejected,
        survivors,
        lessons,
        judgment,
        metrics: {
          ideasTested: input.candidates.length,
          candidates: ranked.length,
          killRate: ranked.length === 0 ? 0 : rejected.length / ranked.length,
          advanceRate: ranked.length === 0 ? 0 : survivors.length / ranked.length,
          humanOverrides: 0,
          iterations: Math.max(...input.candidates.map(({ iteration }) => iteration)),
          timeToPrototypeMs: Date.now() - started,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateExperiment(input: {
  candidates: ExperimentCandidate[];
  rubric: EvaluationRubric;
  survivorCount: number;
  bounds: ExperimentBounds;
}): void {
  if (
    !Number.isInteger(input.bounds.maxCandidates) ||
    input.bounds.maxCandidates < 1 ||
    input.bounds.maxCandidates > 100
  )
    throw new Error("Experiment candidate bound must be between 1 and 100");
  if (
    !Number.isInteger(input.bounds.maxIterations) ||
    input.bounds.maxIterations < 1 ||
    input.bounds.maxIterations > 100
  )
    throw new Error("Experiment iteration bound must be between 1 and 100");
  if (
    !Number.isInteger(input.bounds.maxEvaluations) ||
    input.bounds.maxEvaluations < 1 ||
    input.bounds.maxEvaluations > 10_000
  )
    throw new Error("Experiment evaluation bound must be between 1 and 10000");
  if (
    !Number.isInteger(input.bounds.maxWallClockMs) ||
    input.bounds.maxWallClockMs < 1 ||
    input.bounds.maxWallClockMs > 604_800_000
  )
    throw new Error("Experiment wall-clock bound must be between 1 ms and 7 days");
  if (input.candidates.length === 0) throw new Error("Experiment requires candidates");
  if (input.candidates.length > input.bounds.maxCandidates)
    throw new Error("Experiment candidate budget exceeded");
  if (input.candidates.some(({ iteration }) => iteration > input.bounds.maxIterations))
    throw new Error("Experiment iteration budget exceeded");
  if (input.survivorCount < 1 || input.survivorCount > input.bounds.maxCandidates)
    throw new Error("Invalid survivor count");
  if (input.rubric.criteria.length === 0 || totalWeight(input.rubric.criteria) <= 0)
    throw new Error("Rubric requires positive weighted criteria");
}

function totalWeight(criteria: EvaluationCriterion[]): number {
  return criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  execute: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be positive");
  const result = new Map<number, R>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        result.set(index, await execute(values[index]!));
      }
    }),
  );
  return values.map((_, index) => {
    if (!result.has(index)) throw new Error(`Missing concurrent result ${index}`);
    return result.get(index) as R;
  });
}

function judgmentPackage(
  experimentId: string,
  outcome: string,
  hypothesis: string,
  criteria: EvaluationCriterion[],
  survivors: CandidateResult[],
): JudgmentPackage {
  return {
    experimentId,
    outcome,
    hypothesis,
    criteria: structuredClone(criteria),
    survivors: structuredClone(survivors),
    recommendation:
      survivors.length === 0
        ? "Kill the current approaches or request more evidence."
        : `Advance ${survivors.map(({ candidate }) => candidate.name).join(", ")}.`,
    risks: survivors.flatMap(({ reasons }) => reasons),
    decisions: ["Kill", "Advance", "Iterate", "Need More Evidence"],
  };
}
