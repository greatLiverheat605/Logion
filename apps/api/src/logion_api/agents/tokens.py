import secrets
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from uuid6 import uuid7

from logion_api.agents.models import AgentToken
from logion_api.agents.schemas import (
    AgentTokenCreate,
    AgentTokenIssued,
    AgentTokenPage,
    AgentTokenView,
)
from logion_api.agents.security import PREFIX, digest, lock_scope, require_enabled
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.identity.models import User
from logion_api.integrations.routes import write_boundary
from logion_api.library.service import not_found

router = APIRouter(
    prefix="/api/v1/research/agent-tokens",
    tags=["agent-management"],
    dependencies=[Depends(require_enabled)],
)


def audit(db: DatabaseSession, request: Request, user: UUID, token: UUID, action: str) -> None:
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"agent.token_{action}",
            result="success",
            actor_id=user,
            target_type="agent_token",
            target_id=token,
            metadata={},
        )
    )


@router.get("", response_model=AgentTokenPage, operation_id="agent_token_list")
async def list_tokens(
    context: AuthContextDependency,
    db: DatabaseSession,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AgentTokenPage:
    query = select(AgentToken).where(AgentToken.user_id == context.user.id)
    if cursor:
        query = query.where(AgentToken.id < cursor)
    rows = list(await db.scalars(query.order_by(AgentToken.id.desc()).limit(limit + 1)))
    return AgentTokenPage(
        tokens=[AgentTokenView.model_validate(row) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.post(
    "",
    response_model=AgentTokenIssued,
    status_code=201,
    operation_id="agent_token_create",
    dependencies=[Depends(write_boundary)],
)
async def create_token(
    payload: AgentTokenCreate, request: Request, context: AuthContextDependency, db: DatabaseSession
) -> AgentTokenIssued:
    now = utc_now()
    if not now < payload.expires_at <= now + timedelta(days=365):
        raise APIError(
            code="AGENT_EXPIRY_INVALID",
            message="Token expiry must be within the next 365 days.",
            status_code=422,
        )
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    await lock_scope(db, context.user.id, payload.workspace_id, payload.space_id)
    count = await db.scalar(
        select(func.count())
        .select_from(AgentToken)
        .where(
            AgentToken.user_id == context.user.id,
            AgentToken.revoked_at.is_(None),
            AgentToken.expires_at > now,
        )
    )
    if (count or 0) >= 20:
        raise APIError(
            code="AGENT_TOKEN_QUOTA",
            message="Revoke an active token before creating another.",
            status_code=409,
        )
    identity = uuid7()
    raw = f"{PREFIX}{identity.hex}_{secrets.token_urlsafe(32)}"
    token = AgentToken(
        id=identity,
        user_id=context.user.id,
        workspace_id=payload.workspace_id,
        space_id=payload.space_id,
        name=payload.name,
        token_digest=digest(raw),
        scopes=payload.scopes,
        created_at=now,
        expires_at=payload.expires_at,
    )
    db.add(token)
    audit(db, request, context.user.id, token.id, "created")
    await db.flush()
    result = AgentTokenIssued(token=raw, detail=AgentTokenView.model_validate(token))
    await db.commit()
    return result


@router.post(
    "/{token_id}/revoke",
    response_model=AgentTokenView,
    operation_id="agent_token_revoke",
    dependencies=[Depends(write_boundary)],
)
async def revoke_token(
    token_id: UUID, request: Request, context: AuthContextDependency, db: DatabaseSession
) -> AgentTokenView:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    token = await db.scalar(
        select(AgentToken)
        .where(AgentToken.id == token_id, AgentToken.user_id == context.user.id)
        .with_for_update()
    )
    if token is None:
        raise not_found()
    if token.revoked_at is None:
        token.revoked_at = utc_now()
        audit(db, request, context.user.id, token.id, "revoked")
    result = AgentTokenView.model_validate(token)
    await db.commit()
    return result
