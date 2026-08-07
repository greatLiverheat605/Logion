from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from logion_worker.local_worker_security import LocalWorkerSecurity, WorkerSecurityError

NOW = datetime(2026, 8, 7, 12, 0, tzinfo=UTC)


def ids() -> tuple[object, object, object, object]:
    return uuid4(), uuid4(), uuid4(), uuid4()


def test_lease_binds_job_scope_input_and_expiry(tmp_path) -> None:
    clock = [NOW]
    security = LocalWorkerSecurity(tmp_path, lease_seconds=30, clock=lambda: clock[0])
    job_id, workspace_id, space_id, other_space_id = ids()
    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )

    assert (
        security.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
        )
        == claims
    )
    for kwargs in (
        {"space_id": other_space_id},
        {"input_sha256": "b" * 64},
        {"token": "wrong"},
    ):
        with pytest.raises(WorkerSecurityError):
            security.validate_lease(
                lease_id=claims.lease_id,
                token=kwargs.get("token", token),
                job_id=job_id,
                workspace_id=workspace_id,
                space_id=kwargs.get("space_id", space_id),
                input_sha256=kwargs.get("input_sha256", "a" * 64),
            )

    clock[0] = NOW + timedelta(seconds=30)
    with pytest.raises(WorkerSecurityError, match="expired"):
        security.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
        )


def test_revocation_and_duplicate_completion_fail_closed(tmp_path) -> None:
    security = LocalWorkerSecurity(tmp_path)
    job_id, workspace_id, space_id, _ = ids()
    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    security.revoke(claims.lease_id)
    with pytest.raises(WorkerSecurityError, match="not active"):
        security.write_checkpoint(claims, token=token, stage="running")

    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    security.write_checkpoint(claims, token=token, stage="uploaded", output_sha256="b" * 64)
    with pytest.raises(WorkerSecurityError, match="not active"):
        security.write_checkpoint(claims, token=token, stage="uploaded", output_sha256="b" * 64)


def test_checkpoint_tampering_and_partial_residue_are_rejected_or_cleaned(tmp_path) -> None:
    security = LocalWorkerSecurity(tmp_path)
    job_id, workspace_id, space_id, _ = ids()
    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    security.write_checkpoint(claims, token=token, stage="running")
    checkpoint_path = tmp_path / str(job_id) / "checkpoint.json"
    checkpoint_path.write_text(
        checkpoint_path.read_text(encoding="utf-8").replace(str(space_id), str(uuid4())),
        encoding="utf-8",
    )
    with pytest.raises(WorkerSecurityError, match="scope"):
        security.load_checkpoint(claims, token=token)

    residue = tmp_path / str(uuid4())
    residue.mkdir()
    (residue / "checkpoint.json.part").write_text("partial", encoding="utf-8")
    (residue / "checkpoint.json").write_text("complete", encoding="utf-8")
    assert security.cleanup_residue() == 1
    assert (residue / "checkpoint.json").exists()
    assert not (residue / "checkpoint.json.part").exists()


def test_checkpoint_stages_are_monotonic_and_terminal_cleanup_is_bounded(tmp_path) -> None:
    security = LocalWorkerSecurity(tmp_path)
    job_id, workspace_id, space_id, _ = ids()
    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    security.write_checkpoint(claims, token=token, stage="running")
    with pytest.raises(WorkerSecurityError, match="backwards"):
        security.write_checkpoint(claims, token=token, stage="claimed")
    with pytest.raises(WorkerSecurityError, match="output hash"):
        security.write_checkpoint(claims, token=token, stage="uploaded")
    security.write_checkpoint(claims, token=token, stage="uploaded", output_sha256="b" * 64)
    assert security.cleanup_job(job_id) == 1
    assert not (tmp_path / str(job_id)).exists()


def test_new_security_instance_rejects_old_checkpoint_after_restart(tmp_path) -> None:
    security = LocalWorkerSecurity(tmp_path)
    job_id, workspace_id, space_id, _ = ids()
    claims, token = security.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    security.write_checkpoint(claims, token=token, stage="running")
    restarted = LocalWorkerSecurity(tmp_path)
    with pytest.raises(WorkerSecurityError, match="not active"):
        restarted.load_checkpoint(claims, token=token)
    assert restarted.cleanup_residue() == 0


def test_invalid_hash_and_naive_clock_are_rejected(tmp_path) -> None:
    security = LocalWorkerSecurity(tmp_path)
    job_id, workspace_id, space_id, _ = ids()
    with pytest.raises(WorkerSecurityError):
        security.issue_lease(
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="not-a-hash",
        )
    with pytest.raises(WorkerSecurityError):
        security.issue_lease(
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
            now=datetime(2026, 8, 7, 12, 0),
        )
