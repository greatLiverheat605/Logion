import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.library.schemas import LibraryCreate
from logion_api.main import app
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.models import AccountDeletionRequest, DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.research.models import ResearchClaim
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import ValidationError
from sqlalchemy import select


def test_library_validates_and_normalizes_identifiers_and_metadata() -> None:
    value = LibraryCreate(
        title="Synthetic paper",
        doi="https://doi.org/10.1234/EXAMPLE",
        arxiv_id="https://arxiv.org/pdf/2401.12345v2.pdf",
        pmid="000123",
        csl={"author": [{"family": "Example"}], "issued": {"date-parts": [[2024, 2, 29]]}},
        tags=[" tag ", "tag"],
    )
    assert (value.doi, value.arxiv_id, value.pmid, value.tags) == (
        "10.1234/example",
        "2401.12345",
        "123",
        ["tag"],
    )
    for invalid in [
        {"doi": "https://example.com"},
        {"arxiv_id": "anything"},
        {"pmid": "-1"},
        {"source_url": "javascript:alert(1)"},
        {"source_url": "https://username:password@example.com"},
        {"csl": {"secret": "not allowed"}},
        {"csl": {"issued": {"date-parts": [[2023, 2, 29]]}}},
        {"file_locator": {"kind": "logion_webdav", "path": "../private"}},
    ]:
        with pytest.raises(ValidationError):
            LibraryCreate.model_validate({"title": "Synthetic", **invalid})


@pytest.mark.integration
@pytest.mark.asyncio
async def test_library_is_private_in_shared_spaces_and_legacy_projections(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", False)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.231", 49001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.232", 49002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as other,
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as anonymous,
    ):
        disabled = f"/api/v1/workspaces/{uuid4()}/spaces/{uuid4()}/library/resources"
        for method, path, body in [
            ("GET", disabled, None),
            ("GET", f"{disabled}/{uuid4()}", None),
            ("POST", disabled, {"title": "Synthetic"}),
            ("PUT", f"{disabled}/{uuid4()}", {"title": "Synthetic", "expected_version": 1}),
            ("DELETE", f"{disabled}/{uuid4()}", {"expected_version": 1}),
        ]:
            assert (await anonymous.request(method, path, json=body)).status_code == 404
        registrations = []
        for client in (owner, other):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"library-{uuid4()}@example.com",
                    "password": "synthetic-library-password-123",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            registrations.append(response.json())
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        owner_id, other_id = [UUID(item["user"]["id"]) for item in registrations]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Synthetic shared research", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space = shared.json()["id"]
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=other_id,
                    role="editor",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        base = f"{scope}/library/resources"
        legacy_id = uuid4()
        old = await owner.post(
            f"{scope}/research/papers",
            json={
                "id": str(legacy_id),
                "title": "Legacy synthetic paper",
                "citation_key": "legacy",
            },
        )
        assert old.status_code == 201, old.text
        claim = await owner.post(
            f"{scope}/research/claims",
            json={
                "id": str(uuid4()),
                "paper_id": str(legacy_id),
                "statement": "Synthetic claim",
                "stance": "supports",
            },
        )
        assert claim.status_code == 201, claim.text
        async with session_factory() as db:
            mapped = await db.scalar(select(Resource).where(Resource.legacy_paper_id == legacy_id))
            assert mapped is not None and mapped.research_owner_id == owner_id
            assert (await db.get(ResearchClaim, UUID(claim.json()["id"]))).resource_id == mapped.id
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        readonly = await owner.post(
            f"{scope}/research/papers",
            json={
                "id": str(uuid4()),
                "title": "Read-only paper",
                "citation_key": "readonly",
            },
        )
        assert readonly.status_code == 409
        assert readonly.json()["code"] == "RESEARCH_PAPERS_READ_ONLY"
        import_space = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Synthetic private import", "visibility": "private"},
        )
        assert import_space.status_code == 201, import_space.text
        imports = f"/api/v1/workspaces/{workspace}/data-imports"
        preview_id = uuid4()
        preview = await owner.post(
            f"{imports}/preview",
            json={
                "id": str(preview_id),
                "source_format": "logion_json",
                "source_filename": "synthetic.json",
                "content": json.dumps(
                    {
                        "schema_version": "logion-export-v1",
                        "objects": {
                            "paper_records": [
                                {"title": "Synthetic imported paper", "citation_key": "imported"}
                            ]
                        },
                    }
                ),
            },
        )
        assert preview.status_code == 201, preview.text
        import_body = {
            "target_space_id": import_space.json()["id"],
            "expected_version": 1,
            "confirmation": "IMPORT",
        }
        denied_import = await owner.post(f"{imports}/{preview_id}/commit", json=import_body)
        assert denied_import.status_code == 409, denied_import.text
        assert denied_import.json()["code"] == "RESEARCH_PAPERS_READ_ONLY"
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        imported = await owner.post(f"{imports}/{preview_id}/commit", json=import_body)
        assert imported.status_code == 200, imported.text
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        import_list = await owner.get(
            f"/api/v1/workspaces/{workspace}/spaces/{import_space.json()['id']}/library/resources"
        )
        assert [row["title"] for row in import_list.json()["resources"]] == [
            "Synthetic imported paper"
        ]
        assert (await anonymous.get(base)).status_code == 401
        payload = {
            "title": "Synthetic private library title",
            "doi": "10.1234/PRIVATE",
            "arxiv_id": "2401.12345v2",
            "pmid": "123",
            "tags": ["methods"],
            "reading_status": "reading",
        }
        no_csrf = await owner.post(base, json=payload, headers={"X-CSRF-Token": ""})
        assert no_csrf.status_code == 403
        assert (
            await owner.post(
                base, json=payload, headers={"Origin": "https://untrusted.example.com"}
            )
        ).status_code == 403
        created = await owner.post(base, json=payload)
        assert created.status_code == 201, created.text
        resource = created.json()
        assert resource["doi"] == "10.1234/private"
        assert created.headers["cache-control"] == "private, no-store"
        path = f"{base}/{resource['id']}"
        for identifier in ("doi", "arxiv_id", "pmid"):
            duplicate = await owner.post(
                base, json={"title": "Duplicate", identifier: payload[identifier]}
            )
            assert duplicate.status_code == 409, duplicate.text
            assert duplicate.json()["details"] == {"existing_id": resource["id"]}
        peer = await other.post(base, json=payload)
        assert peer.status_code == 201, peer.text
        assert peer.json()["id"] != resource["id"]
        assert (await other.get(path)).status_code == 404
        assert (await other.put(path, json={**payload, "expected_version": 1})).status_code == 404
        assert (
            await other.request("DELETE", path, json={"expected_version": 1})
        ).status_code == 404
        listed = await owner.get(base, params={"status": "reading", "tag": "methods"})
        assert [item["id"] for item in listed.json()["resources"]] == [resource["id"]]
        assert (await owner.get(base, params={"tag": "missing"})).json()["resources"] == []
        first = (await owner.get(base, params={"limit": 1})).json()
        second = (await owner.get(base, params={"limit": 1, "cursor": first["next_cursor"]})).json()
        assert len(first["resources"]) == len(second["resources"]) == 1
        assert first["resources"][0]["id"] != second["resources"][0]["id"]

        # Legacy APIs must neither expose nor mutate private v3 resources.
        old_update = await other.put(
            f"{scope}/resources/{resource['id']}",
            json={
                "expected_version": 1,
                "resource_type": "link",
                "title": "Attack",
                "source_url": "https://example.com/synthetic",
                "page_index": [],
            },
        )
        assert old_update.status_code == 404, old_update.text
        goal_id, phase_id, task_id = uuid4(), uuid4(), uuid4()
        planned = await owner.post(
            f"{scope}/goals",
            json={
                "goal_id": str(goal_id),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Synthetic evidence goal",
                "description": "",
                "desired_outcome": "Synthetic",
                "weekly_minutes": 60,
                "target_date": None,
                "phases": [
                    {
                        "id": str(phase_id),
                        "title": "Phase",
                        "description": "",
                        "position": 0,
                        "estimated_minutes": 60,
                        "acceptance_criteria": ["Synthetic"],
                    }
                ],
            },
        )
        assert planned.status_code == 201, planned.text
        task = await owner.post(
            f"{scope}/tasks",
            json={
                "id": str(task_id),
                "goal_id": str(goal_id),
                "phase_id": str(phase_id),
                "title": "Synthetic evidence task",
                "description": "",
            },
        )
        assert task.status_code == 201, task.text
        for version, status in enumerate(("planned", "in_progress"), start=1):
            started = await owner.post(
                f"{scope}/tasks/{task_id}/transition",
                json={"expected_version": version, "status": status},
            )
            assert started.status_code == 200, started.text
        for client in (owner, other):
            evidence = await client.post(
                f"{scope}/evidence",
                json={
                    "evidence_id": str(uuid4()),
                    "verification_id": str(uuid4()),
                    "task_id": str(task_id),
                    "evidence_type": "resource",
                    "resource_id": resource["id"],
                },
            )
            assert evidence.status_code == 404, evidence.text
        for client in (owner, other):
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            device_id = next(item["id"] for item in devices if item["current"])
            bootstrap = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                json={
                    "message_type": "bootstrap_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": device_id,
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200, bootstrap.text
            assert all(
                record["entity_id"] != resource["id"] for record in bootstrap.json()["records"]
            )
            search = await client.post(
                f"/api/v1/workspaces/{workspace}/search",
                json={"query": "Synthetic private library title"},
            )
            assert search.status_code == 200, search.text
            assert resource["id"] not in search.text
        async with session_factory() as db:
            # The legacy export format excludes the v3 collection for both members.
            service = object.__new__(PortabilityService)
            for user in (owner_id, other_id):
                archive = await service._build_archive(
                    db,
                    DataExportJob(
                        workspace_id=UUID(workspace),
                        requested_by=user,
                    ),
                )
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    data = json.loads(bundle.read("data.json"))
                assert all(item["id"] != resource["id"] for item in data["objects"]["resources"])
            audit = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.event_type.like("library.%"),
                        AuditEvent.actor_id == owner_id,
                    )
                )
            )
            assert audit and all(
                item.workspace_id is None and item.target_id is None for item in audit
            )
        edited = await owner.put(
            path, json={**payload, "expected_version": 1, "reading_status": "close_read"}
        )
        assert edited.status_code == 200, edited.text
        assert edited.json()["version"] == 2 and edited.json()["read_at"] is not None
        assert (await owner.put(path, json={**payload, "expected_version": 1})).status_code == 409
        assert (
            await owner.request("DELETE", path, json={"expected_version": 1})
        ).status_code == 409
        assert (
            await owner.request("DELETE", path, json={"expected_version": 2})
        ).status_code == 204
        assert (await owner.get(path)).status_code == 404
        assert (await owner.post(base, json=payload)).status_code == 201
        assert (await other.get(f"{base}/{peer.json()['id']}")).status_code == 200
        deletion = await other.post(
            "/api/v1/account-deletion", json={"confirmation": "DELETE MY ACCOUNT"}
        )
        assert deletion.status_code == 202, deletion.text
        async with session_factory() as db:
            request = await db.get(AccountDeletionRequest, UUID(deletion.json()["id"]))
            assert request is not None
            request.delete_after = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        assert await AccountDeletionService(settings).execute_next()
        async with session_factory() as db:
            assert await db.get(Resource, UUID(peer.json()["id"])) is None
            assert (
                await db.scalar(select(Resource).where(Resource.research_owner_id == owner_id))
                is not None
            )
