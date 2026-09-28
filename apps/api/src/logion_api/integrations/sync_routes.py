from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select

from logion_api.db import utc_now
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.identity.models import User
from logion_api.integrations.models import IntegrationCredential, ZoteroSyncState
from logion_api.integrations.network import integration_error
from logion_api.library.routes import Service, require_enabled, write_boundary

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/zotero-sync",
    tags=["research-integrations"],
    dependencies=[Depends(require_enabled)],
)


class ZoteroSyncStatus(BaseModel):
    configured: bool
    pending: bool
    library_version: int
    last_sync_at: datetime | None
    retry_after: datetime | None
    last_error_code: str | None


def status_of(
    credential: IntegrationCredential | None,
    state: ZoteroSyncState | None,
) -> ZoteroSyncStatus:
    return ZoteroSyncStatus(
        configured=bool(credential and credential.connected),
        pending=bool(
            credential
            and credential.connected
            and state
            and (state.due_at <= utc_now() or state.target_version is not None)
        ),
        library_version=state.library_version if state else 0,
        last_sync_at=state.last_sync_at if state else None,
        retry_after=credential.retry_after if credential else None,
        last_error_code=credential.last_error_code if credential else None,
    )


@router.get("", response_model=ZoteroSyncStatus, operation_id="research_zotero_sync_status")
async def get_sync_status(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ZoteroSyncStatus:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    credential = await db.scalar(
        select(IntegrationCredential).where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == "zotero",
        )
    )
    state = (
        await db.scalar(
            select(ZoteroSyncState).where(
                ZoteroSyncState.credential_id == credential.id,
                ZoteroSyncState.space_id == space_id,
            )
        )
        if credential
        else None
    )
    return status_of(credential, state)


@router.post(
    "",
    response_model=ZoteroSyncStatus,
    operation_id="research_zotero_sync_trigger",
    status_code=202,
    dependencies=[Depends(write_boundary)],
)
async def trigger_sync(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ZoteroSyncStatus:
    await db.scalar(
        select(User.id).where(User.id == context.user.id).with_for_update(key_share=True)
    )
    credential = await db.scalar(
        select(IntegrationCredential)
        .where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == "zotero",
        )
        .with_for_update()
    )
    if credential is None or not credential.connected:
        raise integration_error("ZOTERO_CONNECTION_TEST_REQUIRED", 409)
    await service.authorize(db, context, workspace_id, space_id, request_id(request), write=True)
    state = await db.scalar(
        select(ZoteroSyncState)
        .where(
            ZoteroSyncState.credential_id == credential.id,
            ZoteroSyncState.space_id == space_id,
        )
        .with_for_update()
    )
    if state is None:
        state = ZoteroSyncState(
            credential_id=credential.id,
            workspace_id=workspace_id,
            space_id=space_id,
        )
        db.add(state)
    state.due_at = max(utc_now(), credential.retry_after or utc_now())
    await db.flush()
    result = status_of(credential, state)
    await db.commit()
    return result
