# Backup and restore runbook

## Scope

Phase 0 automatically creates a PostgreSQL custom-format dump, verifies that `pg_restore` can list it, and writes a SHA-256 sidecar. This is only the local reference path. Production also needs encrypted off-host copies of PostgreSQL, attachments and the version/encryption metadata required to restore them.

## Safe verification

1. Select a specific immutable dump; never select a path assembled from user input.
2. Run `logion-verify-backup /backups/<name>.dump` inside the Backup image.
3. Record dump timestamp, checksum, application version, database migration head and sync epoch.

## Empty-environment restore rehearsal

1. Create isolated PostgreSQL, attachment and backup volumes; verify their resolved paths are not production paths.
2. Stop all application writers.
3. Verify the dump checksum and structure.
4. Restore with `pg_restore --exit-on-error --no-owner --no-privileges` into the empty rehearsal database.
5. Apply only migrations compatible with the recorded application version.
6. Verify tenant/Space relations, counts, attachments, audit sequence and export samples.
7. Increase `sync_epoch` before admitting old devices.
8. Run API/Web smoke and the cross-tenant negative suite.
9. Destroy only the explicitly named rehearsal environment after preserving the signed report.

Production restoration requires human approval and a change record. Binary rollback is forbidden if it cannot read the restored schema; use a compatible application or forward fix.
