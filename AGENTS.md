# Logion agent contract

These rules apply to every agent working in this repository.

## Persistent workflow and resume order

Do not rely on chat history as project memory. Before coordinated work, read these sources in
order:

1. `docs/development/AGENT_DELIVERY_WORKFLOW.md` for the approval, delegation, review, and Git
   workflow;
2. `docs/development/V020_EXECUTION_PLAN.md` and `docs/development/V020_STATUS.md` for the current
   version DAG and dated progress snapshot;
3. `.agents/coordination/current-run.json`, when present, followed by validation of the referenced
   Run as described in `docs/development/AGENT_STATE_MODEL.md`.

The user-approved specification, Git working tree, and observed checks remain more authoritative
than a status document or ledger snapshot. Update the durable workflow/status documents and append
coordination events whenever the user approves or rejects a design, a task changes lifecycle state,
the immutable base changes, or work is handed across sessions or machines. Never rewrite historical
events to hide a superseded decision.

- Preserve unexplained working-tree changes. Never reset, clean, stash, reformat, or commit
  another owner's files without explicit scope.
- For multi-client work, read
  `.agents/skills/logion-orca-coordinator/SKILL.md` and its coordination contract before
  dispatching workers.
- Treat the user-designated coordinator session as the only writer of local coordination state
  under `.agents/coordination/runs/`. Other workers receive self-contained task packets and return
  structured handoffs; they do not edit the ledger.
- Keep one writer per branch and worktree. Do not give concurrent workers overlapping writable
  paths.
- Never place API keys, tokens, passwords, SSH material, provider endpoints, private host data,
  user home paths, production configuration, terminal transcripts, or dispatch capabilities in
  repository files or coordination state.
- Record checks as passed only after observing the result. A written test, planned command, or
  worker claim is not equivalent to a passing coordinator verification.
- The user-designated mainline owner owns architecture, sensitive backend work, integration and
  final tests within the approved task packet. Commit, push, merge and release authority must be
  transferred explicitly; Production changes and sensitive feature enablement always require
  current user approval.

When a local active-run pointer exists at `.agents/coordination/current-run.json`, validate and
read that run before continuing coordinated work. The Git working tree and observed test results
remain authoritative over ledger summaries.
