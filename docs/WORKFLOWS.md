# Workflow authoring

Workflows are immutable, versioned YAML dependency graphs. Start from [Autonomous Delivery](../workflows/autonomous-delivery.yaml), [Autonomous Discovery](../workflows/autonomous-discovery.yaml), or the smaller [software-development workflow](../workflows/software-development.yaml), then validate with `fable validate path/to/workflow.yaml`.

## Structure

- `schemaVersion`, `id`, `version`, `lifecycle`, and `name` identify the contract. Lifecycle is `DRAFT`, `ENABLED`, or `DISABLED`; changed content requires a new version.
- `includes` composes relative fragments inside the allowed workflow root. Cycles and traversal are rejected.
- `trigger.states` and `eligibility` constrain dispatch.
- `workspace.strategy` is `git-worktree`, `clone`, `local`, or `temporary`; failed workspaces can be retained.
- `budgets` bound iterations, time, tokens, estimated API spend, subscription requests, agents, and subagents.
- `agents` declares logical roles independent of a provider.
- `steps` is an acyclic graph linked by `dependsOn`.
- `assets` pins sub-workflows, gates, rubrics, profiles, policies, and templates by version and digest.
- `domainStates`, `configuration`, and `requirements` declare user state, projections, reusable policy configuration, and activation compatibility.
- `transitions` maps successful, failed, or cancelled results back to work-system states.

## Step types

- `agent`: runs a role with an interpolated goal. Two role executions create separate sessions, enabling an independent reviewer.
- `command`: shell-free executable plus argument array, optional working directory/environment, timeout, and allowed exit codes.
- `tool`: calls a registered built-in, extension, or namespaced MCP tool.
- `action`: calls a workflow action such as `source_control.commit`, `source_control.push`, or `source_control.pull_request`.
- `approval`: persists a human gate and pauses the step until approved, denied, timed out, or interrupted.
- `human_input`: persists typed text, boolean, choice, approval, secret-reference, file-reference, or free-form input for app/work-item channels.
- `wait`: suspends for time, external events, dependencies, provider availability, or work-item events without retaining a model session.
- `subworkflow`: calls an explicitly pinned reusable workflow with input and declared fail/continue behavior.

Every step supports `dependsOn`, `when`, `outputSchema`, `onEnter`/`onExit` actions, retry policy, bounded `repeat`, timeout, and `onError: fail|continue`. Fan-in may require all, any, minimum N, or named dependencies. Ready steps run concurrently up to `concurrency.workflowSteps`.

## Durable waits and versions

A run stores the root workflow version/digest and a resolved asset snapshot. Resumption loads that exact content, never the latest by ID. Wait state stores the node checkpoint and normalized signals. The first authorized valid signal selects the response; later signals remain supplemental. Explicitly promoted responses can enter the next execution-spec revision.

Before a long coding wait, Fable commits meaningful changes to a run branch, pushes without force, and records the SHA. Non-code workflows should use the managed issue section so a human can understand current learning without the original model session.

## Designer and Evaluate

The desktop designer edits a visual graph and canonical YAML as one semantic document. Saving publishes the next immutable version. **Evaluate** compiles a draft and explains routing, repositories, instructions, context, guards, state mappings, profiles, permissions, gates, experiments, scheduling, expected effects, path, and blockers without claiming work or executing a provider, tool, or action.

## Expressions

Use `${{ ... }}` interpolation for `work`, workflow variables, and prior step outputs. Conditions use the safe expression evaluator; arbitrary JavaScript is not evaluated. Examples:

```yaml
when: steps.test.exitCode == 0
goal: "Fix ${{ work.externalId }}: ${{ work.title }}"
```

## Delivery controls

Keep write/delivery actions behind both permission rules and an explicit approval step for production repositories. Conventional Commit syntax is enforced by the GitHub source-control adapter. Default draft pull requests preserve a review boundary. Hooks may observe or prepare agent, commit, pull-request, failure, completion, and cleanup lifecycle points.

## Retry and idempotency guidance

Use retries for read-only or naturally idempotent provider calls. Avoid repeating commit, push, or pull-request actions unless an extension supplies an idempotency key. Scheduler dispatch is independently durable and will not enqueue the same source/item pair concurrently.
