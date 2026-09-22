import json
from collections.abc import Sequence
from datetime import timedelta
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Note, Resource
from logion_api.db import session_factory, utc_now
from logion_api.engagement.models import Notification
from logion_api.identity.models import AuditEvent, EmailOutbox
from logion_api.main import app
from logion_api.portability.models import DataImportPreview
from logion_api.research.models import PaperRecord
from logion_api.self_study.models import InboxItem
from logion_api.sync.models import ProcessedSyncOperation, SyncChange, WorkspaceSyncState
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def import_transaction_snapshot(
    db: AsyncSession, workspace_id: UUID, user_id: UUID, preview_id: UUID
) -> dict[str, Any]:
    queries = {
        "note": select(Note.id).where(Note.workspace_id == workspace_id),
        "resource": select(Resource.id).where(Resource.workspace_id == workspace_id),
        "paper": select(PaperRecord.id).where(PaperRecord.workspace_id == workspace_id),
        "inbox_item": select(InboxItem.id).where(InboxItem.workspace_id == workspace_id),
        "committed": select(AuditEvent.id).where(
            AuditEvent.workspace_id == workspace_id,
            AuditEvent.target_id == preview_id,
            AuditEvent.event_type == "data.import_committed",
        ),
        "sync_changes": select(SyncChange.operation_id).where(
            SyncChange.workspace_id == workspace_id
        ),
        "sync_operations": select(ProcessedSyncOperation.operation_id).where(
            ProcessedSyncOperation.workspace_id == workspace_id
        ),
        "notifications": select(Notification.id).where(
            Notification.workspace_id == workspace_id,
            Notification.recipient_user_id == user_id,
        ),
        "email_outbox": select(EmailOutbox.id).where(EmailOutbox.user_id == user_id),
    }
    ids = {name: set(await db.scalars(query)) for name, query in queries.items()}
    # Read persisted columns rather than an ORM identity-map instance.
    preview = dict(
        (
            await db.execute(
                select(DataImportPreview.__table__).where(DataImportPreview.id == preview_id)
            )
        )
        .mappings()
        .one()
    )
    for field in ("normalized_ciphertext", "normalized_nonce"):
        value = preview[field]
        preview[field] = sha256(value).hexdigest() if value is not None else None
    sync_head = (
        await db.execute(
            select(
                WorkspaceSyncState.sync_epoch,
                WorkspaceSyncState.last_sequence,
                WorkspaceSyncState.min_retained_sequence,
            ).where(WorkspaceSyncState.workspace_id == workspace_id)
        )
    ).one_or_none()
    return {
        "ids": ids,
        "preview": preview,
        "sync_head": tuple(sync_head) if sync_head is not None else None,
    }


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("source_format", ["logion_json", "csv"])
@pytest.mark.parametrize("failure", ["expired", "after_flush"])
async def test_import_expiry_and_flushed_failure_preserve_transaction(
    source_format: str, failure: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source_ids = [uuid4() for _ in range(4)]
    if source_format == "logion_json":
        content = json.dumps(
            {
                "schema_version": "logion-export-v1",
                "objects": {
                    "notes": [
                        {
                            "id": str(source_ids[0]),
                            "title": "First synthetic note",
                            "markdown_body": "First body",
                        },
                        {
                            "id": str(source_ids[1]),
                            "title": "Second synthetic note",
                            "markdown_body": "Second body",
                        },
                    ],
                    "resources": [
                        {
                            "id": str(source_ids[2]),
                            "title": "Synthetic resource",
                            "resource_type": "link",
                            "source_url": "https://example.com/source",
                        }
                    ],
                    "paper_records": [
                        {
                            "id": str(source_ids[3]),
                            "title": "Synthetic paper",
                            "citation_key": "synthetic-paper",
                            "source_url": "https://example.com/paper",
                        }
                    ],
                },
            }
        )
        expected_counts = {"note": 2, "resource": 1, "paper": 1, "inbox_item": 0}
        filename = "data.json"
    else:
        content = (
            "id,title,note\n"
            f"{source_ids[0]},First inbox,Synthetic first\n"
            f"{source_ids[1]},Second inbox,Synthetic second\n"
        )
        expected_counts = {"note": 0, "resource": 0, "paper": 0, "inbox_item": 2}
        filename = "inbox.csv"

    address = uuid4().hex
    client_ip = f"2001:db8::{address[:4]}:{address[4:8]}"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(client_ip, 49014), raise_app_exceptions=False),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as owner:
        registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"import-transaction-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Import transaction test",
            },
        )
        assert registration.status_code == 201
        user_id = UUID(registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        preview_id = uuid4()
        imports_url = f"/api/v1/workspaces/{workspace_id}/data-imports"
        preview = await owner.post(
            f"{imports_url}/preview",
            headers=csrf,
            json={
                "id": str(preview_id),
                "source_format": source_format,
                "source_filename": filename,
                "content": content,
            },
        )
        assert preview.status_code == 201, preview.text
        assert preview.json()["counts"] == {
            kind: count for kind, count in expected_counts.items() if count
        }
        if failure == "expired":
            async with session_factory() as db:
                stored = await db.get(DataImportPreview, preview_id)
                assert stored is not None
                stored.expires_at = utc_now() - timedelta(seconds=1)
                await db.commit()

        async def snapshot() -> dict[str, Any]:
            async with session_factory() as db:
                return await import_transaction_snapshot(db, workspace_id, user_id, preview_id)

        before = await snapshot()
        assert before["ids"]["committed"] == set()
        assert before["preview"]["status"] == "previewed"
        assert before["preview"]["version"] == 1
        assert before["preview"]["normalized_ciphertext"] is not None
        assert before["preview"]["normalized_nonce"] is not None
        assert before["preview"]["normalized_encryption_key_id"] is not None
        assert before["preview"]["imported_at"] is None
        assert before["preview"]["imported_space_id"] is None
        commit_url = f"{imports_url}/{preview_id}/commit"
        commit_body = {
            "target_space_id": str(space_id),
            "expected_version": 1,
            "confirmation": "IMPORT",
        }
        if failure == "expired":
            response = await owner.post(commit_url, headers=csrf, json=commit_body)
            assert response.status_code == 409
            assert response.json()["code"] == "IMPORT_PREVIEW_EXPIRED"
            assert await snapshot() == before
            return

        def assert_imported(state: dict[str, Any]) -> None:
            for kind, count in expected_counts.items():
                old_ids = before["ids"][kind]
                new_ids = state["ids"][kind]
                assert old_ids <= new_ids
                assert len(new_ids - old_ids) == count
                assert (new_ids - old_ids).isdisjoint(source_ids)
            assert len(state["ids"]["committed"]) == 1
            for name in ("sync_changes", "sync_operations", "notifications", "email_outbox"):
                assert state["ids"][name] == before["ids"][name]
            assert state["sync_head"] == before["sync_head"]
            assert state["preview"]["status"] == "imported"
            assert state["preview"]["version"] == 2
            assert state["preview"]["imported_space_id"] == space_id
            assert state["preview"]["imported_at"] is not None
            assert state["preview"]["normalized_ciphertext"] is None
            assert state["preview"]["normalized_nonce"] is None
            assert state["preview"]["normalized_encryption_key_id"] is None

        real_flush = AsyncSession.flush
        injected = False

        async def fail_after_import_flush(
            db: AsyncSession, objects: Sequence[Any] | None = None
        ) -> None:
            nonlocal injected
            target = any(
                isinstance(row, DataImportPreview)
                and row.id == preview_id
                and row.status == "imported"
                for row in db.dirty
            )
            await real_flush(db, objects)
            if target:
                # Prove business rows, preview and audit reached SQL before failing.
                assert_imported(
                    await import_transaction_snapshot(db, workspace_id, user_id, preview_id)
                )
                # An assertion swallowed as HTTP 500 must not pass this check.
                injected = True
                raise RuntimeError("synthetic import flush failure")

        with monkeypatch.context() as patch:
            patch.setattr(AsyncSession, "flush", fail_after_import_flush)
            failed = await owner.post(commit_url, headers=csrf, json=commit_body)
        assert injected
        assert failed.status_code == 500
        assert await snapshot() == before
        retried = await owner.post(commit_url, headers=csrf, json=commit_body)
        assert retried.status_code == 200, retried.text
        assert retried.json()["status"] == "imported"
        assert retried.json()["version"] == 2
        after = await snapshot()
        assert_imported(after)
        async with session_factory() as db:
            committed_audit = (
                await db.execute(
                    select(AuditEvent.actor_id, AuditEvent.result).where(
                        AuditEvent.id.in_(after["ids"]["committed"])
                    )
                )
            ).one()
            assert tuple(committed_audit) == (user_id, "success")
        repeated = await owner.post(
            commit_url,
            headers=csrf,
            json={**commit_body, "expected_version": 2},
        )
        assert repeated.status_code == 409
        assert repeated.json()["code"] == "IMPORT_PREVIEW_EXPIRED"
        assert await snapshot() == after


async def import_counts(workspace_id: UUID) -> tuple[int, int]:
    async with session_factory() as db:
        previews = await db.scalar(
            select(func.count(DataImportPreview.id)).where(
                DataImportPreview.workspace_id == workspace_id
            )
        )
        notes = await db.scalar(
            select(func.count(Note.id)).where(Note.workspace_id == workspace_id)
        )
        return int(previews or 0), int(notes or 0)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_preview_first_import_is_private_new_id_and_single_use() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.172", 49012)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.173", 49013)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        registrations = []
        for client, label in ((owner, "owner"), (viewer, "viewer")):
            registrations.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"import-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        viewer_id = UUID(registrations[1].json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=viewer_id,
                    role="viewer",
                    status="active",
                )
            )
            await db.commit()

        source_id = uuid4()
        marker = f"import-marker-{uuid4().hex}"
        package = json.dumps(
            {
                "schema_version": "logion-export-v1",
                "objects": {
                    "notes": [
                        {
                            "id": str(source_id),
                            "title": "Imported private note",
                            "markdown_body": marker,
                        }
                    ],
                    "tasks": [{"id": str(uuid4()), "title": "Skipped task"}],
                },
            }
        )
        preview_id = uuid4()
        imports_url = f"/api/v1/workspaces/{workspace_id}/data-imports"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        preview = await owner.post(
            f"{imports_url}/preview",
            headers=csrf,
            json={
                "id": str(preview_id),
                "source_format": "logion_json",
                "source_filename": "data.json",
                "content": package,
            },
        )
        assert preview.status_code == 201, preview.text
        assert preview.json()["counts"] == {"note": 1}
        assert preview.json()["warnings"] == ["Skipped unsupported object type: tasks"]
        assert (await viewer.get(imports_url)).json()["imports"] == []
        denied = await viewer.post(
            f"{imports_url}/{preview_id}/commit",
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={
                "target_space_id": str(space_id),
                "expected_version": 1,
                "confirmation": "IMPORT",
            },
        )
        assert denied.status_code == 404
        assert denied.json()["code"] == "IMPORT_TARGET_NOT_FOUND"
        viewer_csrf = {"X-CSRF-Token": viewer.cookies["logion_csrf"]}
        viewer_space = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers=viewer_csrf,
            json={"name": "Viewer import target", "visibility": "private"},
        )
        assert viewer_space.status_code == 201, viewer_space.text
        target = viewer_space.json()
        assert target["workspace_id"] == str(workspace_id)
        assert target["owner_user_id"] == str(viewer_id)
        assert target["visibility"] == "private"
        assert target["status"] == "active"
        async with session_factory() as db:
            before_owner_denial = await import_transaction_snapshot(
                db, workspace_id, viewer_id, preview_id
            )
        # Reach the preview ownership check with a valid requester-owned target.
        for inaccessible_preview_id in (preview_id, uuid4()):
            owner_denied = await viewer.post(
                f"{imports_url}/{inaccessible_preview_id}/commit",
                headers=viewer_csrf,
                json={
                    "target_space_id": target["id"],
                    "expected_version": 1,
                    "confirmation": "IMPORT",
                },
            )
            assert owner_denied.status_code == 404, owner_denied.text
            assert owner_denied.json()["code"] == "IMPORT_NOT_FOUND"
        async with session_factory() as db:
            assert (
                await import_transaction_snapshot(db, workspace_id, viewer_id, preview_id)
                == before_owner_denial
            )
        counts_before = await import_counts(workspace_id)
        stale = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": preview.json()["version"] + 1,
                "confirmation": "IMPORT",
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "VERSION_CONFLICT"
        assert await import_counts(workspace_id) == counts_before
        unchanged = (await owner.get(imports_url)).json()["imports"]
        assert next(item for item in unchanged if item["id"] == str(preview_id)) == preview.json()
        async with session_factory() as db:
            stored = await db.get(DataImportPreview, preview_id)
            assert stored is not None and stored.normalized_ciphertext is not None
        committed = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": 1,
                "confirmation": "IMPORT",
            },
        )
        assert committed.status_code == 200, committed.text
        assert committed.json()["status"] == "imported"
        counts_after = (counts_before[0], counts_before[1] + 1)
        assert await import_counts(workspace_id) == counts_after
        repeated = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": 2,
                "confirmation": "IMPORT",
            },
        )
        assert repeated.status_code == 409
        assert repeated.json()["code"] == "IMPORT_PREVIEW_EXPIRED"
        assert await import_counts(workspace_id) == counts_after
        search = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/search",
            headers=csrf,
            json={"query": marker, "object_types": ["note"], "limit": 10},
        )
        assert search.status_code == 200, search.text
        imported = search.json()["results"][0]
        assert imported["object_id"] != str(source_id)

    async with session_factory() as db:
        stored = await db.get(DataImportPreview, preview_id)
        assert stored is not None and stored.status == "imported"
        assert stored.normalized_ciphertext is None
        assert marker not in str(stored.warnings)


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("dimension", "size", "error_code"),
    [
        ("content", 0, "VALIDATION_ERROR"),
        ("content", 1, None),
        ("content", 1_048_576, None),
        ("content", 1_048_577, "VALIDATION_ERROR"),
        ("body", 0, None),
        ("body", 100_000, None),
        ("body", 100_001, "IMPORT_SOURCE_INVALID"),
        ("records", 0, "IMPORT_SOURCE_INVALID"),
        ("records", 1, None),
        ("records", 1000, None),
        ("records", 1001, "IMPORT_SOURCE_INVALID"),
    ],
)
async def test_import_preview_boundaries_preserve_business_data(
    dimension: str, size: int, error_code: str | None
) -> None:
    source_format = "logion_json"
    notes = [{"title": "Boundary note", "markdown_body": "x" * size if dimension == "body" else ""}]
    if dimension == "records":
        notes *= size
    content = json.dumps(
        {"schema_version": "logion-export-v1", "objects": {"notes": notes}},
        separators=(",", ":"),
    )
    if dimension == "content":
        if size <= 1:
            source_format, content = "markdown", "x" * size
        else:
            content = content.ljust(size)
        assert len(content) == size

    origin = "http://test"
    address = uuid4().hex
    client_ip = f"2001:db8::{address[:4]}:{address[4:8]}"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(client_ip, 49014)),
        base_url=origin,
        headers={"Origin": origin},
    ) as owner:
        registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"import-boundary-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Import boundary test",
            },
        )
        assert registered.status_code == 201
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        counts_before = await import_counts(workspace_id)
        preview_id = uuid4()
        response = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/data-imports/preview",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(preview_id),
                "source_format": source_format,
                "source_filename": "boundary.md"
                if source_format == "markdown"
                else "boundary.json",
                "content": content,
            },
        )
        if error_code is not None:
            assert response.status_code == 422
            assert response.json()["code"] == error_code
            assert await import_counts(workspace_id) == counts_before
            async with session_factory() as db:
                assert await db.get(DataImportPreview, preview_id) is None
        else:
            assert response.status_code == 201, response.text
            assert response.json()["counts"] == {"note": size if dimension == "records" else 1}
            assert await import_counts(workspace_id) == (counts_before[0] + 1, counts_before[1])
            async with session_factory() as db:
                stored = await db.get(DataImportPreview, preview_id)
                assert stored is not None and stored.status == "previewed"
                assert stored.normalized_ciphertext is not None
