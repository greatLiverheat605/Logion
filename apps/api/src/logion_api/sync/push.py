import hashlib
from typing import Any, Literal, cast
from uuid import NAMESPACE_URL, UUID, uuid5

import rfc8785
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Note, Resource
from logion_api.content.schemas import (
    NoteUpdateRequest,
    NoteWriteRequest,
    ResourceCreateRequest,
    ResourceUpdateRequest,
)
from logion_api.content.service import ContentService
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.exam.models import Exam
from logion_api.exam.schemas import ExamCreateRequest
from logion_api.exam.service import ExamService
from logion_api.execution.evidence_models import EvidenceItem, VerificationRecord
from logion_api.execution.evidence_schemas import EvidenceSubmitRequest
from logion_api.execution.evidence_service import EvidenceService
from logion_api.execution.models import StudySession, Task
from logion_api.execution.schemas import (
    SessionFinishRequest,
    SessionStartRequest,
    TaskCreateRequest,
    TaskTransitionRequest,
)
from logion_api.execution.service import ExecutionService
from logion_api.identity.service import AuthContext
from logion_api.memory.models import (
    AuditReview,
    ErrorPattern,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewFinding,
    ReviewSchedule,
    Topic,
    TopicDependency,
)
from logion_api.memory.schemas import (
    AuditReviewCompleteRequest,
    AuditReviewCreateRequest,
    ErrorPatternResolveRequest,
    MasteryConfirmRequest,
    QuizAttemptCreateRequest,
    QuizItemCreateRequest,
    ReviewFindingCreateRequest,
    ReviewFindingResolveRequest,
    TopicCreateRequest,
    TopicDependencyCreateRequest,
)
from logion_api.memory.service import MemoryService
from logion_api.planning.schemas import GoalPlanCreateRequest
from logion_api.planning.service import PlanningService
from logion_api.sync.models import ProcessedSyncOperation
from logion_api.sync.schemas import (
    AppliedOperationResult,
    ConflictOperationResult,
    FailedOperationResult,
    OperationResult,
    PushRequest,
    SyncConflict,
)
from logion_api.sync.service import (
    AppliedSyncChange,
    SyncLedgerError,
    SyncLedgerService,
    SyncOperationIdentity,
)
from logion_api.workspaces.permissions import SpaceVisibility
from logion_api.workspaces.service import WorkspaceService


def canonical_hash(value: object) -> str:
    encoded = rfc8785.dumps(cast(Any, value))
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def operation_fingerprint(operation: object) -> str:
    return canonical_hash(operation)


class SyncPushService:
    def __init__(
        self,
        ledger: SyncLedgerService,
        workspaces: WorkspaceService,
        planning: PlanningService,
        execution: ExecutionService,
        content: ContentService,
        evidence: EvidenceService,
        memory: MemoryService,
        exams: ExamService,
    ) -> None:
        self._ledger = ledger
        self._workspaces = workspaces
        self._planning = planning
        self._execution = execution
        self._content = content
        self._evidence = evidence
        self._memory = memory
        self._exams = exams

    async def push(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        *,
        request_id: str,
    ) -> list[OperationResult]:
        results: list[OperationResult] = []
        succeeded: set[UUID] = set()
        known = {operation.operation_id for operation in request.operations}
        for operation in request.operations:
            if any(
                dependency in known and dependency not in succeeded
                for dependency in operation.dependencies
            ):
                results.append(
                    FailedOperationResult(
                        operation_id=operation.operation_id,
                        status="blocked_dependency",
                        retryable=False,
                        error_code="SYNC_DEPENDENCY_FAILED",
                    )
                )
                continue
            result = await self._apply_one(
                db,
                context,
                request,
                operation,
                request_id=request_id,
            )
            results.append(result)
            if isinstance(result, AppliedOperationResult):
                succeeded.add(operation.operation_id)
        return results

    async def _apply_one(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        if canonical_hash(operation.payload) != operation.payload_hash:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_HASH_MISMATCH")
        fingerprint_payload = operation.model_dump(mode="json", exclude={"payload_hash"})
        identity = SyncOperationIdentity(
            operation_id=operation.operation_id,
            workspace_id=request.workspace_id,
            device_id=request.device_id,
            payload_hash=operation.payload_hash,
            operation_fingerprint=operation_fingerprint(fingerprint_payload),
            entity_type=operation.entity_type,
            entity_id=operation.entity_id,
            operation_type=operation.operation_type,
        )
        try:
            replay = await self._ledger.find_replay(db, identity)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)
        if replay is not None:
            return AppliedOperationResult(
                operation_id=operation.operation_id,
                status="duplicate",
                server_version=replay.server_version,
                sequence=replay.sequence,
            )
        if operation.entity_type == "learning_goal" and operation.operation_type == "create":
            return await self._create_goal(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "task" and operation.operation_type == "create":
            return await self._create_task(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "task" and operation.operation_type == "update":
            return await self._transition_task(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "study_session" and operation.operation_type == "create":
            return await self._start_session(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "study_session" and operation.operation_type == "update":
            return await self._finish_session(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "note" and operation.operation_type == "create":
            return await self._create_note(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "note" and operation.operation_type == "update":
            return await self._update_note(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "resource" and operation.operation_type == "create":
            return await self._create_resource(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "resource" and operation.operation_type == "update":
            return await self._update_resource(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "evidence" and operation.operation_type == "create":
            return await self._create_evidence(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "verification" and operation.operation_type == "update":
            return await self._update_verification(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "topic" and operation.operation_type == "create":
            return await self._create_topic(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "topic_dependency" and operation.operation_type == "create":
            return await self._create_topic_dependency(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "mastery" and operation.operation_type in {
            "create",
            "update",
        }:
            return await self._confirm_mastery(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "quiz_item" and operation.operation_type == "create":
            return await self._create_quiz_item(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "quiz_attempt" and operation.operation_type == "create":
            return await self._create_quiz_attempt(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "error_pattern" and operation.operation_type == "update":
            return await self._resolve_error_pattern(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "audit_review" and operation.operation_type == "create":
            return await self._create_audit_review(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "audit_review" and operation.operation_type == "update":
            return await self._complete_audit_review(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "review_finding" and operation.operation_type == "create":
            return await self._create_review_finding(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "review_finding" and operation.operation_type == "update":
            return await self._resolve_review_finding(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type == "exam" and operation.operation_type == "create":
            return await self._create_exam(
                db, context, request, operation, identity, request_id=request_id
            )
        if operation.entity_type != "space" or operation.operation_type != "create":
            return self._rejected(operation.operation_id, "SYNC_OPERATION_UNSUPPORTED")
        if operation.base_version != 0 or set(operation.payload) != {"name", "visibility"}:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        name = operation.payload.get("name")
        visibility = operation.payload.get("visibility")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        if not isinstance(visibility, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_visibility = SpaceVisibility(visibility)
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                space = await self._workspaces.create_space(
                    db,
                    context,
                    request.workspace_id,
                    name=name,
                    visibility=parsed_visibility,
                    request_id=request_id,
                    space_id=operation.entity_id,
                )
                state = await self._ledger.lock_workspace_state(db, request.workspace_id)
                durable = await self._ledger.append_applied(
                    db,
                    state,
                    identity,
                    AppliedSyncChange(
                        server_version=space.version,
                        payload={"name": space.name, "visibility": space.visibility},
                        payload_hash=canonical_hash(
                            {"name": space.name, "visibility": space.visibility}
                        ),
                    ),
                )
        except Exception as exc:
            from logion_api.errors import APIError

            if isinstance(exc, APIError):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            if isinstance(exc, SyncLedgerError):
                return self._rejected(operation.operation_id, exc.code)
            raise
        return AppliedOperationResult(
            operation_id=operation.operation_id,
            status="duplicate" if durable.duplicate else "applied",
            server_version=durable.server_version,
            sequence=durable.sequence,
        )

    async def _create_goal(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        if operation.base_version != 0:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            planning_payload = GoalPlanCreateRequest.model_validate(
                {**raw, "goal_id": operation.entity_id}
            )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                aggregate = await self._planning.create(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    planning_payload,
                    request_id=request_id,
                )
                normalized = {
                    "space_id": str(parsed_space_id),
                    **planning_payload.model_dump(mode="json", exclude={"goal_id"}),
                }
                state = await self._ledger.lock_workspace_state(db, request.workspace_id)
                durable = await self._ledger.append_applied(
                    db,
                    state,
                    identity,
                    AppliedSyncChange(
                        server_version=aggregate.goal.version,
                        payload=normalized,
                        payload_hash=canonical_hash(normalized),
                    ),
                )
        except Exception as exc:
            from logion_api.errors import APIError

            if isinstance(exc, APIError):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            if isinstance(exc, SyncLedgerError):
                return self._rejected(operation.operation_id, exc.code)
            raise
        return AppliedOperationResult(
            operation_id=operation.operation_id,
            status="duplicate" if durable.duplicate else "applied",
            server_version=durable.server_version,
            sequence=durable.sequence,
        )

    async def _create_task(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        supplied_status = raw.pop("status", None)
        supplied_blocked_reason = raw.pop("blocked_reason", None)
        if supplied_blocked_reason is not None:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            payload = TaskCreateRequest.model_validate({**raw, "id": operation.entity_id})
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        derived_status = "planned" if payload.planned_at is not None else "backlog"
        if supplied_status is not None and supplied_status != derived_status:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                task = await self._execution.create_task(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    task_id=payload.id,
                    goal_id=payload.goal_id,
                    phase_id=payload.phase_id,
                    title=payload.title,
                    description=payload.description,
                    priority=payload.priority,
                    estimated_minutes=payload.estimated_minutes,
                    planned_at=payload.planned_at,
                    due_at=payload.due_at,
                    request_id=request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, task.version, task_payload(task)
                )
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _transition_task(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        allowed = {
            "goal_id",
            "phase_id",
            "title",
            "description",
            "status",
            "priority",
            "estimated_minutes",
            "planned_at",
            "due_at",
            "blocked_reason",
        }
        if not set(raw).issubset(allowed):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            expected_version = await self._causal_base_version(db, request, operation)
            if expected_version is None:
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            payload = TaskTransitionRequest.model_validate(
                {
                    "status": raw.get("status"),
                    "blocked_reason": raw.get("blocked_reason"),
                    "expected_version": expected_version,
                }
            )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                task = await self._execution.transition_task(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    operation.entity_id,
                    expected_version=payload.expected_version,
                    desired_status=payload.status,
                    blocked_reason=payload.blocked_reason,
                    request_id=request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, task.version, task_payload(task)
                )
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _start_session(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        if not set(raw).issubset(
            {
                "task_id",
                "status",
                "started_at",
                "ended_at",
                "manual_minutes",
                "reflection",
                "outcome",
            }
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            payload = SessionStartRequest.model_validate(
                {"task_id": raw.get("task_id"), "id": operation.entity_id}
            )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        task = await db.get(Task, payload.task_id)
        if task is None or task.workspace_id != request.workspace_id:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
        # Offline callers must enqueue the planned -> in_progress task transition
        # first; otherwise the implicit task mutation would have no ledger entry.
        if task.status != "in_progress":
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                session = await self._execution.start_session(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    session_id=payload.id,
                    task_id=payload.task_id,
                    request_id=request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    session.version,
                    session_payload(session),
                )
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _finish_session(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        allowed = {
            "task_id",
            "status",
            "started_at",
            "ended_at",
            "outcome",
            "manual_minutes",
            "reflection",
        }
        if not set(raw).issubset(allowed):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            expected_version = await self._causal_base_version(db, request, operation)
            if expected_version is None:
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            payload = SessionFinishRequest.model_validate(
                {
                    "outcome": raw.get("outcome"),
                    "manual_minutes": raw.get("manual_minutes"),
                    "reflection": raw.get("reflection", ""),
                    "expected_version": expected_version,
                }
            )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                session = await self._execution.finish_session(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    operation.entity_id,
                    expected_version=payload.expected_version,
                    outcome=payload.outcome,
                    manual_minutes=payload.manual_minutes,
                    reflection=payload.reflection,
                    request_id=request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    session.version,
                    session_payload(session),
                )
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _append_entity(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        identity: SyncOperationIdentity,
        version: int,
        payload: dict[str, object],
    ) -> AppliedOperationResult:
        state = await self._ledger.lock_workspace_state(db, workspace_id)
        durable = await self._ledger.append_applied(
            db,
            state,
            identity,
            AppliedSyncChange(
                server_version=version,
                payload=payload,
                payload_hash=canonical_hash(payload),
            ),
        )
        return AppliedOperationResult(
            operation_id=identity.operation_id,
            status="duplicate" if durable.duplicate else "applied",
            server_version=durable.server_version,
            sequence=durable.sequence,
        )

    async def _append_derived(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        parent: SyncOperationIdentity,
        *,
        suffix: str,
        entity_type: str,
        entity_id: UUID,
        operation_type: Literal["create", "update", "delete", "restore"],
        version: int,
        payload: dict[str, object],
    ) -> None:
        operation_id = uuid5(
            NAMESPACE_URL,
            f"logion:sync-derived:{workspace_id}:{parent.operation_id}:{suffix}",
        )
        fingerprint = {
            "operation_id": str(operation_id),
            "workspace_id": str(workspace_id),
            "device_id": str(parent.device_id),
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "operation_type": operation_type,
            "derived_from": str(parent.operation_id),
            "suffix": suffix,
        }
        identity = SyncOperationIdentity(
            operation_id=operation_id,
            workspace_id=workspace_id,
            device_id=parent.device_id,
            payload_hash=canonical_hash(payload),
            operation_fingerprint=operation_fingerprint(fingerprint),
            entity_type=entity_type,
            entity_id=entity_id,
            operation_type=operation_type,
        )
        state = await self._ledger.lock_workspace_state(db, workspace_id)
        await self._ledger.append_applied(
            db,
            state,
            identity,
            AppliedSyncChange(
                server_version=version,
                payload=payload,
                payload_hash=canonical_hash(payload),
            ),
        )

    async def _create_evidence(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        verification_id = raw.pop("verification_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            payload = EvidenceSubmitRequest.model_validate(
                {
                    **raw,
                    "evidence_id": operation.entity_id,
                    "verification_id": verification_id,
                }
            )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        task = await db.get(Task, payload.task_id)
        if (
            task is None
            or task.workspace_id != request.workspace_id
            or task.space_id != parsed_space_id
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
        # The client must enqueue the task transition first so that every
        # cross-entity mutation has its own durable ledger entry.
        if task.status != "submitted":
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            async with db.begin_nested():
                aggregate = await self._evidence.submit(
                    db,
                    context,
                    request.workspace_id,
                    parsed_space_id,
                    payload,
                    request_id,
                )
                verification = aggregate.verification
                await self._append_derived(
                    db,
                    request.workspace_id,
                    identity,
                    suffix="verification",
                    entity_type="verification",
                    entity_id=verification.id,
                    operation_type="create",
                    version=verification.version,
                    payload=verification_payload(verification),
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    aggregate.evidence.version,
                    evidence_payload(aggregate.evidence),
                )
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _update_verification(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        action = raw.pop("action", None)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str) or action not in {"decide", "close_task"}:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space_id = UUID(space_id)
            expected = await self._causal_base_version(db, request, operation)
            if expected is None:
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            async with db.begin_nested():
                if action == "decide":
                    if not {"verdict", "reviewer_notes"}.issubset(raw) or not set(raw).issubset(
                        {
                            "verdict",
                            "reviewer_notes",
                            "task_id",
                            "evidence_id",
                            "decided_by",
                            "decided_at",
                        }
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    verdict = raw["verdict"]
                    reviewer_notes = raw["reviewer_notes"]
                    if (
                        verdict not in {"passed", "failed", "needs_revision"}
                        or not isinstance(reviewer_notes, str)
                        or len(reviewer_notes.strip()) > 10000
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    current = await db.get(VerificationRecord, operation.entity_id)
                    if current is None or current.workspace_id != request.workspace_id:
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
                    if (
                        raw.get("task_id", str(current.task_id)) != str(current.task_id)
                        or raw.get("evidence_id", str(current.evidence_id))
                        != str(current.evidence_id)
                        or raw.get("decided_by", current.decided_by) != current.decided_by
                        or raw.get("decided_at", current.decided_at) != current.decided_at
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    aggregate = await self._evidence.decide(
                        db,
                        context,
                        request.workspace_id,
                        parsed_space_id,
                        operation.entity_id,
                        expected,
                        verdict,
                        reviewer_notes.strip(),
                        request_id,
                    )
                    verification = aggregate.verification
                    task = aggregate.task
                else:
                    if not {"task_id", "expected_task_version"}.issubset(raw) or not set(
                        raw
                    ).issubset(
                        {
                            "task_id",
                            "expected_task_version",
                            "evidence_id",
                            "verdict",
                            "reviewer_notes",
                            "decided_by",
                            "decided_at",
                        }
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    task_id = UUID(str(raw["task_id"]))
                    expected_task_version = raw["expected_task_version"]
                    if (
                        isinstance(expected_task_version, bool)
                        or not isinstance(expected_task_version, int)
                        or expected_task_version < 1
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    found_verification = await db.get(VerificationRecord, operation.entity_id)
                    if (
                        found_verification is None
                        or found_verification.workspace_id != request.workspace_id
                        or found_verification.task_id != task_id
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
                    if found_verification.version != expected:
                        raise APIError(
                            code="RESOURCE_VERSION_CONFLICT",
                            message="Verification changed.",
                            status_code=409,
                        )
                    verification = found_verification
                    if raw.get("evidence_id", str(verification.evidence_id)) != str(
                        verification.evidence_id
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    projection = verification_payload(verification)
                    if any(
                        key in raw and raw[key] != projection[key]
                        for key in {
                            "verdict",
                            "reviewer_notes",
                            "decided_by",
                            "decided_at",
                        }
                    ):
                        return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
                    task = await self._evidence.close_task(
                        db,
                        context,
                        request.workspace_id,
                        parsed_space_id,
                        task_id,
                        expected_task_version,
                        request_id,
                    )
                await self._append_derived(
                    db,
                    request.workspace_id,
                    identity,
                    suffix="task",
                    entity_type="task",
                    entity_id=task.id,
                    operation_type="update",
                    version=task.version,
                    payload=task_payload(task),
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    verification.version,
                    verification_payload(verification),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_note(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            parsed_space = UUID(space_id)
            payload = NoteWriteRequest.model_validate({**raw, "id": operation.entity_id})
            async with db.begin_nested():
                note = await self._content.create_note(
                    db, context, request.workspace_id, parsed_space, payload, request_id
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, note.version, note_payload(note)
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _update_note(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = await self._causal_base_version(db, request, operation)
            if expected is None:
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            payload = NoteUpdateRequest.model_validate({**raw, "expected_version": expected})
            async with db.begin_nested():
                note = await self._content.update_note(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    operation.entity_id,
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, note.version, note_payload(note)
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_resource(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = ResourceCreateRequest.model_validate({**raw, "id": operation.entity_id})
            async with db.begin_nested():
                resource = await self._content.create_resource(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload.id,
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, resource.version, resource_payload(resource)
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _update_resource(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = await self._causal_base_version(db, request, operation)
            if expected is None:
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            payload = ResourceUpdateRequest.model_validate({**raw, "expected_version": expected})
            async with db.begin_nested():
                resource = await self._content.update_resource(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    operation.entity_id,
                    payload.expected_version,
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, resource.version, resource_payload(resource)
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_topic(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = TopicCreateRequest.model_validate({**raw, "id": operation.entity_id})
            async with db.begin_nested():
                topic = await self._memory.create_topic(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db, request.workspace_id, identity, topic.version, topic_payload(topic)
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_topic_dependency(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = TopicDependencyCreateRequest.model_validate(
                {**raw, "id": operation.entity_id}
            )
            async with db.begin_nested():
                dependency = await self._memory.add_dependency(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    dependency.version,
                    topic_dependency_payload(dependency),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _confirm_mastery(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        action = raw.pop("action", None)
        space_id = raw.pop("space_id", None)
        topic_id = raw.pop("topic_id", None)
        schedule_id = raw.pop("schedule_id", None)
        confirmed_level = raw.pop("confirmed_level", None)
        allowed_projection = {
            "suggested_level",
            "suggested_reason",
            "suggested_at",
            "confirmed_at",
        }
        if (
            action != "confirm"
            or not isinstance(space_id, str)
            or not isinstance(topic_id, str)
            or not isinstance(schedule_id, str)
            or not set(raw).issubset(allowed_projection)
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = (
                0
                if operation.operation_type == "create"
                else await self._causal_base_version(db, request, operation)
            )
            if expected is None or (
                operation.operation_type == "create" and operation.base_version != 0
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            current = await db.get(MasteryRecord, operation.entity_id)
            if current is not None:
                if (
                    current.workspace_id != request.workspace_id
                    or current.user_id != context.user.id
                ):
                    return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
                projection = mastery_payload(current)
                if any(
                    key in raw and raw[key] != projection[key]
                    for key in allowed_projection - {"confirmed_at"}
                ):
                    return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
            payload = MasteryConfirmRequest.model_validate(
                {
                    "mastery_id": operation.entity_id,
                    "schedule_id": UUID(schedule_id),
                    "expected_version": expected,
                    "confirmed_level": confirmed_level,
                }
            )
            async with db.begin_nested():
                result = await self._memory.confirm_mastery(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    UUID(topic_id),
                    payload,
                    request_id,
                )
                await self._append_derived(
                    db,
                    request.workspace_id,
                    identity,
                    suffix="review_schedule",
                    entity_type="review_schedule",
                    entity_id=result.review_schedule.id,
                    operation_type="create" if result.review_schedule.version == 1 else "update",
                    version=result.review_schedule.version,
                    payload=review_schedule_payload(result.review_schedule),
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    result.mastery.version,
                    mastery_payload(result.mastery),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_quiz_item(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = QuizItemCreateRequest.model_validate({**raw, "id": operation.entity_id})
            async with db.begin_nested():
                item = await self._memory.create_quiz_item(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    item.version,
                    quiz_item_payload(item),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_quiz_attempt(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        quiz_item_id = raw.pop("quiz_item_id", None)
        raw.pop("topic_id", None)
        raw.pop("is_correct", None)
        raw.pop("attempted_at", None)
        raw.pop("answer_key", None)
        raw.pop("explanation", None)
        if (
            operation.base_version != 0
            or not isinstance(space_id, str)
            or not isinstance(quiz_item_id, str)
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = QuizAttemptCreateRequest.model_validate({**raw, "id": operation.entity_id})
            async with db.begin_nested():
                result = await self._memory.submit_quiz_attempt(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    UUID(quiz_item_id),
                    payload,
                    request_id,
                )
                if result.error_pattern is not None:
                    await self._append_derived(
                        db,
                        request.workspace_id,
                        identity,
                        suffix="error_pattern",
                        entity_type="error_pattern",
                        entity_id=result.error_pattern.id,
                        operation_type=(
                            "create" if result.error_pattern.version == 1 else "update"
                        ),
                        version=result.error_pattern.version,
                        payload=error_pattern_payload(result.error_pattern),
                    )
                if result.review_schedule is not None:
                    await self._append_derived(
                        db,
                        request.workspace_id,
                        identity,
                        suffix="review_schedule",
                        entity_type="review_schedule",
                        entity_id=result.review_schedule.id,
                        operation_type=(
                            "create" if result.review_schedule.version == 1 else "update"
                        ),
                        version=result.review_schedule.version,
                        payload=review_schedule_payload(result.review_schedule),
                    )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    result.attempt.version,
                    quiz_attempt_payload(result.attempt, result.item),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _resolve_error_pattern(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        action = raw.pop("action", None)
        space_id = raw.pop("space_id", None)
        raw.pop("topic_id", None)
        raw.pop("cause", None)
        raw.pop("occurrence_count", None)
        raw.pop("status", None)
        raw.pop("latest_attempt_id", None)
        if action != "resolve" or not isinstance(space_id, str) or raw:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = await self._causal_base_version(db, request, operation)
            current = await db.get(ErrorPattern, operation.entity_id)
            if (
                expected is None
                or current is None
                or current.workspace_id != request.workspace_id
                or current.user_id != context.user.id
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            async with db.begin_nested():
                pattern = await self._memory.resolve_error_pattern(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    operation.entity_id,
                    ErrorPatternResolveRequest(expected_version=expected),
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    pattern.version,
                    error_pattern_payload(pattern),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_audit_review(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        raw.pop("status", None)
        raw.pop("completed_at", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = AuditReviewCreateRequest.model_validate({**raw, "id": operation.entity_id})
            current = await db.get(AuditReview, operation.entity_id)
            if current is not None and (
                current.workspace_id != request.workspace_id or current.user_id != context.user.id
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            async with db.begin_nested():
                result = await self._memory.create_audit_review(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    result.review.version,
                    audit_review_payload(result.review),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _complete_audit_review(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        action = raw.pop("action", None)
        space_id = raw.pop("space_id", None)
        summary = raw.pop("summary", None)
        for key in ("cadence", "period_start", "period_end", "status", "completed_at"):
            raw.pop(key, None)
        if (
            action != "complete"
            or not isinstance(space_id, str)
            or not isinstance(summary, str)
            or raw
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = await self._causal_base_version(db, request, operation)
            current = await db.get(AuditReview, operation.entity_id)
            if (
                expected is None
                or current is None
                or current.workspace_id != request.workspace_id
                or current.user_id != context.user.id
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            async with db.begin_nested():
                result = await self._memory.complete_audit_review(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    operation.entity_id,
                    AuditReviewCompleteRequest(expected_version=expected, summary=summary),
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    result.review.version,
                    audit_review_payload(result.review),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_review_finding(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        review_id = raw.pop("audit_review_id", None)
        raw.pop("status", None)
        if (
            operation.base_version != 0
            or not isinstance(space_id, str)
            or not isinstance(review_id, str)
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = ReviewFindingCreateRequest.model_validate({**raw, "id": operation.entity_id})
            current = await db.get(ReviewFinding, operation.entity_id)
            if current is not None and (
                current.workspace_id != request.workspace_id or current.user_id != context.user.id
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            async with db.begin_nested():
                finding = await self._memory.add_review_finding(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    UUID(review_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    finding.version,
                    review_finding_payload(finding),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _resolve_review_finding(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        action = raw.pop("action", None)
        space_id = raw.pop("space_id", None)
        review_id = raw.pop("audit_review_id", None)
        for key in ("category", "description", "suggested_action", "status"):
            raw.pop(key, None)
        if (
            action != "resolve"
            or not isinstance(space_id, str)
            or not isinstance(review_id, str)
            or raw
        ):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            expected = await self._causal_base_version(db, request, operation)
            current = await db.get(ReviewFinding, operation.entity_id)
            if (
                expected is None
                or current is None
                or current.workspace_id != request.workspace_id
                or current.user_id != context.user.id
            ):
                return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
            async with db.begin_nested():
                finding = await self._memory.resolve_review_finding(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    UUID(review_id),
                    operation.entity_id,
                    ReviewFindingResolveRequest(expected_version=expected),
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    finding.version,
                    review_finding_payload(finding),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _create_exam(
        self,
        db: AsyncSession,
        context: AuthContext,
        request: PushRequest,
        operation: object,
        identity: SyncOperationIdentity,
        *,
        request_id: str,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        raw = dict(operation.payload)
        space_id = raw.pop("space_id", None)
        raw.pop("status", None)
        if operation.base_version != 0 or not isinstance(space_id, str):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        try:
            payload = ExamCreateRequest.model_validate(
                {**raw, "id": operation.entity_id}
            )
            current = await db.get(Exam, operation.entity_id)
            if current is not None and (
                current.workspace_id != request.workspace_id
                or current.user_id != context.user.id
            ):
                return self._rejected(
                    operation.operation_id, "SYNC_OPERATION_FORBIDDEN"
                )
            async with db.begin_nested():
                exam = await self._exams.create_exam(
                    db,
                    context,
                    request.workspace_id,
                    UUID(space_id),
                    payload,
                    request_id,
                )
                return await self._append_entity(
                    db,
                    request.workspace_id,
                    identity,
                    exam.version,
                    exam_payload(exam),
                )
        except (TypeError, ValueError):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_INVALID")
        except APIError as exc:
            return await self._api_error_result(db, request, operation, exc)
        except SyncLedgerError as exc:
            return self._rejected(operation.operation_id, exc.code)

    async def _causal_base_version(
        self, db: AsyncSession, request: PushRequest, operation: object
    ) -> int | None:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        predecessor = await db.scalar(
            select(ProcessedSyncOperation).where(
                ProcessedSyncOperation.operation_id.in_(operation.dependencies),
                ProcessedSyncOperation.workspace_id == request.workspace_id,
                ProcessedSyncOperation.device_id == request.device_id,
                ProcessedSyncOperation.entity_type == operation.entity_type,
                ProcessedSyncOperation.entity_id == operation.entity_id,
            )
        )
        if predecessor is None:
            return operation.base_version if operation.base_version > 0 else None
        if operation.entity_type == "task":
            task = await db.get(Task, operation.entity_id)
            if task is None or task.workspace_id != request.workspace_id:
                return None
            return task.version
        if operation.entity_type == "study_session":
            study_session = await db.get(StudySession, operation.entity_id)
            if study_session is None or study_session.workspace_id != request.workspace_id:
                return None
            return study_session.version
        if operation.entity_type == "note":
            note = await db.get(Note, operation.entity_id)
            return (
                note.version
                if note is not None and note.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "resource":
            resource = await db.get(Resource, operation.entity_id)
            return (
                resource.version
                if resource is not None and resource.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "evidence":
            evidence = await db.get(EvidenceItem, operation.entity_id)
            return (
                evidence.version
                if evidence is not None and evidence.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "verification":
            verification = await db.get(VerificationRecord, operation.entity_id)
            return (
                verification.version
                if verification is not None and verification.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "topic":
            topic = await db.get(Topic, operation.entity_id)
            return (
                topic.version
                if topic is not None and topic.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "topic_dependency":
            dependency = await db.get(TopicDependency, operation.entity_id)
            return (
                dependency.version
                if dependency is not None and dependency.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "mastery":
            mastery = await db.get(MasteryRecord, operation.entity_id)
            return (
                mastery.version
                if mastery is not None and mastery.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "review_schedule":
            schedule = await db.get(ReviewSchedule, operation.entity_id)
            return (
                schedule.version
                if schedule is not None and schedule.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "error_pattern":
            pattern = await db.get(ErrorPattern, operation.entity_id)
            return (
                pattern.version
                if pattern is not None and pattern.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "audit_review":
            review = await db.get(AuditReview, operation.entity_id)
            return (
                review.version
                if review is not None and review.workspace_id == request.workspace_id
                else None
            )
        if operation.entity_type == "review_finding":
            finding = await db.get(ReviewFinding, operation.entity_id)
            return (
                finding.version
                if finding is not None and finding.workspace_id == request.workspace_id
                else None
            )
        else:
            return None

    async def _api_error_result(
        self,
        db: AsyncSession,
        request: PushRequest,
        operation: object,
        exc: APIError,
    ) -> OperationResult:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        if exc.code != "RESOURCE_VERSION_CONFLICT":
            code = (
                "SYNC_OPERATION_INVALID" if exc.status_code == 422 else "SYNC_OPERATION_FORBIDDEN"
            )
            return self._rejected(operation.operation_id, code)
        remote: (
            Task
            | StudySession
            | Note
            | Resource
            | EvidenceItem
            | VerificationRecord
            | Topic
            | TopicDependency
            | MasteryRecord
            | ReviewSchedule
            | QuizItem
            | QuizAttempt
            | ErrorPattern
            | AuditReview
            | ReviewFinding
            | Exam
            | None
        ) = None
        if operation.entity_type == "task":
            remote = await db.get(Task, operation.entity_id)
        elif operation.entity_type == "study_session":
            remote = await db.get(StudySession, operation.entity_id)
        elif operation.entity_type == "note":
            remote = await db.get(Note, operation.entity_id)
        elif operation.entity_type == "resource":
            remote = await db.get(Resource, operation.entity_id)
        elif operation.entity_type == "evidence":
            remote = await db.get(EvidenceItem, operation.entity_id)
        elif operation.entity_type == "verification":
            remote = await db.get(VerificationRecord, operation.entity_id)
        elif operation.entity_type == "topic":
            remote = await db.get(Topic, operation.entity_id)
        elif operation.entity_type == "topic_dependency":
            remote = await db.get(TopicDependency, operation.entity_id)
        elif operation.entity_type == "mastery":
            remote = await db.get(MasteryRecord, operation.entity_id)
        elif operation.entity_type == "review_schedule":
            remote = await db.get(ReviewSchedule, operation.entity_id)
        elif operation.entity_type == "quiz_item":
            remote = await db.get(QuizItem, operation.entity_id)
        elif operation.entity_type == "quiz_attempt":
            remote = await db.get(QuizAttempt, operation.entity_id)
        elif operation.entity_type == "error_pattern":
            remote = await db.get(ErrorPattern, operation.entity_id)
        elif operation.entity_type == "audit_review":
            remote = await db.get(AuditReview, operation.entity_id)
        elif operation.entity_type == "review_finding":
            remote = await db.get(ReviewFinding, operation.entity_id)
        elif operation.entity_type == "exam":
            remote = await db.get(Exam, operation.entity_id)
        if remote is None or remote.workspace_id != request.workspace_id:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
        if isinstance(remote, Task):
            payload = task_payload(remote)
        elif isinstance(remote, StudySession):
            payload = session_payload(remote)
        elif isinstance(remote, Note):
            payload = note_payload(remote)
        elif isinstance(remote, EvidenceItem):
            payload = evidence_payload(remote)
        elif isinstance(remote, VerificationRecord):
            payload = verification_payload(remote)
        elif isinstance(remote, Topic):
            payload = topic_payload(remote)
        elif isinstance(remote, TopicDependency):
            payload = topic_dependency_payload(remote)
        elif isinstance(remote, MasteryRecord):
            payload = mastery_payload(remote)
        elif isinstance(remote, ReviewSchedule):
            payload = review_schedule_payload(remote)
        elif isinstance(remote, QuizItem):
            payload = quiz_item_payload(remote)
        elif isinstance(remote, ErrorPattern):
            payload = error_pattern_payload(remote)
        elif isinstance(remote, AuditReview):
            payload = audit_review_payload(remote)
        elif isinstance(remote, ReviewFinding):
            payload = review_finding_payload(remote)
        elif isinstance(remote, QuizAttempt):
            return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
        elif isinstance(remote, Exam):
            payload = exam_payload(remote)
        else:
            payload = resource_payload(remote)
        return ConflictOperationResult(
            operation_id=operation.operation_id,
            conflict=SyncConflict(
                conflict_id=uuid5(
                    NAMESPACE_URL,
                    f"logion:sync-conflict:{request.workspace_id}:{operation.operation_id}",
                ),
                conflict_kind=(
                    "content"
                    if operation.entity_type in {"note", "resource", "evidence", "topic"}
                    else "status"
                ),
                entity_type=operation.entity_type,
                entity_id=operation.entity_id,
                base_version=operation.base_version,
                local_payload_hash=operation.payload_hash,
                remote_version=remote.version,
                remote_payload=payload,
                remote_payload_hash=canonical_hash(payload),
                resolution_options=["keep_remote", "dismiss"],
                created_at=utc_now(),
            ),
        )

    @staticmethod
    def _rejected(operation_id: UUID, code: str) -> FailedOperationResult:
        return FailedOperationResult(
            operation_id=operation_id,
            status="rejected",
            retryable=False,
            error_code=code,
        )


def task_payload(task: Task) -> dict[str, object]:
    return {
        "space_id": str(task.space_id),
        "goal_id": str(task.goal_id),
        "phase_id": str(task.phase_id) if task.phase_id is not None else None,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "estimated_minutes": task.estimated_minutes,
        "planned_at": task.planned_at.isoformat() if task.planned_at is not None else None,
        "due_at": task.due_at.isoformat() if task.due_at is not None else None,
        "blocked_reason": task.blocked_reason,
    }


def session_payload(session: StudySession) -> dict[str, object]:
    return {
        "space_id": str(session.space_id),
        "task_id": str(session.task_id),
        "status": session.status,
        "started_at": session.started_at.isoformat(),
        "ended_at": session.ended_at.isoformat() if session.ended_at is not None else None,
        "manual_minutes": session.manual_minutes,
        "reflection": session.reflection,
    }


def note_payload(note: Note) -> dict[str, object]:
    return {
        "space_id": str(note.space_id),
        "task_id": str(note.task_id) if note.task_id is not None else None,
        "title": note.title,
        "markdown_body": note.markdown_body,
    }


def resource_payload(resource: Resource) -> dict[str, object]:
    return {
        "space_id": str(resource.space_id),
        "task_id": str(resource.task_id) if resource.task_id is not None else None,
        "resource_type": resource.resource_type,
        "title": resource.title,
        "source_url": resource.source_url,
        "pdf_filename": resource.pdf_filename,
        "page_count": resource.page_count,
        "sha256": resource.sha256,
        "page_index": resource.page_index,
    }


def evidence_payload(item: EvidenceItem) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "task_id": str(item.task_id),
        "evidence_type": item.evidence_type,
        "note_id": str(item.note_id) if item.note_id is not None else None,
        "resource_id": str(item.resource_id) if item.resource_id is not None else None,
        "summary": item.summary,
        "external_url": item.external_url,
    }


def verification_payload(record: VerificationRecord) -> dict[str, object]:
    return {
        "space_id": str(record.space_id),
        "task_id": str(record.task_id),
        "evidence_id": str(record.evidence_id),
        "verdict": record.verdict,
        "reviewer_notes": record.reviewer_notes,
        "decided_by": str(record.decided_by) if record.decided_by is not None else None,
        "decided_at": record.decided_at.isoformat() if record.decided_at is not None else None,
    }


def topic_payload(topic: Topic) -> dict[str, object]:
    return {
        "space_id": str(topic.space_id),
        "title": topic.title,
        "description": topic.description,
    }


def topic_dependency_payload(dependency: TopicDependency) -> dict[str, object]:
    return {
        "space_id": str(dependency.space_id),
        "prerequisite_topic_id": str(dependency.prerequisite_topic_id),
        "dependent_topic_id": str(dependency.dependent_topic_id),
    }


def mastery_payload(record: MasteryRecord) -> dict[str, object]:
    return {
        "space_id": str(record.space_id),
        "topic_id": str(record.topic_id),
        "suggested_level": record.suggested_level,
        "suggested_reason": record.suggested_reason,
        "suggested_at": (
            record.suggested_at.isoformat() if record.suggested_at is not None else None
        ),
        "confirmed_level": record.confirmed_level,
        "confirmed_at": (
            record.confirmed_at.isoformat() if record.confirmed_at is not None else None
        ),
    }


def review_schedule_payload(schedule: ReviewSchedule) -> dict[str, object]:
    return {
        "space_id": str(schedule.space_id),
        "topic_id": str(schedule.topic_id),
        "status": schedule.status,
        "source": schedule.source,
        "interval_days": schedule.interval_days,
        "next_review_at": schedule.next_review_at.isoformat(),
        "last_reviewed_at": (
            schedule.last_reviewed_at.isoformat() if schedule.last_reviewed_at is not None else None
        ),
    }


def quiz_item_payload(item: QuizItem) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "topic_id": str(item.topic_id),
        "prompt": item.prompt,
        "evaluation_mode": item.evaluation_mode,
    }


def quiz_attempt_payload(attempt: QuizAttempt, item: QuizItem) -> dict[str, object]:
    return {
        "space_id": str(attempt.space_id),
        "topic_id": str(attempt.topic_id),
        "quiz_item_id": str(attempt.quiz_item_id),
        "response_text": attempt.response_text,
        "is_correct": attempt.is_correct,
        "confidence": attempt.confidence,
        "duration_seconds": attempt.duration_seconds,
        "error_cause": attempt.error_cause,
        "attempted_at": attempt.attempted_at.isoformat(),
        "answer_key": item.answer_key,
        "explanation": item.explanation,
    }


def error_pattern_payload(item: ErrorPattern) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "topic_id": str(item.topic_id),
        "cause": item.cause,
        "occurrence_count": item.occurrence_count,
        "status": item.status,
        "latest_attempt_id": str(item.latest_attempt_id),
    }


def audit_review_payload(item: AuditReview) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "cadence": item.cadence,
        "period_start": item.period_start.isoformat(),
        "period_end": item.period_end.isoformat(),
        "status": item.status,
        "summary": item.summary,
        "completed_at": (item.completed_at.isoformat() if item.completed_at is not None else None),
    }


def review_finding_payload(item: ReviewFinding) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "audit_review_id": str(item.audit_review_id),
        "category": item.category,
        "description": item.description,
        "suggested_action": item.suggested_action,
        "status": item.status,
    }


def exam_payload(item: Exam) -> dict[str, object]:
    return {
        "space_id": str(item.space_id),
        "title": item.title,
        "date_status": item.date_status,
        "exam_at": item.exam_at.isoformat() if item.exam_at is not None else None,
        "timezone": item.timezone,
        "target_score": item.target_score,
        "score_scale_max": item.score_scale_max,
        "status": item.status,
    }
