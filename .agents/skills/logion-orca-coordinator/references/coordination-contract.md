# Logion multi-client coordination contract

## Role matrix

| Seat                         | Default scope                                                                                                              | Delivery mode                                                             | Default prohibitions                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Codex / GPT-5.6 Sol          | Architecture, task decomposition, core implementation, sensitive backend work, review, tests, integration, commits, pushes | Windows primary worktree and Orca coordinator                             | Do not overwrite unexplained user changes or waive failed gates                      |
| ZCode / GLM-5.2              | Bounded modular implementation with clear file ownership                                                                   | Manual Windows ZCode workspace backed by a dedicated Git worktree         | No Orca worker claim, no merge/push, no secrets, no overlapping files                |
| Claude Code / Kimi K3        | UI concepts, frontend components, styling, and bounded frontend implementation                                             | Mac terminal in a dedicated remote worktree; supervise by terminal handle | No backend/auth/migration/contract changes unless explicitly assigned; no merge/push |
| OpenCode / DeepSeek V4 Flash | Independent diff, security, contract, or regression review                                                                 | Mac read-only `deepseek-review` profile in a dedicated worktree           | No edits, destructive shell, external-directory access, commit, or push              |

Use `k3-256k` for routine Kimi work. Use the full `k3[1m]` Claude Code setting only when the
task truly needs the longer context and the user's Kimi plan supports it. Use the exact
DeepSeek model ID returned by the configured relay's `/v1/models` response.

## Task packet

```text
Title:
Owner/client/model:
Objective:
Base repository and immutable base commit:
Worktree path and branch:
Allowed files/directories:
Forbidden files/directories:
Required behavior:
Non-goals:
Interfaces and invariants that must remain unchanged:
Acceptance commands:
Required handoff format:
Stop and ask when:
```

The packet must be self-contained. Attach only the smallest relevant source files or specifications;
never attach credentials, production data, `.env`, or unrelated conversation history.

## Worker handoff

Require this evidence:

```text
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```

"No tests needed" is not evidence. The worker must state why a test category is not applicable.
Inside a structured handoff receipt, `checks` contains only checks that actually ran, with status
`passed` or `failed`. Never put a planned or unavailable check in that array. Put every check that
did not run in `unrunChecks` as `{ name, reason }`. A coordinator observation is a different
evidence type and may use `not_run` with a non-empty reason; Worker receipts may not.

Every timestamp stored in coordination state must be strict RFC 3339 with `Z` or an explicit UTC
offset. Model evidence must exist no later than the `task.assigned` or `task.retried` event that
uses that seat; later evidence cannot retroactively prove an earlier dispatch.

## Merge gates

Apply the narrowest relevant gates first, then the repository gate:

| Change type              | Minimum bounded verification                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| React/UI                 | Targeted Vitest, lint/typecheck for the package, production build; relevant Playwright flow when behavior or navigation changes |
| API/service              | Targeted pytest, Ruff, mypy; integration tests when PostgreSQL or Redis behavior changes                                        |
| OpenAPI/client contract  | `pnpm contracts:generate`, inspect generated diff, then `pnpm contracts:check`                                                  |
| Database/migration       | Explicit authorization, migration upgrade/downgrade checks, PostgreSQL integration tests; never infer permission                |
| Auth/security/secrets    | Codex-owned review, targeted negative tests, secret scan, and applicable browser/API integration flow                           |
| Documentation/Skill only | Frontmatter validation, link/config review, focused formatter check, and a forward test for a non-trivial Skill                 |

Before integration, run `pnpm ci:fast` when the change can affect the product build or contracts.
Run `pnpm test:browser` when user-visible behavior changes and the required environment exists.
Record infrastructure-dependent Worker checks in `unrunChecks` when the environment is absent.
When Codex independently records the same gap, use a coordinator observation with `not_run` and a
non-empty reason.

## Cross-machine Git rules

- Clone the repository independently on each machine; never copy `.git` or Windows worktree
  metadata to macOS.
- Start every task from the same remote-reachable base commit.
- A synthetic fixture under the repository's trusted real
  `.agents/coordination/fixtures/` root is the only allowed unreachable-baseline exception. That
  root and Run may not be a symlink or junction. Active and closed Runs must always prove their
  base commit is reachable.
- Use one branch per worktree and one writer per branch.
- External workers leave changes for coordinator review and do not push by default.
- The coordinator reviews the remote diff and tests before creating or accepting a commit.
- Never force-push a shared branch or delete a worktree containing unreviewed changes.
