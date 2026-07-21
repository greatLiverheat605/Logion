import hashlib
from typing import Any, cast
from uuid import UUID

import rfc8785
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.identity.service import AuthContext
from logion_api.planning.schemas import GoalPlanCreateRequest
from logion_api.planning.service import PlanningService
from logion_api.sync.schemas import (
    AppliedOperationResult,
    FailedOperationResult,
    OperationResult,
    PushRequest,
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
    ) -> None:
        self._ledger = ledger
        self._workspaces = workspaces
        self._planning = planning

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

    @staticmethod
    def _rejected(operation_id: UUID, code: str) -> FailedOperationResult:
        return FailedOperationResult(
            operation_id=operation_id,
            status="rejected",
            retryable=False,
            error_code=code,
        )
