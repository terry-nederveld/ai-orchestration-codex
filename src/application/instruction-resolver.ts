import type { AppliedInstruction } from "../domain/execution.js";
import type { InstructionDiscoveryRequest, InstructionProvider } from "../ports/context.js";

export interface EffectiveInstructions {
  applied: AppliedInstruction[];
  content: string;
}

export class InstructionResolver {
  public constructor(private readonly providers: readonly InstructionProvider[]) {}

  public async resolve(request: InstructionDiscoveryRequest): Promise<EffectiveInstructions> {
    const discovered = (
      await Promise.all(this.providers.map((provider) => provider.discover(request)))
    )
      .flat()
      .sort(compareInstructions);
    const unique = new Map<string, AppliedInstruction>();
    for (const instruction of discovered)
      unique.set(`${instruction.provider}:${instruction.path}`, instruction);
    const applied = [...unique.values()].sort(compareInstructions);
    return {
      applied,
      content: applied
        .map(
          (instruction) =>
            `<!-- instruction: ${instruction.path}; sha256=${instruction.digest}; trusted=${instruction.trusted} -->\n${instruction.content.trim()}`,
        )
        .join("\n\n"),
    };
  }
}

function compareInstructions(left: AppliedInstruction, right: AppliedInstruction): number {
  return (
    left.precedence - right.precedence ||
    left.scope.localeCompare(right.scope) ||
    left.path.localeCompare(right.path)
  );
}
