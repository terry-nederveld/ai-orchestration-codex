# Operations and troubleshooting

## Daily operation

1. Run `fable validate` after configuration or workflow changes.
2. Run `fable providers` and resolve unavailable/authentication details.
3. Inspect `fable status` and `fable scheduler status`.
4. Use `fable work list -p <provider>` to confirm eligibility before enabling polling.
5. Review pending approvals and retained failed workspaces before retrying delivery.
6. Use `fable runs show <id>` for the durable event timeline and terminal outcome.

The scheduler owns one deterministic dispatch per source/work item, preserves native rank, applies lane/WIP policy, and uses bounded retry. Persisted recurring triggers are polled by `serve` and dispatch through the same engine. Manual `scheduler poll` runs one backlog cycle.

## State and backup

The default project state lives under `.fable`: SQLite plus WAL files, managed workspaces, and optionally the encrypted vault. Stop Fable before a file-level backup, or use SQLite-aware online backup tooling. The vault needs its external master password; backing up only one is insufficient. Do not synchronize active workspace or WAL files through consumer cloud-drive software.

## Failure behavior

- Provider 429/5xx and classified transient failures retry within configured bounds.
- Runs at a durable wait checkpoint remain waiting across restart. Interrupted execution without a safe checkpoint fails rather than silently replaying effects.
- Interrupted scheduler dispatches retry or exhaust based on their attempt count.
- Typed human requests and generic wait conditions remain durable; the first authorized response resumes the exact pinned node.
- Failed workflows retain workspaces when `retainOnFailure: true`; successful owned workspaces are cleaned up.
- Claim release, work transition, and cleanup failures emit distinct events so the primary outcome is not hidden.
- Cancellation propagates through workflow, model/agent, MCP, and process abort signals.

## Troubleshooting

### No configuration found

Run `fable init`, pass `--config /absolute/path/fable.config.yaml`, or set `FABLE_CONFIG_PATH` for the desktop process. Remember automatic user/project layering is based on the current working directory.

### Provider reports unavailable

Use `fable providers --json`. Verify the executable is on `PATH`, run its login command, confirm secret-reference spelling, and test outbound TLS/proxy access. `fable validate` does not authenticate.

### Vault secret disappears after restart

Set `FABLE_VAULT_PASSWORD` before both `secrets set` and service startup. Without it, the writable secret provider is deliberately in-memory. The password must be at least 16 characters and must match the one used to create the vault.

### Work is discovered but not dispatched

Check scheduler `enabled`, source provider/workflow IDs, trigger state, required/excluded labels, retry exhaustion, active concurrency, and whether the same source/item already has an active dispatch. Inspect scheduler events and the SQLite dispatch entity through supported diagnostics rather than editing the database.

### A run waits forever

Check **Needs Your Input** for an approval or typed request, inspect the wait/checkpoint, then verify provider limits and terminal events. A restart preserves declared waits. Non-checkpointed active work fails closed.

### Resume cannot find coding progress

Inspect the recorded branch and checkpoint SHA. Fable reconstructs a missing local workspace from the remote branch and refuses force-push collisions. If the branch was deleted externally, restore it from the remote provider or recorded SHA before resuming.

### Workspace cleanup is refused

Fable refuses deletion when strategy/ownership/root metadata does not prove the path is managed. Inspect and remove the directory manually only after resolving the exact path and confirming it contains no user work.

### Desktop says control plane unavailable

Check `FABLE_CONFIG_PATH`, validate YAML, verify the sidecar executable exists in the bundle, and start `fable serve --port 0 --json` directly for a readable startup error. The desktop allows 20 seconds for readiness and kills the child on exit.

### macOS DMG creation stalls locally

The `.app` bundle can still be valid; DMG creation relies on Finder/AppleScript and can stall in restricted/headless sessions. Use the macOS GitHub runner release workflow for distribution artifacts.

## Logs and support bundles

Prefer `fable runs show <id> --json`, configuration with secret values removed, provider status, OS/architecture, and the exact Fable version. Never include the bearer token, vault/password, environment variables, private issue bodies, or repository files unless the recipient is authorized.
