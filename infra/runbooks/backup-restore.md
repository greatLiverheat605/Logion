# Backup and restore runbook

## Scope and artifact

The Backup service creates `logion-TIMESTAMP-KEYID.backup`, an AES-256-GCM encrypted bundle containing:

- a PostgreSQL custom-format dump;
- the server attachment tree;
- a versioned manifest with application version, Alembic head, backup key ID, timestamp and mandatory `sync_epoch` bump semantics.

The adjacent `.sha256` covers the encrypted bytes. AES-GCM authenticates the decrypted bundle. The backup key is a base64url-encoded 32-byte random value mounted at `/run/secrets/logion_backup_key`; it is never stored in the image, database, manifest, environment or log. `LOGION_BACKUP_KEY_ID` is non-secret and identifies the separately escrowed key generation.

The Compose volume is a server-side recovery copy, not final disaster recovery. Production must copy immutable encrypted artifacts and sidecars to a separate account/region under retention lock. TOTP, email, AI, export and backup keyrings require separate escrow; losing all generations makes encrypted records or backups unrecoverable.

## Provisioning

1. Generate a key outside the repository: `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.
2. Store it in the secret manager or an owner-readable file such as `./secrets/backup.key`; never commit it.
3. Set `LOGION_BACKUP_SECRET_SOURCE` to the host file and `LOGION_BACKUP_KEY_ID` to a stable generation label.
4. Start the Backup service. It writes through a temporary ciphertext file, then atomically renames and writes the checksum.
5. Confirm off-host replication and retention monitoring. Local `LOGION_BACKUP_RETENTION_DAYS` defaults to 14.

## Safe verification

Select an exact operator-controlled path, then run:

```sh
docker compose exec -T backup logion-verify-backup /backups/logion-TIMESTAMP-KEYID.backup
```

Verification checks the ciphertext SHA-256, GCM authentication, archive path/type allowlist, manifest schema and `pg_restore --list`. It never extracts to an operator-supplied production path.

## Empty-environment rehearsal

1. Create an isolated empty PostgreSQL database and an empty attachment directory under `/tmp` or `/restore` inside the Backup container.
2. Stop or isolate all writers to the rehearsal target.
3. Run:

```sh
docker compose exec -T postgres createdb -U logion logion_restore
docker compose exec -T backup logion-restore-backup \
  /backups/logion-TIMESTAMP-KEYID.backup \
  logion_restore \
  /tmp/logion-restore-attachments
```

The helper refuses a non-empty database, validates archive members, restores with `--no-owner --no-privileges`, restores attachments only into an empty safe rehearsal path, and changes every `workspace_sync_states.sync_epoch`. Old devices must therefore re-bootstrap and isolate old Outbox entries.

4. Compare manifest/Alembic version, tenant/member/Space counts, attachment hashes, audit sequence and representative authenticated exports.
5. Run API/Web smoke and cross-tenant negative tests against the rehearsal environment.
6. Preserve the JSON restore report with RPO/RTO, artifact checksum, key ID, counts and reviewer sign-off.
7. Destroy only the explicitly named rehearsal database/path after resolving and verifying their targets.

## Production restore

Production restoration requires human approval, a change record and a pre-restore copy of current state. The supplied helper intentionally accepts attachment targets only under `/tmp` or `/restore`; an operator must verify the rehearsal, stop writers, and use a separately reviewed promotion step for the production attachment volume. Binary rollback is forbidden if it cannot read the restored schema; use a compatible application or a database forward fix.

Key rotation does not rewrite old artifacts. Retain each old key through the longest artifact retention period, test it against a sampled backup, then destroy it according to the approved cryptographic erasure procedure.

The release-candidate workflow automates an isolated subset through `scripts/release/rc_recovery.sh`. Its JSON evidence is tied to the candidate source SHA and digest-pinned backup image. It does not promote restored data, approve production, prove off-host disaster recovery, or replace the quarterly operator rehearsal.
