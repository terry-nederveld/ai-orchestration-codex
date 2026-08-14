// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Workflows } from "../../desktop/pages/Workflows.js";

afterEach(cleanup);

describe("Workflows", () => {
  it("renders and switches between validated workflow graphs", () => {
    render(
      <Workflows
        workflows={[
          workflow("delivery", "Software delivery", ["implement", "test"]),
          workflow("triage", "Issue triage", ["classify"]),
        ]}
      />,
    );

    expect(screen.getByText("implement")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Issue triage/ }));
    expect(screen.getByText("classify")).toBeTruthy();
    expect(screen.queryByText("implement")).toBeNull();
  });
});

function workflow(id: string, name: string, steps: string[]) {
  return {
    schemaVersion: 1 as const,
    id,
    name,
    workspace: { strategy: "git-worktree", retainOnFailure: true },
    agents: {},
    steps: steps.map((step, index) => ({
      id: step,
      type: index === 0 ? ("agent" as const) : ("command" as const),
      dependsOn: index === 0 ? [] : [steps[index - 1]!],
    })),
  };
}
