# Phase 2 architecture review

Date: 2026-08-18

Scope: Orchestrator Phase 2 implementation and v0.2.0 integration

Result: approved after remediation; no blocking findings remain

## Review method

The review traced each Phase 2 requirement through domain contracts, application services, ports, adapters, composition, persistence, control-plane endpoints, desktop state, schemas, and executable tests. It also ran the import-boundary contract, strict type checking, flagship acceptance scenarios, restart recovery, and destructive Git recovery.

## Boundary assessment

- The domain layer owns normalized immutable records and policies without importing infrastructure.
- Application services implement resolution and orchestration against ports; provider-specific behavior remains in adapters or extension-contributed workflow actions.
- The workflow engine owns graph position and declared transitions. Agent handlers can produce structured values but cannot mutate the running graph.
- Persistence is the correctness boundary for workflow checkpoints, asset snapshots, execution-spec revisions, waits, responses, recurrence, and events. Provider sessions remain disposable hints.
- Composition wires the adapters once. The control plane and desktop are clients of application/runtime contracts rather than alternate orchestration paths.
- Federated desktop records preserve runtime ownership and commands use the owning runtime client. Workspace grouping is display-only.

## Findings and remediation

### A-01 — fatal terminal step could report success

Severity: blocking. A single final node that failed with fatal error handling could exit the scheduling loop before the terminal status was recomputed. The engine now derives failure after the loop and a regression test covers invalid structured output on the terminal node.

### A-02 — Delivery source-control contract was incomplete

Severity: blocking for the checked-in template. The Delivery graph committed and opened a pull request but omitted the explicit push node and required pull-request inputs. The template now commits, pushes, then supplies repository, title, body, and draft state to the built-in pull-request action.

### A-03 — Phase 2 services risked becoming isolated utilities

Severity: high. Repository mapping, instruction discovery, context resolution, specification revision, remote checkpoints, waits, joins, recurrence, and workflow publication were traced into the runtime path. Missing integration was added to orchestration, scheduler, recovery, handlers, composition, and control-plane routes. Acceptance tests assert behavior across service boundaries rather than testing only data classes.

### A-04 — mutable workflow selection on resume

Severity: high. Resume now loads the exact stored `(id, version, digest)` asset and validates the workflow snapshot. Editing or publishing a newer workflow cannot change an existing run.

## Accepted architecture constraints

- Flagship domain actions such as evidence gathering and work-item synthesis are replaceable workflow actions supplied by configured adapters/extensions. The deterministic acceptance adapters prove the graph contracts without making paid or tenant-mutating calls.
- Remote access terminates TLS outside the loopback-only service or uses a loopback tunnel. Public server hosting is intentionally not added to the trusted local-control-plane process.
- Advanced designer configuration remains canonical YAML with semantic round-trip; the visual graph provides node/dependency/lifecycle manipulation over the same definition.

## Conclusion

The implementation evolves the existing architecture rather than introducing a parallel Phase 2 kernel. The separation of state layers, immutable asset boundary, durable checkpoint path, and provider-neutral services are coherent and covered by executable integration evidence. No blocking architecture finding remains.
