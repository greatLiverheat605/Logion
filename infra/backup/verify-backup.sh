#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: verify-backup.sh /backups/logion-TIMESTAMP.backup" >&2
  exit 2
fi

backup="$1"
checksum="${backup}.sha256"
key_file="${LOGION_BACKUP_KEY_FILE:-/run/secrets/logion_backup_key}"
workdir="$(mktemp -d /tmp/logion-verify.XXXXXX)"
trap 'rm -rf "${workdir}"' EXIT HUP INT TERM

test -f "${backup}"
test -f "${checksum}"
test -r "${key_file}"
(cd "$(dirname "${backup}")" && sha256sum -c "$(basename "${checksum}")")
python3 /usr/local/lib/logion/backup_crypto.py decrypt \
  "${backup}" "${workdir}/bundle.tar.gz" --key-file "${key_file}"
python3 /usr/local/lib/logion/backup_bundle.py extract \
  --source "${workdir}/bundle.tar.gz" --output "${workdir}/extracted"
pg_restore --list "${workdir}/extracted/database.dump" >/dev/null
echo "encrypted backup structure and checksum verified: ${backup}"
