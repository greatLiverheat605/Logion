import asyncio
from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.models import AIOutputDraft, AIOutputDraftCandidate, AIRun, AITaskRoute
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.knowledge_space.models import KnowledgeAcceptanceReceipt, KnowledgeCitation
from logion_api.knowledge_space.schemas import KnowledgeDraftAcceptanceRequest
from logion_api.knowledge_space.service import KnowledgeService
from logion_api.main import app
from logion_api.memory.models import Topic
from sqlalchemy import select

ORIGIN = "http://test"
PASSWORD = "a-strong-password-123"  # noqa: S105 - test-only credential


@pytest.fixture
def _knowledge_space_api_enabled() -> Iterator[None]:
    base_settings = get_settings()
    original_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "knowledge_space_api_enabled": True,
            "knowledge_space_ai_acceptance_enabled": True,
        }
    )
    try:
        yield
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def _register(client: AsyncClient, label: str) -> tuple[UUID, UUID]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"acceptance-{label}-{uuid4()}@example.com",
            "password": PASSWORD,
            "device_name": label,
        },
    )
    assert response.status_code == 201, response.text
    user_id = UUID(response.json()["user"]["id"])
    workspaces = await client.get("/api/v1/workspaces")
    assert workspaces.status_code == 200, workspaces.text
    return user_id, UUID(workspaces.json()["workspaces"][0]["id"])


async def _private_space(client: AsyncClient, workspace_id: UUID) -> UUID:
    response = await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")
    assert response.status_code == 200, response.text
    return UUID(
        next(item["id"] for item in response.json()["spaces"] if item["visibility"] == "private")
    )


def _csrf(client: AsyncClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["logion_csrf"]}


def _payload(
    *,
    workspace_id: UUID,
    space_id: UUID,
    draft_id: UUID,
    candidate_id: UUID,
    target_id: UUID,
    excerpt_id: UUID,
    excerpt_sha256: str,
    expected_draft_version: int = 1,
    expected_excerpt_version: int = 1,
    accepted_edits: dict[str, str] | None = None,
) -> dict[str, object]:
    body: dict[str, object] = {
        "idempotency_key": str(uuid4()),
        "payload_sha256": "0" * 64,
        "expected_draft_version": expected_draft_version,
        "accepted_candidate_ids": [str(candidate_id)],
        "target_expectations": [
            {"target_type": "topic", "target_id": str(target_id), "expected_version": 1}
        ],
        "excerpt_expectations": [
            {
                "excerpt_id": str(excerpt_id),
                "expected_version": expected_excerpt_version,
                "expected_excerpt_sha256": excerpt_sha256,
                "expected_source_version_key": "version-1",
            }
        ],
        "accepted_edits": accepted_edits,
    }
    request = KnowledgeDraftAcceptanceRequest.model_validate(body)
    body["payload_sha256"] = KnowledgeService.acceptance_payload_sha256(
        workspace_id,
        space_id,
        draft_id,
        request,
    )
    return body


@pytest.mark.integration
@pytest.mark.asyncio
async def test_acceptance_is_atomic_and_idempotent(_knowledge_space_api_enabled: None) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.59", 48204)),
        base_url=ORIGIN,
        headers={"Origin": ORIGIN},
    ) as client:
        user_id, workspace_id = await _register(client, "owner")
        space_id = await _private_space(client, workspace_id)
        resource_id, topic_id = uuid4(), uuid4()
        excerpt_id, draft_id, candidate_id, run_id, route_id = (uuid4() for _ in range(5))
        async with session_factory() as db:
            db.add_all(
                [
                    Resource(
                        id=resource_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        resource_type="link",
                        title="Acceptance source",
                        source_url="https://example.com/acceptance",
                        created_by=user_id,
                        updated_by=user_id,
                    ),
                    Topic(
                        id=topic_id,
                        workspace_id=workspace_id,
                        space_id=space_id,
                        title="Acceptance target",
                        created_by=user_id,
                        updated_by=user_id,
                    ),
                    AITaskRoute(
                        id=route_id,
                        workspace_id=workspace_id,
                        name="Knowledge route",
                        normalized_name="knowledge-route",
                        task_type="knowledge.extract",
                        max_input_tokens=100,
                        max_output_tokens=100,
                        created_by=user_id,
                        updated_by=user_id,
                    ),
                ]
            )
            await db.flush()
            db.add(
                AIRun(
                    id=run_id,
                    workspace_id=workspace_id,
                    route_id=route_id,
                    task_type="knowledge.extract",
                    target_type="topic",
                    target_id=topic_id,
                    target_version=1,
                    selected_fields=["title"],
                    expected_output_fields=["summary"],
                    prompt_version="test-v1",
                    prompt_hash="b" * 64,
                    idempotency_key=uuid4(),
                    request_hash="c" * 64,
                    status="succeeded",
                    estimated_input_tokens=1,
                    requested_output_tokens=1,
                    reserved_tokens=1,
                    reserved_cost_minor=0,
                    currency="CNY",
                    attempt_count=1,
                    requested_by=user_id,
                )
            )
            await db.flush()
            db.add(
                AIOutputDraft(
                    id=draft_id,
                    workspace_id=workspace_id,
                    run_id=run_id,
                    target_type="topic",
                    target_id=topic_id,
                    target_version=1,
                    structured_output={"summary": "draft"},
                )
            )
            await db.flush()
            await db.commit()
        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge"
        excerpt = await client.post(
            f"{base}/source-excerpts",
            headers=_csrf(client),
            json={
                "id": str(excerpt_id),
                "resource_id": str(resource_id),
                "excerpt_text": "immutable evidence",
                "locator": {"page_start": 1, "page_end": 1},
                "source_version_key": "version-1",
                "source_version_sha256": "d" * 64,
            },
        )
        assert excerpt.status_code == 201, excerpt.text
        excerpt_sha256 = excerpt.json()["excerpt_sha256"]
        async with session_factory() as db:
            db.add(
                AIOutputDraftCandidate(
                    id=candidate_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    draft_id=draft_id,
                    source_excerpt_id=excerpt_id,
                    target_type="topic",
                    target_id=topic_id,
                    relationship_kind="source",
                    target_version=1,
                    excerpt_version=1,
                    excerpt_sha256=excerpt_sha256,
                    source_version_key="version-1",
                )
            )
            await db.commit()

        payload = _payload(
            workspace_id=workspace_id,
            space_id=space_id,
            draft_id=draft_id,
            candidate_id=candidate_id,
            target_id=topic_id,
            excerpt_id=excerpt_id,
            excerpt_sha256=excerpt_sha256,
            accepted_edits={"summary": "approved"},
        )
        accepted, replay = await asyncio.gather(
            client.post(
                f"{base}/drafts/{draft_id}/acceptances",
                headers=_csrf(client),
                json=payload,
            ),
            client.post(
                f"{base}/drafts/{draft_id}/acceptances",
                headers=_csrf(client),
                json=payload,
            ),
        )
        assert accepted.status_code == 200, accepted.text
        receipt = accepted.json()
        assert replay.status_code == 200, replay.text
        assert replay.json() == receipt

        conflicting = dict(payload)
        conflicting["accepted_edits"] = {"summary": "different"}
        conflicting_request = KnowledgeDraftAcceptanceRequest.model_validate(conflicting)
        conflicting["payload_sha256"] = KnowledgeService.acceptance_payload_sha256(
            workspace_id,
            space_id,
            draft_id,
            conflicting_request,
        )
        conflict = await client.post(
            f"{base}/drafts/{draft_id}/acceptances",
            headers=_csrf(client),
            json=conflicting,
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "KNOWLEDGE_IDEMPOTENCY_CONFLICT"

        async with session_factory() as db:
            candidates = await db.scalars(
                select(AIOutputDraftCandidate).where(
                    AIOutputDraftCandidate.workspace_id == workspace_id,
                )
            )
            assert len(candidates.all()) == 1
            draft = await db.get(AIOutputDraft, draft_id)
            assert draft is not None and draft.status == "accepted"

        stale_run_id, stale_draft_id, stale_candidate_id = uuid4(), uuid4(), uuid4()
        async with session_factory() as db:
            db.add(
                AIRun(
                    id=stale_run_id,
                    workspace_id=workspace_id,
                    route_id=route_id,
                    task_type="knowledge.extract",
                    target_type="topic",
                    target_id=topic_id,
                    target_version=1,
                    selected_fields=["title"],
                    expected_output_fields=["summary"],
                    prompt_version="test-v1",
                    prompt_hash="e" * 64,
                    idempotency_key=uuid4(),
                    request_hash="f" * 64,
                    status="succeeded",
                    estimated_input_tokens=1,
                    requested_output_tokens=1,
                    reserved_tokens=1,
                    reserved_cost_minor=0,
                    currency="CNY",
                    attempt_count=1,
                    requested_by=user_id,
                )
            )
            await db.flush()
            db.add(
                AIOutputDraft(
                    id=stale_draft_id,
                    workspace_id=workspace_id,
                    run_id=stale_run_id,
                    target_type="topic",
                    target_id=topic_id,
                    target_version=1,
                    structured_output={"summary": "draft"},
                )
            )
            await db.flush()
            db.add(
                AIOutputDraftCandidate(
                    id=stale_candidate_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    draft_id=stale_draft_id,
                    source_excerpt_id=excerpt_id,
                    target_type="topic",
                    target_id=topic_id,
                    relationship_kind="definition",
                    target_version=1,
                    excerpt_version=1,
                    excerpt_sha256=excerpt_sha256,
                    source_version_key="version-1",
                )
            )
            await db.commit()

        stale_payload = _payload(
            workspace_id=workspace_id,
            space_id=space_id,
            draft_id=stale_draft_id,
            candidate_id=stale_candidate_id,
            target_id=topic_id,
            excerpt_id=excerpt_id,
            excerpt_sha256=excerpt_sha256,
            expected_excerpt_version=2,
            accepted_edits={"summary": "approved"},
        )
        stale = await client.post(
            f"{base}/drafts/{stale_draft_id}/acceptances",
            headers=_csrf(client),
            json=stale_payload,
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "KNOWLEDGE_VERSION_CONFLICT"
        async with session_factory() as db:
            stale_draft = await db.get(AIOutputDraft, stale_draft_id)
            assert stale_draft is not None and stale_draft.status == "pending"
            assert await db.get(KnowledgeCitation, stale_candidate_id) is None
            assert (
                await db.scalar(
                    select(KnowledgeAcceptanceReceipt.id).where(
                        KnowledgeAcceptanceReceipt.draft_id == stale_draft_id,
                    )
                )
                is None
            )


@pytest.mark.asyncio
async def test_acceptance_hash_is_order_independent() -> None:
    workspace_id, space_id, draft_id = uuid4(), uuid4(), uuid4()
    candidate_a, candidate_b = uuid4(), uuid4()
    target_a, target_b = uuid4(), uuid4()
    excerpt_a, excerpt_b = uuid4(), uuid4()
    common = {
        "idempotency_key": uuid4(),
        "payload_sha256": "0" * 64,
        "expected_draft_version": 1,
        "accepted_edits": None,
    }
    first = KnowledgeDraftAcceptanceRequest.model_validate(
        {
            **common,
            "accepted_candidate_ids": [candidate_b, candidate_a],
            "target_expectations": [
                {"target_type": "topic", "target_id": target_b, "expected_version": 1},
                {"target_type": "topic", "target_id": target_a, "expected_version": 1},
            ],
            "excerpt_expectations": [
                {
                    "excerpt_id": excerpt_b,
                    "expected_version": 1,
                    "expected_excerpt_sha256": "a" * 64,
                    "expected_source_version_key": "version-1",
                },
                {
                    "excerpt_id": excerpt_a,
                    "expected_version": 1,
                    "expected_excerpt_sha256": "a" * 64,
                    "expected_source_version_key": "version-1",
                },
            ],
        }
    )
    second = first.model_copy(
        update={
            "accepted_candidate_ids": [candidate_a, candidate_b],
            "target_expectations": list(reversed(first.target_expectations)),
            "excerpt_expectations": list(reversed(first.excerpt_expectations)),
        }
    )
    assert KnowledgeService.acceptance_payload_sha256(workspace_id, space_id, draft_id, first) == (
        KnowledgeService.acceptance_payload_sha256(workspace_id, space_id, draft_id, second)
    )
