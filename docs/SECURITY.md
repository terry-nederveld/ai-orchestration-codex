# Security model

Fable assumes one trusted local operator and treats work-item text, repository contents, model output, extensions, and MCP results as potentially hostile input.

## Controls

- The control plane binds only to `127.0.0.1`, `localhost`, or `::1`, validates Host/Origin, requires a constant-time compared bearer token for API/SSE routes, and emits only a minimal unauthenticated health response.
- Desktop tokens are random, ephemeral, and returned over Tauri IPC. They are not persisted or placed in process arguments.
- Secrets are references. Environment values and decrypted vault contents never enter configuration snapshots, SQLite entities, domain events, UI payloads, native notifications, or logs.
- The fallback vault uses scrypt-derived AES-256-GCM, unique salt/IV, authenticated tags, atomic replace, regular-file/symlink checks, serialized writes, and restrictive file modes.
- Permission capabilities cover filesystem read/write, process execution, network, Git, issue writes, credentials, MCP, and extensions. Default policy is deny; `ask` becomes a durable approval boundary where supported.
- Filesystem tools canonicalize workspace roots, reject traversal and symlink escapes, bound output, and allow missing targets only after checking the nearest existing parent.
- Process execution uses executable/argument arrays without a shell, bounded output/time, explicit working directories, and abort propagation.
- Managed workspace deletion verifies strategy, ownership metadata, and containment before recursive removal.
- Extension manifests require exact capability grants. MCP tools are namespaced and permission mediated. Workflow expressions are parsed, not evaluated as JavaScript.
- Structured events and terminal notifications omit prompt, issue, secret, and full log content unless a specific adapter deliberately emits a safe summary.

## Prompt-injection posture

Provider text is data, not authority. It cannot change Fable configuration, grants, budgets, or approval policy. Agents can act only through their provider sandbox and registered tools. Use deny/ask rules for process, network, Git, and issue writes; keep delivery behind an approval; disable agent network access unless required; and review all extensions/MCP servers.

## Credential guidance

Prefer provider CLI OAuth/account sessions for subscription agents and least-privilege fine-grained tokens for APIs. Keep `FABLE_VAULT_PASSWORD` outside project files and process logs. Rotate any token exposed in a config, shell transcript, issue, prompt, or event. The encrypted vault is a fallback, not an OS keychain; protect the machine account and backups accordingly.

## Supply chain and releases

`npm ci`, lockfiles, weekly dependency updates, high-severity npm audit, strict compilation, architecture tests, and target-specific CI are enforced. Release artifacts should be built by GitHub-hosted target runners and signed/notarized with repository secrets. Unsigned local builds are development artifacts.

## Reporting

Do not attach vault files, bearer tokens, provider responses containing private work, or full `.fable` databases to public issues. Reproduce with deterministic fakes when possible and redact paths/usernames from diagnostics.
