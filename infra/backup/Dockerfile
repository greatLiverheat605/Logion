FROM postgres:17.7-alpine

COPY backup.sh /usr/local/bin/logion-backup
COPY verify-backup.sh /usr/local/bin/logion-verify-backup
RUN chmod 0555 /usr/local/bin/logion-backup /usr/local/bin/logion-verify-backup \
    && mkdir -p /backups \
    && chown postgres:postgres /backups

USER postgres
ENTRYPOINT ["/usr/local/bin/logion-backup"]
