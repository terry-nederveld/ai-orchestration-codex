# Phase 2 security review

Date: 2026-08-18

Scope: new workflow, wait, context, Git checkpoint, extension, federation, and designer surfaces

Result: approved for the documented trusted-operator model; no blocking findings remain

## Threat review

| Risk                                        | Control and evidence                                                                                                                                                                                                                        | Residual boundary                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Issue/comment/instruction prompt injection  | Context and instruction records carry provenance/digests and are explicitly labeled untrusted before agent use. They cannot expand permission rules, budgets, or graph transitions. Attachments are disabled unless bounded policy opts in. | A permitted model may still be influenced within its existing authority; use deny/ask policy for sensitive tools.          |
| Tool escalation                             | Registered tools and workflow actions pass through capability policy; process execution is shell-free and filesystem operations remain workspace-contained.                                                                                 | Extension code executes with its approved manifest grants and must be reviewed like local code.                            |
| Secret exposure                             | Inputs use references; secret human input accepts references only. Tauri bearer tokens are ephemeral/session-scoped and plaintext non-loopback remotes are rejected.                                                                        | Browser development explicitly persists operator-entered tokens; use a dedicated profile and HTTPS.                        |
| Cross-runtime leakage                       | Every aggregate record is tagged with runtime ownership and each mutation resolves the owning client. Runtime failures and tokens are isolated.                                                                                             | UI groups are views, not an authorization boundary.                                                                        |
| Unauthorized or conflicting human responses | Bearer authentication is required; request channel is enforced; the first valid response is selected atomically and later responses remain supplemental.                                                                                    | Phase 2 trusts the connection identity and actor identifier; fine-grained delegated identity is deferred.                  |
| Managed-section overwrite/injection         | Delimiters are validated, only the bounded managed block is replaced, and all human-authored text outside it is preserved.                                                                                                                  | External editors can intentionally remove the managed block, which causes safe recreation rather than hidden merging.      |
| Branch collision or lost coding work        | Checkpoints create Conventional Commits and use non-force remote pushes; conflicting branches fail closed. Recorded SHA/branch/spec revision can reconstruct a deleted local session.                                                       | Remote retention and access policy remain the operator's responsibility.                                                   |
| Malicious workflow or runaway execution     | Schema/compiler validation, immutable digests, declared transitions, bounded retry/repeat/experiment/fan-out limits, capability policy, and lifecycle enablement fail closed. Regex mapping rejects unsafe patterns.                        | Tenant authors can deliberately allocate large values within configured hard caps; budgets should match their environment. |
| Compromised MCP/extension                   | MCP tools are namespaced and permission-mediated; extension manifests require exact grants and load lazily.                                                                                                                                 | The host cannot sandbox arbitrary trusted local extension JavaScript beyond its grant checks.                              |
| Evaluate causing mutations                  | Evaluation uses read-only resolvers and a test repository spy proves zero writes.                                                                                                                                                           | Hypothetical inputs may contain sensitive sample data and should be handled like work-item context.                        |

## Findings and remediation

### S-01 — insecure remote token transport

Severity: blocking. Multi-runtime configuration initially made remote URLs possible without a transport rule. Connection normalization now rejects non-loopback plaintext URLs and documentation requires HTTPS termination or a loopback tunnel.

### S-02 — response source could bypass the requested channel

Severity: high. Human input normalization now checks `app`, `work_item`, or `both` before selecting a response. Atomic persistence implements first-response-wins; secret values cannot be embedded directly.

### S-03 — unbounded conditional regex and experiment work

Severity: high. Repository mapping rejects unsafe regex forms and limits pattern length. Workflow repetition, fan-out, experiments, evaluations, candidates, concurrency, wall-clock, and token budgets are validated against hard bounds.

### S-04 — remote checkpoint overwrite

Severity: high. Git checkpoints do not force-push. A conflicting remote branch fails the wait transition instead of destroying another run's work.

## Verification

Security-relevant suites cover connection transport, first response/channel enforcement, secret references, managed-section preservation, mapping validation, bounded experiments, workspace containment, extensions/MCP grants, and destructive remote-Git recovery. Dependency and Rust checks are part of final validation.

## Conclusion

No blocking issue remains under the single trusted operator/connection-identity model. The important residual risks are explicit: configured extensions are trusted code, remote TLS is externally terminated, browser development can persist tokens, and fine-grained human identity is not yet an authorization subsystem.
