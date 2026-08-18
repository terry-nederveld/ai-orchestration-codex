import { randomUUID } from "node:crypto";
import type {
  AppliedInstruction,
  ExecutionSpecification,
  RepositoryBinding,
  ResolvedContextItem,
} from "../domain/execution.js";
import type { VersionedAssetReference } from "../domain/assets.js";
import type { JsonObject } from "../domain/json.js";
import type { PersistenceProvider } from "../ports/persistence.js";
import { contentDigest } from "./versioned-assets.js";

export interface ExecutionSpecificationInput {
  runId: string;
  workflowSnapshotId: string;
  workflow: VersionedAssetReference;
  goal: string;
  acceptanceCriteria: string[];
  completionCriteria: string[];
  work: JsonObject;
  relatedWork: JsonObject[];
  repositories: RepositoryBinding[];
  instructions: AppliedInstruction[];
  context: ResolvedContextItem[];
  workflowOutputs: JsonObject;
  dependencies: JsonObject[];
  tests: string[];
  tools: string[];
  permissions: string[];
  validationRequirements: string[];
  agentProfile?: VersionedAssetReference;
}

interface SpecificationHead extends JsonObject {
  runId: string;
  specificationId: string;
  revision: number;
}

export class ExecutionSpecificationService {
  public constructor(private readonly persistence: PersistenceProvider) {}

  public async reconcile(input: ExecutionSpecificationInput): Promise<ExecutionSpecification> {
    const fingerprint = contentDigest(specificationContent(input));
    const head = await this.persistence.entities.get<SpecificationHead>(
      "execution_specification_head",
      input.runId,
    );
    if (head !== undefined) {
      const current = await this.get(head.value.specificationId);
      if (current === undefined)
        throw new Error(`Missing specification ${head.value.specificationId}`);
      if (current.authoritativeFingerprint === fingerprint) return current;
      return this.create(input, head.value.revision + 1, fingerprint, current.id, head.version);
    }
    return this.create(input, 1, fingerprint);
  }

  public async current(runId: string): Promise<ExecutionSpecification | undefined> {
    const head = await this.persistence.entities.get<SpecificationHead>(
      "execution_specification_head",
      runId,
    );
    return head === undefined ? undefined : this.get(head.value.specificationId);
  }

  public async history(runId: string): Promise<ExecutionSpecification[]> {
    const rows =
      await this.persistence.entities.list<ExecutionSpecification>("execution_specification");
    return rows
      .map(({ value }) => value)
      .filter((value) => value.runId === runId)
      .sort((left, right) => left.revision - right.revision);
  }

  private async get(id: string): Promise<ExecutionSpecification | undefined> {
    return (
      await this.persistence.entities.get<ExecutionSpecification>("execution_specification", id)
    )?.value;
  }

  private async create(
    input: ExecutionSpecificationInput,
    revision: number,
    fingerprint: string,
    supersedes?: string,
    expectedHeadVersion?: number,
  ): Promise<ExecutionSpecification> {
    const value: ExecutionSpecification = {
      ...structuredClone(input),
      id: randomUUID(),
      revision,
      authoritativeFingerprint: fingerprint,
      createdAt: new Date().toISOString(),
      ...(supersedes === undefined ? {} : { supersedes }),
    };
    await this.persistence.entities.put("execution_specification", value.id, value);
    const head: SpecificationHead = {
      runId: input.runId,
      specificationId: value.id,
      revision,
    };
    await this.persistence.entities.put(
      "execution_specification_head",
      input.runId,
      head,
      ...(expectedHeadVersion === undefined ? [] : [expectedHeadVersion]),
    );
    return value;
  }
}

function specificationContent(input: ExecutionSpecificationInput): JsonObject {
  return JSON.parse(JSON.stringify(input)) as JsonObject;
}
