# Candidate security gate runbook

## Reproduce the license gate

After frozen dependency installation:

```sh
mkdir -p reports/security
pnpm licenses list --json --prod > reports/security/pnpm-licenses.json
uv run --isolated --no-dev --all-packages python scripts/security/license_policy.py \
  --policy config/security/license-policy.json \
  --pnpm-json reports/security/pnpm-licenses.json \
  --output reports/security/license-policy.json
rm reports/security/pnpm-licenses.json
```

Review the normalized report, especially `denied`, rather than preserving package-manager paths.

## Reproduce candidate scans

Authenticate `gh`, Trivy and the container registry without printing tokens. Supply the four exact references from a verified candidate manifest:

```sh
python scripts/security/candidate_security.py \
  --repository OWNER/REPOSITORY \
  --reports-dir reports/security \
  --verify-attestations \
  --image web=REGISTRY/WEB@sha256:DIGEST \
  --image api=REGISTRY/API@sha256:DIGEST \
  --image worker=REGISTRY/WORKER@sha256:DIGEST \
  --image backup=REGISTRY/BACKUP@sha256:DIGEST
```

The command attempts all provenance, image, filesystem and IaC checks, then exits non-zero if any failed. Do not rerun against tags or edit the generated summary.

## Triage

1. Confirm the source SHA, manifest and digest before reading findings.
2. For a vulnerability, identify the affected layer/package, exploitability and fixed version. Rebuild from a new commit; never replace the old digest.
3. For a secret, revoke it first, remove it from the full Git history and rebuild. Treat detector output as sensitive.
4. For IaC, fix the repository declaration and verify the effective deployment separately.
5. For a license denial, verify upstream metadata and obligations. Policy changes require human review.
6. Preserve the failed artifact and link remediation to its Main run. A rerun without a source change may confirm transient infrastructure failure but cannot change vulnerable bytes.
