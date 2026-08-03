---
name: logion-orca-coordinator
description: Coordinate Logion development across Windows and macOS with Orca, Git worktrees, Codex, ZCode, Claude Code, and OpenCode. Use when Codex must decompose a Logion change, route bounded work to GPT-5.6 Sol, GLM-5.2, Kimi K3, or DeepSeek V4 Flash, supervise Orca workers, manage manual ZCode handoffs, protect secrets, review diffs, run merge gates, or integrate multi-agent results.
---

# Logion Orca Coordinator

Coordinate external coding clients while keeping GPT-5.6 Sol responsible for architecture,
core implementation, acceptance, integration, commits, and pushes.

## Load the project contract

Read `references/coordination-contract.md` before delegating work. Read
`docs/development/ORCA_MULTI_CLIENT_SETUP.md` when configuring hosts, clients, providers,
SSH, or Orca itself.

## Enforce the boundaries

- Treat Git worktrees as source isolation, not as a security sandbox.
- Never put API keys, relay credentials, SSH private keys, production `.env` files, or database
  credentials in a task prompt, worktree, commit, terminal transcript, or Orca message.
- Keep production credentials unavailable to every external worker.
- Keep each task on one dedicated worktree and branch. Never let two workers write the same
  branch or overlapping files concurrently.
- Allow at most two external workers at once during the initial rollout. Run only one heavy
  client on the 8 GB Mac when memory pressure appears.
- Do not let workers merge, push, rewrite shared history, or alter migrations, contracts,
  authentication, deployment, or secrets unless the task packet explicitly authorizes the
  bounded change.
- Treat ZCode as a manual desktop client. It has no documented interactive CLI and cannot be
  started with `worker-start --agent zcode`.
- Use the exact model ID returned by the configured provider or relay. Never invent or silently
  substitute a model slug.

## Coordinate a change

### 1. Establish the baseline

1. Read applicable `AGENTS.md` files and the user's current specification.
2. Inspect `git status --short --branch`, the current commit, remotes, and existing worktrees.
3. Preserve all pre-existing changes. Stop if the requested paths overlap unexplained edits.
4. Select one immutable base commit that every task can reach. For cross-machine work, verify
   that the base branch or commit is available from the shared remote.
5. Record exact model evidence before the `task.assigned` or `task.retried` event that uses it.
   Evidence observed after dispatch cannot retroactively prove the selected model.
6. Check Orca without installing or reconfiguring it:

   ```text
   orca status --json
   orca skills get orchestration --full
   ```

7. If Orca is absent or orchestration is disabled, produce the same task packets and worktree
   plan, then report the missing prerequisite. Do not pretend workers were dispatched.
8. For work that can outlive one context window, inspect
   `.agents/coordination/current-run.json`. If it points to an active Run, validate that Run with
   `pnpm agent:state:validate -- <run-directory>` before continuing. If no Run exists, initialize
   one with `pnpm agent:state:init -- --run-id <stable-id> --objective <text>`.

The Windows Codex coordinator is the only writer of `.agents/coordination/runs/`. External
workers receive task packets and return handoffs; they never edit the ledger or graph. Store stable
requirements, decisions, task events, artifact references, observed checks, and Orca Run/Task IDs.
Do not store chat or terminal transcripts, terminal handles, dispatch capabilities, private host
data, provider endpoints, credentials, or user home paths. Read
`docs/development/AGENT_STATE_MODEL.md` when creating, recovering, or closing a persistent Run.

### 2. Decompose and route

Split work by independently testable ownership boundaries. Assign explicit allowed paths,
forbidden paths, acceptance commands, and a base commit. Use the role matrix in the reference:

- Keep architecture, sensitive backend changes, cross-module work, and final integration with
  Codex/GPT-5.6 Sol.
- Give ZCode/GLM-5.2 one bounded Windows worktree for manual modular implementation.
- Give Claude Code/Kimi K3 isolated frontend concepts or bounded frontend implementation on the
  Mac.
- Give OpenCode/DeepSeek V4 Flash read-only review by default.

Do not delegate tasks merely to use every model. Delegate only when ownership is independent and
the expected result justifies coordination overhead.

### 3. Create a complete task packet

Use the task-packet template in `references/coordination-contract.md`. Include all required
context in the packet; do not rely on a worker having this conversation. Require the worker to
report changed files, commands actually run, results, unresolved risks, and its final commit or
working-tree state.

### 4. Dispatch safely

For supported terminal workers, read the installed Orca orchestration skill before choosing
commands because orchestration is experimental. A typical supervised flow is:

```text
orca orchestration run-create --objective "<objective>" --json
orca orchestration task-create --spec "<task packet>" --task-title "<title>" --json
orca orchestration worker-start --task <task-id> --terminal <terminal-handle> --json
```

Prefer `--terminal <terminal-handle>` for Kimi and DeepSeek launchers so their provider, model,
and permission profiles are already active. Never add YOLO, auto-approve, permission-bypass, or
sandbox-bypass flags.

For ZCode:

1. Create or select its dedicated Windows worktree.
2. Ask the operator to open that exact directory with ZCode's `Open Workspace` action.
3. Record the task packet and base commit.
4. Treat completion as a manual Git handoff; do not claim Orca worker telemetry.

### 5. Supervise and resolve

Use Orca messages and decision gates for supported workers. A worker may ask questions, but it
may not expand its own scope. Record decisions that affect interfaces or multiple tasks. Stop or
reassign a worker that touches forbidden paths, requests secrets, loses its base commit, or
cannot prove its model/profile.

### 6. Review before integration

1. Inspect the complete diff and untracked files from the worker's worktree.
2. Verify that only allowed paths changed and that no credentials or generated local state were
   added.
3. Run the task-specific checks from the packet and the applicable merge gates in the reference.
4. For API contract changes, run `pnpm contracts:generate` and inspect the snapshot diff. Do not
   describe the contract as unchanged unless the generated output proves it.
5. Run broader gates from the integration worktree only after bounded checks pass.
6. Have the Codex coordinator create the accepted commit, merge or cherry-pick it, and push only
   when the user has authorized that Git action.

Reject or return partial work instead of repairing it silently when doing so would blur ownership
or exceed the task packet. Codex may implement a fix directly when it is core integration work and
the user already authorized implementation.

### 7. Close with evidence

Report:

- task-to-worker assignments;
- base and resulting commits;
- changed files;
- checks actually run and their observed outcomes;
- items not run and the exact reason;
- rejected or deferred worker output;
- remaining branches/worktrees and cleanup needed.

After independently verifying a handoff, append the corresponding task event, update the graph,
write a coordinator observation bound to the completion and exact handoff SHA-256, bind that
observation's SHA-256 in the append-only acceptance event, and run the state validator. Record a
Worker check that did not run only in `unrunChecks` with its reason. A coordinator observation may
use `not_run` with its reason. Never retroactively rewrite a prior event or promote a Worker claim
to an accepted result without coordinator evidence.

Never equate "test written" with "test passed," and never mark unavailable infrastructure as a
successful acceptance result.

## Stop conditions

Pause delegation and report the blocker when any of these is true:

- the shared baseline is not reachable from the target machine;
- the provider does not list the requested model;
- a required secret would need to enter the repository or worker prompt;
- dirty work overlaps the planned ownership boundary;
- the task changes production data, auth, migrations, contracts, or deployment without explicit
  scope;
- required Docker, PostgreSQL, Redis, browser, or device infrastructure is unavailable.
