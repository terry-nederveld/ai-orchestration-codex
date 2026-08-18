// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FableClient } from "../../desktop/app/client.js";
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

  it("round-trips visual edits through YAML and evaluates without executing effects", async () => {
    const evaluateWorkflow = vi.fn().mockResolvedValue({
      sideEffects: false,
      routing: { status: "MATCHED", candidates: [] },
      repositories: [],
      repositoryConflicts: [],
      instructions: [],
      context: [],
      guards: [],
      pinnedAssets: [],
      profileRequirements: {},
      expectedSideEffects: ["execute process"],
      determinablePath: ["build"],
      blockers: [],
    });
    const client = { evaluateWorkflow } as unknown as FableClient;
    render(
      <Workflows
        workflows={[
          { ...workflow("delivery", "Delivery", ["build"]), runtimeId: "local", version: 2 },
        ]}
        clients={new Map([["local", client]])}
      />,
    );

    fireEvent.change(screen.getByLabelText("Node 1 ID"), { target: { value: "compile" } });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Node 1 ID" }).value).toBe(
      "compile",
    );
    expect(document.querySelector<HTMLTextAreaElement>(".workflow-yaml")?.value).toContain(
      "compile",
    );
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    await waitFor(() => expect(evaluateWorkflow).toHaveBeenCalledOnce());
    expect(
      screen.getByText(
        "Read-only: no provider, repository, work-item, or persistence effects were executed.",
      ),
    ).toBeTruthy();
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
