import hashlib
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Attachment
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_attachment_protocol_is_verified_idempotent_and_tenant_bound() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.170", 49010)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.171", 49011)),
            base_url=origin,
            headers={"Origin": origin},
        ) as outsider,
    ):
        registrations = []
        for client, label in ((owner, "owner"), (outsider, "outsider")):
            registrations.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"attachment-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        outsider_workspace = UUID(
            (await outsider.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        outsider_space = UUID(
            (await outsider.get(f"/api/v1/workspaces/{outsider_workspace}/spaces")).json()[
                "spaces"
            ][0]["id"]
        )
        owner_csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        outsider_csrf = {"X-CSRF-Token": outsider.cookies["logion_csrf"]}

        note_id, outsider_note_id = uuid4(), uuid4()
        owner_note = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes",
            headers=owner_csrf,
            json={"id": str(note_id), "title": "Result note", "markdown_body": "Private"},
        )
        outsider_note = await outsider.post(
            f"/api/v1/workspaces/{outsider_workspace}/spaces/{outsider_space}/notes",
            headers=outsider_csrf,
            json={
                "id": str(outsider_note_id),
                "title": "Other note",
                "markdown_body": "Other",
            },
        )
        assert owner_note.status_code == outsider_note.status_code == 201

        content = b"\x89PNG\r\n\x1a\nverified-result"
        attachment_id = uuid4()
        init_payload = {
            "id": str(attachment_id),
            "target_type": "note",
            "target_id": str(note_id),
            "filename": "result.png",
            "declared_mime": "image/png",
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }
        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/attachments"
        assert (await owner.post(f"{base}/init", json=init_payload)).status_code == 403
        initiated = await owner.post(f"{base}/init", headers=owner_csrf, json=init_payload)
        assert initiated.status_code == 201, initiated.text
        assert initiated.json()["status"] == "pending_upload"
        assert "staging_key" not in initiated.text and "storage_key" not in initiated.text

        replay = await owner.post(f"{base}/init", headers=owner_csrf, json=init_payload)
        assert replay.status_code == 201
        different_replay = await owner.post(
            f"{base}/init",
            headers=owner_csrf,
            json={**init_payload, "filename": "changed.png"},
        )
        assert different_replay.status_code == 409

        cross_workspace_same_id = await outsider.post(
            f"/api/v1/workspaces/{outsider_workspace}/spaces/{outsider_space}/attachments/init",
            headers=outsider_csrf,
            json={
                **init_payload,
                "target_id": str(outsider_note_id),
            },
        )
        assert cross_workspace_same_id.status_code == 404
        outsider_upload = await outsider.put(
            f"{base}/{attachment_id}/content",
            headers={**outsider_csrf, "Content-Type": "application/octet-stream"},
            content=content,
        )
        assert outsider_upload.status_code == 404

        invalid_content_type = await owner.put(
            f"{base}/{attachment_id}/content",
            headers={**owner_csrf, "Content-Type": "image/png"},
            content=content,
        )
        assert invalid_content_type.status_code == 415
        uploaded = await owner.put(
            f"{base}/{attachment_id}/content",
            headers={**owner_csrf, "Content-Type": "application/octet-stream"},
            content=content,
        )
        assert uploaded.status_code == 200, uploaded.text
        assert uploaded.json()["status"] == "uploading"
        upload_version = uploaded.json()["version"]

        completed = await owner.post(
            f"{base}/{attachment_id}/complete",
            headers=owner_csrf,
            json={"expected_version": upload_version},
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "verified"
        assert completed.json()["detected_mime"] == "image/png"
        assert completed.json()["verified_sha256"] == init_payload["sha256"]
        repeated_complete = await owner.post(
            f"{base}/{attachment_id}/complete",
            headers=owner_csrf,
            json={"expected_version": upload_version},
        )
        assert repeated_complete.status_code == 200
        assert repeated_complete.json()["version"] == completed.json()["version"]

        downloaded = await owner.get(f"{base}/{attachment_id}/content")
        assert downloaded.status_code == 200
        assert downloaded.content == content
        assert downloaded.headers["cache-control"] == "private, no-store"
        assert downloaded.headers["x-content-type-options"] == "nosniff"
        assert "filename*=UTF-8''result.png" in downloaded.headers["content-disposition"]

        malicious_id = uuid4()
        disguised = b"%PDF-1.7\nnot-a-png"
        malicious_payload = {
            **init_payload,
            "id": str(malicious_id),
            "size_bytes": len(disguised),
            "sha256": hashlib.sha256(disguised).hexdigest(),
        }
        assert (
            await owner.post(f"{base}/init", headers=owner_csrf, json=malicious_payload)
        ).status_code == 201
        malicious_upload = await owner.put(
            f"{base}/{malicious_id}/content",
            headers={**owner_csrf, "Content-Type": "application/octet-stream"},
            content=disguised,
        )
        assert malicious_upload.status_code == 200
        rejected = await owner.post(
            f"{base}/{malicious_id}/complete",
            headers=owner_csrf,
            json={"expected_version": malicious_upload.json()["version"]},
        )
        assert rejected.status_code == 422
        assert rejected.json()["code"] == "ATTACHMENT_MIME_MISMATCH"

    async with session_factory() as db:
        verified = await db.get(Attachment, attachment_id)
        failed = await db.get(Attachment, malicious_id)
        assert verified is not None and verified.status == "verified"
        assert failed is not None and failed.status == "failed"
        audits = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        serialized = " ".join(str(row.event_metadata) for row in audits)
        assert "result.png" not in serialized
        assert init_payload["sha256"] not in serialized
