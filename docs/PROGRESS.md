# Delivery ledger

Updated: 2026-08-14

## Current objective

Deliver the first complete, testable issue-to-code vertical slice, then widen provider and desktop coverage without weakening the domain boundaries.

## Completed milestones

- Read the product requirements and verified the workspace is greenfield.
- Researched current authoritative material for Symphony, Pi, Codex, Claude, Copilot, GitHub, Jira Cloud, Jira Data Center, Linear, MCP, Tauri, Electron, and SQLite.
- Chose the initial stack, process model, provider contracts, workflow semantics, persistence approach, extension boundary, and security boundary.
- Established the strict TypeScript workspace with formatting, linting, build, test, and ADR validation gates.
- Implemented provider-neutral domain contracts, explicit run transitions, capability routing, budgets, permissions, hooks, tools, layered configuration, structured eventing, optimistic entity storage, durable claims, SQLite migrations, and deterministic fake providers.
- Added reusable model, work, and persistence contract test suites.
- Implemented the versioned YAML workflow compiler, dependency-graph executor, safe conditions/interpolation, retries, parallel steps, bounded repetition, approvals/actions, cancellation, and persisted execution snapshots.
- Implemented the native goal-oriented agent loop with streaming events, parallel tool calls, provider retries, explicit terminal outcomes, context compaction, resumable sessions, usage accounting, and budget enforcement.
- Added shell-free bounded process execution, workspace-scoped filesystem/process/search tools, traversal and symlink protection, local/temporary/clone/Git-worktree isolation, Git/GitHub source control, Conventional Commit enforcement, and delivery actions.
- Completed a deterministic end-to-end issue-to-isolated-worktree flow that edits, tests, independently reviews, commits, records events, transitions the work item, releases its claim, and cleans up.

## Active work

- Implement direct model and coding-agent adapters plus GitHub, Jira Cloud, Jira Data Center, and Linear work providers.
- Implement extension discovery, MCP, skills, hooks, and secure headless credential storage.

## Known constraints

- Cross-platform installers must be built and signed on their target operating systems; this macOS environment can validate macOS packaging and CI configuration for Windows/Linux.
- Live provider end-to-end tests require user-owned credentials and are opt-in; default tests use deterministic providers and local HTTP fixtures.
- Tauri packages the Node control plane as a target-specific sidecar so desktop users do not need Node installed.

## Remaining requirements

- Core orchestration, workflow, native agent runtime, workspace isolation, SCM, providers, extensions, MCP, skills, hooks, CLI, control plane, desktop UI, packaging, security review, documentation, and complete validation.

## Test status

- 20 test files and 33 tests pass, including the end-to-end autonomous issue-to-code workflow.
- Formatting, linting, strict typechecking, core compilation, SQLite migration startup, provider/persistence contracts, security-sensitive tool tests, workflow/agent tests, and all 8 ADR validations pass.

## Deferred items

- None. Items that cannot be validated locally will be covered by target-specific CI or explicitly documented only after implementation.
