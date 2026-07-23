FROM postgres:17.10-alpine

COPY backup.sh /usr/local/bin/logion-backup
COPY verify-backup.sh /usr/local/bin/logion-verify-backup
COPY restore-backup.sh /usr/local/bin/logion-restore-backup
COPY backup_crypto.py backup_bundle.py /usr/local/lib/logion/
RUN apk add --no-cache python3 py3-cryptography \
    && rm -f /usr/local/bin/gosu \
    && chmod 0555 /usr/local/bin/logion-backup /usr/local/bin/logion-verify-backup \
      /usr/local/bin/logion-restore-backup /usr/local/lib/logion/*.py \
    && mkdir -p /backups \
    && chown postgres:postgres /backups

USER postgres
ENTRYPOINT ["/usr/local/bin/logion-backup"]
