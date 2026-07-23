# Production rollout and abort runbook

This runbook does not approve or execute Production. The cloud provider, region, traffic adapter, alert recipients and off-host backup target remain operator decisions. Never substitute RC synthetic rehearsal evidence for live Production observability.

## Preconditions

1. Human release owner selects a successful RC artifact and verifies source SHA, candidate manifest, four digests, security, recovery, browser/WCAG and privacy evidence.
2. Production environment approval is separate from staging and has no automatic approver. Credentials exist only in that protected environment.
3. Confirm current application/schema compatibility, forward-fix owner, abort authority, incident channel and maintenance window.
4. Generate and verify a pre-deploy encrypted off-host backup. Record artifact checksum, key generation and restore rehearsal age.
5. The selected observability adapter emits `logion-rollout-samples-v1` with `sample_source=live_observability` and no content/PII fields.

## Staged traffic

At each stage, the operator changes traffic using the reviewed cloud adapter, then observes without another deployment:

1. 5% for at least 15 minutes, 3 aggregate windows and 500 requests.
2. 25% for at least 30 minutes, 3 aggregate windows and 2,000 requests. The gate requires the same-candidate 5% promotion evidence.
3. 100% for at least 60 minutes, 3 aggregate windows and 5,000 requests. The gate requires the same-candidate 25% promotion evidence.

Run `scripts/release/rollout_gate.py` in `production` mode. `promote` only authorizes the human to consider the next traffic change; the script never deploys, changes traffic or grants approval. `hold` means collect more valid live evidence. `abort` means stop expansion immediately.

## Abort and recovery

- Freeze expansion and route traffic away from the candidate through the reviewed provider adapter.
- Preserve metrics, deployment events, candidate identity and audit timeline without user content.
- Do not automatically roll back the database. If the prior binary cannot read the migrated schema, keep the compatible candidate disabled and apply a reviewed forward fix.
- If data integrity, tenant isolation or secret exposure is suspected, declare P0, revoke affected credentials/sessions, stop writers as required and follow the restore/security incident procedure.
- A retry uses a new candidate identity and new evidence chain. Failed immutable images and evidence remain retained.

Production completion requires the human release owner to sign the 100% live evidence, confirm alerts and backup replication, and record any residual risks. Phase approval alone is not Production approval.
