const conventionalCommitPattern =
  /^(feat|fix|refactor|perf|test|docs|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?(!)?: [^\r\n]{1,200}(\r?\n[\s\S]*)?$/;

const forbiddenFooterPattern =
  /^(co-authored-by|generated-by|generated-with|assisted-by|ai-generated|claude|openai|codex|copilot):/im;

export function validateCommitMessage(message: string): void {
  if (!conventionalCommitPattern.test(message)) {
    throw new Error("Commit message must follow Conventional Commits");
  }
  if (forbiddenFooterPattern.test(message)) {
    throw new Error("Commit message contains a forbidden attribution footer");
  }
}
