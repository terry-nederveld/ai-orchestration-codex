# Delivery ledger

Updated: 2026-08-14

## Current objective

Deliver the first complete, testable issue-to-code vertical slice, then widen provider and desktop coverage without weakening the domain boundaries.

## Completed milestones

- Read the product requirements and verified the workspace is greenfield.
- Researched current authoritative material for Symphony, Pi, Codex, Claude, Copilot, GitHub, Jira Cloud, Jira Data Center, Linear, MCP, Tauri, Electron, and SQLite.
- Chose the initial stack, process model, provider contracts, workflow semantics, persistence approach, extension boundary, and security boundary.

## Active work

- Establish the TypeScript workspace and architecture records.
- Implement domain contracts, eventing, persistence, budget/policy enforcement, deterministic providers, and contract tests.

## Known constraints

- Cross-platform installers must be built and signed on their target operating systems; this macOS environment can validate macOS packaging and CI configuration for Windows/Linux.
- Live provider end-to-end tests require user-owned credentials and are opt-in; default tests use deterministic providers and local HTTP fixtures.
- Tauri packages the Node control plane as a target-specific sidecar so desktop users do not need Node installed.

## Remaining requirements

- Core orchestration, workflow, native agent runtime, workspace isolation, SCM, providers, extensions, MCP, skills, hooks, CLI, control plane, desktop UI, packaging, security review, documentation, and complete validation.

## Test status

- Not yet runnable; project foundation in progress.

## Deferred items

- None. Items that cannot be validated locally will be covered by target-specific CI or explicitly documented only after implementation.

