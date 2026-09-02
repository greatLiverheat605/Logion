from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from logion_api.knowledge_space.local_worker_protocol import (
    LocalWorkerProtocol,
    LocalWorkerProtocolError,
)

NOW = datetime(2026, 8, 7, 13, 0, tzinfo=UTC)


def ids() -> tuple[object, object, object]:
    return uuid4(), uuid4(), uuid4()


def issue(protocol: LocalWorkerProtocol) -> tuple[object, object, object, object, str]:
    job_id, workspace_id, space_id = ids()
    claims, token = protocol.issue_lease(
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
        now=NOW,
    )
    return job_id, workspace_id, space_id, claims, token


def test_scope_binding_and_expiry_fail_closed() -> None:
    clock = [NOW]
    protocol = LocalWorkerProtocol(clock=lambda: clock[0], lease_seconds=30)
    job_id, workspace_id, space_id, claims, token = issue(protocol)
    protocol.validate_lease(
        lease_id=claims.lease_id,
        token=token,
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
        now=NOW,
    )
    with pytest.raises(LocalWorkerProtocolError, match="scope"):
        protocol.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=uuid4(),
            input_sha256="a" * 64,
            now=NOW,
        )
    clock[0] = NOW + timedelta(seconds=30)
    with pytest.raises(LocalWorkerProtocolError, match="expired"):
        protocol.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
        )


def test_revocation_is_idempotent_and_rejects_checkpoint() -> None:
    protocol = LocalWorkerProtocol(clock=lambda: NOW)
    job_id, workspace_id, space_id, claims, token = issue(protocol)
    assert protocol.revoke(claims.lease_id).state == "revoked"
    assert protocol.revoke(claims.lease_id).state == "revoked"
    with pytest.raises(LocalWorkerProtocolError, match="not active"):
        protocol.checkpoint(
            lease_id=claims.lease_id,
            token=token,
            stage="running",
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
        )


def test_result_requires_uploaded_checkpoint_and_is_idempotent() -> None:
    protocol = LocalWorkerProtocol(clock=lambda: NOW)
    job_id, workspace_id, space_id, claims, token = issue(protocol)
    with pytest.raises(LocalWorkerProtocolError, match="uploaded checkpoint"):
        protocol.submit_result(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
            idempotency_key="result-1",
            output_sha256="b" * 64,
        )
    protocol.checkpoint(
        lease_id=claims.lease_id,
        token=token,
        stage="uploaded",
        output_sha256="b" * 64,
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    receipt = protocol.submit_result(
        lease_id=claims.lease_id,
        token=token,
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
        idempotency_key="result-1",
        output_sha256="b" * 64,
    )
    assert (
        protocol.submit_result(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
            idempotency_key="result-1",
            output_sha256="b" * 64,
        )
        == receipt
    )
    assert protocol.recovery(job_id) is None


def test_result_idempotency_conflict_and_invalid_key() -> None:
    protocol = LocalWorkerProtocol(clock=lambda: NOW)
    job_id, workspace_id, space_id, claims, token = issue(protocol)
    protocol.checkpoint(
        lease_id=claims.lease_id,
        token=token,
        stage="uploaded",
        output_sha256="b" * 64,
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
    )
    protocol.submit_result(
        lease_id=claims.lease_id,
        token=token,
        job_id=job_id,
        workspace_id=workspace_id,
        space_id=space_id,
        input_sha256="a" * 64,
        idempotency_key="result-2",
        output_sha256="b" * 64,
    )
    with pytest.raises(LocalWorkerProtocolError, match="conflicts"):
        protocol.submit_result(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
            idempotency_key="result-2",
            output_sha256="c" * 64,
        )
    with pytest.raises(LocalWorkerProtocolError, match="idempotency key"):
        protocol.submit_result(
            lease_id=claims.lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256="a" * 64,
            idempotency_key="bad key",
            output_sha256="b" * 64,
        )
