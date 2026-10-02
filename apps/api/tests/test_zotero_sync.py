import base64
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.integrations.keyring import IntegrationKeyring
from logion_api.integrations.models import IntegrationCredential, ZoteroSyncState
from logion_api.integrations.zotero_sync import ZoteroSyncService, retry_time
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import SecretStr
from sqlalchemy import select

# The real API answers 400 for any other value, e.g. sort=version.
ZOTERO_SORTS = frozenset(
    {
        "dateAdded",
        "dateModified",
        "title",
        "creator",
        "itemType",
        "date",
        "publisher",
        "publicationTitle",
        "journalAbbreviation",
        "language",
        "accessDate",
        "libraryCatalog",
        "callNumber",
        "rights",
        "addedBy",
        "numItems",
    }
)


@pytest.fixture
def zotero_server() -> Iterator[tuple[str, dict[str, Any]]]:
    state: dict[str, Any] = {
        "version": 10,
        "status": 200,
        "backoff": None,
        "requests": [],
        "deleted": [],
        "collections": [{"key": "C0000001", "version": 10, "data": {"name": "Research"}}],
        "items": [
            {
                "key": "P0000001",
                "version": 10,
                "data": {
                    "itemType": "journalArticle",
                    "title": "Synthetic paper",
                    "DOI": "10.1234/SYNC",
                    "creators": [
                        {"creatorType": "author", "lastName": "Example", "firstName": "A"}
                    ],
                    "date": "2024-01-01",
                    "publicationTitle": "Synthetic journal",
                    "extra": "arXiv: 2401.12345v2\nPMID: 000123",
                    "collections": ["C0000001"],
                    "tags": [{"tag": "synthetic"}],
                },
            }
        ],
        "attachments": [
            {
                "key": "A0000001",
                "version": 10,
                "data": {
                    "itemType": "attachment",
                    "parentItem": "P0000001",
                    "contentType": "application/pdf",
                },
            }
        ],
        "annotations": [
            {
                "key": "N0000001",
                "version": 10,
                "data": {
                    "itemType": "annotation",
                    "parentItem": "A0000001",
                    "annotationText": "Cafe\u0301\r\nsynthetic text",
                    "annotationPosition": '{"pageIndex":2}',
                },
            }
        ],
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:  # noqa: N802
            assert self.headers.get("Zotero-API-Key") == "synthetic-zotero"
            path = urlsplit(self.path)
            query = parse_qs(path.query)
            status = state["status"]
            body: Any = {}
            if path.path == "/keys/current":
                body = {"userID": 123, "access": {"user": {"library": True, "write": False}}}
                status = 200
            else:
                state["requests"].append(
                    (path.path, query, self.headers.get("If-Modified-Since-Version"))
                )
                if query.get("sort", ["dateModified"])[0] not in ZOTERO_SORTS:
                    payload = b"Invalid 'sort' value"
                    self.send_response(400)
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                since = int(query["since"][0])
                if int(self.headers["If-Modified-Since-Version"]) >= state["version"]:
                    status = 304
                if path.path.endswith("/deleted"):
                    body = {"items": state["deleted"], "collections": []}
                else:
                    phase = (
                        "collections"
                        if path.path.endswith("/collections")
                        else "items"
                        if path.path.endswith("/top")
                        else "attachments"
                        if query["itemType"] == ["attachment"]
                        else "annotations"
                    )
                    entries = [item for item in state[phase] if item["version"] > since]
                    offset, limit = int(query["start"][0]), int(query["limit"][0])
                    body = entries[offset : offset + limit]
            payload = json.dumps(body).encode() if status != 304 else b""
            self.send_response(status)
            self.send_header("Last-Modified-Version", str(state["version"]))
            self.send_header("Content-Length", str(len(payload)))
            if state["backoff"]:
                self.send_header("Backoff", str(state["backoff"]))
                self.send_header("Retry-After", str(state["backoff"]))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_retry_after_supports_seconds_and_http_dates() -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert retry_time("120", now) == now + timedelta(seconds=120)
    assert retry_time("Thu, 01 Jan 2026 00:02:00 GMT", now) == now + timedelta(seconds=120)
    assert retry_time(None, now) is None
    assert retry_time("invalid", now) == now + timedelta(minutes=30)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pagination_resumes_after_429_and_rechecks_space_membership(
    monkeypatch: pytest.MonkeyPatch,
    zotero_server: tuple[str, dict[str, Any]],
) -> None:
    settings = get_settings()
    origin, fake = zotero_server
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    monkeypatch.setattr(settings, "env", "test")
    monkeypatch.setattr(settings, "zotero_origin", origin)
    monkeypatch.setattr(
        settings,
        "integration_keyring",
        IntegrationKeyring(
            active="synthetic",
            keys={"synthetic": base64.urlsafe_b64encode(b"k" * 32).decode()},
        ),
    )
    # Duplicate aliases must not create 101 resources; pagination still advances.
    source = fake["items"][0]
    fake["items"] = [{**source, "key": f"P{index:07d}"} for index in range(101)]
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.217", 49003)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as owner:
        response = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"zotero-page-{uuid4()}@example.com",
                "password": "Synthetic-password-42!",
                "device_name": "synthetic",
            },
        )
        assert response.status_code == 201, response.text
        user_id = UUID(response.json()["user"]["id"])
        owner.headers["X-CSRF-Token"] = owner.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (await owner.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"][0][
            "id"
        ]
        base = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        credential_path = "/api/v1/research/integrations/zotero"
        assert (
            await owner.put(credential_path, json={"credential": "synthetic-zotero"})
        ).status_code == 200
        assert (await owner.post(credential_path + "/test")).json()["connected"]
        assert (await owner.post(base + "/zotero-sync")).status_code == 202
        assert await ZoteroSyncService(settings).execute_next()  # Collections.
        assert await ZoteroSyncService(settings).execute_next()  # First 100 items.
        async with session_factory() as db:
            sync = await db.scalar(
                select(ZoteroSyncState).where(ZoteroSyncState.space_id == UUID(space))
            )
            assert sync and sync.page_offset == 100 and sync.phase == "items"
            assert len(sync.item_map) == 100 and sync.library_version == 0
        fake["status"], fake["backoff"] = 429, 120
        assert await ZoteroSyncService(settings).execute_next()
        assert not await ZoteroSyncService(settings).execute_next()
        async with session_factory() as db:
            credential = await db.scalar(
                select(IntegrationCredential).where(IntegrationCredential.user_id == user_id)
            )
            sync = await db.scalar(
                select(ZoteroSyncState).where(ZoteroSyncState.credential_id == credential.id)
            )
            assert credential.last_error_code == "ZOTERO_RATE_LIMITED" and credential.connected
            assert sync.page_offset == 100 and sync.library_version == 0
            assert sync.due_at >= datetime.now(UTC) + timedelta(seconds=110)
            credential.retry_after = sync.due_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        fake["status"], fake["backoff"] = 200, None
        assert await ZoteroSyncService(settings).execute_next()
        assert fake["requests"][-1][1]["start"] == ["100"]
        for _ in range(3):
            assert await ZoteroSyncService(settings).execute_next()
        assert not await ZoteroSyncService(settings).execute_next()
        response = (await owner.get(base + "/library/resources")).json()
        assert len(response["resources"]) == 1
        assert (await owner.get(base + "/zotero-sync")).json()["library_version"] == 10
        assert (await owner.post(base + "/zotero-sync")).status_code == 202
        before = len(fake["requests"])
        async with session_factory() as db:
            membership = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == UUID(workspace),
                    WorkspaceMembership.user_id == user_id,
                )
            )
            membership.status = "revoked"
            await db.commit()
        assert await ZoteroSyncService(settings).execute_next()
        assert len(fake["requests"]) == before
        async with session_factory() as db:
            credential = await db.scalar(
                select(IntegrationCredential).where(IntegrationCredential.user_id == user_id)
            )
            assert credential.last_error_code == "ZOTERO_SYNC_ACCESS_REVOKED"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_zotero_sync_is_incremental_private_resumable_and_non_destructive(
    monkeypatch: pytest.MonkeyPatch,
    zotero_server: tuple[str, dict[str, Any]],
) -> None:
    settings = get_settings()
    origin, fake = zotero_server
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    monkeypatch.setattr(settings, "knowledge_space_api_enabled", True)
    monkeypatch.setattr(settings, "knowledge_cursor_active_key_id", "synthetic")
    monkeypatch.setattr(settings, "knowledge_cursor_keys", {"synthetic": SecretStr("x" * 32)})
    monkeypatch.setattr(settings, "env", "test")
    monkeypatch.setattr(settings, "zotero_origin", origin)
    monkeypatch.setattr(
        settings,
        "integration_keyring",
        IntegrationKeyring(
            active="synthetic",
            keys={"synthetic": base64.urlsafe_b64encode(b"k" * 32).decode()},
        ),
    )
    service = ZoteroSyncService(settings)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.215", 49001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.216", 49002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"zotero-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Synthetic", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space = shared.json()["id"]
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace), user_id=users[1], role="viewer", status="active"
                )
            )
            await db.commit()
        base = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        credential_path = "/api/v1/research/integrations/zotero"
        assert (
            await owner.put(credential_path, json={"credential": "synthetic-zotero"})
        ).status_code == 200
        assert (await owner.post(credential_path + "/test")).json()["connected"]
        existing = await owner.post(
            base + "/library/resources",
            json={
                "title": "Manually entered",
                "doi": "10.1234/sync",
                "reading_status": "reading",
            },
        )
        assert existing.status_code == 201, existing.text
        resource_id = UUID(existing.json()["id"])
        trigger = base + "/zotero-sync"
        assert (await peer.post(trigger)).status_code == 409
        assert (await owner.post(trigger, headers={"X-CSRF-Token": "wrong"})).status_code == 403
        assert (await owner.post(trigger)).status_code == 202
        for _ in range(5):
            assert await service.execute_next()
        assert not await service.execute_next()
        state = (await owner.get(trigger)).json()
        assert state["library_version"] == 10 and state["last_sync_at"]
        resources = (await owner.get(base + "/library/resources")).json()["resources"]
        assert len(resources) == 1
        resource = resources[0]
        assert resource["id"] == str(resource_id)
        assert resource["reading_status"] == "reading"
        assert resource["csl"]["container-title"] == "Synthetic journal"
        assert resource["arxiv_id"] == "2401.12345" and resource["pmid"] == "123"
        assert resource["tags"] == ["synthetic", "collection:Research"]
        assert resource["file_locator"]["path"] == "zotero/A0000001.zip"
        assert (await peer.get(base + "/library/resources")).json()["resources"] == []
        async with session_factory() as db:
            excerpt = await db.scalar(
                select(SourceExcerpt).where(SourceExcerpt.resource_id == resource_id)
            )
            assert excerpt and excerpt.origin == "zotero"
            assert excerpt.excerpt_text == "Café\nsynthetic text"
            assert excerpt.page_start == excerpt.page_end == 3
            excerpt_id = excerpt.id
        # Even legacy shared-space APIs may neither disclose nor cite private annotations.
        for client in (owner, peer):
            response = await client.get(base + f"/knowledge/source-excerpts/{excerpt_id}")
            assert response.status_code == 404, response.text
            response = await client.get(base + "/knowledge/source-excerpts")
            assert response.status_code == 200, response.text
            assert response.json()["excerpts"] == []
        assert resource["zotero_attachment_version"] == 10
        edited = {
            key: value
            for key, value in resource.items()
            if key
            not in {
                "id",
                "workspace_id",
                "space_id",
                "version",
                "created_at",
                "updated_at",
                "zotero_attachment_version",
            }
        }
        edited.update(expected_version=resource["version"], tags=["synthetic", "collection:Forged"])
        refused = await owner.put(base + f"/library/resources/{resource_id}", json=edited)
        assert refused.json()["code"] == "ZOTERO_COLLECTION_READ_ONLY"
        # An unchanged library needs one 304 request, with the completed cursor.
        assert (await owner.post(trigger)).status_code == 202
        before = len(fake["requests"])
        assert await service.execute_next()
        assert not await service.execute_next()
        assert len(fake["requests"]) == before + 1
        assert fake["requests"][-1][2] == "10"
        # Collection renames affect unchanged items; annotation editions preserve old evidence.
        fake["version"] = 20
        fake["collections"][0].update(version=20, data={"name": "Renamed"})
        fake["annotations"][0]["version"] = 20
        fake["annotations"][0]["data"]["annotationText"] = "Changed synthetic annotation"
        assert (await owner.post(trigger)).status_code == 202
        for _ in range(5):
            assert await service.execute_next()
        async with session_factory() as db:
            row = await db.get(Resource, resource_id)
            assert row and row.tags == ["synthetic", "collection:Renamed"]
            excerpts = list(
                await db.scalars(
                    select(SourceExcerpt)
                    .where(SourceExcerpt.resource_id == resource_id)
                    .order_by(SourceExcerpt.created_at)
                )
            )
            assert len(excerpts) == 2
            assert excerpts[0].status == "stale" and excerpts[1].status == "active"
            assert excerpts[0].excerpt_text == "Café\nsynthetic text"
        # Successful responses can still demand Backoff; manual trigger must respect it.
        fake["version"], fake["backoff"] = 30, 120
        assert (await owner.post(trigger)).status_code == 202
        assert await service.execute_next()
        before = len(fake["requests"])
        assert not await service.execute_next()
        assert (await owner.post(trigger)).status_code == 202
        assert not await service.execute_next()
        assert (await owner.post(credential_path + "/test")).status_code == 429
        assert len(fake["requests"]) == before
        # Move the persisted deadline into the past to test restart without sleeping.
        async with session_factory() as db:
            credential = await db.scalar(
                select(IntegrationCredential).where(IntegrationCredential.user_id == users[0])
            )
            sync = await db.scalar(
                select(ZoteroSyncState).where(ZoteroSyncState.credential_id == credential.id)
            )
            credential.retry_after = sync.due_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        fake["version"], fake["backoff"] = 31, None
        assert await service.execute_next()  # Changed snapshot restarts before applying this page.
        async with session_factory() as db:
            sync = await db.scalar(
                select(ZoteroSyncState).where(ZoteroSyncState.space_id == UUID(space))
            )
            assert sync and sync.library_version == 20 and sync.target_version is None
            assert sync.phase == "collections" and sync.page_offset == 0
        for _ in range(5):
            assert await service.execute_next()
        fake["version"], fake["deleted"] = 40, ["P0000001"]
        assert (await owner.post(trigger)).status_code == 202
        for _ in range(5):
            assert await service.execute_next()
        async with session_factory() as db:
            row = await db.get(Resource, resource_id)
            assert row and row.reading_status == "archived" and row.zotero_sync_stopped
            assert row.deleted_at is None
            excerpts = list(
                await db.scalars(select(SourceExcerpt).where(SourceExcerpt.resource_id == row.id))
            )
            assert len(excerpts) == 2 and sum(item.status == "active" for item in excerpts) == 1
        # Revocation and feature-off stop worker dispatch.
        assert (await owner.delete(credential_path)).status_code == 204
        assert not await service.execute_next()
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(trigger)).status_code == 404
        assert (await owner.post(trigger)).status_code == 404
        assert not await service.execute_next()
