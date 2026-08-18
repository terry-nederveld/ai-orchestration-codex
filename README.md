# Fable

Fable is a local-first, provider-neutral autonomous work orchestrator. It coordinates delivery, discovery, experiments, deterministic gates, models and coding agents, repositories, tools, human judgment, recurring work, and independent local/remote runtimes. It discovers eligible work in GitHub Issues, Jira Cloud, Jira Data Center, or Linear; claims it durably; runs a pinned workflow graph; and exposes work-centric progress through one CLI/control-plane/desktop stack.

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

- Desktop: federated runtime/group views, work discovery, work-centric run state, newest-first events, typed human needs, provider health, visual/YAML workflow design, side-effect-free Evaluate, immutable workflow publication, and opt-in native notifications.
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

The deterministic suite covers provider contracts, immutable assets/specifications, durable waits/resume, Git recovery, repository/instruction/context resolution, gates/profiles/fallback, experiments/rubrics/judgment packages, joins, lanes/recurrence/releases, routing/Evaluate, federated UI behavior, both flagship journeys, and the original issue-to-code flow.

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

Fable v0.2 uses one connection identity per external system and keeps every runtime authoritative for its own credentials and state. The desktop can observe local and remote runtimes simultaneously; the shipped server remains loopback-only, so remote operation uses an HTTPS gateway or loopback tunnel. Dedicated GitHub Projects V2 field synchronization, fine-grained delegated enterprise identity, OS-keychain integration, and in-app auto-update remain later work.

Licensed under the [MIT License](LICENSE).
