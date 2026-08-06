from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.memory.models import Topic, TopicDependency
from logion_api.research.models import PaperRecord, ResearchClaim
from logion_api.workspaces.models import WorkspaceMembership

ORIGIN = "http://test"
PASSWORD = "a-strong-password-123"  # noqa: S105 - test-only credential


async def _register(client: AsyncClient, label: str) -> tuple[UUID, UUID]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"knowledge-{label}-{uuid4()}@example.com",
            "password": PASSWORD,
            "device_name": label,
        },
    )
    assert response.status_code == 201, response.text
    user_id = UUID(response.json()["user"]["id"])
    workspace_response = await client.get("/api/v1/workspaces")
    assert workspace_response.status_code == 200, workspace_response.text
    return user_id, UUID(workspace_response.json()["workspaces"][0]["id"])


async def _private_space(client: AsyncClient, workspace_id: UUID) -> UUID:
    response = await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")
    assert response.status_code == 200, response.text
    spaces = response.json()["spaces"]
    return UUID(next(space["id"] for space in spaces if space["visibility"] == "private"))


def _csrf(client: AsyncClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["logion_csrf"]}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_excerpt_is_scoped_and_supports_authorized_304() -> None:
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.10", 48100)),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.11", 48101)),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as other,
    ):
        owner_id, workspace_id = await _register(owner, "owner")
        _, other_workspace_id = await _register(other, "other")
        space_id = await _private_space(owner, workspace_id)

        resource_id = uuid4()
        topic_id = uuid4()
        async with session_factory() as db:
            db.add_all(
                [
                    Resource(
                        id=resource_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        resource_type="link",
                        title="Scoped source",
                        source_url="https://example.com/source",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    Topic(
                        id=topic_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        title="Scoped topic",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                ]
            )
            await db.commit()

        excerpt_id = uuid4()
        payload = {
            "id": str(excerpt_id),
            "resource_id": str(resource_id),
            "excerpt_text": "an immutable excerpt",
            "locator": {"page_start": 1, "page_end": 1},
            "source_version_key": "version-1",
            "source_version_sha256": "a" * 64,
        }
        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge"
        created = await owner.post(f"{base}/source-excerpts", headers=_csrf(owner), json=payload)
        assert created.status_code == 201, created.text
        etag = created.headers["etag"]
        fetched = await owner.get(f"{base}/source-excerpts/{excerpt_id}")
        assert fetched.status_code == 200, fetched.text
        assert fetched.json()["excerpt_text"] == "an immutable excerpt"
        not_modified = await owner.get(
            f"{base}/source-excerpts/{excerpt_id}", headers={"If-None-Match": etag}
        )
        assert not_modified.status_code == 304
        assert not_modified.headers["etag"] == etag

        citation_id = uuid4()
        citation = await owner.post(
            f"{base}/knowledge-citations",
            headers=_csrf(owner),
            json={
                "id": str(citation_id),
                "excerpt_id": str(excerpt_id),
                "target": {"topic_id": str(topic_id)},
                "relationship": "source",
            },
        )
        assert citation.status_code == 201, citation.text
        citation_etag = citation.headers["etag"]
        citation_not_modified = await owner.get(
            f"{base}/knowledge-citations/{citation_id}",
            headers={"If-None-Match": citation_etag},
        )
        assert citation_not_modified.status_code == 304
        citations = await owner.get(f"{base}/knowledge-citations", params={"page_size": 25})
        assert citations.status_code == 200, citations.text
        assert [item["id"] for item in citations.json()["citations"]] == [str(citation_id)]
        assert citations.json()["next_cursor"] is None

        hidden = await other.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge/source-excerpts/{excerpt_id}"
        )
        assert hidden.status_code == 404
        assert other_workspace_id != workspace_id


@pytest.mark.integration
@pytest.mark.asyncio
async def test_shared_write_stays_closed_and_graph_is_bounded() -> None:
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.12", 48102)),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.13", 48103)),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as other,
    ):
        owner_id, workspace_id = await _register(owner, "graph")
        other_id, _other_workspace_id = await _register(other, "claim-other")
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers=_csrf(owner),
            json={"name": "Shared graph", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space_id = UUID(shared.json()["id"])
        other_space_response = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers=_csrf(owner),
            json={"name": "Other graph", "visibility": "shared"},
        )
        assert other_space_response.status_code == 201, other_space_response.text
        other_space_id = UUID(other_space_response.json()["id"])

        resource_id = uuid4()
        root_id, child_id, grandchild_id, other_space_topic_id = (
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
        )
        owner_paper_id, other_paper_id = uuid4(), uuid4()
        owner_claim_id, other_claim_id = uuid4(), uuid4()
        async with session_factory() as db:
            db.add_all(
                [
                    Resource(
                        id=resource_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        resource_type="link",
                        title="Shared source",
                        source_url="https://example.com/shared",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    WorkspaceMembership(
                        workspace_id=workspace_id,
                        user_id=other_id,
                        role="viewer",
                        status="active",
                    ),
                    PaperRecord(
                        id=owner_paper_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        user_id=owner_id,
                        title="Owner claim paper",
                        citation_key="owner-claim-paper",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    PaperRecord(
                        id=other_paper_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        user_id=other_id,
                        title="Other claim paper",
                        citation_key="other-claim-paper",
                        created_by=other_id,
                        updated_by=other_id,
                    ),
                    ResearchClaim(
                        id=owner_claim_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        user_id=owner_id,
                        paper_id=owner_paper_id,
                        statement="Owner private claim",
                        stance="supports",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    ResearchClaim(
                        id=other_claim_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        user_id=other_id,
                        paper_id=other_paper_id,
                        statement="Other private claim",
                        stance="supports",
                        created_by=other_id,
                        updated_by=other_id,
                    ),
                    Topic(
                        id=root_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        title="Root root",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    Topic(
                        id=child_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        title="Root child",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    Topic(
                        id=grandchild_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        title="Root grandchild",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    Topic(
                        id=other_space_topic_id,
                        workspace_id=workspace_id,
                        space_id=other_space_id,
                        title="Root external space",
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    TopicDependency(
                        id=uuid4(),
                        workspace_id=workspace_id,
                        space_id=space_id,
                        prerequisite_topic_id=root_id,
                        dependent_topic_id=child_id,
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                    TopicDependency(
                        id=uuid4(),
                        workspace_id=workspace_id,
                        space_id=space_id,
                        prerequisite_topic_id=child_id,
                        dependent_topic_id=grandchild_id,
                        created_by=owner_id,
                        updated_by=owner_id,
                    ),
                ]
            )
            await db.commit()

        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge"
        excerpt = await owner.post(
            f"{base}/source-excerpts",
            headers=_csrf(owner),
            json={
                "id": str(uuid4()),
                "resource_id": str(resource_id),
                "excerpt_text": "shared evidence",
                "locator": {"section": "intro"},
                "source_version_key": "v1",
                "source_version_sha256": "b" * 64,
            },
        )
        assert excerpt.status_code == 403
        assert excerpt.json()["code"] == "KNOWLEDGE_SHARED_WRITES_DISABLED"

        graph = await owner.get(
            f"{base}/graph",
            params={"root_type": "topic", "root_id": str(root_id), "depth": 2, "direction": "out"},
        )
        assert graph.status_code == 200, graph.text
        body = graph.json()
        assert body["nodes"][0]["id"] == str(root_id)
        assert {node["id"] for node in body["nodes"]} == {
            str(root_id),
            str(child_id),
            str(grandchild_id),
        }
        assert len(body["edges"]) == 2
        assert body["truncated"] is False

        search = await owner.post(
            f"{base}/search",
            json={"query": "root", "target_types": ["topic"], "limit": 1},
        )
        assert search.status_code == 200, search.text
        search_body = search.json()
        assert [item["id"] for item in search_body["results"]] == [str(root_id)]
        assert search_body["results"][0]["target_type"] == "topic"
        assert search_body["next_cursor"]
        next_page = await owner.post(
            f"{base}/search",
            params={"cursor": search_body["next_cursor"]},
            json={"query": "root", "target_types": ["topic"], "limit": 1},
        )
        assert next_page.status_code == 200, next_page.text
        assert next_page.json()["results"][0]["id"] != str(root_id)

        scoped_search = await owner.post(
            f"{base}/search",
            json={"query": "root", "target_types": ["topic"], "limit": 50},
        )
        assert scoped_search.status_code == 200, scoped_search.text
        scoped_ids = {item["id"] for item in scoped_search.json()["results"]}
        assert str(other_space_topic_id) not in scoped_ids

        claim_search = await owner.post(
            f"{base}/search",
            json={"query": "claim", "target_types": ["research_claim"], "limit": 50},
        )
        assert claim_search.status_code == 200, claim_search.text
        claim_ids = {item["id"] for item in claim_search.json()["results"]}
        assert claim_ids == {str(owner_claim_id)}
