import asyncio
import hashlib
import time
import unicodedata
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import rfc8785
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.ai_gateway.models import AIOutputDraft, AIOutputDraftCandidate, AIRun
from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.authorization import KnowledgeAction, authorize_space_policy
from logion_api.knowledge_space.cursors import (
    DecodedKnowledgeCursor,
    KnowledgeCursorCodec,
    KnowledgeCursorScope,
)
from logion_api.knowledge_space.errors import (
    acceptance_idempotency_conflict_error,
    acceptance_precondition_invalid_error,
    acceptance_state_conflict_error,
    acceptance_version_conflict_error,
    query_timeout_error,
    resource_not_found_error,
)
from logion_api.knowledge_space.graph_limits import (
    GraphEdge,
    GraphNode,
    bounded_subgraph,
)
from logion_api.knowledge_space.limits import (
    DRAFT_ACCEPT_RATE,
    GRAPH_CANDIDATE_ROWS,
    GRAPH_READ_RATE,
    GRAPH_STATEMENT_TIMEOUT_SECONDS,
    ITEM_READ_RATE,
    KNOWLEDGE_WRITE_RATE,
    LIST_CANDIDATE_ROWS,
    LIST_MAX_BYTES,
    LIST_STATEMENT_TIMEOUT_SECONDS,
    KnowledgeRatePolicy,
    RateLimiterProtocol,
    enforce_dual_rate_limit,
)
from logion_api.knowledge_space.models import (
    KnowledgeAcceptanceReceipt,
    KnowledgeCitation,
    SourceExcerpt,
)
from logion_api.knowledge_space.preconditions import make_strong_etag, validate_write_precondition
from logion_api.knowledge_space.schemas import (
    GRAPH_MAX_BYTES,
    GRAPH_MAX_EDGES,
    GRAPH_MAX_NODES,
    CitationRelationship,
    CitationTarget,
    GraphDirection,
    GraphEdgeType,
    GraphTruncationReason,
    KnowledgeCitationCreateRequest,
    KnowledgeCitationPageResponse,
    KnowledgeCitationResponse,
    KnowledgeDraftAcceptanceReceipt,
    KnowledgeDraftAcceptanceRequest,
    KnowledgeGraphEdge,
    KnowledgeGraphLimits,
    KnowledgeGraphNode,
    KnowledgeGraphResponse,
    KnowledgeGraphRoot,
    KnowledgeLifecycleStatus,
    KnowledgeTargetType,
    SourceExcerptCreateRequest,
    SourceExcerptPageResponse,
    SourceExcerptPreview,
    SourceExcerptResponse,
    SourceLocator,
)
from logion_api.memory.models import QuizItem, Topic, TopicDependency
from logion_api.research.models import ResearchClaim
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import SpaceVisibility, WorkspaceRole


@dataclass(frozen=True)
class KnowledgeScope:
    space: Space
    membership: WorkspaceMembership


@dataclass(frozen=True)
class CursorWindow:
    cutoff_at: datetime
    position_created_at: datetime | None
    position_id: UUID | None


@dataclass(frozen=True)
class GraphNodeRecord:
    type: KnowledgeTargetType
    id: UUID
    label: str
    version: int
    preview: SourceExcerptPreview | None = None

    def response(self) -> KnowledgeGraphNode:
        return KnowledgeGraphNode(
            type=self.type,
            id=self.id,
            label=self.label[:500],
            version=self.version,
            excerpt_preview=self.preview,
        )


class KnowledgeService:
    def __init__(
        self,
        settings: Settings,
        security: IdentitySecurity,
        limiter: RateLimiterProtocol | None = None,
    ) -> None:
        self._settings = settings
        self._security = security
        self._limiter = limiter

    async def create_source_excerpt(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: SourceExcerptCreateRequest,
    ) -> tuple[SourceExcerptResponse, str]:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.WRITE,
            for_update=True,
        )
        await self._enforce_rate(context, workspace_id, "excerpt-write", KNOWLEDGE_WRITE_RATE)
        resource = await db.scalar(
            select(Resource)
            .where(
                Resource.id == payload.resource_id,
                Resource.workspace_id == workspace_id,
                Resource.space_id == space_id,
                Resource.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if resource is None:
            raise resource_not_found_error()
        if (
            payload.resource_sha256 is not None
            and resource.sha256 is not None
            and payload.resource_sha256 != resource.sha256
        ):
            raise self._source_version_conflict()
        if await db.scalar(select(SourceExcerpt.id).where(SourceExcerpt.id == payload.id)):
            raise self._identifier_conflict()

        normalized_text = self._normalize_excerpt(payload.excerpt_text)
        excerpt = SourceExcerpt(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            resource_id=resource.id,
            resource_version=resource.version,
            source_version_key=payload.source_version_key.strip(),
            source_file_sha256=payload.resource_sha256 or resource.sha256,
            source_version_sha256=payload.source_version_sha256,
            excerpt_text=normalized_text,
            excerpt_sha256=hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
            hash_algorithm=payload.hash_algorithm,
            normalization_version=payload.normalization_version,
            page_start=payload.locator.page_start,
            page_end=payload.locator.page_end,
            char_start=payload.locator.character_start,
            char_end=payload.locator.character_end,
            section_locator=payload.locator.section,
            status="active",
            version=1,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(excerpt)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise self._identifier_conflict() from exc
        return self._excerpt_response(excerpt), self._etag("source-excerpt", excerpt.id, 1)

    async def get_source_excerpt(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        excerpt_id: UUID,
    ) -> tuple[SourceExcerptResponse, str]:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.READ,
        )
        await self._enforce_rate(context, workspace_id, "excerpt-read", ITEM_READ_RATE)
        excerpt = await db.scalar(
            select(SourceExcerpt).where(
                SourceExcerpt.id == excerpt_id,
                SourceExcerpt.workspace_id == workspace_id,
                SourceExcerpt.space_id == space_id,
                SourceExcerpt.status.in_(("active", "stale")),
                SourceExcerpt.deleted_at.is_(None),
            )
        )
        if excerpt is None:
            raise resource_not_found_error()
        return (
            self._excerpt_response(excerpt),
            self._etag("source-excerpt", excerpt.id, excerpt.version),
        )

    async def list_source_excerpts(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        page_size: int,
        cursor: str | None,
        resource_id: UUID | None,
        stale: bool | None,
        status_filter: str | None,
    ) -> SourceExcerptPageResponse:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.READ,
        )
        await self._enforce_rate(context, workspace_id, "excerpt-list", ITEM_READ_RATE)
        if status_filter not in {None, "active", "stale"}:
            raise self._filter_invalid()
        if stale is not None and status_filter is not None:
            expected = "stale" if stale else "active"
            if status_filter != expected:
                raise self._filter_invalid()
        effective_status = status_filter or (
            "stale" if stale else "active" if stale is False else None
        )
        filters: dict[str, object] = {
            "page_size": page_size,
            "resource_id": str(resource_id) if resource_id is not None else None,
            "stale": stale,
            "status": effective_status,
        }
        scope = self._cursor_scope(context, workspace_id, space_id, "source-excerpts")
        window = self._cursor_window(cursor, scope=scope, filters=filters)
        conditions: list[Any] = [
            SourceExcerpt.workspace_id == workspace_id,
            SourceExcerpt.space_id == space_id,
            SourceExcerpt.status.in_(("active", "stale")),
            SourceExcerpt.deleted_at.is_(None),
            SourceExcerpt.created_at <= window.cutoff_at,
        ]
        if resource_id is not None:
            conditions.append(SourceExcerpt.resource_id == resource_id)
        if effective_status is not None:
            conditions.append(SourceExcerpt.status == effective_status)
        if window.position_created_at is not None and window.position_id is not None:
            conditions.append(
                or_(
                    SourceExcerpt.created_at < window.position_created_at,
                    and_(
                        SourceExcerpt.created_at == window.position_created_at,
                        SourceExcerpt.id < window.position_id,
                    ),
                )
            )
        try:
            result = await asyncio.wait_for(
                db.scalars(
                    select(SourceExcerpt)
                    .where(*conditions)
                    .order_by(SourceExcerpt.created_at.desc(), SourceExcerpt.id.desc())
                    .limit(min(page_size + 1, LIST_CANDIDATE_ROWS))
                ),
                timeout=LIST_STATEMENT_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            raise query_timeout_error() from exc
        rows = list(result.all())
        page = rows[:page_size]
        while (
            page
            and len(
                SourceExcerptPageResponse(
                    excerpts=[self._excerpt_response(row) for row in page],
                    next_cursor=None,
                )
                .model_dump_json()
                .encode("utf-8")
            )
            > LIST_MAX_BYTES
        ):
            page.pop()
        has_more = len(rows) > len(page)
        next_cursor = None
        if has_more and page:
            last = page[-1]
            next_cursor = self._cursor_codec().encode(
                scope=scope,
                filters=filters,
                position={"created_at": last.created_at.isoformat(), "id": str(last.id)},
                cutoff_at=window.cutoff_at,
            )
        return SourceExcerptPageResponse(
            excerpts=[self._excerpt_response(row) for row in page],
            next_cursor=next_cursor,
        )

    async def create_knowledge_citation(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: KnowledgeCitationCreateRequest,
    ) -> tuple[KnowledgeCitationResponse, str]:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.ACCEPT,
            for_update=True,
        )
        await self._enforce_rate(context, workspace_id, "citation-write", KNOWLEDGE_WRITE_RATE)
        excerpt = await db.scalar(
            select(SourceExcerpt)
            .where(
                SourceExcerpt.id == payload.excerpt_id,
                SourceExcerpt.workspace_id == workspace_id,
                SourceExcerpt.space_id == space_id,
                SourceExcerpt.status == "active",
                SourceExcerpt.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if excerpt is None:
            raise resource_not_found_error()
        target = await self._load_target(
            db,
            payload.target.kind,
            payload.target,
            workspace_id,
            space_id,
            caller_user_id=context.user.id,
            for_update=True,
        )
        if target is None:
            raise resource_not_found_error()
        if await db.scalar(select(KnowledgeCitation.id).where(KnowledgeCitation.id == payload.id)):
            raise self._identifier_conflict()

        target_values = self._target_values(payload.target, target)
        duplicate_conditions: list[Any] = [
            KnowledgeCitation.workspace_id == workspace_id,
            KnowledgeCitation.space_id == space_id,
            KnowledgeCitation.source_excerpt_id == excerpt.id,
            KnowledgeCitation.relationship_kind == payload.relationship.value,
            KnowledgeCitation.status == "active",
            KnowledgeCitation.deleted_at.is_(None),
        ]
        target_column, target_id = self._target_column_and_id(payload.target)
        duplicate_conditions.append(target_column == target_id)
        if await db.scalar(select(KnowledgeCitation.id).where(*duplicate_conditions)):
            raise self._identifier_conflict()

        now = datetime.now(UTC)
        citation = KnowledgeCitation(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            source_excerpt_id=excerpt.id,
            relationship_kind=payload.relationship.value,
            relation_note=payload.relation_note,
            accepted_draft_id=None,
            acceptance_operation_id=uuid7(),
            accepted_by=context.user.id,
            accepted_at=now,
            status="active",
            version=1,
            created_by=context.user.id,
            **target_values,
        )
        db.add(citation)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise self._identifier_conflict() from exc
        return self._citation_response(citation), self._etag("knowledge-citation", citation.id, 1)

    async def get_knowledge_citation(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        citation_id: UUID,
    ) -> tuple[KnowledgeCitationResponse, str]:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.READ,
        )
        await self._enforce_rate(context, workspace_id, "citation-read", ITEM_READ_RATE)
        citation = await db.scalar(
            select(KnowledgeCitation)
            .join(
                SourceExcerpt,
                and_(
                    SourceExcerpt.id == KnowledgeCitation.source_excerpt_id,
                    SourceExcerpt.workspace_id == KnowledgeCitation.workspace_id,
                    SourceExcerpt.space_id == KnowledgeCitation.space_id,
                ),
            )
            .where(
                KnowledgeCitation.id == citation_id,
                KnowledgeCitation.workspace_id == workspace_id,
                KnowledgeCitation.space_id == space_id,
                KnowledgeCitation.status == "active",
                KnowledgeCitation.deleted_at.is_(None),
                SourceExcerpt.status.in_(("active", "stale")),
                SourceExcerpt.deleted_at.is_(None),
            )
        )
        if citation is None or not await self._citation_target_is_visible(
            db, citation, workspace_id, space_id, context.user.id
        ):
            raise resource_not_found_error()
        return (
            self._citation_response(citation),
            self._etag("knowledge-citation", citation.id, citation.version),
        )

    async def accept_knowledge_draft(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        draft_id: UUID,
        payload: KnowledgeDraftAcceptanceRequest,
        request_id: str,
        if_match: str | None = None,
    ) -> KnowledgeDraftAcceptanceReceipt:
        """Atomically apply selected, pre-staged AI citation candidates.

        The caller owns the surrounding database transaction.  This method never
        invokes a provider and every mutable row is re-authorized and locked before
        the first formal knowledge row is staged.
        """

        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.ACCEPT,
            for_update=True,
        )
        await self._enforce_rate(context, workspace_id, "draft-accept", DRAFT_ACCEPT_RATE)
        canonical_hash = self.acceptance_payload_sha256(
            workspace_id,
            space_id,
            draft_id,
            payload,
        )
        if canonical_hash != payload.payload_sha256:
            raise acceptance_precondition_invalid_error()

        receipt = await db.scalar(
            select(KnowledgeAcceptanceReceipt)
            .where(
                KnowledgeAcceptanceReceipt.workspace_id == workspace_id,
                KnowledgeAcceptanceReceipt.accepted_by == context.user.id,
                KnowledgeAcceptanceReceipt.idempotency_key == payload.idempotency_key,
            )
            .with_for_update()
        )
        if receipt is not None:
            if (
                receipt.space_id != space_id
                or receipt.draft_id != draft_id
                or receipt.payload_sha256 != canonical_hash
            ):
                raise acceptance_idempotency_conflict_error()
            return self._acceptance_receipt_response(receipt)

        draft = await db.scalar(
            select(AIOutputDraft)
            .join(AIRun, AIRun.id == AIOutputDraft.run_id)
            .where(
                AIOutputDraft.id == draft_id,
                AIOutputDraft.workspace_id == workspace_id,
                AIRun.requested_by == context.user.id,
            )
            .with_for_update()
        )
        if draft is None:
            raise resource_not_found_error()
        if draft.version != payload.expected_draft_version or draft.status != "pending":
            committed_receipt = await db.scalar(
                select(KnowledgeAcceptanceReceipt).where(
                    KnowledgeAcceptanceReceipt.workspace_id == workspace_id,
                    KnowledgeAcceptanceReceipt.accepted_by == context.user.id,
                    KnowledgeAcceptanceReceipt.idempotency_key == payload.idempotency_key,
                )
            )
            if (
                committed_receipt is not None
                and committed_receipt.space_id == space_id
                and committed_receipt.draft_id == draft_id
                and committed_receipt.payload_sha256 == canonical_hash
            ):
                return self._acceptance_receipt_response(committed_receipt)
            if committed_receipt is not None:
                raise acceptance_idempotency_conflict_error()
        validate_write_precondition(
            expected_version=payload.expected_draft_version,
            current_version=draft.version,
            if_match=if_match,
            current_etag=self._etag("ai-draft", draft.id, draft.version),
        )
        if draft.status != "pending":
            raise acceptance_state_conflict_error()
        if payload.accepted_edits is not None and set(payload.accepted_edits) != set(
            draft.structured_output
        ):
            raise APIError(
                code="KNOWLEDGE_TARGET_INVALID",
                message="Accepted edits must contain exactly the draft output fields.",
                status_code=422,
                headers={"Cache-Control": "private, no-store"},
            )

        candidates = list(
            (
                await db.scalars(
                    select(AIOutputDraftCandidate)
                    .where(
                        AIOutputDraftCandidate.id.in_(payload.accepted_candidate_ids),
                        AIOutputDraftCandidate.draft_id == draft_id,
                        AIOutputDraftCandidate.workspace_id == workspace_id,
                        AIOutputDraftCandidate.space_id == space_id,
                    )
                    .order_by(AIOutputDraftCandidate.id)
                    .with_for_update()
                )
            ).all()
        )
        if len(candidates) != len(payload.accepted_candidate_ids):
            raise resource_not_found_error()

        target_expectations = {
            (item.target_type, item.target_id): item for item in payload.target_expectations
        }
        excerpt_expectations = {item.excerpt_id: item for item in payload.excerpt_expectations}
        target_keys = {
            (KnowledgeTargetType(candidate.target_type), candidate.target_id)
            for candidate in candidates
        }
        excerpt_ids = {candidate.source_excerpt_id for candidate in candidates}
        if set(target_expectations) != target_keys or set(excerpt_expectations) != excerpt_ids:
            raise acceptance_version_conflict_error()

        draft_target_key: tuple[KnowledgeTargetType, UUID]
        try:
            draft_target_key = (KnowledgeTargetType(draft.target_type), draft.target_id)
        except ValueError as exc:
            raise acceptance_state_conflict_error() from exc
        draft_target_expectation = target_expectations.get(draft_target_key)
        if (
            draft_target_expectation is None
            or draft_target_expectation.expected_version != draft.target_version
        ):
            raise acceptance_version_conflict_error()

        excerpts = list(
            (
                await db.scalars(
                    select(SourceExcerpt)
                    .where(
                        SourceExcerpt.id.in_(excerpt_ids),
                        SourceExcerpt.workspace_id == workspace_id,
                        SourceExcerpt.space_id == space_id,
                        SourceExcerpt.status == "active",
                        SourceExcerpt.deleted_at.is_(None),
                    )
                    .order_by(SourceExcerpt.id)
                    .with_for_update()
                )
            ).all()
        )
        if len(excerpts) != len(excerpt_ids):
            raise resource_not_found_error()
        excerpt_rows = {row.id: row for row in excerpts}

        target_rows: dict[tuple[KnowledgeTargetType, UUID], Any] = {}
        for target_key in sorted(target_keys, key=lambda item: (item[0].value, item[1].hex)):
            target_type, target_id = target_key
            target = await self._load_target_by_id(
                db,
                target_type,
                target_id,
                workspace_id,
                space_id,
                caller_user_id=context.user.id,
                for_update=True,
            )
            if target is None:
                raise resource_not_found_error()
            expectation = target_expectations[target_key]
            if target.version != expectation.expected_version:
                raise acceptance_version_conflict_error()
            target_rows[target_key] = target

        semantics: set[tuple[UUID, KnowledgeTargetType, UUID, str]] = set()
        for candidate in candidates:
            target_type = KnowledgeTargetType(candidate.target_type)
            target_key = (target_type, candidate.target_id)
            target_expectation = target_expectations[target_key]
            excerpt_expectation = excerpt_expectations[candidate.source_excerpt_id]
            excerpt = excerpt_rows[candidate.source_excerpt_id]
            if (
                candidate.target_version != target_expectation.expected_version
                or candidate.excerpt_version != excerpt_expectation.expected_version
                or candidate.excerpt_sha256 != excerpt_expectation.expected_excerpt_sha256
                or candidate.source_version_key != excerpt_expectation.expected_source_version_key
                or excerpt.version != excerpt_expectation.expected_version
                or excerpt.excerpt_sha256 != excerpt_expectation.expected_excerpt_sha256
                or excerpt.source_version_key != excerpt_expectation.expected_source_version_key
            ):
                raise acceptance_version_conflict_error()
            semantic = (
                candidate.source_excerpt_id,
                target_type,
                candidate.target_id,
                candidate.relationship_kind,
            )
            if semantic in semantics:
                raise acceptance_state_conflict_error()
            semantics.add(semantic)
            target_column = self._citation_column(target_type)
            if await db.scalar(
                select(KnowledgeCitation.id).where(
                    KnowledgeCitation.workspace_id == workspace_id,
                    KnowledgeCitation.space_id == space_id,
                    KnowledgeCitation.source_excerpt_id == candidate.source_excerpt_id,
                    KnowledgeCitation.relationship_kind == candidate.relationship_kind,
                    target_column == candidate.target_id,
                    KnowledgeCitation.status == "active",
                    KnowledgeCitation.deleted_at.is_(None),
                )
            ):
                raise acceptance_state_conflict_error()

        now = datetime.now(UTC)
        receipt_id = uuid7()
        created_ids: list[UUID] = []
        for candidate in candidates:
            target_type = KnowledgeTargetType(candidate.target_type)
            target = CitationTarget(**{f"{target_type.value}_id": candidate.target_id})
            citation = KnowledgeCitation(
                id=candidate.id,
                workspace_id=workspace_id,
                space_id=space_id,
                source_excerpt_id=candidate.source_excerpt_id,
                relationship_kind=candidate.relationship_kind,
                relation_note=candidate.relation_note,
                accepted_draft_id=draft.id,
                acceptance_operation_id=receipt_id,
                accepted_by=context.user.id,
                accepted_at=now,
                status="active",
                version=1,
                created_by=context.user.id,
                **self._target_values(target, target_rows[(target_type, candidate.target_id)]),
            )
            db.add(citation)
            created_ids.append(citation.id)

        receipt = KnowledgeAcceptanceReceipt(
            id=receipt_id,
            workspace_id=workspace_id,
            space_id=space_id,
            draft_id=draft.id,
            accepted_by=context.user.id,
            idempotency_key=payload.idempotency_key,
            payload_sha256=canonical_hash,
            status="applied",
            created_object_ids=[str(identifier) for identifier in created_ids],
            accepted_at=now,
        )
        db.add(receipt)
        draft.status = "accepted"
        draft.edited_output = payload.accepted_edits
        draft.decided_by = context.user.id
        draft.decided_at = now
        draft.updated_at = now
        draft.version += 1
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="knowledge.draft_accepted",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="knowledge_acceptance_receipt",
                target_id=receipt.id,
                metadata={"candidate_count": len(created_ids)},
            )
        )
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            existing = await db.scalar(
                select(KnowledgeAcceptanceReceipt).where(
                    KnowledgeAcceptanceReceipt.workspace_id == workspace_id,
                    KnowledgeAcceptanceReceipt.accepted_by == context.user.id,
                    KnowledgeAcceptanceReceipt.idempotency_key == payload.idempotency_key,
                )
            )
            if (
                existing is not None
                and existing.space_id == space_id
                and existing.draft_id == draft_id
                and existing.payload_sha256 == canonical_hash
            ):
                return self._acceptance_receipt_response(existing)
            raise acceptance_state_conflict_error() from exc
        return self._acceptance_receipt_response(receipt)

    async def list_knowledge_citations(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        page_size: int,
        cursor: str | None,
        excerpt_id: UUID | None,
        topic_id: UUID | None,
        quiz_item_id: UUID | None,
        research_claim_id: UUID | None,
        note_id: UUID | None,
        relationship: CitationRelationship | None,
    ) -> KnowledgeCitationPageResponse:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.READ,
        )
        await self._enforce_rate(context, workspace_id, "citation-list", ITEM_READ_RATE)
        target_filters = (topic_id, quiz_item_id, research_claim_id, note_id)
        if sum(value is not None for value in target_filters) > 1:
            raise self._filter_invalid()
        filters: dict[str, object] = {
            "page_size": page_size,
            "excerpt_id": str(excerpt_id) if excerpt_id is not None else None,
            "topic_id": str(topic_id) if topic_id is not None else None,
            "quiz_item_id": str(quiz_item_id) if quiz_item_id is not None else None,
            "research_claim_id": (
                str(research_claim_id) if research_claim_id is not None else None
            ),
            "note_id": str(note_id) if note_id is not None else None,
            "relationship": relationship.value if relationship is not None else None,
        }
        scope = self._cursor_scope(context, workspace_id, space_id, "knowledge-citations")
        window = self._cursor_window(cursor, scope=scope, filters=filters)
        conditions: list[Any] = [
            KnowledgeCitation.workspace_id == workspace_id,
            KnowledgeCitation.space_id == space_id,
            KnowledgeCitation.status == "active",
            KnowledgeCitation.deleted_at.is_(None),
            KnowledgeCitation.created_at <= window.cutoff_at,
            SourceExcerpt.status.in_(("active", "stale")),
            SourceExcerpt.deleted_at.is_(None),
        ]
        conditions.append(
            or_(
                KnowledgeCitation.research_claim_id.is_(None),
                KnowledgeCitation.research_claim_user_id == context.user.id,
            )
        )
        if excerpt_id is not None:
            conditions.append(KnowledgeCitation.source_excerpt_id == excerpt_id)
        for column, value in (
            (KnowledgeCitation.topic_id, topic_id),
            (KnowledgeCitation.quiz_item_id, quiz_item_id),
            (KnowledgeCitation.research_claim_id, research_claim_id),
            (KnowledgeCitation.note_id, note_id),
        ):
            if value is not None:
                conditions.append(column == value)
        if relationship is not None:
            conditions.append(KnowledgeCitation.relationship_kind == relationship.value)
        if window.position_created_at is not None and window.position_id is not None:
            conditions.append(
                or_(
                    KnowledgeCitation.created_at < window.position_created_at,
                    and_(
                        KnowledgeCitation.created_at == window.position_created_at,
                        KnowledgeCitation.id < window.position_id,
                    ),
                )
            )
        try:
            result = await asyncio.wait_for(
                db.scalars(
                    select(KnowledgeCitation)
                    .join(
                        SourceExcerpt,
                        and_(
                            SourceExcerpt.id == KnowledgeCitation.source_excerpt_id,
                            SourceExcerpt.workspace_id == KnowledgeCitation.workspace_id,
                            SourceExcerpt.space_id == KnowledgeCitation.space_id,
                        ),
                    )
                    .where(*conditions)
                    .order_by(KnowledgeCitation.created_at.desc(), KnowledgeCitation.id.desc())
                    .limit(min(page_size + 1, LIST_CANDIDATE_ROWS))
                ),
                timeout=LIST_STATEMENT_TIMEOUT_SECONDS,
            )
        except TimeoutError as exc:
            raise query_timeout_error() from exc
        rows = list(result.all())
        visible = rows[:page_size]
        while (
            visible
            and len(
                KnowledgeCitationPageResponse(
                    citations=[self._citation_response(row) for row in visible],
                    next_cursor=None,
                )
                .model_dump_json()
                .encode("utf-8")
            )
            > LIST_MAX_BYTES
        ):
            visible.pop()
        has_hidden_or_more = len(rows) > len(visible)
        next_cursor = None
        if has_hidden_or_more and visible:
            last = visible[-1]
            next_cursor = self._cursor_codec().encode(
                scope=scope,
                filters=filters,
                position={"created_at": last.created_at.isoformat(), "id": str(last.id)},
                cutoff_at=window.cutoff_at,
            )
        return KnowledgeCitationPageResponse(
            citations=[self._citation_response(row) for row in visible],
            next_cursor=next_cursor,
        )

    async def get_graph(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        root_type: KnowledgeTargetType,
        root_id: UUID,
        depth: int,
        direction: GraphDirection,
        edge_types: list[GraphEdgeType] | None,
        include_excerpt_preview: bool,
    ) -> KnowledgeGraphResponse:
        await self._authorize_scope(
            db,
            context,
            workspace_id,
            space_id,
            KnowledgeAction.READ,
        )
        await self._enforce_rate(context, workspace_id, "graph-read", GRAPH_READ_RATE)
        root_target = await self._load_target_by_id(
            db, root_type, root_id, workspace_id, space_id, caller_user_id=context.user.id
        )
        if root_target is None:
            raise resource_not_found_error()
        root_record = self._target_record(root_type, root_target)
        records: dict[tuple[KnowledgeTargetType, UUID], GraphNodeRecord] = {
            (root_type, root_id): root_record
        }
        graph_edges: dict[UUID, KnowledgeGraphEdge] = {}
        truncation: list[GraphTruncationReason] = []

        include_dependencies = edge_types is None or GraphEdgeType.TOPIC_DEPENDENCY in edge_types
        if root_type is KnowledgeTargetType.TOPIC and include_dependencies:
            (
                candidate_nodes,
                candidate_edges,
                row_limited,
                timed_out,
            ) = await self._load_topic_graph_candidates(
                db,
                workspace_id,
                space_id,
                root_id,
                root_record,
                depth,
                direction,
            )
            if row_limited:
                self._append_reason(truncation, GraphTruncationReason.ROW_LIMIT)
            if timed_out:
                self._append_reason(truncation, GraphTruncationReason.TIME_LIMIT)
            kernel = bounded_subgraph(
                self._graph_key(KnowledgeTargetType.TOPIC, root_id),
                [GraphNode(key) for key in candidate_nodes],
                candidate_edges,
                max_hops=depth,
                max_nodes=GRAPH_MAX_NODES,
                max_edges=GRAPH_MAX_EDGES,
            )
            records = {
                self._graph_key_parts(node.id): candidate_nodes[node.id] for node in kernel.nodes
            }
            graph_edges = {
                UUID(edge.id): KnowledgeGraphEdge(
                    id=UUID(edge.id),
                    type=GraphEdgeType.TOPIC_DEPENDENCY,
                    source=self._graph_root_from_key(edge.source),
                    target=self._graph_root_from_key(edge.target),
                )
                for edge in kernel.edges
            }
            if "max_nodes" in kernel.truncation_reasons:
                self._append_reason(truncation, GraphTruncationReason.NODE_LIMIT)
            if "max_edges" in kernel.truncation_reasons:
                self._append_reason(truncation, GraphTruncationReason.EDGE_LIMIT)

        if include_excerpt_preview:
            records = await self._attach_previews(db, workspace_id, space_id, records)
        ordered_records = [records[(root_type, root_id)]] + sorted(
            (record for key, record in records.items() if key != (root_type, root_id)),
            key=lambda record: (record.type.value, str(record.id)),
        )
        response = KnowledgeGraphResponse(
            root=KnowledgeGraphRoot(type=root_type, id=root_id),
            depth=depth,
            nodes=[record.response() for record in ordered_records],
            edges=sorted(graph_edges.values(), key=lambda edge: str(edge.id)),
            truncated=bool(truncation),
            truncation_reasons=truncation,
            next_cursor=None,
            limits=KnowledgeGraphLimits(),
        )
        if len(response.model_dump_json().encode("utf-8")) > GRAPH_MAX_BYTES:
            self._append_reason(truncation, GraphTruncationReason.BYTE_LIMIT)
            response = KnowledgeGraphResponse(
                root=response.root,
                depth=response.depth,
                nodes=[root_record.response()],
                edges=[],
                truncated=True,
                truncation_reasons=truncation,
                next_cursor=None,
                limits=response.limits,
            )
        return response

    async def _load_topic_graph_candidates(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        space_id: UUID,
        root_id: UUID,
        root_record: GraphNodeRecord,
        depth: int,
        direction: GraphDirection,
    ) -> tuple[dict[str, GraphNodeRecord], list[GraphEdge], bool, bool]:
        """Collect only scoped, visible TopicDependency candidates for the kernel.

        Authorization is applied in every statement before data enters the pure
        bounded kernel. The 600-row statement budget and a monotonic deadline
        keep dense/deep graphs from turning into unbounded work; a timeout
        returns the safe partial graph with no resumable cursor.
        """

        deadline = time.monotonic() + GRAPH_STATEMENT_TIMEOUT_SECONDS
        records: dict[str, GraphNodeRecord] = {
            self._graph_key(KnowledgeTargetType.TOPIC, root_id): root_record
        }
        edges: dict[str, GraphEdge] = {}
        frontier = {root_id}
        row_limited = False
        timed_out = False

        for _hop in range(depth):
            if not frontier:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            edge_conditions: list[Any] = [
                TopicDependency.workspace_id == workspace_id,
                TopicDependency.space_id == space_id,
                TopicDependency.deleted_at.is_(None),
            ]
            if direction is GraphDirection.OUT:
                edge_conditions.append(TopicDependency.prerequisite_topic_id.in_(frontier))
            elif direction is GraphDirection.IN:
                edge_conditions.append(TopicDependency.dependent_topic_id.in_(frontier))
            else:
                edge_conditions.append(
                    or_(
                        TopicDependency.prerequisite_topic_id.in_(frontier),
                        TopicDependency.dependent_topic_id.in_(frontier),
                    )
                )
            try:
                result = await asyncio.wait_for(
                    db.scalars(
                        select(TopicDependency)
                        .where(*edge_conditions)
                        .order_by(TopicDependency.id.asc())
                        .limit(GRAPH_CANDIDATE_ROWS + 1)
                    ),
                    timeout=remaining,
                )
                candidates = list(result.all())
            except TimeoutError:
                timed_out = True
                break
            if len(candidates) > GRAPH_CANDIDATE_ROWS:
                row_limited = True
                candidates = candidates[:GRAPH_CANDIDATE_ROWS]
            topic_ids = {
                topic_id
                for edge in candidates
                for topic_id in (edge.prerequisite_topic_id, edge.dependent_topic_id)
            }
            if not topic_ids:
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            try:
                topic_result = await asyncio.wait_for(
                    db.scalars(
                        select(Topic).where(
                            Topic.id.in_(topic_ids),
                            Topic.workspace_id == workspace_id,
                            Topic.space_id == space_id,
                            Topic.deleted_at.is_(None),
                        )
                    ),
                    timeout=remaining,
                )
                visible_topics = {topic.id: topic for topic in topic_result.all()}
            except TimeoutError:
                timed_out = True
                break

            next_frontier: set[UUID] = set()
            for edge in candidates:
                source = visible_topics.get(edge.prerequisite_topic_id)
                target = visible_topics.get(edge.dependent_topic_id)
                if source is None or target is None:
                    continue
                source_key = self._graph_key(KnowledgeTargetType.TOPIC, source.id)
                target_key = self._graph_key(KnowledgeTargetType.TOPIC, target.id)
                records[source_key] = self._target_record(KnowledgeTargetType.TOPIC, source)
                records[target_key] = self._target_record(KnowledgeTargetType.TOPIC, target)
                edges.setdefault(
                    str(edge.id),
                    GraphEdge(str(edge.id), source_key, target_key),
                )
                if direction in {GraphDirection.OUT, GraphDirection.BOTH} and source.id in frontier:
                    next_frontier.add(target.id)
                if direction in {GraphDirection.IN, GraphDirection.BOTH} and target.id in frontier:
                    next_frontier.add(source.id)
            frontier = next_frontier

        return records, list(edges.values()), row_limited, timed_out

    @staticmethod
    def _graph_key(target_type: KnowledgeTargetType, target_id: UUID) -> str:
        return f"{target_type.value}:{target_id}"

    @staticmethod
    def _graph_key_parts(key: str) -> tuple[KnowledgeTargetType, UUID]:
        target_type, raw_id = key.split(":", 1)
        return KnowledgeTargetType(target_type), UUID(raw_id)

    @classmethod
    def _graph_root_from_key(cls, key: str) -> KnowledgeGraphRoot:
        target_type, target_id = cls._graph_key_parts(key)
        return KnowledgeGraphRoot(type=target_type, id=target_id)

    async def _enforce_rate(
        self,
        context: AuthContext,
        workspace_id: UUID,
        operation: str,
        policy: KnowledgeRatePolicy,
    ) -> None:
        if self._limiter is None:
            return
        await enforce_dual_rate_limit(
            self._limiter,
            self._security,
            operation=operation,
            caller_id=str(context.user.id),
            workspace_id=str(workspace_id),
            policy=policy,
        )

    async def _authorize_scope(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        action: KnowledgeAction,
        *,
        for_update: bool = False,
    ) -> KnowledgeScope:
        statement = (
            select(Space, WorkspaceMembership)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .join(
                WorkspaceMembership,
                WorkspaceMembership.workspace_id == Workspace.id,
            )
            .where(
                Workspace.id == workspace_id,
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == context.user.id,
                WorkspaceMembership.status == "active",
                Space.id == space_id,
                Space.workspace_id == workspace_id,
                Space.status == "active",
                Space.deleted_at.is_(None),
                or_(
                    Space.visibility == SpaceVisibility.SHARED.value,
                    Space.owner_user_id == context.user.id,
                ),
            )
        )
        if for_update:
            statement = statement.with_for_update()
        row = (await db.execute(statement)).one_or_none()
        if row is None:
            raise resource_not_found_error()
        scope = KnowledgeScope(space=row[0], membership=row[1])
        authorize_space_policy(
            role=WorkspaceRole(scope.membership.role),
            visibility=SpaceVisibility(scope.space.visibility),
            caller_user_id=context.user.id,
            owner_user_id=scope.space.owner_user_id,
            action=action,
            shared_writes_enabled=self._settings.knowledge_space_shared_writes_enabled,
        )
        return scope

    async def _load_target(
        self,
        db: AsyncSession,
        target_type: KnowledgeTargetType,
        target: CitationTarget,
        workspace_id: UUID,
        space_id: UUID,
        *,
        caller_user_id: UUID | None = None,
        for_update: bool = False,
    ) -> Any | None:
        _column, target_id = self._target_column_and_id(target)
        return await self._load_target_by_id(
            db,
            target_type,
            target_id,
            workspace_id,
            space_id,
            caller_user_id=caller_user_id,
            for_update=for_update,
        )

    async def _load_target_by_id(
        self,
        db: AsyncSession,
        target_type: KnowledgeTargetType,
        target_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        *,
        caller_user_id: UUID | None = None,
        for_update: bool = False,
    ) -> Any | None:
        model = self._target_model(target_type)
        conditions: list[Any] = [
            model.id == target_id,
            model.workspace_id == workspace_id,
            model.space_id == space_id,
            model.deleted_at.is_(None),
        ]
        if target_type is KnowledgeTargetType.RESEARCH_CLAIM and caller_user_id is not None:
            conditions.append(model.user_id == caller_user_id)
        statement = select(model).where(*conditions)
        if for_update:
            statement = statement.with_for_update()
        return await db.scalar(statement)

    async def _citation_target_is_visible(
        self,
        db: AsyncSession,
        citation: KnowledgeCitation,
        workspace_id: UUID,
        space_id: UUID,
        caller_user_id: UUID,
    ) -> bool:
        target = self._citation_target(citation)
        return (
            await self._load_target(
                db,
                target.kind,
                target,
                workspace_id,
                space_id,
                caller_user_id=caller_user_id,
            )
            is not None
        )

    async def _attach_previews(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        space_id: UUID,
        records: dict[tuple[KnowledgeTargetType, UUID], GraphNodeRecord],
    ) -> dict[tuple[KnowledgeTargetType, UUID], GraphNodeRecord]:
        updated = dict(records)
        for target_type in KnowledgeTargetType:
            ids = {node_id for (node_type, node_id) in records if node_type is target_type}
            if not ids:
                continue
            target_column = self._citation_column(target_type)
            rows = (
                await db.execute(
                    select(KnowledgeCitation, SourceExcerpt)
                    .join(
                        SourceExcerpt,
                        and_(
                            SourceExcerpt.id == KnowledgeCitation.source_excerpt_id,
                            SourceExcerpt.workspace_id == KnowledgeCitation.workspace_id,
                            SourceExcerpt.space_id == KnowledgeCitation.space_id,
                        ),
                    )
                    .where(
                        KnowledgeCitation.workspace_id == workspace_id,
                        KnowledgeCitation.space_id == space_id,
                        KnowledgeCitation.status == "active",
                        KnowledgeCitation.deleted_at.is_(None),
                        target_column.in_(ids),
                        SourceExcerpt.status.in_(("active", "stale")),
                        SourceExcerpt.deleted_at.is_(None),
                    )
                    .order_by(KnowledgeCitation.created_at.desc(), KnowledgeCitation.id.asc())
                    .limit(GRAPH_MAX_NODES * 4)
                )
            ).all()
            seen: set[UUID] = set()
            for citation, excerpt in rows:
                target_id = self._citation_target_id(citation)
                if target_id in seen:
                    continue
                seen.add(target_id)
                key = (target_type, target_id)
                current = updated.get(key)
                if current is None:
                    continue
                updated[key] = replace(
                    current,
                    preview=SourceExcerptPreview(
                        excerpt_id=excerpt.id,
                        text=excerpt.excerpt_text[:500],
                        stale=excerpt.status == "stale",
                    ),
                )
        return updated

    @staticmethod
    def acceptance_payload_sha256(
        workspace_id: UUID,
        space_id: UUID,
        draft_id: UUID,
        payload: KnowledgeDraftAcceptanceRequest,
    ) -> str:
        """Hash the order-independent, route-bound acceptance payload."""

        data = payload.model_dump(mode="json", exclude={"idempotency_key", "payload_sha256"})
        data["workspace_id"] = str(workspace_id)
        data["space_id"] = str(space_id)
        data["draft_id"] = str(draft_id)
        data["accepted_candidate_ids"] = sorted(data["accepted_candidate_ids"])
        data["target_expectations"] = sorted(
            data["target_expectations"],
            key=lambda item: (item["target_type"], item["target_id"]),
        )
        data["excerpt_expectations"] = sorted(
            data["excerpt_expectations"],
            key=lambda item: item["excerpt_id"],
        )
        return hashlib.sha256(rfc8785.dumps(data)).hexdigest()

    @staticmethod
    def _acceptance_receipt_response(
        receipt: KnowledgeAcceptanceReceipt,
    ) -> KnowledgeDraftAcceptanceReceipt:
        return KnowledgeDraftAcceptanceReceipt(
            receipt_id=receipt.id,
            idempotency_key=receipt.idempotency_key,
            draft_id=receipt.draft_id,
            status="applied",
            created_object_ids=[UUID(identifier) for identifier in receipt.created_object_ids],
            accepted_at=receipt.accepted_at,
        )

    def _cursor_codec(self) -> KnowledgeCursorCodec:
        active_key_id = self._settings.knowledge_cursor_active_key_id
        if active_key_id is None:
            raise resource_not_found_error()
        return KnowledgeCursorCodec(
            active_key_id=active_key_id,
            previous_key_id=self._settings.knowledge_cursor_previous_key_id,
            keys={
                key_id: value.get_secret_value().encode("utf-8")
                for key_id, value in self._settings.knowledge_cursor_keys.items()
            },
            lifetime=timedelta(seconds=self._settings.knowledge_cursor_ttl_seconds),
            clock_skew=timedelta(seconds=self._settings.knowledge_cursor_clock_skew_seconds),
        )

    def _cursor_scope(
        self,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        endpoint: str,
    ) -> KnowledgeCursorScope:
        subject_hash = self._security.privacy_hash(f"knowledge:{context.user.id}:{workspace_id}")
        return KnowledgeCursorScope(
            subject_hash=subject_hash or "unknown",
            workspace_id=str(workspace_id),
            space_id=str(space_id),
            endpoint=endpoint,
        )

    def _cursor_window(
        self,
        cursor: str | None,
        *,
        scope: KnowledgeCursorScope,
        filters: dict[str, object],
    ) -> CursorWindow:
        if cursor is None:
            return CursorWindow(datetime.now(UTC), None, None)
        decoded = self._cursor_codec().decode(cursor, scope=scope, filters=filters)
        created_at, identifier = self._cursor_position(decoded)
        return CursorWindow(decoded.cutoff_at, created_at, identifier)

    @staticmethod
    def _cursor_position(decoded: DecodedKnowledgeCursor) -> tuple[datetime, UUID]:
        try:
            raw_created_at = decoded.position["created_at"]
            raw_id = decoded.position["id"]
            if not isinstance(raw_created_at, str) or not isinstance(raw_id, str):
                raise ValueError("invalid position types")
            created_at = datetime.fromisoformat(raw_created_at)
            if created_at.tzinfo is None:
                raise ValueError("missing cursor timezone")
            return created_at.astimezone(UTC), UUID(raw_id)
        except (KeyError, TypeError, ValueError) as exc:
            raise KnowledgeCursorCodec.invalid_cursor() from exc

    def _etag(self, entity_kind: str, entity_id: UUID, version: int) -> str:
        return make_strong_etag(
            key=self._settings.secret_key.get_secret_value().encode("utf-8"),
            entity_kind=entity_kind,
            entity_id=entity_id,
            version=version,
        )

    @staticmethod
    def _normalize_excerpt(value: str) -> str:
        return unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n"))

    @staticmethod
    def _excerpt_response(excerpt: SourceExcerpt) -> SourceExcerptResponse:
        status = (
            KnowledgeLifecycleStatus.SUPERSEDED
            if excerpt.status == "stale"
            else KnowledgeLifecycleStatus(excerpt.status)
        )
        return SourceExcerptResponse(
            id=excerpt.id,
            workspace_id=excerpt.workspace_id,
            space_id=excerpt.space_id,
            resource_id=excerpt.resource_id,
            excerpt_text=excerpt.excerpt_text,
            locator=SourceLocator(
                page_start=excerpt.page_start,
                page_end=excerpt.page_end,
                character_start=excerpt.char_start,
                character_end=excerpt.char_end,
                section=excerpt.section_locator,
            ),
            source_version_key=excerpt.source_version_key,
            source_version_sha256=excerpt.source_version_sha256,
            resource_sha256=excerpt.source_file_sha256,
            excerpt_sha256=excerpt.excerpt_sha256,
            normalization_version="utf8-nfc-lf-v1",
            hash_algorithm="sha256",
            stale=excerpt.status == "stale",
            status=status,
            version=excerpt.version,
            created_by=excerpt.created_by,
            created_at=excerpt.created_at,
            updated_at=excerpt.updated_at,
        )

    @staticmethod
    def _citation_response(citation: KnowledgeCitation) -> KnowledgeCitationResponse:
        status = (
            KnowledgeLifecycleStatus.SUPERSEDED
            if citation.status == "closed"
            else KnowledgeLifecycleStatus(citation.status)
        )
        return KnowledgeCitationResponse(
            id=citation.id,
            workspace_id=citation.workspace_id,
            space_id=citation.space_id,
            excerpt_id=citation.source_excerpt_id,
            target=KnowledgeService._citation_target(citation),
            relationship=CitationRelationship(citation.relationship_kind),
            relation_note=citation.relation_note,
            accepted_draft_id=citation.accepted_draft_id,
            status=status,
            version=citation.version,
            created_by=citation.created_by,
            created_at=citation.created_at,
            updated_at=citation.accepted_at,
        )

    @staticmethod
    def _citation_target(citation: KnowledgeCitation) -> CitationTarget:
        return CitationTarget(
            topic_id=citation.topic_id,
            quiz_item_id=citation.quiz_item_id,
            research_claim_id=citation.research_claim_id,
            note_id=citation.note_id,
        )

    @staticmethod
    def _citation_target_id(citation: KnowledgeCitation) -> UUID:
        for value in (
            citation.topic_id,
            citation.quiz_item_id,
            citation.research_claim_id,
            citation.note_id,
        ):
            if value is not None:
                return value
        raise ValueError("citation has no typed target")

    @staticmethod
    def _target_values(target: CitationTarget, target_row: Any) -> dict[str, UUID | None]:
        return {
            "topic_id": target.topic_id,
            "quiz_item_id": target.quiz_item_id,
            "research_claim_id": target.research_claim_id,
            "research_claim_user_id": (
                target_row.user_id if target.research_claim_id is not None else None
            ),
            "note_id": target.note_id,
        }

    @staticmethod
    def _target_column_and_id(target: CitationTarget) -> tuple[Any, UUID]:
        for column, value in (
            (KnowledgeCitation.topic_id, target.topic_id),
            (KnowledgeCitation.quiz_item_id, target.quiz_item_id),
            (KnowledgeCitation.research_claim_id, target.research_claim_id),
            (KnowledgeCitation.note_id, target.note_id),
        ):
            if value is not None:
                return column, value
        raise ValueError("citation target is missing")

    @staticmethod
    def _citation_column(target_type: KnowledgeTargetType) -> Any:
        return {
            KnowledgeTargetType.TOPIC: KnowledgeCitation.topic_id,
            KnowledgeTargetType.QUIZ_ITEM: KnowledgeCitation.quiz_item_id,
            KnowledgeTargetType.RESEARCH_CLAIM: KnowledgeCitation.research_claim_id,
            KnowledgeTargetType.NOTE: KnowledgeCitation.note_id,
        }[target_type]

    @staticmethod
    def _target_model(target_type: KnowledgeTargetType) -> Any:
        return {
            KnowledgeTargetType.TOPIC: Topic,
            KnowledgeTargetType.QUIZ_ITEM: QuizItem,
            KnowledgeTargetType.RESEARCH_CLAIM: ResearchClaim,
            KnowledgeTargetType.NOTE: Note,
        }[target_type]

    @staticmethod
    def _target_record(target_type: KnowledgeTargetType, target: Any) -> GraphNodeRecord:
        labels = {
            KnowledgeTargetType.TOPIC: "title",
            KnowledgeTargetType.QUIZ_ITEM: "prompt",
            KnowledgeTargetType.RESEARCH_CLAIM: "statement",
            KnowledgeTargetType.NOTE: "title",
        }
        return GraphNodeRecord(
            type=target_type,
            id=target.id,
            label=str(getattr(target, labels[target_type])),
            version=target.version,
        )

    @staticmethod
    def _append_reason(reasons: list[GraphTruncationReason], reason: GraphTruncationReason) -> None:
        if reason not in reasons:
            reasons.append(reason)

    @staticmethod
    def _identifier_conflict() -> APIError:
        return APIError(
            code="KNOWLEDGE_IDENTIFIER_CONFLICT",
            message="The supplied knowledge identifier is already in use.",
            status_code=409,
            headers={"Cache-Control": "private, no-store"},
        )

    @staticmethod
    def _source_version_conflict() -> APIError:
        return APIError(
            code="KNOWLEDGE_SOURCE_VERSION_CONFLICT",
            message="The source version no longer matches the requested excerpt.",
            status_code=409,
            headers={"Cache-Control": "private, no-store"},
        )

    @staticmethod
    def _filter_invalid() -> APIError:
        return APIError(
            code="KNOWLEDGE_FILTER_INVALID",
            message="The requested knowledge filters cannot be combined.",
            status_code=400,
            headers={"Cache-Control": "private, no-store"},
        )
