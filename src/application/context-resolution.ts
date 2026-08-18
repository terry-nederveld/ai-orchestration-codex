import type { ResolvedContextItem } from "../domain/execution.js";
import type { JsonValue } from "../domain/json.js";
import type { WorkItem, WorkRelationshipType } from "../domain/work.js";
import type { ContextResolver, WorkGraphProvider } from "../ports/context.js";
import { contentDigest } from "./versioned-assets.js";

const defaultRelationships = new Set<WorkRelationshipType>([
  "parent",
  "child",
  "blocks",
  "blocked_by",
  "depends_on",
]);

export interface RelationshipContextPolicy {
  upwardDepth: number;
  downwardDepth: number;
  relationships: string[];
  maxItems: number;
}

export class RelationshipContextResolver implements ContextResolver {
  public readonly id = "work-relationships";
  readonly #policy: RelationshipContextPolicy;

  public constructor(
    private readonly graph: WorkGraphProvider,
    policy: Partial<RelationshipContextPolicy> = {},
  ) {
    this.#policy = {
      upwardDepth: policy.upwardDepth ?? 1,
      downwardDepth: policy.downwardDepth ?? 1,
      relationships: policy.relationships ?? [...defaultRelationships],
      maxItems: policy.maxItems ?? 50,
    };
  }

  public async resolve(input: { workItem: WorkItem; signal?: AbortSignal }) {
    const result: ResolvedContextItem[] = [];
    const visited = new Set([input.workItem.id]);
    const queue = input.workItem.relationships.map((relationship) => ({
      relationship,
      depth: 1,
    }));
    while (queue.length > 0 && result.length < this.#policy.maxItems) {
      input.signal?.throwIfAborted();
      const next = queue.shift()!;
      if (!this.#policy.relationships.includes(next.relationship.type)) continue;
      if (!withinDepth(next.relationship.type, next.depth, this.#policy)) continue;
      if (visited.has(next.relationship.targetId)) continue;
      visited.add(next.relationship.targetId);
      const item = await this.graph.get(next.relationship.targetId, input.signal);
      if (item === undefined) continue;
      const content = workContext(item);
      result.push({
        id: item.id,
        kind: "work_item",
        source: item.provider,
        relationship: next.relationship.type,
        content,
        promoted: false,
        digest: contentDigest(content),
      });
      for (const relationship of item.relationships) {
        queue.push({ relationship, depth: next.depth + 1 });
      }
    }
    return result;
  }
}

export interface AttachmentReference {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  content: JsonValue;
}

export class AttachmentContextResolver {
  public constructor(
    private readonly policy: {
      enabled: boolean;
      allowedMediaTypes: string[];
      maxBytes: number;
      maxCount: number;
    },
  ) {}

  public resolve(attachments: AttachmentReference[]): ResolvedContextItem[] {
    if (!this.policy.enabled) return [];
    let bytes = 0;
    return attachments
      .filter((item) => this.policy.allowedMediaTypes.includes(item.mediaType))
      .slice(0, this.policy.maxCount)
      .filter((item) => {
        if (bytes + item.sizeBytes > this.policy.maxBytes) return false;
        bytes += item.sizeBytes;
        return true;
      })
      .map((item) => ({
        id: item.id,
        kind: "attachment",
        source: item.name,
        content: item.content,
        promoted: false,
        digest: contentDigest(item.content),
      }));
  }
}

function withinDepth(
  relationship: string,
  depth: number,
  policy: RelationshipContextPolicy,
): boolean {
  if (relationship === "parent" || relationship === "blocked_by" || relationship === "depends_on")
    return depth <= policy.upwardDepth;
  if (relationship === "child" || relationship === "blocks") return depth <= policy.downwardDepth;
  return depth <= Math.max(policy.upwardDepth, policy.downwardDepth);
}

function workContext(item: WorkItem): JsonValue {
  return {
    id: item.id,
    externalId: item.externalId,
    title: item.title,
    description: item.description ?? null,
    state: item.state,
    type: item.type ?? null,
    labels: item.labels,
    updatedAt: item.updatedAt ?? null,
  };
}
