# Fable

Fable is a local-first, provider-neutral orchestration platform for autonomous software-delivery agents. It discovers eligible work in GitHub Issues, Jira Cloud, Jira Data Center, or Linear; claims it durably; creates an isolated workspace; runs a versioned workflow; and exposes progress, approvals, logs, budgets, and terminal outcomes through one CLI/control-plane/desktop stack.

The repository contains a strict TypeScript orchestration core, a loopback-only authenticated HTTP/SSE control plane, and a Tauri 2 desktop application. Packaged desktop builds embed the Node control plane as a supervised sidecar, so end users do not need Node.js.

## Quick start from source

Prerequisites are Node.js 22.13 or newer, npm, Git, and the coding-agent CLI/account you intend to use. Rust is needed only for the desktop host and installers.

```sh
npm ci
npm run dev -- init
```

Edit `fable.config.yaml`, then validate it without contacting providers:

```sh
npm run dev -- validate
npm run dev -- providers
```

Set credentials as environment variables or use the encrypted vault:

```sh
export GITHUB_TOKEN=...
export FABLE_VAULT_PASSWORD='a unique password of at least 16 characters'
printf '%s' "$OPENAI_API_KEY" | npm run dev -- secrets set openai.api_key
```

Do not place literal secrets in YAML. Start one item synchronously:

```sh
npm run dev -- run \
  --provider github-issues:your-organization/your-repository \
  --issue 123 \
  --workflow software-development
```

Or enable the scheduler in configuration and start the control plane:

```sh
npm run dev -- serve
```

For desktop development:

```sh
npm run dev:desktop
```

## Operator surfaces

- Desktop: dashboard, discovery, runs and event history, provider health, workflows, agents/projects, approval decisions, settings, and opt-in native terminal-state notifications.
- CLI: `init`, `validate`, `providers`, `agents list`, `workflows list`, `extensions list`, `status`, `scheduler status|poll`, `work list`, `run`, `runs list|show`, `approvals list|resolve`, `secrets set|delete`, and `serve`.
- Local API: authenticated loopback HTTP plus resumable server-sent domain events. The desktop generates a new bearer token on every launch.

## Quality gates

```sh
npm run check
npm run validate:adrs
npm run build
npm run build:sidecar
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

The deterministic suite covers provider contracts, persistence, workflow compilation/execution, native agents, permissions, path containment, extension grants, MCP normalization, scheduler recovery, control-plane authentication, UI behavior, and a complete issue-to-code delivery flow.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Workflow authoring](docs/WORKFLOWS.md)
- [Providers and authentication](docs/PROVIDERS.md)
- [Extensions, skills, hooks, and MCP](docs/EXTENSIONS.md)
- [Security model](docs/SECURITY.md)
- [Operations and troubleshooting](docs/OPERATIONS.md)
- [Development](docs/DEVELOPMENT.md)
- [Releases and updates](docs/RELEASES.md)
- [Architecture decision records](docs/adrs)

## Current scope

Fable v0.1 is designed for one trusted operator on one machine. It has a durable polling scheduler rather than a distributed queue. GitHub repository Issues are supported directly; GitHub Projects V2 field synchronization is not yet a dedicated provider. Native workflows run separate implementer/reviewer sessions, while provider-owned subagent delegation is available only when the selected external agent supports it. OS-keychain integration and an in-app auto-updater are intentionally deferred; credentials use environment lookup plus an authenticated encrypted vault, and updates are distributed as versioned platform artifacts.

Licensed under the [MIT License](LICENSE).
