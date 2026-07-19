#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: verify-backup.sh /backups/logion-TIMESTAMP.dump" >&2
  exit 2
fi

backup="$1"
checksum="${backup}.sha256"

test -f "${backup}"
test -f "${checksum}"
sha256sum -c "${checksum}"
pg_restore --list "${backup}" >/dev/null
echo "backup structure and checksum verified: ${backup}"
