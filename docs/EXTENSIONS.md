# Extensions, skills, hooks, and MCP

Application extensions and MCP servers have different trust models. Extensions execute in the control-plane process as trusted JavaScript after manifest validation and explicit grants. MCP servers remain protocol peers whose tools pass through Fable’s permission layer.

## Manifest extensions

Place `fable-extension.json` under a configured `extensions.paths` directory:

```json
{
  "schemaVersion": 1,
  "id": "acme.delivery",
  "name": "Acme delivery",
  "version": "1.0.0",
  "apiVersion": "1",
  "entry": "index.mjs",
  "provides": {
    "tools": ["acme.lookup"],
    "workflowActions": ["acme.deploy"],
    "hooks": ["after_pull_request"]
  },
  "permissions": ["network.connect"]
}
```

Grant exactly the declared capabilities:

```yaml
extensions:
  paths: [.fable/extensions]
  grants:
    acme.delivery: [network.connect]
```

Discovery rejects duplicate IDs, incompatible API versions, unknown manifest fields, symlinks during scanning, entry-path escapes, undeclared contribution shapes, and missing grants. The module exports `activate({ manifest, apiVersion })` and returns optional `tools`, `workflowActions`, and `hooks`. In-process code is fully trusted once loaded; inspect it before granting any capability.

## Hooks

Supported lifecycle names are `before_work_claim`, `after_work_claim`, `before_workspace_create`, `after_workspace_create`, `before_agent_start`, `after_agent_turn`, `before_tool_call`, `after_tool_call`, `before_subagent`, `after_subagent`, `before_commit`, `after_commit`, `before_pull_request`, `after_pull_request`, `on_failure`, `on_complete`, and `on_cleanup`. Higher priority executes first. A hook may return JSON fields to augment the next hook context; preparation hooks can adjust commit or pull-request inputs.

## Skills

Any `SKILL.md` beneath an extension path is indexed lazily to depth four. YAML frontmatter may define `id`, `name`, `description`, and string `tags`. Contents are loaded only when requested, reducing prompt/context cost. Duplicate IDs and unsafe symlinked paths are rejected.

## MCP

```yaml
mcp:
  - id: local-tools
    transport: stdio
    command: node
    args: [server.mjs]
    cwd: tools
    permissions: [process.execute]
  - id: remote-readonly
    transport: http
    url: http://127.0.0.1:8787/mcp
    permissions: [network.connect]
```

Fable supports stdio and Streamable HTTP through the official MCP SDK. Tools are namespaced as `<server-id>.<tool-name>`, schemas/results are normalized to JSON, cancellation propagates, and connections close with the runtime. Header strings are currently literal configuration values, so prefer a short-lived authenticated local proxy or environment-configured stdio launcher rather than placing durable bearer tokens in YAML.

Inspect loaded manifests, skills, and MCP tool names with `fable extensions list`.
