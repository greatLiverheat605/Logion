# Candidate security and dependency policy

## Blocking policy

The candidate identity is the full source commit plus four `repository@sha256:digest` references. Main verifies each GitHub attestation against this repository before scanning. Mutable tags, incomplete service sets and digest mismatches are rejected before tools run.

Runtime images use explicit supported patch/distribution tags. Python services use Alpine 3.24 instead of the previous Debian runtime after the first image gate exposed unresolved base OS findings. The Web runtime removes npm/npx because the standalone Next server does not use package-management tooling at runtime. Backup follows the current PostgreSQL 17 minor Alpine image and removes the inherited `gosu` binary because its overridden entrypoint already runs as `postgres` and never performs user switching. Frozen application lockfiles remain unchanged by base-image remediation.

Release-blocking checks are:

- HIGH or CRITICAL OS/library vulnerabilities in any candidate image;
- secrets detected in an image or repository filesystem;
- HIGH or CRITICAL IaC/Dockerfile configuration findings;
- missing or invalid GitHub/Sigstore provenance;
- UNKNOWN or unapproved production dependency licenses;
- failed source dependency/secret scans already enforced in PR.

The wrapper completes every independent check and writes `candidate-security-summary.json` even when one check fails. SARIF is uploaded to GitHub code scanning and the complete security artifact is retained for 90 days. Reports contain package names, versions, licenses, digests and findings; they must not contain environment dumps, credentials, cookies or user content.

## License decisions

`config/security/license-policy.json` is the reviewable allowlist. Internal Logion packages are recorded as `INTERNAL` until the project owner selects and publishes the repository license. Missing Python license expressions may be mapped only from an installed package's OSI classifier. Unknown metadata fails closed.

Permissive licenses, MPL-2.0, CC-BY-4.0 and the current Sharp binary expression are approved for the present dependency graph. This is an engineering compatibility gate, not legal advice. Attribution, NOTICE, LGPL replacement/relinking requirements and source-offer obligations remain release checklist items.

## Exceptions and response

There is no silent ignore file in L6-002. A blocked candidate remains retained and is marked rejected. Remediation order is dependency/base-image update, removal or configuration fix. If no fix exists, a human security owner must create a separately reviewed, time-limited exception with affected digest/CVE or rule, exposure analysis, compensating control, owner and expiry before the policy gains exception support. Production approval cannot be inferred from an exception.
