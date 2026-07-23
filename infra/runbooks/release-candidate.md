# Immutable candidate and RC runbook

## Main candidate

1. Merge reviewed code to `main`. Main runs Fast checks and Compose validation.
2. Main pushes four SHA-tagged GHCR images with SBOM and provenance, generates `candidate-manifest.json`, then starts those exact digest references with `--no-build` and migrates the empty temporary database to the recorded Alembic head.
3. The bounded authenticated workspace-list gate must complete 200 requests at concurrency 10 with p95 strictly below 500 ms.
4. Record the successful Main run ID, full source SHA, manifest artifact, four digests and performance evidence. A failed or cancelled run is not a candidate.

The bounded gate catches candidate regressions but does not satisfy the full capacity release gate. RC evidence must additionally record the approved profile for 100,000 tasks, 1,000,000 events, 50,000 notes/resources, 10,000 attachments, 5,000 papers and 100,000 AI runs, including dataset generator version, hardware, concurrency, warm-up, sample count, p50/p95/p99, errors, query plans and saturation signals.

## RC promotion

1. Select **Run workflow** for Release candidate and enter a display version, the full Main source SHA and its numeric run ID.
2. Approve only the staging environment. Do not approve production as part of this procedure.
3. Confirm preflight validates the run's workflow, branch, conclusion and source SHA.
4. Confirm manifest verification passes before registry login or Compose startup.
5. Confirm logs show `docker compose pull` and `up --no-build`; any build step invalidates the RC.
6. Preserve the candidate manifest, Compose status and later L6-002/L6-003 evidence under the same candidate identity.
7. Confirm `recovery-evidence.json` records matching migration heads and object counts, an attachment hash match, a changed `sync_epoch`, RPO/RTO and the digest-pinned backup image.
8. Confirm offline compatibility tests require `upgrade_required` or `rebootstrap_required` and quarantine the old Outbox instead of replaying it.
9. Confirm Chromium, Firefox, WebKit, mobile Chrome and mobile Safari emulation pass the public/auth browser gate. Automation is not physical Safari, iOS or screen-reader proof; collect those human sign-offs separately.
10. Confirm the 5/25/100 rollout policy rehearsal completes with `mode=rehearsal`, `sample_source=synthetic_policy_rehearsal`, the candidate source SHA, and `changes_traffic=false`. This proves the policy engine only; it is never valid Production telemetry or traffic approval.

## Failure and revocation

Do not delete immutable images when a candidate fails. Mark the candidate rejected, retain the evidence and fix through a new source commit and Main candidate. If a digest or provenance cannot be verified, stop promotion. Database rollback is never inferred from an image rollback: apply the documented compatibility matrix and prefer a forward fix when an older binary cannot read the migrated schema.
