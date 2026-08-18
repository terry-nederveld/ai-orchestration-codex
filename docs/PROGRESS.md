# Delivery ledger

Updated: 2026-08-18

## Current objective

Orchestrator Phase 2 is implemented and in final release validation for v0.2.0.

## Completed milestones

- Preserved the ports-and-adapters architecture while adding immutable workflow and asset versions, pinned resolved snapshots, explicit sub-workflows, structured output contracts, declarative joins, lifecycle actions, and separate graph, engine, domain, and external-state layers.
- Added durable typed human input and a unified wait model with first-valid-response semantics, channel enforcement, supplemental responses, exact-node restart recovery, and explicit context promotion.
- Added immutable revisioned execution specifications, deterministic many-to-many repository mapping, scoped repository-instruction discovery, configurable relationship context, opt-in attachments, remote Git checkpoints, and managed work-item sections.
- Added reusable gate sets with independent reevaluation, composed agent profiles, capability/budget-aware fallback decisions, bounded experiments, versioned rubrics, judgment packages, fan-out/fan-in, lanes, rank preservation, recurrence, support correlation, and release lifecycle projections.
- Added versioned Autonomous Delivery and Autonomous Discovery templates plus deterministic end-to-end acceptance scenarios, including remediation, process recreation during durable waits, specification revision, experiment rejection/learning, PRD/story handoff, Conventional Commit validation, push, pull request, and work-item completion.
- Added side-effect-free workflow evaluation, ambiguity-safe routing and rule suggestions, immutable visual/YAML workflow publication, and DRAFT/ENABLED/DISABLED lifecycle enforcement.
- Added simultaneous multi-runtime desktop state, per-runtime client routing and failure isolation, UI-only groups, typed Needs You responses, work-centric run details, newest-first activity, and a new-events indicator.
- Completed Phase 2 architecture decisions in ADRs 0010–0013 and updated architecture, workflow, configuration, operations, security, release, and user documentation.
- Completed architecture and security reviews and remediated the blocking findings found during review.

## Validation status

- `npm run check` passes: Prettier, ESLint, strict TypeScript, 57 test files, and 117 tests.
- Both flagship acceptance suites pass without paid model calls.
- Git checkpoint recovery is proven against a bare remote after deletion of the original workspace.
- Evaluate is covered by a repository-spy test proving zero writes.
- Federated runtime identity, grouping, security, run display, and workflow designer behavior are covered by UI tests.
- ADR validation and core/desktop builds pass in the working tree. Clean-checkout and Rust host validation are recorded in `PHASE2-FINAL-REPORT.md`.

## Known constraints

- Live provider acceptance requires user-owned credentials and service configuration; deterministic providers and local fixtures are the default validation boundary.
- Remote desktop connections require a user-operated HTTPS gateway or loopback tunnel because the control plane itself deliberately remains loopback-only.
- Native installers must be built and signed on their target operating systems. This environment validates the macOS Rust host and cross-platform CI definitions, not signed Windows/Linux artifacts.
- Flagship business actions are extension points backed by configured work, evidence, model, and source-control providers; the checked-in acceptance suites supply deterministic action adapters.

## Deferred items

- Fine-grained delegated enterprise identity, direct public control-plane hosting/TLS termination, OS-keychain storage, signed/notarized production artifacts, in-app auto-update, opaque learned routing classifiers, and email/Slack/Teams notification channels remain outside the Phase 2 boundary.
