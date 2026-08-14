# Workflow authoring

Workflows are versioned YAML dependency graphs. Use [the shipped software-development workflow](../workflows/software-development.yaml) as a starting point and validate with `fable validate path/to/workflow.yaml`.

## Structure

- `schemaVersion`, `id`, and `name` identify the contract.
- `includes` composes relative fragments inside the allowed workflow root. Cycles and traversal are rejected.
- `trigger.states` and `eligibility` constrain dispatch.
- `workspace.strategy` is `git-worktree`, `clone`, `local`, or `temporary`; failed workspaces can be retained.
- `budgets` bound iterations, time, tokens, estimated API spend, subscription requests, agents, and subagents.
- `agents` declares logical roles independent of a provider.
- `steps` is an acyclic graph linked by `dependsOn`.
- `transitions` maps successful, failed, or cancelled results back to work-system states.

## Step types

- `agent`: runs a role with an interpolated goal. Two role executions create separate sessions, enabling an independent reviewer.
- `command`: shell-free executable plus argument array, optional working directory/environment, timeout, and allowed exit codes.
- `tool`: calls a registered built-in, extension, or namespaced MCP tool.
- `action`: calls a workflow action such as `source_control.commit`, `source_control.push`, or `source_control.pull_request`.
- `approval`: persists a human gate and pauses the step until approved, denied, timed out, or interrupted.

Every step supports `dependsOn`, `when`, retry policy, bounded `repeat`, timeout, and `onError: fail|continue`. Ready steps run concurrently up to `concurrency.workflowSteps`.

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
