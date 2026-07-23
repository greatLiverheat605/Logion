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
| Compromised dependency/action changes build | Lockfiles are frozen and hashed; actions are Dependabot-managed. SHA pinning and policy enforcement remain L6-002 work          | Lock hashes and dependency PRs          |

## Residual risk and next controls

L6-001 establishes identity and promotion invariants; it does not claim that images are vulnerability-free. L6-002 must scan every digest and IaC, review action pinning, set severity/exception policy and verify attestations before RC. Registry retention and package access policies require operator configuration. A successful Main candidate is not approval to stage or produce a release.
