from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def service_block(compose: str, service: str, next_service: str) -> str:
    start = compose.index(f"  {service}:\n")
    end = compose.index(f"  {next_service}:\n", start)
    return compose[start:end]


def test_attachment_volume_is_initialized_with_bounded_privilege() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    init = service_block(compose, "attachment-init", "api")

    assert 'user: "0:10001"' in init
    assert "network_mode: none" in init
    assert "read_only: true" in init
    assert "cap_drop: [ALL]" in init
    assert "cap_add: [CHOWN]" in init
    assert "security_opt: [no-new-privileges:true]" in init
    assert "chown 0:10001 /attachments /attachments/staging /attachments/verified" in init
    assert "chmod 0700 /attachments/staging" in init
    assert "chmod 0750 /attachments /attachments/verified" in init
    assert "chown 10001:10001 /attachments /attachments/staging /attachments/verified" in init
    assert "chmod 0777" not in init


def test_attachment_consumers_retain_least_privilege_mounts() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    api = service_block(compose, "api", "worker")
    worker = service_block(compose, "worker", "web")
    backup_start = compose.index("  backup:\n")
    backup = compose[backup_start : compose.index("\nnetworks:\n", backup_start)]

    for service in (api, worker):
        assert "LOGION_ATTACHMENT_ROOT: /attachments" in service
        assert "attachments_data:/attachments" in service
        assert "attachment-init:" in service
        assert "condition: service_completed_successfully" in service
        assert "read_only: true" in service
        assert 'user: "0:10001"' not in service

    assert "attachments_data:/attachments:ro" in backup
    assert 'group_add: ["10001"]' in backup
    assert "attachment-init:" in backup
