import base64
import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import select
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.identity.models import User
from logion_api.integrations.keyring import decrypt, encrypt
from logion_api.integrations.models import IntegrationCredential
from logion_api.integrations.network import Provider, integration_error, request_integration
from logion_api.library.routes import require_enabled


class IntegrationSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credential: SecretStr = Field(min_length=1, max_length=4096)
    username: SecretStr | None = Field(default=None, min_length=1, max_length=320)


class IntegrationStatus(BaseModel):
    provider: Provider
    configured: bool
    connected: bool
    last_sync_at: datetime | None
    last_error_code: str | None


def status_of(provider: Provider, row: IntegrationCredential | None) -> IntegrationStatus:
    return IntegrationStatus(
        provider=provider,
        configured=row is not None,
        connected=bool(row and row.connected),
        last_sync_at=row.last_sync_at if row else None,
        last_error_code=row.last_error_code if row else None,
    )


async def write_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session, x_csrf_token, request.cookies.get(settings.csrf_cookie_name)
    )
    identity.require_recent_authentication(context)
    await limiter.enforce(
        scope="integration_write",
        subject_hash=get_security().privacy_hash(str(context.user.id)) or "unknown",
        limit=30,
        window=3600,
    )


router = APIRouter(
    prefix="/api/v1/research/integrations",
    tags=["research-integrations"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)},
)


@router.get(
    "/{provider}", response_model=IntegrationStatus, operation_id="research_integration_status"
)
async def get_status(
    provider: Provider, context: AuthContextDependency, db: DatabaseSession
) -> IntegrationStatus:
    row = await db.scalar(
        select(IntegrationCredential).where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == provider,
        )
    )
    return status_of(provider, row)


@router.put(
    "/{provider}",
    response_model=IntegrationStatus,
    operation_id="research_integration_set",
    dependencies=[Depends(write_boundary)],
)
async def set_credential(
    provider: Provider,
    payload: IntegrationSet,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> IntegrationStatus:
    if provider == "webdav" and payload.username is None:
        raise integration_error("INTEGRATION_USERNAME_REQUIRED")
    credential = payload.credential.get_secret_value()
    username = payload.username.get_secret_value() if payload.username else None
    if any(c in credential for c in "\r\n") or (
        username is not None and any(c in username for c in ":\r\n")
    ):
        raise integration_error("INTEGRATION_CREDENTIAL_INVALID")
    # Serialize updates and first creation for this owner, including concurrent tabs.
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    row = await db.scalar(
        select(IntegrationCredential).where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == provider,
        )
    )
    if row is None:
        row = IntegrationCredential(id=uuid7(), user_id=context.user.id, provider=provider)
        db.add(row)
    envelope = encrypt(
        settings.integration_keyring,
        json.dumps({"credential": credential, "username": username}).encode(),
        aad=row.aad,
    )
    for field in ("ciphertext", "nonce", "wrapped_key", "key_nonce", "key_id"):
        setattr(row, field, getattr(envelope, field))
    row.connected, row.last_error_code, row.updated_at = False, None, utc_now()
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type="integration.set",
            actor_id=context.user.id,
            result="success",
            target_type="integration",
            metadata={"provider": provider},
        )
    )
    await db.flush()
    result = status_of(provider, row)
    await db.commit()
    return result


@router.delete(
    "/{provider}",
    status_code=204,
    operation_id="research_integration_revoke",
    dependencies=[Depends(write_boundary)],
)
async def revoke(
    provider: Provider, request: Request, context: AuthContextDependency, db: DatabaseSession
) -> Response:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    row = await db.scalar(
        select(IntegrationCredential)
        .where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == provider,
        )
        .with_for_update()
    )
    if row:
        await db.delete(row)
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type="integration.revoke",
            actor_id=context.user.id,
            result="success",
            target_type="integration",
            metadata={"provider": provider},
        )
    )
    await db.commit()
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})


def has_write_access(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            (key == "write" and bool(item)) or has_write_access(item) for key, item in value.items()
        )
    return isinstance(value, list) and any(has_write_access(item) for item in value)


@router.post(
    "/{provider}/test",
    response_model=IntegrationStatus,
    operation_id="research_integration_test",
    dependencies=[Depends(write_boundary)],
)
async def test_connection(
    provider: Provider,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> IntegrationStatus:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    row = await db.scalar(
        select(IntegrationCredential)
        .where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == provider,
        )
        .with_for_update()
    )
    if row is None:
        raise integration_error("INTEGRATION_NOT_CONFIGURED", 409)
    try:
        secret = json.loads(decrypt(settings.integration_keyring, row.envelope, aad=row.aad))
        if provider == "zotero":
            response = await request_integration(
                settings,
                provider,
                "GET",
                "/keys/current",
                headers={"Zotero-API-Key": secret["credential"], "Zotero-API-Version": "3"},
            )
        else:
            basic = base64.b64encode(
                f"{secret['username']}:{secret['credential']}".encode()
            ).decode()
            response = await request_integration(
                settings,
                provider,
                "PROPFIND",
                "/dav/",
                headers={"Authorization": f"Basic {basic}", "Depth": "0"},
            )
        if response.status in (401, 403):
            raise integration_error("INTEGRATION_AUTH_FAILED")
        if response.status not in (200, 207):
            raise integration_error("INTEGRATION_UNAVAILABLE", 503)
        if provider == "zotero":
            body = json.loads(response.body)
            access = body.get("access", {})
            if not access.get("user", {}).get("library") or has_write_access(access):
                raise integration_error("ZOTERO_READ_ONLY_KEY_REQUIRED")
            if not isinstance(body.get("userID"), int) or body["userID"] <= 0:
                raise integration_error("INTEGRATION_RESPONSE_INVALID")
            secret["zotero_user_id"] = body["userID"]
            envelope = encrypt(
                settings.integration_keyring, json.dumps(secret).encode(), aad=row.aad
            )
            for field in ("ciphertext", "nonce", "wrapped_key", "key_nonce", "key_id"):
                setattr(row, field, getattr(envelope, field))
        row.connected, row.last_error_code = True, None
    except (ValueError, KeyError, TypeError, AttributeError):
        row.connected, row.last_error_code = False, "INTEGRATION_RESPONSE_INVALID"
    except APIError as exc:
        row.connected, row.last_error_code = False, exc.code
    row.updated_at = utc_now()
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type="integration.test",
            actor_id=context.user.id,
            result="success" if row.connected else "failed",
            target_type="integration",
            metadata={"provider": provider},
        )
    )
    result = status_of(provider, row)
    await db.commit()
    return result
