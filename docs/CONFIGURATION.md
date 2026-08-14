# Configuration

Fable reads versioned YAML. With no `--config`, it merges `~/.config/fable/config.yaml` first and `<current directory>/fable.config.yaml` second. Nested objects merge recursively; arrays and scalar values in the project file replace the earlier value. An explicit `--config` or `FABLE_CONFIG_PATH` selects one file. Relative paths are resolved from the highest-precedence file.

Start with `fable init`, then run `fable validate` after every change.

```yaml
version: 1
dataDirectory: .fable
workspaceRoot: .fable/workspaces

permissions:
  - capability: filesystem.read
    resource: "*"
    decision: allow
  - capability: filesystem.write
    resource: "*"
    decision: sandbox-only
  - capability: process.execute
    resource: "*"
    decision: ask

agents:
  - type: codex
    executable: codex
    network: false

work:
  - type: github
    owner: acme
    repository: storefront
    secret: github.token

workflows:
  - workflows/software-development.yaml

scheduler:
  enabled: true
  pollIntervalMs: 30000
  maxConcurrentRuns: 2
  maxAttempts: 3
  retryBackoffMs: 5000
  maxRetryBackoffMs: 300000
  sources:
    - id: github-ready
      workProvider: github-issues:acme/storefront
      workflow: software-development
      query:
        states: [open]
        labels: [agent-ready]
        limit: 50
```

## Top-level fields

| Field                                        | Purpose                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `dataDirectory`, `database`, `workspaceRoot` | Local state, optional SQLite path, and managed workspace root.                |
| `vault.path`                                 | Optional AES-256-GCM vault location. Requires `FABLE_VAULT_PASSWORD`.         |
| `permissions`                                | Ordered capability policy. Decisions: `allow`, `deny`, `ask`, `sandbox-only`. |
| `models`                                     | Direct OpenAI, Anthropic, OpenRouter/OpenAI-compatible, or local endpoints.   |
| `agents`                                     | Codex SDK, Claude Code CLI, or GitHub Copilot SDK sessions.                   |
| `work`                                       | GitHub Issues, Jira Cloud/Data Center, or Linear sources.                     |
| `workflows`                                  | Relative paths to version-1 workflow documents.                               |
| `extensions`                                 | Discovery paths plus exact per-extension capability grants.                   |
| `mcp`                                        | Stdio or Streamable HTTP server definitions.                                  |
| `sourceControl`                              | GitHub API base URL and secret reference for pull requests.                   |
| `concurrency.workflowSteps`                  | Maximum ready workflow steps executed concurrently.                           |
| `scheduler`                                  | Polling, concurrency, retry, and source definitions.                          |

## Secret references

Provider configuration contains references such as `github.token`, never values. Built-in environment mappings are:

| Reference            | Environment variable |
| -------------------- | -------------------- |
| `openai.api_key`     | `OPENAI_API_KEY`     |
| `anthropic.api_key`  | `ANTHROPIC_API_KEY`  |
| `openrouter.api_key` | `OPENROUTER_API_KEY` |
| `github.token`       | `GITHUB_TOKEN`       |
| `linear.token`       | `LINEAR_API_KEY`     |

Other references are looked up by their exact environment-variable name. With `FABLE_VAULT_PASSWORD` set to at least 16 characters, `fable secrets set <reference>` writes an authenticated encrypted file with restrictive permissions and never prints the value. Without that password, writes are process-memory only and do not survive restart.

## Safe defaults

Scheduling is disabled, no provider is implicitly configured, and the permission list is empty. External agent network access is disabled unless configured. A new desktop install bootstraps an inert config in the platform application-config directory.
