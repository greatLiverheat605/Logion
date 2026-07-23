#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: restore-backup.sh BACKUP TARGET_DATABASE EMPTY_ATTACHMENTS_DIR" >&2
  exit 2
fi

backup="$1"
target_database="$2"
attachments_target="$3"
key_file="${LOGION_BACKUP_KEY_FILE:-/run/secrets/logion_backup_key}"

case "${target_database}" in
  ''|*[!A-Za-z0-9_]* ) echo "target database name is invalid" >&2; exit 2 ;;
esac
case "${attachments_target}" in
  /tmp/*|/restore/* ) ;;
  * ) echo "attachments rehearsal target must be under /tmp or /restore" >&2; exit 2 ;;
esac
if [ -e "${attachments_target}" ] && [ -n "$(find "${attachments_target}" -mindepth 1 -print -quit)" ]; then
  echo "attachments target must be empty" >&2
  exit 2
fi

workdir="$(mktemp -d /tmp/logion-restore.XXXXXX)"
trap 'rm -rf "${workdir}"' EXIT HUP INT TERM
(cd "$(dirname "${backup}")" && sha256sum -c "$(basename "${backup}.sha256")") >&2
python3 /usr/local/lib/logion/backup_crypto.py decrypt \
  "${backup}" "${workdir}/bundle.tar.gz" --key-file "${key_file}"
manifest="$(python3 /usr/local/lib/logion/backup_bundle.py extract \
  --source "${workdir}/bundle.tar.gz" --output "${workdir}/extracted")"
table_count="$(psql --dbname="${target_database}" -Atqc \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')")"
test "${table_count}" = "0"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="${target_database}" "${workdir}/extracted/database.dump"
psql --dbname="${target_database}" -v ON_ERROR_STOP=1 -c \
  "UPDATE workspace_sync_states SET sync_epoch = gen_random_uuid(), updated_at = now()" >/dev/null
mkdir -p "${attachments_target}"
if [ -d "${workdir}/extracted/attachments" ]; then
  cp -a "${workdir}/extracted/attachments/." "${attachments_target}/"
fi
workspace_count="$(psql --dbname="${target_database}" -Atqc 'SELECT count(*) FROM workspaces')"
attachment_count="$(find "${attachments_target}" -type f | wc -l | tr -d ' ')"
printf '{"status":"restored","target_database":"%s","workspace_count":%s,"attachment_count":%s,"manifest":%s}\n' \
  "${target_database}" "${workspace_count}" "${attachment_count}" "${manifest}"
