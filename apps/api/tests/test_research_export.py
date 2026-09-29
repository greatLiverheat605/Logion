import hashlib
import io
import json
import zipfile
from datetime import date, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuthSession
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.main import app
from logion_api.memory.models import QuizAttempt, QuizItem
from logion_api.planning.models import WeeklyReview
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.models import Space, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import func, select


@pytest_asyncio.fixture(loop_scope="session")
async def export_scope(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    address = uuid4().int % 65536
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=app, client=(f"198.18.{address // 256}.{address % 256}", 48000)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=app, client=(f"198.19.{address // 256}.{address % 256}", 48000)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"export-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "Synthetic export",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        created = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={
                "name": "Shared export",
                "visibility": "shared",
            },
        )
        assert created.status_code == 201, created.text
        space = created.json()["id"]
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace), user_id=users[1], role="admin", status="active"
                )
            )
            await db.commit()
        yield owner, peer, users, workspace, space


async def execute(client: httpx.AsyncClient, workspace: str, *, legacy: bool = False):
    path = f"/api/v1/workspaces/{workspace}/" + (
        "data-exports" if legacy else "research/data-exports"
    )
    identifier = uuid4()
    created = await client.post(path, json={"id": str(identifier), "confirmation": "EXPORT"})
    assert created.status_code == 202, created.text
    async with session_factory() as db:
        row = await db.get(DataExportJob, identifier)
        assert row
        row.status = "running"
        await db.commit()
    settings = get_settings()
    await PortabilityService(settings, WorkspaceService(settings)).execute(identifier)
    download = await client.get(f"{path}/{identifier}/download")
    assert download.status_code == 200, download.text
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        package = json.loads(archive.read("data.json"))
    return identifier, download, package


@pytest.mark.integration
@pytest.mark.asyncio
async def test_complete_research_archive_and_shared_peer_sentinels(export_scope) -> None:
    owner, peer, users, workspace, space = export_scope
    scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
    owner_ids = {}
    for client, user, marker in (
        (owner, users[0], "OWNER_PRIVATE"),
        (peer, users[1], "PEER_PRIVATE"),
    ):
        paper = await client.post(
            f"{scope}/library/resources",
            json={
                "title": f"{marker} paper",
                "resource_type": "paper",
                "doi": f"10.1234/{marker.lower()}",
                "csl": {"author": [{"family": "Synthetic"}]},
            },
        )
        assert paper.status_code == 201, paper.text
        rid = paper.json()["id"]
        path = f"{scope}/library/resources/{rid}"
        async with session_factory() as db:
            resource = await db.get(Resource, UUID(rid))
            assert resource
            resource.sha256 = "a" * 64
            await db.commit()
        source = await client.post(
            f"{path}/text",
            json={
                "file_sha256": "a" * 64,
                "pages": [f"{marker} first page.", "第二页"],
                "extracted_by": "pdfjs@6.3.289",
            },
        )
        assert source.status_code == 200, source.text
        concept = await client.post(
            f"{path}/concepts",
            json={
                "source_text_id": source.json()["id"],
                "char_start": 0,
                "char_end": 13,
            },
        )
        assert concept.status_code == 201, concept.text
        note = await client.post(f"{path}/note")
        assert note.status_code == 200, note.text
        idea = await client.post(
            f"{scope}/research/ideas", json={"title": marker, "body": f"{marker} idea"}
        )
        assert idea.status_code == 201, idea.text
        tid = UUID(concept.json()["topic_id"])
        async with session_factory() as db:
            kwargs = dict(
                workspace_id=UUID(workspace), space_id=UUID(space), created_by=user, updated_by=user
            )
            item = QuizItem(
                **kwargs,
                topic_id=tid,
                resource_id=UUID(rid),
                research_owner_id=user,
                origin="user",
                prompt=f"{marker} question",
                answer_key="Reference answer",
                evaluation_mode="self_assessed",
                deleted_at=utc_now(),
            )
            db.add(item)
            await db.flush()
            db.add(
                QuizAttempt(
                    **kwargs,
                    topic_id=tid,
                    quiz_item_id=item.id,
                    user_id=user,
                    response_text=f"{marker} answer",
                    is_correct=False,
                    confidence=3,
                    duration_seconds=42,
                    ai_grade={
                        "score": 80,
                        "reasoning": f"{marker} evidence",
                        "weak_concepts": ["Synthetic"],
                    },
                )
            )
            db.add(
                WeeklyReview(
                    workspace_id=UUID(workspace),
                    space_id=UUID(space),
                    user_id=user,
                    week_start=date(2026, 9, 28),
                    timezone="UTC",
                    stats={"done": 1},
                    task_snapshot=[],
                    triage=[],
                    ai_comment=f"{marker} weekly",
                )
            )
            db.add(
                KnowledgeEdge(
                    workspace_id=UUID(workspace),
                    space_id=UUID(space),
                    user_id=user,
                    from_idea_id=UUID(idea.json()["id"]),
                    to_resource_id=UUID(rid),
                    relation="inspired_by",
                    origin="user",
                    status="confirmed",
                    reason=f"{marker} edge",
                )
            )
            await db.commit()
        if client is owner:
            owner_ids = {"rid": rid, "tid": str(tid), "item": str(item.id)}
    old_note = await owner.post(
        f"{scope}/notes",
        json={
            "id": str(uuid4()),
            "task_id": None,
            "title": "Shared legacy note",
            "markdown_body": "旧笔记仍可导出",
        },
    )
    assert old_note.status_code == 201, old_note.text
    identifier, download, package = await execute(owner, workspace)
    assert package["schema_version"] == "logion-export-v03"
    objects = package["objects"]
    encoded = json.dumps(package, ensure_ascii=False)
    assert "OWNER_PRIVATE" in encoded and "PEER_PRIVATE" not in encoded
    assert len(objects["notes"]) == 2
    assert any(n["note_kind"] == "close_reading" for n in objects["notes"])
    assert objects["source_texts"][0]["page_offsets"] == [
        {"start": 0, "end": 26},
        {"start": 26, "end": 30},
    ]
    assert objects["source_excerpts"][0]["char_start"] == 0
    assert objects["knowledge_citations"][0]["topic_id"] == owner_ids["tid"]
    assert objects["quiz_items"][0]["id"] == owner_ids["item"]
    assert objects["quiz_items"][0]["deleted_at"] is not None
    assert objects["quiz_attempts"][0]["ai_grade"]["score"] == 80
    assert objects["knowledge_edges"][0]["from_type"] == "idea"
    assert objects["weekly_reviews"][0]["ai_comment"] == "OWNER_PRIVATE weekly"
    assert objects["resources"][0]["doi"] == "10.1234/owner_private"
    assert all(
        key not in encoded for key in ("yjs_state", "ciphertext", "token_hash", "password_hash")
    )
    assert "Synthetic-password-42!" not in encoded
    for cookie in owner.cookies.values():
        assert cookie not in encoded
    assert download.headers["cache-control"] == "private, no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        assert set(archive.namelist()) == {
            "manifest.json",
            "data.json",
            "notes.md",
            "papers.bib",
            "tasks.csv",
        }
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["counts"] == {name: len(rows) for name, rows in objects.items()}
        bibtex = archive.read("papers.bib").decode()
        assert "OWNER_PRIVATE paper" in bibtex
        assert "doi = {10.1234/owner_private}" in bibtex
        assert "author = {Synthetic}" in bibtex
    async with session_factory() as db:
        row = await db.get(DataExportJob, identifier)
        assert row and row.artifact_ciphertext != download.content
        assert b"OWNER_PRIVATE" not in row.artifact_ciphertext
        assert row.artifact_sha256 == hashlib.sha256(download.content).hexdigest()
    _, _, peer_package = await execute(peer, workspace)
    assert "OWNER_PRIVATE" not in json.dumps(peer_package)
    assert "PEER_PRIVATE" in json.dumps(peer_package)
    _, _, legacy_package = await execute(owner, workspace, legacy=True)
    assert legacy_package["schema_version"] == "logion-export-v1"
    assert not legacy_package["objects"]["resources"]
    assert len(legacy_package["objects"]["notes"]) == 1
    path = f"/api/v1/workspaces/{workspace}/research/data-exports"
    assert (await peer.get(f"{path}/{identifier}/download")).status_code == 404
    assert (
        await owner.get(f"/api/v1/workspaces/{workspace}/data-exports/{identifier}/download")
    ).status_code == 404
    collision = await owner.post(
        f"/api/v1/workspaces/{workspace}/data-exports",
        json={"id": str(identifier), "confirmation": "EXPORT"},
    )
    assert collision.status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_research_export_rechecks_space_membership_expiry_and_digest(export_scope) -> None:
    owner, peer, users, workspace, space = export_scope
    identifier, _, _ = await execute(peer, workspace)
    path = f"/api/v1/workspaces/{workspace}/research/data-exports/{identifier}/download"
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        assert row
        row.status = "archived"
        row.archived_at = utc_now()
        await db.commit()
    assert (await peer.get(path)).status_code == 200
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        assert row
        row.visibility = "private"
        await db.commit()
    denied = await peer.get(path)
    assert denied.status_code == 409 and denied.json()["code"] == "EXPORT_SCOPE_CHANGED"
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        assert row
        row.visibility = "shared"
        row.status = "deleted"
        row.deleted_at = utc_now()
        await db.commit()
    assert (await peer.get(path)).status_code == 409
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        assert row
        row.status = "active"
        row.archived_at = row.deleted_at = None
        job = await db.get(DataExportJob, identifier)
        assert job
        digest, expiry = job.artifact_sha256, job.expires_at
        job.artifact_sha256 = "0" * 64
        await db.commit()
    denied = await peer.get(path)
    assert denied.status_code == 503 and denied.json()["code"] == "EXPORT_ARTIFACT_INTEGRITY_FAILED"
    async with session_factory() as db:
        job = await db.get(DataExportJob, identifier)
        assert job
        job.artifact_sha256 = digest
        job.expires_at = utc_now() - timedelta(seconds=1)
        await db.commit()
    assert (await peer.get(path)).status_code == 404
    async with session_factory() as db:
        job = await db.get(DataExportJob, identifier)
        assert job
        job.expires_at = expiry
        member = await db.scalar(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == UUID(workspace),
                WorkspaceMembership.user_id == users[1],
            )
        )
        assert member
        member.status = "revoked"
        await db.commit()
    assert (await peer.get(path)).status_code == 404
    # A queued job also loses authorization; the worker must not build an artifact.
    async with session_factory() as db:
        job = DataExportJob(
            workspace_id=UUID(workspace),
            requested_by=users[1],
            schema_version="logion-export-v03",
            status="running",
            expires_at=expiry,
        )
        db.add(job)
        await db.commit()
        job_id = job.id
    settings = get_settings()
    await PortabilityService(settings, WorkspaceService(settings)).execute(job_id)
    async with session_factory() as db:
        job = await db.get(DataExportJob, job_id)
        assert job and job.status == "failed" and job.artifact_ciphertext is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_research_export_boundaries_cancel_and_feature_flag(
    export_scope, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, _, users, workspace, _ = export_scope
    path = f"/api/v1/workspaces/{workspace}/research/data-exports"
    payload = {"id": str(uuid4()), "confirmation": "EXPORT"}
    for headers in ({"Origin": "https://untrusted.example.com"}, {"X-CSRF-Token": "bad"}):
        assert (await owner.post(path, json=payload, headers=headers)).status_code == 403
    created = await owner.post(path, json=payload)
    assert created.status_code == 202, created.text
    row = created.json()
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", False)
    for response in (
        await owner.get(path),
        await owner.post(path, json=payload),
        await owner.get(f"{path}/{row['id']}/download"),
        await owner.post(f"{path}/{row['id']}/cancel", json={"expected_version": row["version"]}),
    ):
        assert response.status_code == 404
    # Make this job the first candidate, so unrelated queued fixtures cannot mask a missing gate.
    async with session_factory() as db:
        job = await db.get(DataExportJob, UUID(row["id"]))
        oldest = await db.scalar(select(func.min(DataExportJob.created_at)))
        assert job and oldest
        job.created_at = oldest - timedelta(seconds=1)
        await db.commit()
    # Real queue selector must leave the gated job queued.
    await PortabilityService(settings, WorkspaceService(settings)).execute_next()
    async with session_factory() as db:
        job = await db.get(DataExportJob, UUID(row["id"]))
        assert job and job.status == "queued" and job.artifact_ciphertext is None
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    cancelled = await owner.post(
        f"{path}/{row['id']}/cancel", json={"expected_version": row["version"]}
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    identifier, _, _ = await execute(owner, workspace)
    async with session_factory() as db:
        sessions = await db.scalars(select(AuthSession).where(AuthSession.user_id == users[0]))
        for session in sessions:
            session.created_at = utc_now() - timedelta(hours=2)
        await db.commit()
    assert (await owner.get(f"{path}/{identifier}/download")).status_code == 403
    assert (await owner.post(path, json={**payload, "id": str(uuid4())})).status_code == 403
