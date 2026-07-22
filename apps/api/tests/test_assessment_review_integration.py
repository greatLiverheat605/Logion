from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.memory.models import ErrorPattern, ReviewSchedule
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_assessment_error_feedback_and_human_audit_review() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.97", 48300)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.98", 48301)),
            base_url=origin,
            headers={"Origin": origin},
        ) as learner,
    ):
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"assessment-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Assessment owner",
            },
        )
        learner_registration = await learner.post(
            "/api/v1/auth/register",
            json={
                "email": f"assessment-learner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Assessment learner",
            },
        )
        assert owner_registration.status_code == learner_registration.status_code == 201
        learner_id = UUID(learner_registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "User configured learning group", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space_id = UUID(shared.json()["id"])
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=learner_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        topic_id = uuid4()
        topic = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/topics",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(topic_id),
                "title": "User supplied assessment topic",
                "description": "sensitive topic description",
            },
        )
        assert topic.status_code == 201, topic.text
        quiz_id = uuid4()
        created = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/quiz-items",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(quiz_id),
                "topic_id": str(topic_id),
                "prompt": "sensitive quiz prompt",
                "answer_key": "Expected Answer",
                "explanation": "sensitive answer explanation",
                "evaluation_mode": "exact_match",
            },
        )
        assert created.status_code == 201, created.text
        assert "answer_key" not in created.json()
        listed = await learner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/quiz-items"
        )
        assert listed.status_code == 200
        assert "answer_key" not in listed.json()["quiz_items"][0]
        forbidden_create = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/quiz-items",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "id": str(uuid4()),
                "topic_id": str(topic_id),
                "prompt": "forbidden",
                "answer_key": "forbidden",
                "evaluation_mode": "exact_match",
            },
        )
        assert forbidden_create.status_code == 403

        pattern_id, schedule_id = uuid4(), uuid4()

        async def wrong_attempt(attempt_id: UUID):
            return await learner.post(
                f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/quiz-items/{quiz_id}/attempts",
                headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
                json={
                    "id": str(attempt_id),
                    "error_pattern_id": str(pattern_id),
                    "schedule_id": str(schedule_id),
                    "response_text": "private wrong response",
                    "confidence": 4,
                    "duration_seconds": 25,
                    "self_assessed_correct": None,
                    "error_cause": "concept_confusion",
                },
            )

        first_attempt = await wrong_attempt(uuid4())
        assert first_attempt.status_code == 201, first_attempt.text
        assert first_attempt.json()["is_correct"] is False
        assert first_attempt.json()["answer_key"] == "Expected Answer"
        assert first_attempt.json()["error_pattern"]["occurrence_count"] == 1
        assert first_attempt.json()["review_schedule"]["source"] == "quiz_error"
        assert first_attempt.json()["review_schedule"]["status"] == "due"
        second_attempt = await wrong_attempt(uuid4())
        assert second_attempt.status_code == 201, second_attempt.text
        assert second_attempt.json()["error_pattern"]["occurrence_count"] == 2

        learner_patterns = await learner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/error-patterns"
        )
        assert learner_patterns.status_code == 200
        assert learner_patterns.json()["error_patterns"][0]["id"] == str(pattern_id)
        owner_patterns = await owner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/error-patterns"
        )
        assert owner_patterns.status_code == 200
        assert owner_patterns.json()["error_patterns"] == []
        foreign_pattern_write = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/error-patterns/{pattern_id}/resolution",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"expected_version": 2},
        )
        assert foreign_pattern_write.status_code == 404
        pattern_resolved = await learner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/error-patterns/{pattern_id}/resolution",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={"expected_version": 2},
        )
        assert pattern_resolved.status_code == 200, pattern_resolved.text
        assert pattern_resolved.json()["status"] == "resolved"

        owner_attempts = await owner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/quiz-attempts"
        )
        assert owner_attempts.status_code == 200
        assert owner_attempts.json()["attempts"] == []

        review_id, finding_id = uuid4(), uuid4()
        review = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "id": str(review_id),
                "cadence": "daily",
                "period_start": str(date(2026, 7, 22)),
                "period_end": str(date(2026, 7, 22)),
                "summary": "private draft summary",
            },
        )
        assert review.status_code == 201, review.text
        finding = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews/{review_id}/findings",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "id": str(finding_id),
                "category": "error_pattern",
                "description": "private finding description",
                "suggested_action": "private next action",
            },
        )
        assert finding.status_code == 201, finding.text
        owner_reviews = await owner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews"
        )
        assert owner_reviews.status_code == 200
        assert owner_reviews.json()["reviews"] == []
        foreign_review_completion = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews/{review_id}/completion",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"expected_version": 1, "summary": "must not be accepted"},
        )
        assert foreign_review_completion.status_code == 404
        completed = await learner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews/{review_id}/completion",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={"expected_version": 1, "summary": "private final review summary"},
        )
        assert completed.status_code == 200, completed.text
        assert completed.json()["status"] == "completed"
        late_finding = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews/{review_id}/findings",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "id": str(uuid4()),
                "category": "progress",
                "description": "must not be accepted",
                "suggested_action": "",
            },
        )
        assert late_finding.status_code == 409
        resolved = await learner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/audit-reviews/{review_id}/findings/{finding_id}/resolution",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={"expected_version": 1},
        )
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["status"] == "resolved"

    async with session_factory() as db:
        pattern = await db.get(ErrorPattern, pattern_id)
        schedule = await db.get(ReviewSchedule, schedule_id)
        assert pattern is not None and pattern.user_id == learner_id
        assert pattern.occurrence_count == 2 and pattern.status == "resolved"
        assert schedule is not None and schedule.user_id == learner_id
        audits = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        serialized = " ".join(str(item.event_metadata) for item in audits)
        assert "sensitive quiz prompt" not in serialized
        assert "Expected Answer" not in serialized
        assert "private wrong response" not in serialized
        assert "private finding description" not in serialized
