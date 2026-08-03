# Logion agent contract

These rules apply to every agent working in this repository.

- Preserve unexplained working-tree changes. Never reset, clean, stash, reformat, or commit
  another owner's files without explicit scope.
- For multi-client work, read
  `.agents/skills/logion-orca-coordinator/SKILL.md` and its coordination contract before
  dispatching workers.
- Treat Windows Codex as the only writer of local coordination state under
  `.agents/coordination/runs/`. External workers receive self-contained task packets and return
  structured handoffs; they do not edit the ledger.
- Keep one writer per branch and worktree. Do not give concurrent workers overlapping writable
  paths.
- Never place API keys, tokens, passwords, SSH material, provider endpoints, private host data,
  user home paths, production configuration, terminal transcripts, or dispatch capabilities in
  repository files or coordination state.
- Record checks as passed only after observing the result. A written test, planned command, or
  worker claim is not equivalent to a passing coordinator verification.
- Codex owns architecture, sensitive backend work, integration, final tests, commits, and pushes.
  External workers do not merge or push unless a task explicitly transfers that authority.

When a local active-run pointer exists at `.agents/coordination/current-run.json`, validate and
read that run before continuing coordinated work. The Git working tree and observed test results
remain authoritative over ledger summaries.
