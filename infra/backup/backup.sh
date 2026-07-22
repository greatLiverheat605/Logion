#!/bin/sh
set -eu

retention_days="${LOGION_BACKUP_RETENTION_DAYS:-14}"
key_file="${LOGION_BACKUP_KEY_FILE:-/run/secrets/logion_backup_key}"
key_id="${LOGION_BACKUP_KEY_ID:-default-v1}"

test -r "${key_file}"
case "${key_id}" in
  ''|*[!A-Za-z0-9._-]* ) echo "backup key ID is invalid" >&2; exit 2 ;;
esac

create_backup() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  workdir="$(mktemp -d /tmp/logion-backup.XXXXXX)"
  encrypted_tmp="/backups/.logion-${timestamp}-${key_id}.backup.tmp"
  final="/backups/logion-${timestamp}-${key_id}.backup"
  trap 'rm -rf "${workdir}" "${encrypted_tmp}"' EXIT HUP INT TERM

  pg_dump --format=custom --file="${workdir}/database.dump"
  pg_restore --list "${workdir}/database.dump" >/dev/null
  migration_head="$(psql -Atqc 'SELECT version_num FROM alembic_version')"
  test -n "${migration_head}"
  python3 /usr/local/lib/logion/backup_bundle.py create \
    --database "${workdir}/database.dump" \
    --attachments /attachments \
    --output "${workdir}/bundle.tar.gz" \
    --created-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --application-version "${LOGION_VERSION:-unknown}" \
    --migration-head "${migration_head}" \
    --backup-key-id "${key_id}"
  python3 /usr/local/lib/logion/backup_crypto.py encrypt \
    "${workdir}/bundle.tar.gz" "${encrypted_tmp}" --key-file "${key_file}"
  mv "${encrypted_tmp}" "${final}"
  (cd /backups && sha256sum "$(basename "${final}")" >"$(basename "${final}").sha256")
  find /backups -type f \( -name 'logion-*.backup' -o -name 'logion-*.backup.sha256' \) \
    -mtime "+${retention_days}" -delete
  rm -rf "${workdir}"
  trap - EXIT HUP INT TERM
}

while true; do
  create_backup
  if [ "${LOGION_BACKUP_ONCE:-false}" = "true" ]; then
    exit 0
  fi
  sleep 86400
done
