# Development

## Repository layout

```text
src/domain          provider-neutral contracts and state
src/ports           interfaces owned by the core
src/application     orchestration use cases
src/adapters        providers and infrastructure
src/composition     validated dependency assembly
src/control-plane   loopback HTTP/SSE API
src/cli             headless operator interface
desktop             React renderer
src-tauri           Rust host and bundled sidecar manifest
tests               unit, contract, UI, security, and end-to-end tests
docs/adrs           accepted architecture decisions
```

## Setup and gates

```sh
npm ci
npm run check
npm run validate:adrs
npm run build
npm run build:sidecar
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

Use Node 22.13+, the stable Rust toolchain, and the platform prerequisites from Tauri’s documentation. Test files use deterministic fakes and local HTTP fixtures; default CI must not require external credentials.

## Adding a provider

1. Implement the smallest matching port (`ModelProvider`, `AgentProvider`, `WorkProvider`, `WorkspaceProvider`, and so on).
2. Publish an accurate descriptor and availability result.
3. Normalize errors, cancellation, streaming, usage, IDs, and pagination at the adapter boundary.
4. Add a schema variant and composition registration without vendor branches in application services.
5. Run the reusable contract suite and add fixture-backed edge cases.
6. Document authentication, capability gaps, consumption model, and provider ID.

## Adding workflow behavior

Prefer a registered tool or action over editing the engine. Update the versioned schema/domain types/compiler together, add graph/retry/cancellation tests, and write an ADR when semantics or persistence compatibility changes. New side effects need permission capabilities, hooks/events, and failure cleanup.

## Commit and review policy

Use Conventional Commits without automated-agent attribution. Keep commits buildable and focused. Reviews should prioritize secret leakage, path/process safety, duplicate dispatch, retry/idempotency, cancellation, state-machine legality, provider contract drift, and architectural dependency inversion.

## Live integration checks

Live provider tests are opt-in because they consume user accounts and can mutate external systems. Use a disposable repository/project, least-privilege token, explicit labels, low budgets, retained failed workspaces, and draft pull requests. Never make live credentials a CI requirement.

## Desktop visual QA

Run `npm run dev:ui` for responsive browser inspection and `npm run dev:desktop` for Tauri IPC/sidecar/notification checks. Verify desktop and narrow widths, keyboard focus, loading/error/empty states, approval decisions, long IDs/paths, terminal run events, and no renderer console errors.
