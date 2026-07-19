#!/bin/sh
set -eu

retention_days="${LOGION_BACKUP_RETENTION_DAYS:-14}"

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  temporary="/backups/.logion-${timestamp}.dump.tmp"
  final="/backups/logion-${timestamp}.dump"

  pg_dump --format=custom --file="${temporary}"
  pg_restore --list "${temporary}" >/dev/null
  mv "${temporary}" "${final}"
  sha256sum "${final}" >"${final}.sha256"
  find /backups -type f -mtime "+${retention_days}" -delete
  sleep 86400
done
