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
- Added streaming direct-model adapters for OpenAI Responses, Anthropic Messages, OpenRouter, and local OpenAI-compatible endpoints, with secret references, abort propagation, usage normalization, tool-call normalization, and retry classification.
- Added supported coding-agent adapters for Codex SDK/ChatGPT sessions, Claude Code CLI account sessions, and GitHub Copilot SDK sessions, including discovery, resume, cancellation, streaming, policy mediation, and plan/API consumption accounting.
- Added normalized GitHub Issues, Jira Cloud v3, Jira Data Center v2, and Linear GraphQL work adapters with fixture-backed discovery, pagination, updates, transitions, comments, labels, assignees, and repository references.
- Implemented validated/grant-gated extension manifests, lazy filesystem skill indexing, namespaced MCP tools over stdio or Streamable HTTP, composite secret lookup, authenticated encrypted-file secret storage, and containment-verified workspace cleanup.

## Active work

- Build the CLI composition root and local control-plane service.
- Build the Tauri desktop shell and operator experience on the same control-plane API.

## Known constraints

- Cross-platform installers must be built and signed on their target operating systems; this macOS environment can validate macOS packaging and CI configuration for Windows/Linux.
- Live provider end-to-end tests require user-owned credentials and are opt-in; default tests use deterministic providers and local HTTP fixtures.
- Tauri packages the Node control plane as a target-specific sidecar so desktop users do not need Node installed.

## Remaining requirements

- CLI, control plane, desktop UI, packaging, reliability hardening, security review, operator/developer documentation, and complete validation.

## Test status

- 24 test files and 48 tests pass, including the end-to-end autonomous issue-to-code workflow and provider/extension/MCP/security contract fixtures.
- Formatting, linting, strict typechecking, core compilation, SQLite migration startup, provider/persistence contracts, security-sensitive tool tests, workflow/agent tests, and all 8 ADR validations pass.

## Deferred items

- None. Items that cannot be validated locally will be covered by target-specific CI or explicitly documented only after implementation.
