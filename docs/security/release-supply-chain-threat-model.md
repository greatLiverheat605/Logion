# Release candidate supply-chain threat model

## Assets and trust boundaries

Protected assets are source provenance, four application images, compatibility metadata, release evidence and environment approval. Pull requests are untrusted build input. `main`, GitHub Actions OIDC, GHCR, the staging environment and the human release owner are separate trust boundaries. Production credentials are outside Main and RC candidate construction.

## Threats and controls

| Threat                                      | Preventive control                                                                                                              | Evidence                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A PR publishes a privileged image           | Package/OIDC/attestation write permissions exist only in the Main workflow                                                      | Workflow permission review              |
| Mutable tag is replaced after testing       | Candidate and Compose use `repository@sha256:digest`; manifest validation rejects tags and digest mismatches                    | Candidate manifest negative tests       |
| RC rebuilds different bytes                 | RC uses `pull` plus `up --no-build` and accepts only a successful Main run                                                      | Release workflow and run API validation |
| An unrelated run ID supplies an artifact    | Run must match source SHA, `main`, successful conclusion and `.github/workflows/main.yml`                                       | RC preflight log                        |
| Source or compatibility metadata is altered | Verifier recalculates lock/OpenAPI hashes, migration head, sync protocol, offline schema and app version at the checked-out SHA | Manifest verification                   |
| Registry artifact lacks provenance          | BuildKit provenance/SBOM plus GitHub OIDC provenance attestation are pushed for every application image                         | GHCR attestations                       |
| Secret enters evidence                      | Generator accepts only bounded identifiers/digests and derives hashes locally; no environment dump is captured                  | Manifest schema review                  |
| Compromised dependency/action changes build | Lockfiles are frozen and hashed; actions are Dependabot-managed; license and HIGH/CRITICAL gates block the candidate            | Lock hashes, dependency PRs, scan JSON  |
| Browser evidence silently omits Safari/PWA  | RC runs Chromium, Firefox, WebKit and mobile emulation; artifact and runbook explicitly retain physical-device/manual sign-off  | Playwright JSON/HTML and RC checklist   |
| HTTP assurance is broken by HTTPS-only CSP  | `upgrade-insecure-requests` is emitted only for an actual HTTPS request; all other CSP directives remain fail closed            | WebKit HTTP browser regression gate     |

## Residual risk and next controls

L6-001 establishes identity and promotion invariants. L6-002 scans every digest, repository filesystem and IaC, verifies attestations and applies the production dependency license policy. L6-003 adds isolated recovery and browser compatibility evidence. Registry retention, package access, physical Safari/iOS, screen-reader and off-host disaster recovery still require operator evidence. A successful Main or RC run is not approval to produce a release.
