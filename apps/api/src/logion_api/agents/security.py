"""PATs never participate in cookie/session authentication."""

import hashlib
import re
from collections.abc import Awaitable, Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.agents.models import AgentToken
from logion_api.config import get_settings
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError, api_error_handler
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    SettingsDependency,
    get_rate_limiter,
    get_security,
)
from logion_api.identity.models import User
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership

PREFIX = "logion_pat_"
TOKEN_PATTERN = re.compile(r"^logion_pat_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def require_enabled(settings: SettingsDependency, response: Response) -> None:
    if not settings.research_v3_enabled or not settings.agent_api_enabled:
        raise APIError(code="NOT_FOUND", message="Not found.", status_code=404)
    response.headers["Cache-Control"] = "private, no-store"


def denied(code: str = "AGENT_TOKEN_INVALID", status: int = 401) -> APIError:
    return APIError(
        code=code,
        message="Agent access is unavailable or not permitted.",
        status_code=status,
        headers={"Cache-Control": "private, no-store"},
    )


async def lock_scope(db: AsyncSession, user: UUID, workspace: UUID, space: UUID) -> None:
    # Same outer order as account deletion/export; share locks last through the request.
    current_user = await db.scalar(
        select(User.id)
        .where(User.id == user, User.status == "active", User.email_verified_at.is_not(None))
        .with_for_update(read=True)
    )
    current_workspace = await db.scalar(
        select(Workspace.id)
        .where(
            Workspace.id == workspace, Workspace.status == "active", Workspace.deleted_at.is_(None)
        )
        .with_for_update(read=True)
    )
    current_space = await db.scalar(
        select(Space.id)
        .where(
            Space.id == space,
            Space.workspace_id == workspace,
            Space.status == "active",
            Space.deleted_at.is_(None),
            (Space.visibility == "shared") | (Space.owner_user_id == user),
        )
        .with_for_update(read=True)
    )
    membership = await db.scalar(
        select(WorkspaceMembership.id)
        .where(
            WorkspaceMembership.workspace_id == workspace,
            WorkspaceMembership.user_id == user,
            WorkspaceMembership.status == "active",
        )
        .with_for_update(read=True)
    )
    if any(value is None for value in (current_user, current_workspace, current_space, membership)):
        raise denied("AGENT_SCOPE_UNAVAILABLE", 403)


async def agent_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    authorization = request.headers.get("authorization", "")
    parts = authorization.split(" ")
    raw = parts[1] if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    agent_path = request.url.path == "/api/v1/agent" or request.url.path.startswith(
        "/api/v1/agent/"
    )
    # Malformed/duplicate PAT headers must not fall back to an ambient session.
    carries_pat = any(PREFIX in value for value in request.headers.getlist("authorization"))
    if not agent_path and not carries_pat:
        return await call_next(request)
    settings = get_settings()
    if not settings.agent_api_enabled or not settings.research_v3_enabled:
        return await api_error_handler(request, denied("NOT_FOUND", 404))
    actor: UUID | None = None
    token_id: UUID | None = None
    operation = "agent.denied_endpoint" if not agent_path else "agent.unknown_endpoint"
    async with session_factory() as db:
        try:
            if not TOKEN_PATTERN.fullmatch(raw):
                await get_rate_limiter().enforce(
                    scope="agent_invalid",
                    subject_hash=get_security().privacy_hash(
                        request.client.host if request.client else "unknown"
                    )
                    or "unknown",
                    limit=60,
                    window=60,
                )
                raise denied()
            token = await db.scalar(
                select(AgentToken).where(AgentToken.token_digest == digest(raw))
            )
            if token is None:
                await get_rate_limiter().enforce(
                    scope="agent_invalid",
                    subject_hash=get_security().privacy_hash(
                        request.client.host if request.client else "unknown"
                    )
                    or "unknown",
                    limit=60,
                    window=60,
                )
                raise denied()
            actor, token_id = token.user_id, token.id
            await get_rate_limiter().enforce(
                scope="agent_token", subject_hash=str(token.id), limit=120, window=60
            )
            await lock_scope(db, actor, token.workspace_id, token.space_id)
            token = await db.scalar(
                select(AgentToken)
                .where(AgentToken.id == token_id, AgentToken.token_digest == digest(raw))
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
            if token is None or token.revoked_at is not None or token.expires_at <= utc_now():
                raise denied()
            if not agent_path:
                raise denied("AGENT_ENDPOINT_FORBIDDEN", 403)
            request.state.agent_token, request.state.agent_db = token, db
            response = await call_next(request)
            operation = getattr(request.scope.get("route"), "operation_id", None) or operation
            if response.status_code < 400:
                db.add(
                    new_audit_event(
                        request_id=request.state.request_id,
                        event_type="agent.request",
                        result="success",
                        actor_id=actor,
                        target_type="agent_token",
                        target_id=token_id,
                        metadata={"operation": operation, "status": response.status_code},
                    )
                )
                await db.commit()
                response.headers["Cache-Control"] = "private, no-store"
                return response
        except APIError as exc:
            response = await api_error_handler(request, exc)
        except Exception:
            await db.rollback()
            if token_id is not None:
                db.add(
                    new_audit_event(
                        request_id=request.state.request_id,
                        event_type="agent.request",
                        result="failed",
                        actor_id=actor,
                        target_type="agent_token",
                        target_id=token_id,
                        metadata={"operation": operation, "status": 500},
                    )
                )
                await db.commit()
            raise
        await db.rollback()
        if token_id is not None:
            db.add(
                new_audit_event(
                    request_id=request.state.request_id,
                    event_type="agent.request",
                    result="denied",
                    actor_id=actor,
                    target_type="agent_token",
                    target_id=token_id,
                    metadata={"operation": operation, "status": response.status_code},
                )
            )
            await db.commit()
        response.headers["Cache-Control"] = "private, no-store"
        return response


def agent_token(request: Request) -> AgentToken:
    token = getattr(request.state, "agent_token", None)
    if not isinstance(token, AgentToken):
        raise denied()
    return token


def agent_database(request: Request) -> AsyncSession:
    return request.state.agent_db  # type: ignore[no-any-return]


Token = Annotated[AgentToken, Depends(agent_token)]
AgentDatabase = Annotated[AsyncSession, Depends(agent_database)]


def require_read(token: Token) -> None:
    if "read" not in token.scopes:
        raise denied("AGENT_SCOPE_FORBIDDEN", 403)


def require_inbox(token: Token) -> None:
    if "inbox:write" not in token.scopes:
        raise denied("AGENT_SCOPE_FORBIDDEN", 403)
