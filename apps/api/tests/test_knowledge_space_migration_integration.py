from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from logion_api.db import engine  # type: ignore[import-untyped]
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.sql.base import Executable

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

_INSERT_EXCERPT = text(
    """
    INSERT INTO source_excerpts (
        id, workspace_id, space_id, resource_id, resource_version,
        source_version_key, source_version_sha256, excerpt_text, excerpt_sha256,
        hash_algorithm, normalization_version, page_start, page_end,
        char_start, char_end, section_locator, status, version,
        created_by, updated_by, stale_at, deleted_at
    ) VALUES (
        :id, :workspace_id, :space_id, :resource_id, :resource_version,
        :source_version_key, :source_version_sha256, :excerpt_text, :excerpt_sha256,
        :hash_algorithm, :normalization_version, :page_start, :page_end,
        :char_start, :char_end, :section_locator, :status, :version,
        :created_by, :updated_by, :stale_at, :deleted_at
    )
    """
)

_INSERT_CITATION = text(
    """
    INSERT INTO knowledge_citations (
        id, workspace_id, space_id, source_excerpt_id, relationship_kind,
        relation_note, topic_id, quiz_item_id, research_claim_id,
        research_claim_user_id, note_id, accepted_draft_id,
        acceptance_operation_id, accepted_by, accepted_at, status, version,
        created_by, closed_by, closed_at, close_reason, deleted_at
    ) VALUES (
        :id, :workspace_id, :space_id, :source_excerpt_id, :relationship_kind,
        :relation_note, :topic_id, :quiz_item_id, :research_claim_id,
        :research_claim_user_id, :note_id, :accepted_draft_id,
        :acceptance_operation_id, :accepted_by, :accepted_at, :status, :version,
        :created_by, :closed_by, :closed_at, :close_reason, :deleted_at
    )
    """
)


@dataclass(frozen=True)
class ScopeSeed:
    user_id: UUID
    workspace_id: UUID
    space_id: UUID
    resource_id: UUID
    note_id: UUID
    topic_id: UUID
    quiz_item_id: UUID
    paper_id: UUID
    claim_id: UUID
    route_id: UUID
    run_id: UUID
    draft_id: UUID


@asynccontextmanager
async def _rolled_back_connection() -> AsyncIterator[AsyncConnection]:
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            yield connection
        finally:
            await transaction.rollback()


async def _seed_scope(connection: AsyncConnection, label: str) -> ScopeSeed:
    seed = ScopeSeed(*(uuid4() for _ in range(12)))
    email = f"v020-{label}-{uuid4()}@example.test"
    common = {"user_id": seed.user_id, "workspace_id": seed.workspace_id}
    await connection.execute(
        text(
            """
            INSERT INTO users (id, email, email_normalized, status, version)
            VALUES (:user_id, :email, :email, 'active', 1)
            """
        ),
        {"user_id": seed.user_id, "email": email},
    )
    await connection.execute(
        text(
            """
            INSERT INTO workspaces (id, name, created_by)
            VALUES (:workspace_id, :name, :user_id)
            """
        ),
        {**common, "name": f"V20 proof {label}"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO spaces (
                id, workspace_id, owner_user_id, name, visibility, created_by, updated_by
            ) VALUES (
                :space_id, :workspace_id, :user_id, :name, 'private', :user_id, :user_id
            )
            """
        ),
        {**common, "space_id": seed.space_id, "name": f"Proof space {label}"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO resources (
                id, workspace_id, space_id, resource_type, title, created_by, updated_by
            ) VALUES (
                :resource_id, :workspace_id, :space_id, 'link', :title, :user_id, :user_id
            )
            """
        ),
        {**common, **seed.__dict__, "title": f"Proof resource {label}"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO notes (
                id, workspace_id, space_id, title, created_by, updated_by, yjs_state
            ) VALUES (
                :note_id, :workspace_id, :space_id, :title, :user_id, :user_id, :yjs_state
            )
            """
        ),
        {**common, **seed.__dict__, "title": f"Proof note {label}", "yjs_state": b"\x00"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO topics (
                id, workspace_id, space_id, title, created_by, updated_by
            ) VALUES (
                :topic_id, :workspace_id, :space_id, :title, :user_id, :user_id
            )
            """
        ),
        {**common, **seed.__dict__, "title": f"Proof topic {label}"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO quiz_items (
                id, workspace_id, space_id, topic_id, prompt, answer_key,
                evaluation_mode, created_by, updated_by
            ) VALUES (
                :quiz_item_id, :workspace_id, :space_id, :topic_id, :prompt, :answer,
                'exact_match', :user_id, :user_id
            )
            """
        ),
        {**common, **seed.__dict__, "prompt": f"Question {label}", "answer": "Answer"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO paper_records (
                id, workspace_id, space_id, user_id, created_by, updated_by,
                title, citation_key
            ) VALUES (
                :paper_id, :workspace_id, :space_id, :user_id, :user_id, :user_id,
                :title, :citation_key
            )
            """
        ),
        {
            **common,
            **seed.__dict__,
            "title": f"Proof paper {label}",
            "citation_key": f"proof-{label}-{uuid4()}",
        },
    )
    await connection.execute(
        text(
            """
            INSERT INTO research_claims (
                id, workspace_id, space_id, user_id, created_by, updated_by,
                paper_id, statement, stance
            ) VALUES (
                :claim_id, :workspace_id, :space_id, :user_id, :user_id, :user_id,
                :paper_id, :statement, 'supports'
            )
            """
        ),
        {**common, **seed.__dict__, "statement": f"Proof claim {label}"},
    )
    await connection.execute(
        text(
            """
            INSERT INTO ai_task_routes (
                id, workspace_id, name, normalized_name, task_type,
                max_input_tokens, max_output_tokens, created_by, updated_by
            ) VALUES (
                :route_id, :workspace_id, :route_name, :route_name, :task_type,
                1024, 512, :user_id, :user_id
            )
            """
        ),
        {
            **common,
            **seed.__dict__,
            "route_name": f"proof-{label}-{uuid4()}",
            "task_type": f"proof-{label}",
        },
    )
    await connection.execute(
        text(
            """
            INSERT INTO ai_runs (
                id, workspace_id, route_id, task_type, target_type, target_id,
                target_version, selected_fields, expected_output_fields,
                prompt_version, prompt_hash, idempotency_key, request_hash,
                estimated_input_tokens, requested_output_tokens, reserved_tokens,
                reserved_cost_minor, currency, requested_by, status
            ) VALUES (
                :run_id, :workspace_id, :route_id, :task_type, 'topic', :topic_id,
                1, CAST(:selected_fields AS jsonb), CAST(:expected_fields AS jsonb),
                'v1', :prompt_hash, :idempotency_key, :request_hash,
                10, 10, 20, 0, 'USD', :user_id, 'succeeded'
            )
            """
        ),
        {
            **common,
            **seed.__dict__,
            "task_type": f"proof-{label}",
            "selected_fields": "[]",
            "expected_fields": "[]",
            "prompt_hash": "a" * 64,
            "request_hash": "b" * 64,
            "idempotency_key": uuid4(),
        },
    )
    await connection.execute(
        text(
            """
            INSERT INTO ai_output_drafts (
                id, workspace_id, run_id, target_type, target_id, target_version,
                structured_output, status, decided_by, decided_at
            ) VALUES (
                :draft_id, :workspace_id, :run_id, 'topic', :topic_id, 1,
                CAST(:structured_output AS jsonb), 'accepted', :user_id, CURRENT_TIMESTAMP
            )
            """
        ),
        {**common, **seed.__dict__, "structured_output": "{}"},
    )
    return seed


def _excerpt(scope: ScopeSeed, **overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "id": uuid4(),
        "workspace_id": scope.workspace_id,
        "space_id": scope.space_id,
        "resource_id": scope.resource_id,
        "resource_version": 1,
        "source_version_key": "resource-version-1",
        "source_version_sha256": "a" * 64,
        "excerpt_text": "A bounded, immutable excerpt.",
        "excerpt_sha256": "b" * 64,
        "hash_algorithm": "sha256",
        "normalization_version": "utf8-nfc-lf-v1",
        "page_start": 1,
        "page_end": 1,
        "char_start": None,
        "char_end": None,
        "section_locator": None,
        "status": "active",
        "version": 1,
        "created_by": scope.user_id,
        "updated_by": scope.user_id,
        "stale_at": None,
        "deleted_at": None,
    }
    values.update(overrides)
    return values


def _citation(
    scope: ScopeSeed,
    excerpt_id: UUID,
    **overrides: object,
) -> dict[str, object]:
    values: dict[str, object] = {
        "id": uuid4(),
        "workspace_id": scope.workspace_id,
        "space_id": scope.space_id,
        "source_excerpt_id": excerpt_id,
        "relationship_kind": "source",
        "relation_note": None,
        "topic_id": scope.topic_id,
        "quiz_item_id": None,
        "research_claim_id": None,
        "research_claim_user_id": None,
        "note_id": None,
        "accepted_draft_id": scope.draft_id,
        "acceptance_operation_id": uuid4(),
        "accepted_by": scope.user_id,
        "accepted_at": datetime.now(UTC),
        "status": "active",
        "version": 1,
        "created_by": scope.user_id,
        "closed_by": None,
        "closed_at": None,
        "close_reason": None,
        "deleted_at": None,
    }
    values.update(overrides)
    return values


def _diagnostic(error: IntegrityError) -> tuple[str | None, str | None]:
    original = error.orig
    assert original is not None
    cause = original.__cause__
    assert cause is not None
    return (
        getattr(cause, "constraint_name", None),
        getattr(cause, "sqlstate", None) or getattr(original, "sqlstate", None),
    )


async def _assert_rejected(
    connection: AsyncConnection,
    statement: Executable,
    parameters: Mapping[str, object],
    constraint_name: str,
    sqlstate: str,
) -> None:
    with pytest.raises(IntegrityError) as caught:
        async with connection.begin_nested():
            await connection.execute(statement, parameters)
    assert _diagnostic(caught.value) == (constraint_name, sqlstate)


async def test_knowledge_space_catalog_constraints_are_validated_and_bounded() -> None:
    expected_parent_keys = {
        "uq_space_workspace",
        "uq_resource_scope",
        "uq_note_scope",
        "uq_quiz_item_scope",
        "uq_ai_output_draft_workspace",
    }
    expected_scope_foreign_keys = {
        "fk_resource_space_scope",
        "fk_note_space_scope",
        "fk_topic_space_scope",
        "fk_quiz_item_space_scope",
        "fk_paper_record_space_scope",
    }
    async with engine.connect() as connection:
        constraints = (
            await connection.execute(
                text(
                    """
                    SELECT conname, contype::text AS contype,
                           convalidated, confdeltype::text AS confdeltype
                    FROM pg_constraint
                    WHERE conname = ANY(:names)
                       OR conrelid IN (
                           'source_excerpts'::regclass,
                           'knowledge_citations'::regclass
                       )
                    """
                ),
                {"names": sorted(expected_parent_keys | expected_scope_foreign_keys)},
            )
        ).mappings()
        rows = list(constraints)
        by_name = {str(row["conname"]): row for row in rows}
        assert expected_parent_keys | expected_scope_foreign_keys <= by_name.keys()
        assert all(bool(by_name[name]["convalidated"]) for name in by_name)
        assert all(by_name[name]["contype"] == "u" for name in expected_parent_keys)
        assert all(by_name[name]["contype"] == "f" for name in expected_scope_foreign_keys)
        assert all(by_name[name]["confdeltype"] == "c" for name in expected_scope_foreign_keys)
        assert all(
            row["confdeltype"] == "r"
            for row in rows
            if row["contype"] == "f" and row["conname"] not in expected_scope_foreign_keys
        )

        indexes = list(
            (
                await connection.execute(
                    text(
                        """
                        SELECT indexname, indexdef
                        FROM pg_indexes
                        WHERE schemaname = 'public'
                          AND tablename IN ('source_excerpts', 'knowledge_citations')
                        """
                    )
                )
            ).mappings()
        )
        object_names = set(by_name) | {str(row["indexname"]) for row in indexes}
        assert max(map(len, object_names)) < 63
        active_unique_indexes = {
            str(row["indexname"]): str(row["indexdef"])
            for row in indexes
            if str(row["indexname"]).startswith("uq_knowledge_citation_active_")
        }
        assert set(active_unique_indexes) == {
            "uq_knowledge_citation_active_topic",
            "uq_knowledge_citation_active_quiz_item",
            "uq_knowledge_citation_active_research_claim",
            "uq_knowledge_citation_active_note",
        }
        assert all(
            "(status)::text = 'active'::text" in value and "IS NOT NULL" in value
            for value in active_unique_indexes.values()
        )


async def test_source_excerpt_scope_hash_locator_and_lifecycle_constraints() -> None:
    async with _rolled_back_connection() as connection:
        own = await _seed_scope(connection, "excerpt-own")
        other = await _seed_scope(connection, "excerpt-other")
        valid = _excerpt(own)
        await connection.execute(_INSERT_EXCERPT, valid)

        cases = (
            (
                {"resource_id": other.resource_id},
                "fk_source_excerpt_resource_scope",
                "23503",
            ),
            ({"resource_version": 0}, "ck_source_excerpt_resource_version", "23514"),
            ({"excerpt_text": ""}, "ck_source_excerpt_text_bounds", "23514"),
            ({"excerpt_text": "😀" * 8193}, "ck_source_excerpt_text_bounds", "23514"),
            ({"source_version_key": "é" * 257}, "ck_source_excerpt_version_key", "23514"),
            ({"source_version_sha256": "A" * 64}, "ck_source_excerpt_hashes", "23514"),
            ({"hash_algorithm": "sha512"}, "ck_source_excerpt_hash_profile", "23514"),
            (
                {"page_start": None, "page_end": None},
                "ck_source_excerpt_locator_present",
                "23514",
            ),
            ({"page_end": None}, "ck_source_excerpt_page_locator", "23514"),
            (
                {
                    "page_start": None,
                    "page_end": None,
                    "char_start": 5,
                    "char_end": None,
                },
                "ck_source_excerpt_char_locator",
                "23514",
            ),
            ({"char_start": 5, "char_end": 5}, "ck_source_excerpt_char_locator", "23514"),
            (
                {"status": "stale", "stale_at": None},
                "ck_source_excerpt_lifecycle",
                "23514",
            ),
            ({"version": 0}, "ck_source_excerpt_version", "23514"),
        )
        for overrides, constraint_name, sqlstate in cases:
            await _assert_rejected(
                connection,
                _INSERT_EXCERPT,
                _excerpt(own, **overrides),
                constraint_name,
                sqlstate,
            )


async def test_citation_typed_targets_scope_lifecycle_uniqueness_and_restrict() -> None:
    async with _rolled_back_connection() as connection:
        own = await _seed_scope(connection, "citation-own")
        other = await _seed_scope(connection, "citation-other")
        excerpt = _excerpt(own)
        await connection.execute(_INSERT_EXCERPT, excerpt)
        excerpt_id = excerpt["id"]
        assert isinstance(excerpt_id, UUID)

        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, topic_id=None),
            "ck_knowledge_citation_one_target",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, note_id=own.note_id),
            "ck_knowledge_citation_one_target",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, relationship_kind="prerequisite"),
            "ck_knowledge_citation_relationship",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, relation_note="x" * 2001),
            "ck_knowledge_citation_note_bounds",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, status="closed"),
            "ck_knowledge_citation_lifecycle",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(
                own,
                excerpt_id,
                topic_id=None,
                research_claim_id=own.claim_id,
            ),
            "ck_knowledge_citation_claim_pair",
            "23514",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(
                own,
                excerpt_id,
                topic_id=None,
                research_claim_id=own.claim_id,
                research_claim_user_id=other.user_id,
            ),
            "fk_knowledge_citation_research_claim_scope",
            "23503",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id, accepted_draft_id=other.draft_id),
            "fk_knowledge_citation_draft_workspace",
            "23503",
        )
        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(other, excerpt_id),
            "fk_knowledge_citation_excerpt_scope",
            "23503",
        )

        cross_scope_targets = (
            (
                {"topic_id": other.topic_id},
                "fk_knowledge_citation_topic_scope",
            ),
            (
                {"topic_id": None, "quiz_item_id": other.quiz_item_id},
                "fk_knowledge_citation_quiz_item_scope",
            ),
            (
                {
                    "topic_id": None,
                    "research_claim_id": other.claim_id,
                    "research_claim_user_id": other.user_id,
                },
                "fk_knowledge_citation_research_claim_scope",
            ),
            (
                {"topic_id": None, "note_id": other.note_id},
                "fk_knowledge_citation_note_scope",
            ),
        )
        for target_overrides, constraint_name in cross_scope_targets:
            await _assert_rejected(
                connection,
                _INSERT_CITATION,
                _citation(own, excerpt_id, **target_overrides),
                constraint_name,
                "23503",
            )

        target_rows = (
            _citation(own, excerpt_id),
            _citation(own, excerpt_id, topic_id=None, quiz_item_id=own.quiz_item_id),
            _citation(
                own,
                excerpt_id,
                topic_id=None,
                research_claim_id=own.claim_id,
                research_claim_user_id=own.user_id,
            ),
            _citation(own, excerpt_id, topic_id=None, note_id=own.note_id),
        )
        for row in target_rows:
            await connection.execute(_INSERT_CITATION, row)

        await _assert_rejected(
            connection,
            _INSERT_CITATION,
            _citation(own, excerpt_id),
            "uq_knowledge_citation_active_topic",
            "23505",
        )

        topic_citation_id = target_rows[0]["id"]
        await connection.execute(
            text(
                """
                UPDATE knowledge_citations
                SET status = 'closed', closed_by = :user_id,
                    closed_at = CURRENT_TIMESTAMP, close_reason = 'superseded',
                    version = version + 1
                WHERE id = :citation_id
                """
            ),
            {"user_id": own.user_id, "citation_id": topic_citation_id},
        )
        replacement = _citation(own, excerpt_id)
        await connection.execute(_INSERT_CITATION, replacement)

        await _assert_rejected(
            connection,
            text("DELETE FROM source_excerpts WHERE id = :id"),
            {"id": excerpt_id},
            "fk_knowledge_citation_excerpt_scope",
            "23503",
        )
        await _assert_rejected(
            connection,
            text("DELETE FROM resources WHERE id = :id"),
            {"id": own.resource_id},
            "fk_source_excerpt_resource_scope",
            "23503",
        )
        await _assert_rejected(
            connection,
            text("DELETE FROM notes WHERE id = :id"),
            {"id": own.note_id},
            "fk_knowledge_citation_note_scope",
            "23503",
        )

        active_before = await connection.scalar(
            text("SELECT status FROM source_excerpts WHERE id = :id"),
            {"id": excerpt_id},
        )
        with pytest.raises(IntegrityError):
            async with connection.begin_nested():
                await connection.execute(
                    text(
                        """
                        UPDATE source_excerpts
                        SET status = 'stale', stale_at = CURRENT_TIMESTAMP, version = version + 1
                        WHERE id = :id
                        """
                    ),
                    {"id": excerpt_id},
                )
                await connection.execute(
                    _INSERT_CITATION,
                    _citation(own, excerpt_id, relationship_kind="invalid-after-update"),
                )
        assert active_before == "active"
        assert (
            await connection.scalar(
                text("SELECT status FROM source_excerpts WHERE id = :id"),
                {"id": excerpt_id},
            )
            == "active"
        )
