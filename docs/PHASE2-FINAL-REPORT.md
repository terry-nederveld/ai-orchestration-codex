# Orchestrator Phase 2 final report

Date: 2026-08-18

Release: v0.2.0

## Result

Phase 2 is implemented and validated against deterministic providers, local fixtures, a real bare Git remote, clean process recreation, a fresh repository clone, the production UI compiler, the packaged control-plane sidecar, and the macOS Rust/Tauri host. Architecture and security reviews found blocking issues during validation; all blocking findings were remediated before release preparation.

## Implemented

- A deterministic immutable workflow graph with separate graph position, reserved engine lifecycle, domain state, and external-state projection.
- Versioned workflows, sub-workflows, asset snapshots, output contracts, guards, lifecycle actions, joins, bounded retry/repetition, and DRAFT/ENABLED/DISABLED publication.
- Durable typed human input and unified waits with exact-node resume, first-valid-response selection, supplemental context, channel enforcement, secret references, and explicit promotion.
- Immutable revisioned execution specifications, authoritative refresh, many-to-many repository resolution, scoped instruction discovery, normalized relationship context, opt-in attachments, remote Git checkpoints, and managed work-item sections.
- Versioned gate sets and independent remediation reevaluation, composed agent profiles, deterministic capability/budget fallback, experiments, pinned rubrics, judgment packages, bounded candidate fan-out/fan-in, learning retention, and judgment observability data.
- Rank-preserving lanes, strict/skip-blocked/ranked-parallel policies, WIP limits, persisted recurrence, support correlation, and implemented/PR/merged/released/deployed/verified lifecycle representation.
- Autonomous Delivery and Autonomous Discovery templates, side-effect-free Evaluate, ambiguity-safe routing, routing-rule suggestions requiring approval, and immutable catalog compatibility checks.
- A federated desktop that connects to multiple independent runtime clients, isolates failures and tokens, preserves runtime ownership, supports UI-only groups, surfaces Needs You, uses work-centric run details and newest-first activity, and edits visual/canonical workflow definitions with semantic round-trip.
- Updated schemas, configuration, operations, security, workflow, release, architecture, migration, and progress documentation plus ADRs 0010–0013.

## Validated

The final clean-checkout sequence used a copied-object clone with no working-tree artifacts:

1. `npm ci --ignore-scripts`
2. `npm run check`
3. `npm run build`
4. `npm run validate:adrs`
5. `npm run build:sidecar`
6. `cargo check --locked --manifest-path src-tauri/Cargo.toml`

Results:

- Prettier, ESLint, and strict TypeScript passed.
- 57 test files and 117 tests passed.
- Autonomous Delivery passed readiness remediation/independent reevaluation, process destruction at genuine ambiguity, work-item response, specification revision, continuation, tests/review/Done gates, Conventional Commit, push/PR contract, and completion.
- Autonomous Discovery passed evidence provenance, hypothesis/rubric predeclaration, practical candidate artifacts, killing/rejected learning, managed-section preservation, process recreation at judgment and approval, PRD, related story creation, and Delivery handoff.
- Remote Git recovery pushed a non-force checkpoint to a bare remote, deleted the original workspace, and reconstructed the recorded branch/SHA.
- Evaluate performed zero persistence writes in the repository-spy test.
- Federated runtime ownership, grouping, transport policy, failure isolation, newest-first runs, Needs You responses, and workflow designer publication passed UI tests.
- Production core and desktop UI builds passed; the target control-plane sidecar was generated; the locked macOS Rust host compiled.
- All 13 ADRs passed repository validation.
- `npm audit --audit-level=high` reported zero vulnerabilities.
- Commit messages are Conventional Commits and the prohibited-credit scan found no attribution or watermark outside the tests that deliberately reject such footers.

## Partial

- Flagship business actions for tenant-specific evidence collection, story creation, work-item managed-section writes, and model execution remain replaceable adapter/extension contracts. The end-to-end suites use deterministic adapters; built-in Git commit/push/pull-request actions are concrete.
- Advanced workflow settings are fully editable in canonical YAML and round-trip through the designer, while the visual form concentrates on graph nodes, dependencies, node type, and lifecycle rather than providing a bespoke form control for every nested policy.
- Provider-native relationship and release observations depend on what GitHub, Jira, Linear, SCM, CI/CD, or installed extensions expose. The internal relationship and lifecycle models are complete; unavailable provider projections degrade explicitly.

## Externally blocked validation

- Live OpenAI/Anthropic/OpenRouter/Codex/Claude/Copilot runs and mutating GitHub/Jira/Linear tenant scenarios require user-owned credentials, repositories, projects, and permission to incur cost or alter external state.
- A real remote-runtime desktop session requires an operator-provided HTTPS runtime/gateway or loopback tunnel. The two-runtime client, ownership, isolation, and security behavior is covered locally.
- Signed/notarized Windows, Linux, and macOS installers require target-native CI runners and signing credentials. This environment validated the macOS host and the target-native CI definitions.

## Intentionally deferred

- Fine-grained delegated enterprise identity and per-human external identity verification.
- Direct public control-plane hosting/TLS termination; the service stays loopback-only.
- OS-keychain secrets, signed production artifacts, and in-app auto-update.
- Opaque learned routing classifiers; Phase 2 limits learning to deterministic suggestions plus explicit approval.
- Email, Slack, and Teams human-interaction channels, which the Phase 2 brief explicitly excludes.

## Review disposition

The architecture review is in `PHASE2-ARCHITECTURE-REVIEW.md`; the threat review is in `PHASE2-SECURITY-REVIEW.md`. No blocking finding remains under the documented trusted-operator and connection-identity model.
