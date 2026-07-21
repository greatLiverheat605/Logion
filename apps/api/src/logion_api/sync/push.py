import hashlib
from typing import Any, cast
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
from logion_api.execution.models import StudySession, Task
from logion_api.execution.schemas import (
    SessionFinishRequest,
    SessionStartRequest,
    TaskCreateRequest,
    TaskTransitionRequest,
)
from logion_api.execution.service import ExecutionService
from logion_api.identity.service import AuthContext
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
    ) -> None:
        self._ledger = ledger
        self._workspaces = workspaces
        self._planning = planning
        self._execution = execution
        self._content = content

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

    async def _causal_base_version(
        self, db: AsyncSession, request: PushRequest, operation: object
    ) -> int | None:
        from logion_api.sync.schemas import SyncOperation

        assert isinstance(operation, SyncOperation)
        if operation.base_version > 0:
            return operation.base_version
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
            return None
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
        remote: Task | StudySession | Note | Resource | None = None
        if operation.entity_type == "task":
            remote = await db.get(Task, operation.entity_id)
        elif operation.entity_type == "study_session":
            remote = await db.get(StudySession, operation.entity_id)
        elif operation.entity_type == "note":
            remote = await db.get(Note, operation.entity_id)
        elif operation.entity_type == "resource":
            remote = await db.get(Resource, operation.entity_id)
        if remote is None or remote.workspace_id != request.workspace_id:
            return self._rejected(operation.operation_id, "SYNC_OPERATION_FORBIDDEN")
        if isinstance(remote, Task):
            payload = task_payload(remote)
        elif isinstance(remote, StudySession):
            payload = session_payload(remote)
        elif isinstance(remote, Note):
            payload = note_payload(remote)
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
                    "content" if operation.entity_type in {"note", "resource"} else "status"
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
