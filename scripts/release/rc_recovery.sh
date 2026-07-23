#!/bin/sh
set -eu

evidence_dir="${1:-reports/release}"
runner_temp="${RUNNER_TEMP:-/tmp}"
backup_container="logion-rc-backup-tools"
restore_database="logion_rc_restore"
fixture_user="00000000-0000-7000-8000-000000000101"
fixture_workspace="00000000-0000-7000-8000-000000000102"
fixture_membership="00000000-0000-7000-8000-000000000103"
fixture_epoch="00000000-0000-7000-8000-000000000104"
fixture_audit="00000000-0000-7000-8000-000000000105"
fixture_space="00000000-0000-7000-8000-000000000106"
fixture_note="00000000-0000-7000-8000-000000000107"
fixture_attachment="00000000-0000-7000-8000-000000000108"

: "${SOURCE_SHA:?SOURCE_SHA is required}"
: "${LOGION_BACKUP_IMAGE:?LOGION_BACKUP_IMAGE must be digest pinned}"
if ! printf '%s' "${LOGION_BACKUP_IMAGE}" | grep -Eq '@sha256:[0-9a-f]{64}$'; then
  echo "LOGION_BACKUP_IMAGE must use an exact sha256 digest" >&2
  exit 2
fi

mkdir -p "${evidence_dir}"
attachments="${runner_temp}/logion-rc-source-attachments"
attachment_relative="verified/${fixture_workspace}/${fixture_attachment}"
mkdir -p "${attachments}/verified/${fixture_workspace}"
printf '%s' 'logion-rc-attachment-marker-v1' >"${attachments}/${attachment_relative}"
fixture_attachment_sha="$(sha256sum "${attachments}/${attachment_relative}" | cut -d ' ' -f 1)"
fixture_attachment_size="$(wc -c <"${attachments}/${attachment_relative}" | tr -d ' ')"

docker compose exec -T postgres psql -U logion -d logion -v ON_ERROR_STOP=1 <<SQL
INSERT INTO users (id,email,email_normalized,status,version,created_at,updated_at)
VALUES ('${fixture_user}','rc-restore@example.invalid','rc-restore@example.invalid','active',1,now(),now());
INSERT INTO workspaces (id,name,status,version,created_by,created_at,updated_at)
VALUES ('${fixture_workspace}','RC recovery fixture','active',1,'${fixture_user}',now(),now());
INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status,version,joined_at,created_at,updated_at)
VALUES ('${fixture_membership}','${fixture_workspace}','${fixture_user}','owner','active',1,now(),now(),now());
INSERT INTO spaces (id,workspace_id,owner_user_id,name,visibility,status,version,created_by,updated_by,created_at,updated_at)
VALUES ('${fixture_space}','${fixture_workspace}','${fixture_user}','RC recovery private space','private','active',1,'${fixture_user}','${fixture_user}',now(),now());
INSERT INTO notes (id,workspace_id,space_id,task_id,title,markdown_body,yjs_state,version,created_by,updated_by,created_at,updated_at)
VALUES ('${fixture_note}','${fixture_workspace}','${fixture_space}',NULL,'RC recovery note','',decode('AAA=','base64'),1,'${fixture_user}','${fixture_user}',now(),now());
INSERT INTO attachments (id,workspace_id,space_id,target_type,target_id,filename,declared_mime,detected_mime,size_bytes,expected_sha256,verified_sha256,status,staging_key,storage_key,failure_code,version,created_by,created_at,updated_at,verified_at)
VALUES ('${fixture_attachment}','${fixture_workspace}','${fixture_space}','note','${fixture_note}','restore-marker.txt','text/plain','text/plain',${fixture_attachment_size},'${fixture_attachment_sha}','${fixture_attachment_sha}','verified','00000000000000000000000000000108','${fixture_workspace}/${fixture_attachment}',NULL,2,'${fixture_user}',now(),now(),now());
INSERT INTO workspace_sync_states (workspace_id,sync_epoch,last_sequence,min_retained_sequence,snapshot_schema_version,created_at,updated_at)
VALUES ('${fixture_workspace}','${fixture_epoch}',0,0,1,now(),now());
INSERT INTO audit_events (id,workspace_id,actor_id,request_id,event_type,target_type,target_id,result,metadata,occurred_at)
VALUES ('${fixture_audit}','${fixture_workspace}','${fixture_user}','rc-recovery-fixture','release.recovery_fixture','workspace','${fixture_workspace}','success','{"sensitive":false}',now());
SQL

source_version="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT version_num FROM alembic_version')"
source_epoch="$(docker compose exec -T postgres psql -U logion -d logion -Atc "SELECT sync_epoch FROM workspace_sync_states WHERE workspace_id='${fixture_workspace}'")"
source_users="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT count(*) FROM users')"
source_workspaces="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT count(*) FROM workspaces')"
source_memberships="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT count(*) FROM workspace_memberships')"
source_audits="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT count(*) FROM audit_events')"
source_attachments="$(docker compose exec -T postgres psql -U logion -d logion -Atc 'SELECT count(*) FROM attachments')"

docker compose run --name "${backup_container}" -d --entrypoint sh \
  -v "${attachments}:/attachments:ro" backup -c 'sleep 900' >/dev/null
if ! docker exec "${backup_container}" test -r /run/secrets/logion_backup_key; then
  echo "backup key is unreadable by the candidate backup image" >&2
  exit 1
fi
docker exec -e LOGION_BACKUP_ONCE=true "${backup_container}" logion-backup
latest="$(docker exec "${backup_container}" sh -c 'find /backups -type f -name "logion-*.backup" | sort | tail -n 1')"
test -n "${latest}"
docker exec "${backup_container}" logion-verify-backup "${latest}"
backup_sha256="$(docker exec "${backup_container}" sha256sum "${latest}" | cut -d ' ' -f 1)"

docker compose exec -T postgres createdb -U logion "${restore_database}"
restore_started_ms="$(date +%s%3N)"
restore_json="$(docker exec "${backup_container}" logion-restore-backup \
  "${latest}" "${restore_database}" /tmp/logion-rc-restore-attachments)"
restore_finished_ms="$(date +%s%3N)"

restored_version="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT version_num FROM alembic_version')"
restored_epoch="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc "SELECT sync_epoch FROM workspace_sync_states WHERE workspace_id='${fixture_workspace}'")"
restored_users="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT count(*) FROM users')"
restored_workspaces="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT count(*) FROM workspaces')"
restored_memberships="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT count(*) FROM workspace_memberships')"
restored_audits="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT count(*) FROM audit_events')"
restored_attachments="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc 'SELECT count(*) FROM attachments')"
source_attachment_sha="$(sha256sum "${attachments}/${attachment_relative}" | cut -d ' ' -f 1)"
restored_attachment_sha="$(docker exec "${backup_container}" sha256sum "/tmp/logion-rc-restore-attachments/${attachment_relative}" | cut -d ' ' -f 1)"
restored_attachment_row_sha="$(docker compose exec -T postgres psql -U logion -d "${restore_database}" -Atc "SELECT verified_sha256 FROM attachments WHERE id='${fixture_attachment}'")"

test "${source_version}" = "${restored_version}"
test "${source_epoch}" != "${restored_epoch}"
test "${source_users}" = "${restored_users}"
test "${source_workspaces}" = "${restored_workspaces}"
test "${source_memberships}" = "${restored_memberships}"
test "${source_audits}" = "${restored_audits}"
test "${source_attachments}" = "${restored_attachments}"
test "${source_attachment_sha}" = "${restored_attachment_sha}"
test "${restored_attachment_sha}" = "${restored_attachment_row_sha}"

manifest_created_at="$(printf '%s' "${restore_json}" | jq -r '.manifest.created_at')"
manifest_key_id="$(printf '%s' "${restore_json}" | jq -r '.manifest.backup_key_id')"
manifest_epoch_policy="$(printf '%s' "${restore_json}" | jq -r '.manifest.restore_requires_sync_epoch_bump')"
test "${manifest_epoch_policy}" = "true"
backup_created_epoch="$(date -u -d "${manifest_created_at}" +%s)"
restore_finished_epoch="$((restore_finished_ms / 1000))"
rpo_seconds="$((restore_finished_epoch - backup_created_epoch))"
rto_ms="$((restore_finished_ms - restore_started_ms))"

jq -n \
  --arg schema_version "logion-rc-recovery-v1" \
  --arg repository "${GITHUB_REPOSITORY:-local}" \
  --arg source_sha "${SOURCE_SHA}" \
  --arg backup_image "${LOGION_BACKUP_IMAGE}" \
  --arg migration_head "${source_version}" \
  --arg source_epoch "${source_epoch}" \
  --arg restored_epoch "${restored_epoch}" \
  --arg backup_created_at "${manifest_created_at}" \
  --arg backup_key_id "${manifest_key_id}" \
  --arg backup_sha256 "${backup_sha256}" \
  --argjson rpo_seconds "${rpo_seconds}" \
  --argjson rto_ms "${rto_ms}" \
  --argjson users "${restored_users}" \
  --argjson workspaces "${restored_workspaces}" \
  --argjson memberships "${restored_memberships}" \
  --argjson audit_events "${restored_audits}" \
  --argjson attachments "${restored_attachments}" \
  --arg attachment_sha256 "${restored_attachment_sha}" \
  '{
    schema_version: $schema_version,
    repository: $repository,
    source_sha: $source_sha,
    backup_image: $backup_image,
    passed: true,
    migration: {source: $migration_head, restored: $migration_head, matched: true},
    sync_epoch: {source: $source_epoch, restored: $restored_epoch, changed: true, old_client_action: "rebootstrap_required", old_outbox_action: "quarantine"},
    recovery: {backup_created_at: $backup_created_at, backup_key_id: $backup_key_id, backup_sha256: $backup_sha256, rpo_seconds: $rpo_seconds, rto_ms: $rto_ms},
    restored_counts: {users: $users, workspaces: $workspaces, memberships: $memberships, audit_events: $audit_events, attachments: $attachments},
    attachment_sha256: $attachment_sha256,
    manual_signoff_required: ["production promotion", "physical Safari/iOS PWA", "screen reader critical flows", "off-host disaster recovery"]
  }' >"${evidence_dir}/recovery-evidence.json"

jq -e '.passed == true and .sync_epoch.changed == true and .migration.matched == true' \
  "${evidence_dir}/recovery-evidence.json" >/dev/null
