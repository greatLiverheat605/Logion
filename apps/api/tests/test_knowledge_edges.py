import asyncio
import importlib.util
import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.models import AIProvider, AIRun
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import engine, session_factory, utc_now
from logion_api.identity.models import AuditEvent
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.knowledge.schemas import EdgeCreate
from logion_api.main import app
from logion_api.research.models import ResearchQuestion
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import ValidationError
from sqlalchemy import Connection, MetaData, Table, event, func, select, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0054_knowledge_edges.py"


def test_relation_vocabulary_is_typed_and_cannot_encode_prerequisites() -> None:
    fields = dict(
        from_type="resource",
        from_id=uuid4(),
        to_type="question",
        to_id=uuid4(),
        relation="addresses",
    )
    EdgeCreate.model_validate(fields)
    for changes in (
        {"relation": "supports"},
        {"from_type": "idea"},
        {"relation": "prerequisite"},
        {"status": "suggested"},
        {"origin": "ai"},
        {"to_type": "resource", "to_id": fields["from_id"], "relation": "extends"},
    ):
        with pytest.raises(ValidationError):
            EdgeCreate.model_validate({**fields, **changes})


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_links_ai_suggestions_rejection_tombstones_and_revocation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.252", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.253", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"links-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (
            await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={"name": "Link scope", "visibility": "shared"},
            )
        ).json()["id"]
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        edges = scope + "/research/knowledge/edges"
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=users[1],
                    role="admin",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            await db.commit()
        sources = []
        for title in ("Evidence paper", "Contrasting paper"):
            response = await owner.post(scope + "/library/resources", json={"title": title})
            assert response.status_code == 201, response.text
            sources.append(response.json())
        question = (
            await owner.post(
                scope + "/research/question-tree", json={"question": "What explains the evidence?"}
            )
        ).json()
        idea = (
            await owner.post(
                scope + "/research/ideas",
                json={"title": "Private thought", "body": "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND"},
            )
        ).json()
        manual = dict(
            from_type="idea",
            from_id=idea["id"],
            to_type="resource",
            to_id=sources[0]["id"],
            relation="inspired_by",
            reason="Owner authored",
        )
        for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.example.com"}):
            assert (await owner.post(edges, json=manual, headers=headers)).status_code == 403
        assert (await peer.post(edges, json=manual)).status_code == 404
        assert (await owner.post(edges, json={**manual, "origin": "ai"})).status_code == 422
        created = await owner.post(edges, json=manual)
        assert created.status_code == 201, created.text
        manual_edge = created.json()
        assert manual_edge["status"] == "confirmed" and manual_edge["ai_run_id"] is None
        assert (await owner.post(edges, json=manual)).status_code == 409
        assert (await peer.get(edges)).json()["edges"] == []
        assert (
            await peer.post(
                edges + f"/{manual_edge['id']}/decision",
                json={"status": "rejected", "expected_version": 1},
            )
        ).status_code == 404
        other_space = (
            await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={"name": "Other scope", "visibility": "shared"},
            )
        ).json()["id"]
        assert (await owner.post(edges.replace(space, other_space), json=manual)).status_code == 404

        ai = f"/api/v1/workspaces/{workspace}/ai"
        provider_id = uuid4()
        response = await owner.post(
            ai + "/providers",
            json={
                "id": str(provider_id),
                "name": "Synthetic link provider",
                "provider_type": "openai_compatible",
                "base_url": "https://api.example.com/v1",
                "credential": uuid4().hex,
                "enabled": True,
                "timeout_seconds": 30,
                "max_retries": 0,
            },
        )
        assert response.status_code == 201, response.text
        model = await owner.post(
            ai + "/models",
            json={
                "id": str(uuid4()),
                "provider_id": str(provider_id),
                "provider_model_id": "synthetic-quality",
                "display_name": "Synthetic",
                "enabled": True,
                "supports_json": True,
                "supports_stream": False,
                "context_window": 32000,
                "pricing_currency": "USD",
                "input_cost_per_million_minor": 1,
                "output_cost_per_million_minor": 1,
            },
        )
        assert model.status_code == 201, model.text
        async with session_factory() as db:
            provider = await db.get(AIProvider, provider_id)
            assert provider
            provider.last_health_status = "healthy"
            await db.commit()
        response = await owner.post(
            f"/api/v1/workspaces/{workspace}/research/ai/presets",
            json={
                "economical_model_ids": [model.json()["id"]],
                "quality_model_ids": [model.json()["id"]],
            },
        )
        assert response.status_code == 201, response.text
        outgoing = []
        output = {
            "links": json.dumps(
                [
                    {
                        "from_source": "source_1",
                        "to_source": "source_0",
                        "relation": "addresses",
                        "reason": "Addresses the supplied question.",
                    },
                    {
                        "from_source": "source_2",
                        "to_source": "source_1",
                        "relation": "contradicts",
                        "reason": "Contrasts with the supplied result.",
                    },
                ]
            )
        }

        async def resolve(_host: str, _port: int):
            return ["93.184.216.34"]

        def provider_mock(request: httpx.Request):
            content = request.content.decode()
            assert "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND" not in content
            assert idea["id"] not in content and manual_edge["id"] not in content
            outgoing.append(content)
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": json.dumps(output)}}],
                    "usage": {"prompt_tokens": 40, "completion_tokens": 30},
                },
            )

        execution = AIExecutionService(
            settings,
            adapter_factory=lambda: OpenAICompatibleGenerationAdapter(
                resolver=resolve,
                transport_factory=lambda: httpx.MockTransport(provider_mock),
            ),
        )

        def generation():
            return {
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "task_type": "link_suggest",
                "target": {
                    "entity_type": "research_question",
                    "id": question["id"],
                    "version": question["version"],
                },
                "context_entities": [
                    {"entity_type": "resource", "id": source["id"], "version": source["version"]}
                    for source in sources
                ],
                "expected_output_fields": ["links"],
                "requested_output_tokens": 1500,
                "send_confirmed": True,
            }

        async def queued():
            response = await owner.post(scope + "/research/ai/runs", json=generation())
            assert response.status_code == 202, response.text
            run_id = UUID(response.json()["id"])
            async with session_factory() as db:
                run = await db.get(AIRun, run_id)
                assert run
                run.status = "running"
                await db.commit()
            return run_id

        async def result(run_id):
            await execution.execute_run(run_id)
            response = await owner.get(f"/api/v1/workspaces/{workspace}/research/ai/runs/{run_id}")
            assert response.status_code == 200, response.text
            return response.json()

        blocked = generation()
        blocked["context_entities"].append(
            {"entity_type": "research_idea", "id": idea["id"], "version": 1}
        )
        assert (await owner.post(scope + "/research/ai/runs", json=blocked)).json()[
            "code"
        ] == "AI_PRIVATE_CONTENT_BLOCKED"
        assert outgoing == []
        run1, run2 = await queued(), await queued()
        results = await asyncio.gather(result(run1), result(run2))
        assert all(item["run"]["status"] == "succeeded" for item in results), results
        assert sorted(
            len(json.loads(item["draft"]["structured_output"]["links"])) for item in results
        ) == [0, 2]
        listing = (await owner.get(edges)).json()["edges"]
        suggested = [edge for edge in listing if edge["status"] == "suggested"]
        assert len(suggested) == 2 and len(listing) == 3
        assert all(edge["origin"] == "ai" and edge["ai_run_id"] for edge in suggested)
        assert (await peer.get(edges)).json()["edges"] == []
        for edge, status in zip(suggested, ("confirmed", "rejected"), strict=True):
            body = {"status": status, "expected_version": edge["version"]}
            path = edges + f"/{edge['id']}/decision"
            assert (await peer.post(path, json=body)).status_code == 404
            raced = await asyncio.gather(owner.post(path, json=body), owner.post(path, json=body))
            assert sorted(item.status_code for item in raced) == [200, 409]
        regenerated = await result(await queued())
        assert regenerated["run"]["status"] == "succeeded", regenerated
        assert json.loads(regenerated["draft"]["structured_output"]["links"]) == []
        assert len((await owner.get(edges)).json()["edges"]) == 2
        graph_path = scope + "/research/knowledge/graph"
        graph = (await owner.get(graph_path)).json()
        assert len(graph["nodes"]) == 4 and len(graph["edges"]) == 2, graph
        assert graph["truncated"] is False
        assert (await peer.get(graph_path)).json()["nodes"] == []
        focus = {"focus_type": "question", "focus_id": question["id"]}
        assert (await peer.get(graph_path, params=focus)).status_code == 404
        assert (
            await owner.get(graph_path.replace(space, other_space), params=focus)
        ).status_code == 404
        focused = (await owner.get(graph_path, params=focus)).json()
        assert focused["nodes"][0]["id"] == question["id"]
        assert sources[1]["id"] not in {node["id"] for node in focused["nodes"]}
        assert idea["id"] in {node["id"] for node in focused["nodes"]}

        # Valid-looking suggestions followed by a fabricated label fail atomically.
        output = {
            "links": json.dumps(
                [
                    {
                        "from_source": "source_2",
                        "to_source": "source_0",
                        "relation": "addresses",
                        "reason": "A new link.",
                    },
                    {
                        "from_source": "source_31",
                        "to_source": "source_0",
                        "relation": "addresses",
                        "reason": "Fabricated.",
                    },
                ]
            )
        }
        failed = await result(await queued())
        assert failed["run"]["error_code"] == "AI_DRAFT_SCHEMA_INVALID", failed
        assert failed["draft"] is None and failed["run"]["actual_input_tokens"] == 40
        async with session_factory() as db:
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(KnowledgeEdge)
                    .where(KnowledgeEdge.user_id == users[0])
                )
                == 3
            )
            events = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == users[0],
                        AuditEvent.event_type.like("research.link_%"),
                    )
                )
            )
            assert events and all(
                e.workspace_id is None and e.target_id is None and not e.event_metadata
                for e in events
            )

        # Large graphs stay bounded and private even with shared endpoints.
        async with session_factory() as db:
            shared = Resource(
                workspace_id=UUID(workspace),
                space_id=UUID(space),
                title="Shared legacy source",
                resource_type="link",
                created_by=users[0],
                updated_by=users[0],
            )
            db.add(shared)
            papers = [
                Resource(
                    workspace_id=UUID(workspace),
                    space_id=UUID(space),
                    title=f"Graph source {i}",
                    resource_type="paper",
                    research_owner_id=users[0],
                    created_by=users[0],
                    updated_by=users[0],
                )
                for i in range(210)
            ]
            db.add_all(papers)
            await db.flush()
            for paper in [shared, *papers]:
                for relation in ("extends", "contradicts", "supersedes"):
                    db.add(
                        KnowledgeEdge(
                            workspace_id=UUID(workspace),
                            space_id=UUID(space),
                            user_id=users[0],
                            from_resource_id=paper.id,
                            to_resource_id=UUID(sources[0]["id"]),
                            relation=relation,
                            status="confirmed",
                            origin="user",
                            reason="Synthetic",
                        )
                    )
            await db.commit()
            shared_id = str(shared.id)
        writes: list[str] = []

        def capture_write(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
            if statement.lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE ")):
                writes.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", capture_write)
        try:
            capped = await owner.get(graph_path)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_write)
        assert capped.status_code == 200, capped.text
        snapshot = capped.json()
        assert len(snapshot["nodes"]) == 200 and len(snapshot["edges"]) == 400
        assert snapshot["truncated"] and writes == []
        peer_graph = (await peer.get(graph_path)).json()
        assert [node["id"] for node in peer_graph["nodes"]] == [shared_id]
        assert peer_graph["edges"] == []

        # Pending requests re-authorize before any provider call, including source versions.
        stale = await queued()
        before = len(outgoing)
        async with session_factory() as db:
            q = await db.get(ResearchQuestion, UUID(question["id"]))
            assert q
            q.version += 1
            question["version"] = q.version
            await db.commit()
        failed = await result(stale)
        assert failed["run"]["error_code"] == "RESOURCE_VERSION_CONFLICT"
        assert len(outgoing) == before
        revoked = await queued()
        async with session_factory() as db:
            membership = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == UUID(workspace),
                    WorkspaceMembership.user_id == users[0],
                )
            )
            assert membership
            membership.status = "suspended"
            await db.commit()
        await execution.execute_run(revoked)
        assert len(outgoing) == before
        async with session_factory() as db:
            run = await db.get(AIRun, revoked)
            assert run and run.status == "failed" and run.error_code == "RESOURCE_NOT_FOUND"
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(graph_path)).status_code == 404
        for method, suffix, body in (
            ("GET", "", None),
            ("POST", "", manual),
            (
                "POST",
                f"/{manual_edge['id']}/decision",
                {"status": "rejected", "expected_version": 1},
            ),
        ):
            assert (await owner.request(method, edges + suffix, json=body)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_edge_migration_scope_constraints_roundtrip_and_data_refusal() -> None:
    spec = importlib.util.spec_from_file_location("edge_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"edge_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE spaces (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "UNIQUE(id,workspace_id))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE ai_runs (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "UNIQUE(id,workspace_id))"
        )
        for table in (
            "resources",
            "topics",
            "source_excerpts",
            "research_claims",
            "research_questions",
            "research_ideas",
        ):
            connection.exec_driver_sql(
                f"CREATE TABLE {table} (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
                "space_id uuid NOT NULL, user_id uuid NOT NULL, UNIQUE(id,workspace_id,space_id))"
            )
            if table in {"research_claims", "research_questions"}:
                connection.exec_driver_sql(
                    f"ALTER TABLE {table} ADD UNIQUE(id,workspace_id,space_id,user_id)"
                )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            migration.upgrade()
            user, workspace, space, resource, question, idea, run = [uuid4() for _ in range(7)]
            params = dict(
                user=user, workspace=workspace, space=space, resource=resource, idea=idea, run=run
            )
            connection.execute(text("INSERT INTO users VALUES (:user)"), params)
            connection.execute(text("INSERT INTO spaces VALUES (:space,:workspace)"), params)
            connection.execute(text("INSERT INTO ai_runs VALUES (:run,:workspace)"), params)
            metadata = MetaData()
            for table, identity in (
                ("resources", resource),
                ("research_questions", question),
                ("research_ideas", idea),
            ):
                target = Table(table, metadata, autoload_with=connection)
                connection.execute(
                    target.insert().values(
                        id=identity, workspace_id=workspace, space_id=space, user_id=user
                    )
                )
            edge_table = Table("knowledge_edges", metadata, autoload_with=connection)
            values = dict(
                id=uuid4(),
                workspace_id=workspace,
                space_id=space,
                user_id=user,
                from_resource_id=resource,
                to_question_id=question,
                relation="addresses",
                status="rejected",
                origin="user",
                reason="Owner rejected",
                version=1,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            connection.execute(edge_table.insert().values(**values))
            for sql in (
                "UPDATE knowledge_edges SET relation='prerequisite'",
                "UPDATE knowledge_edges SET from_resource_id=NULL",
                "UPDATE knowledge_edges SET space_id=gen_random_uuid()",
                "UPDATE knowledge_edges SET user_id=gen_random_uuid()",
                "UPDATE knowledge_edges SET origin='ai'",
                "UPDATE knowledge_edges SET from_idea_id=:idea",
                "UPDATE knowledge_edges SET from_resource_id=NULL,from_idea_id=:idea,"
                "to_question_id=NULL,to_resource_id=:resource,relation='inspired_by',"
                "origin='ai',ai_run_id=:run",
            ):
                with connection.begin_nested() as nested:
                    with pytest.raises(IntegrityError):
                        connection.execute(text(sql), params)
                    nested.rollback()
            with connection.begin_nested() as nested:
                with pytest.raises(IntegrityError):
                    connection.execute(edge_table.insert().values(**{**values, "id": uuid4()}))
                nested.rollback()
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
