# Delivery ledger

Updated: 2026-08-14

## Current objective

Complete release hardening, cross-platform CI, documentation, and final verification for the implemented v0.1 platform.

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
- Added the CLI, loopback-authenticated HTTP/SSE control plane, durable scheduler/recovery, and provider/workflow/approval/run operator commands.
- Added the Tauri desktop host, embedded supervised sidecar, responsive React operations console, and opt-in privacy-preserving native notifications.
- Added layered user/project configuration, full lifecycle hook wiring, deterministic source-control/workspace/notification fakes, and executable architecture boundaries.
- Added macOS/Windows/Linux CI and native installer workflows, dependency audit/update automation, examples, and developer/operator/security/release documentation.

## Active work

- Final packaged-build regression, failure/security review, and repository audit.

## Known constraints

- Cross-platform installers must be built and signed on their target operating systems; this macOS environment can validate macOS packaging and CI configuration for Windows/Linux.
- Live provider end-to-end tests require user-owned credentials and are opt-in; default tests use deterministic providers and local HTTP fixtures.
- Tauri packages the Node control plane as a target-specific sidecar so desktop users do not need Node installed.

## Remaining requirements

- Validate the final notification-enabled package and document the final verification evidence.

## Test status

- 34 test files and 68 tests pass, including the end-to-end autonomous issue-to-code workflow and provider/extension/MCP/security/architecture fixtures.
- Formatting, linting, strict typechecking, core/UI compilation, Rust host compilation, SQLite migration startup, scheduler recovery, security-sensitive tool tests, and all 9 ADR validations pass.

## Deferred items

- Dedicated GitHub Projects V2 field synchronization, native-runtime subagent dispatch, OS-keychain storage, signed/notarized production artifacts, and in-app auto-update are explicit post-v0.1 items. Provider-owned subagents, repository Issues that appear in Projects, an encrypted vault, and immutable target-native releases cover the current boundary.
