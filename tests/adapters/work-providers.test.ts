import { describe, expect, it } from "vitest";
import type { FetchClient } from "../../src/adapters/model/http-support.js";
import { GitHubIssuesProvider } from "../../src/adapters/work/github-issues.js";
import { JiraWorkProvider } from "../../src/adapters/work/jira.js";
import { LinearWorkProvider } from "../../src/adapters/work/linear.js";
import { assertWorkProviderContract } from "../contracts/work-provider.contract.js";

describe("work provider adapters", () => {
  it("maps and updates GitHub issues", async () => {
    const fixture = githubFixture();
    const provider = new GitHubIssuesProvider({
      owner: "fable",
      repository: "orchestrator",
      token: "token",
      fetch: fixture.fetch,
    });

    await assertWorkProviderContract(provider);
    const updated = await provider.update("42", {
      state: "Done",
      addLabels: ["completed"],
      removeLabels: ["ready"],
      comment: "Implemented in PR #7",
    });

    expect(updated).toMatchObject({ externalId: "42", state: "closed", labels: ["completed"] });
    expect(fixture.comments).toEqual(["Implemented in PR #7"]);
  });

  for (const deployment of ["cloud", "data-center"] as const) {
    it(`maps, transitions, and comments on Jira ${deployment}`, async () => {
      const fixture = jiraFixture(deployment);
      const provider = new JiraWorkProvider({
        deployment,
        baseUrl: "https://jira.test",
        project: "FAB",
        ...(deployment === "cloud" ? { email: "agent@example.com" } : {}),
        token: "token",
        fetch: fixture.fetch,
      });

      await assertWorkProviderContract(provider);
      const updated = await provider.update("FAB-12", {
        state: "Done",
        addLabels: ["automated"],
        comment: "Work completed",
      });

      expect(updated).toMatchObject({ externalId: "FAB-12", state: "Done" });
      expect(fixture.comments).toHaveLength(1);
      const jql = fixture.lastSearchBody["jql"];
      expect(typeof jql).toBe("string");
      expect(typeof jql === "string" && jql.includes("project")).toBe(true);
    });
  }

  it("maps and updates Linear issues through GraphQL", async () => {
    const fixture = linearFixture();
    const provider = new LinearWorkProvider({
      token: "token",
      team: "FAB",
      fetch: fixture.fetch,
    });

    await assertWorkProviderContract(provider);
    const updated = await provider.update("FAB-8", {
      state: "Done",
      addLabels: ["automated"],
      removeLabels: ["ready"],
      comment: "Completed by Fable",
    });

    expect(updated).toMatchObject({ externalId: "FAB-8", state: "Done", labels: ["automated"] });
    expect(fixture.comments).toEqual(["Completed by Fable"]);
  });
});

function githubFixture() {
  const comments: string[] = [];
  const issue = {
    id: 100,
    number: 42,
    title: "Fix the parser",
    body: "Handle chunk boundaries",
    state: "open",
    labels: [{ name: "ready" }],
    assignees: [{ id: 1, login: "octocat" }],
    html_url: "https://github.test/fable/orchestrator/issues/42",
    updated_at: "2026-08-14T00:00:00Z",
  };
  const fetch: FetchClient = async (input, init) => {
    const url = inputUrl(input);
    if (url.endsWith("/repos/fable/orchestrator")) return Response.json({ id: 1 });
    if (url.includes("/issues?") && (init?.method ?? "GET") === "GET") {
      return Response.json([issue]);
    }
    if (url.endsWith("/issues/42/comments")) {
      comments.push(parseBody(init)["body"] as string);
      return Response.json({ id: 2 });
    }
    if (url.endsWith("/issues/42") && init?.method === "PATCH") {
      const body = parseBody(init);
      if (typeof body["state"] === "string") issue.state = body["state"];
      if (Array.isArray(body["labels"])) {
        issue.labels = body["labels"].map((name) => ({ name: String(name) }));
      }
      return Response.json(issue);
    }
    if (url.endsWith("/issues/42")) return Response.json(issue);
    return new Response("not found", { status: 404 });
  };
  return { fetch, comments };
}

function jiraFixture(deployment: "cloud" | "data-center") {
  const comments: unknown[] = [];
  let state = "To Do";
  let labels = ["ready"];
  let lastSearchBody: Record<string, unknown> = {};
  const issue = () => ({
    id: "1200",
    key: "FAB-12",
    fields: {
      summary: "Fix Jira adapter",
      description:
        deployment === "cloud"
          ? {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Details" }] }],
            }
          : "Details",
      status: { name: state },
      issuetype: { name: "Task" },
      priority: { name: "High" },
      labels,
      assignee: { accountId: "user-1", name: "agent", displayName: "Agent" },
      issuelinks: [],
      updated: "2026-08-14T00:00:00Z",
    },
  });
  const fetch: FetchClient = async (input, init) => {
    const url = inputUrl(input);
    if (url.endsWith("/myself")) return Response.json({ accountId: "user-1" });
    if (url.endsWith("/search/jql") || url.endsWith("/search")) {
      lastSearchBody = parseBody(init);
      return Response.json(
        deployment === "cloud"
          ? { issues: [issue()], isLast: true }
          : { issues: [issue()], startAt: 0, total: 1 },
      );
    }
    if (url.includes("/issue/FAB-12/transitions") && init?.method === "POST") {
      state = "Done";
      return new Response(null, { status: 204 });
    }
    if (url.includes("/issue/FAB-12/transitions")) {
      return Response.json({ transitions: [{ id: "31", name: "Done", to: { name: "Done" } }] });
    }
    if (url.endsWith("/issue/FAB-12/comment")) {
      comments.push(parseBody(init));
      return Response.json({ id: "comment-1" });
    }
    if (url.includes("/issue/FAB-12") && init?.method === "PUT") {
      const fields = parseBody(init)["fields"] as Record<string, unknown>;
      if (Array.isArray(fields["labels"])) labels = fields["labels"].map(String);
      return new Response(null, { status: 204 });
    }
    if (url.includes("/issue/FAB-12")) return Response.json(issue());
    return new Response("not found", { status: 404 });
  };
  return {
    fetch,
    comments,
    get lastSearchBody() {
      return lastSearchBody;
    },
  };
}

function linearFixture() {
  const comments: string[] = [];
  let state = "Todo";
  let labels = [{ id: "label-ready", name: "ready" }];
  const issue = () => ({
    id: "issue-8",
    identifier: "FAB-8",
    title: "Fix Linear adapter",
    description: "Details",
    priority: 2,
    url: "https://linear.test/FAB-8",
    updatedAt: "2026-08-14T00:00:00Z",
    state: { id: state === "Done" ? "state-done" : "state-todo", name: state },
    assignee: { id: "user-1", name: "Agent", email: "agent@example.com" },
    team: { id: "team-1", key: "FAB" },
    labels: { nodes: labels },
  });
  const fetch: FetchClient = async (_input, init) => {
    const body = parseBody(init);
    const query = typeof body["query"] === "string" ? body["query"] : "";
    const variables = (body["variables"] ?? {}) as Record<string, unknown>;
    if (query.includes("FableViewer")) return graphql({ viewer: { id: "user-1", name: "Agent" } });
    if (query.includes("FableIssues")) {
      return graphql({
        issues: { nodes: [issue()], pageInfo: { hasNextPage: false, endCursor: null } },
      });
    }
    if (query.includes("FableStates")) {
      return graphql({ workflowStates: { nodes: [{ id: "state-done", name: "Done" }] } });
    }
    if (query.includes("FableLabels")) {
      return graphql({ issueLabels: { nodes: [{ id: "label-automated", name: "automated" }] } });
    }
    if (query.includes("FableIssueUpdate")) {
      const input = variables["input"] as Record<string, unknown>;
      if (input["stateId"] === "state-done") state = "Done";
      if (Array.isArray(input["labelIds"])) {
        labels = input["labelIds"].map((id) => ({
          id: String(id),
          name: id === "label-automated" ? "automated" : "ready",
        }));
      }
      return graphql({ issueUpdate: { success: true } });
    }
    if (query.includes("FableComment")) {
      const input = variables["input"] as Record<string, unknown>;
      comments.push(String(input["body"]));
      return graphql({ commentCreate: { success: true } });
    }
    if (query.includes("FableIssue")) return graphql({ issue: issue() });
    return graphql({}, [{ message: "Unknown fixture query" }]);
  };
  return { fetch, comments };
}

function graphql(data: unknown, errors?: unknown[]): Response {
  return Response.json({ data, ...(errors === undefined ? {} : { errors }) });
}

function inputUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function parseBody(init: RequestInit | undefined): Record<string, unknown> {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
}
