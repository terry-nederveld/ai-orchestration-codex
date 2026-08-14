# Providers and authentication

Run `fable providers` to see capability descriptors and live availability. A provider is selected by ID and required capabilities, never by vendor-specific branching in workflow code.

## Coding agents

| Config type   | Runtime ID           | Authentication and notes                                                                                                                                                    |
| ------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`       | `codex-sdk`          | Install the `codex` executable and run `codex login`, or configure `openai.api_key`. Uses workspace-write sandbox, no approval prompts, and network disabled by default.    |
| `claude-code` | `claude-code`        | Install Claude Code and run `claude auth login`. Uses the supported `-p --output-format stream-json` headless interface. Choose subscription or API consumption accounting. |
| `copilot`     | `github-copilot-sdk` | The Copilot SDK starts its supported client/CLI service and reports its auth status/models. Managed approval requests are refused when no operator is attached.             |

These integrations stream messages/tools/usage, retain provider session IDs, support cancellation, and normalize terminal outcomes. Provider-native subscriptions remain provider-native; Fable records request counts and any usage the provider emits rather than pretending subscription requests are API dollars.

## Direct model APIs

- `openai`: Responses API, ID `openai-responses`, usually `OPENAI_API_KEY`.
- `anthropic`: Messages API, ID `anthropic-messages`, usually `ANTHROPIC_API_KEY`.
- `openai-compatible`: custom ID/name/base URL, optional secret and headers. Use this for OpenRouter and local servers such as Ollama-compatible gateways.

Direct models run through Fable’s native goal loop with workspace tools, streaming, retry classification, context compaction, explicit outcomes, usage, and budgets.

## Work systems

| Config type        | Runtime ID                          | Credential                                                                                                                                                                       |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`           | `github-issues:<owner>/<repo>`      | `github.token` / `GITHUB_TOKEN`; fine-grained access should include repository Issues, Contents, and Pull Requests as needed. Public read-only discovery can be unauthenticated. |
| `jira-cloud`       | `jira-cloud:<host>[:project]`       | API token secret plus account email for Basic auth, or a bearer token when email is omitted.                                                                                     |
| `jira-data-center` | `jira-data-center:<host>[:project]` | Personal access/bearer token, or deployment-supported token scheme.                                                                                                              |
| `linear`           | `linear`                            | `linear.token` / `LINEAR_API_KEY`. Optional team ID and repository mapping.                                                                                                      |

Adapters normalize identity, title/body, state, labels, assignees, relationships, repository metadata, pagination, updates, transitions, comments, and claims. Provider errors preserve retryability without copying credentials into events.

GitHub Projects V2 is not yet a first-class field adapter. Repository Issues that appear in a Project are still discoverable and deliverable through the GitHub Issues provider; Project status/select field synchronization must currently be handled by an extension or MCP tool.

## Source control

Git operations use argument arrays without a shell and are scoped to the selected workspace. Pull requests use the GitHub REST API and default to draft. `sourceControl.githubSecret` may point to a different token reference than the work provider.

## Startup checks

Provider availability is shown independently for installed, authenticated, and available state with model/detail metadata where supported. `fable validate` is offline and checks only configuration/workflow contracts; `fable providers` performs provider probes and may make network or local CLI calls.
