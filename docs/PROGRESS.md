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

## Active work

- Implement the declarative workflow compiler/executor and native agent loop.
- Add workspace, Git, process, and filesystem tool adapters for the first autonomous vertical slice.

## Known constraints

- Cross-platform installers must be built and signed on their target operating systems; this macOS environment can validate macOS packaging and CI configuration for Windows/Linux.
- Live provider end-to-end tests require user-owned credentials and are opt-in; default tests use deterministic providers and local HTTP fixtures.
- Tauri packages the Node control plane as a target-specific sidecar so desktop users do not need Node installed.

## Remaining requirements

- Core orchestration, workflow, native agent runtime, workspace isolation, SCM, providers, extensions, MCP, skills, hooks, CLI, control plane, desktop UI, packaging, security review, documentation, and complete validation.

## Test status

- 10 test files and 13 tests pass.
- Formatting, linting, strict typechecking, core compilation, SQLite migration startup, persistence contract tests, and all 8 ADR validations pass.

## Deferred items

- None. Items that cannot be validated locally will be covered by target-specific CI or explicitly documented only after implementation.
