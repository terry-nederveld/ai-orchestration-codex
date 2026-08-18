export type FanInPolicy =
  | { mode: "all" }
  | { mode: "any" }
  | { mode: "minimum"; count: number }
  | { mode: "named"; required: readonly string[] };

export interface FanOutBranch<T> {
  id: string;
  input: T;
}

export interface FanOutResult<R> {
  joined: boolean;
  succeeded: Array<{ id: string; output: R }>;
  failed: Array<{ id: string; error: string }>;
}

export class FanOutExecutor {
  public async execute<T, R>(input: {
    branches: FanOutBranch<T>[];
    join: FanInPolicy;
    maxConcurrent: number;
    maxBranches: number;
    execute: (branch: FanOutBranch<T>) => Promise<R>;
  }): Promise<FanOutResult<R>> {
    if (input.branches.length > input.maxBranches)
      throw new Error("Fan-out branch budget exceeded");
    const ids = new Set<string>();
    for (const branch of input.branches) {
      if (ids.has(branch.id)) throw new Error(`Duplicate fan-out branch: ${branch.id}`);
      ids.add(branch.id);
    }
    if (input.join.mode === "named") {
      const unknown = input.join.required.find((id) => !ids.has(id));
      if (unknown !== undefined) throw new Error(`Unknown required branch: ${unknown}`);
    }
    const settled = await concurrentSettled(input.branches, input.maxConcurrent, input.execute);
    const succeeded: FanOutResult<R>["succeeded"] = [];
    const failed: FanOutResult<R>["failed"] = [];
    for (const [index, result] of settled.entries()) {
      const id = input.branches[index]!.id;
      if (result.status === "fulfilled") succeeded.push({ id, output: result.value });
      else failed.push({ id, error: errorMessage(result.reason) });
    }
    return {
      joined: joinSatisfied(
        input.join,
        succeeded.map(({ id }) => id),
        input.branches.length,
      ),
      succeeded,
      failed,
    };
  }
}

function joinSatisfied(policy: FanInPolicy, succeeded: string[], total: number): boolean {
  if (policy.mode === "all") return succeeded.length === total;
  if (policy.mode === "any") return succeeded.length >= 1;
  if (policy.mode === "minimum") return succeeded.length >= policy.count;
  return policy.required.every((id) => succeeded.includes(id));
}

async function concurrentSettled<T, R>(
  values: T[],
  concurrency: number,
  execute: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("Concurrency must be positive");
  const result = new Map<number, PromiseSettledResult<R>>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        try {
          result.set(index, { status: "fulfilled", value: await execute(values[index]!) });
        } catch (error) {
          result.set(index, { status: "rejected", reason: error });
        }
      }
    }),
  );
  return values.map((_, index) => {
    const settled = result.get(index);
    if (settled === undefined) throw new Error(`Missing fan-out result ${index}`);
    return settled;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
