"""One durable, bounded Zotero request per worker slice; no outbound writes."""

import json
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import User
from logion_api.integrations.keyring import decrypt
from logion_api.integrations.models import IntegrationCredential, ZoteroSyncState
from logion_api.integrations.network import (
    IntegrationResponse,
    integration_error,
    request_integration,
)
from logion_api.integrations.zotero_mapping import ZoteroMapper
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership

PHASES = ("collections", "items", "attachments", "annotations", "deleted")
PAGE_SIZE = 100


def retry_time(value: str | None, now: datetime) -> datetime | None:
    if not value:
        return None
    try:
        # Bound arithmetic, never shorten a valid provider deadline.
        if value.strip().isdigit():
            return now + timedelta(seconds=int(value))
        date = parsedate_to_datetime(value)
        if date.tzinfo is None:
            date = date.replace(tzinfo=UTC)
        return max(now, date)
    except (ValueError, TypeError, OverflowError):
        return now + timedelta(minutes=30)


def observe_backoff(credential: IntegrationCredential, response: IntegrationResponse) -> None:
    now = utc_now()
    candidates = [
        value
        for value in (
            credential.retry_after,
            retry_time(response.headers.get("Backoff"), now),
            retry_time(response.headers.get("Retry-After"), now),
        )
        if value is not None and value > now
    ]
    if response.status == 429 and not candidates:
        candidates.append(now + timedelta(minutes=30))
    if candidates:
        credential.retry_after = max(candidates)


class ZoteroSyncService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def execute_next(self) -> bool:
        if not self.settings.research_v3_enabled:
            return False
        now = utc_now()
        async with session_factory() as db:
            candidate = (
                await db.execute(
                    select(
                        ZoteroSyncState.id, IntegrationCredential.id, IntegrationCredential.user_id
                    )
                    .join(
                        IntegrationCredential,
                        IntegrationCredential.id == ZoteroSyncState.credential_id,
                    )
                    .where(
                        IntegrationCredential.provider == "zotero",
                        IntegrationCredential.connected.is_(True),
                        or_(
                            IntegrationCredential.retry_after.is_(None),
                            IntegrationCredential.retry_after <= now,
                        ),
                        ZoteroSyncState.due_at <= now,
                    )
                    .order_by(ZoteroSyncState.due_at, ZoteroSyncState.id)
                    .limit(1)
                )
            ).first()
            if candidate is None:
                return False
            # Same lock order as account configuration/revocation: owner, credential, target.
            user = await db.scalar(
                select(User)
                .where(User.id == candidate[2])
                .with_for_update(skip_locked=True, key_share=True)
            )
            if user is None:
                return False
            credential = await db.scalar(
                select(IntegrationCredential)
                .where(IntegrationCredential.id == candidate[1])
                .with_for_update()
            )
            state = await db.scalar(
                select(ZoteroSyncState).where(ZoteroSyncState.id == candidate[0]).with_for_update()
            )
            if (
                credential is None
                or state is None
                or not credential.connected
                or state.due_at > now
                or (credential.retry_after is not None and credential.retry_after > now)
            ):
                return False
            try:
                await self.authorize(db, user, state)
                await self.step(db, credential, state)
            except APIError as exc:
                credential.last_error_code = exc.code
                if exc.code in {"INTEGRATION_AUTH_FAILED", "INTEGRATION_KEY_UNAVAILABLE"}:
                    credential.connected = False
                state.due_at = (
                    credential.retry_after
                    if exc.code == "ZOTERO_RATE_LIMITED" and credential.retry_after is not None
                    else max(utc_now() + timedelta(minutes=30), credential.retry_after or utc_now())
                )
                db.add(
                    new_audit_event(
                        request_id="zotero-worker",
                        event_type="integration.sync",
                        actor_id=credential.user_id,
                        target_type="integration",
                        result="failed",
                        metadata={"provider": "zotero"},
                    )
                )
            await db.commit()
            return True

    @staticmethod
    async def authorize(db: AsyncSession, user: User, state: ZoteroSyncState) -> None:
        access = await db.scalar(
            select(Space.id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
            .where(
                Space.id == state.space_id,
                Space.workspace_id == state.workspace_id,
                Space.status == "active",
                Space.deleted_at.is_(None),
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
                WorkspaceMembership.user_id == user.id,
                WorkspaceMembership.status == "active",
                or_(Space.visibility == "shared", Space.owner_user_id == user.id),
            )
            .with_for_update()
        )
        if user.status != "active" or access is None:
            raise integration_error("ZOTERO_SYNC_ACCESS_REVOKED", 403)

    async def step(
        self,
        db: AsyncSession,
        credential: IntegrationCredential,
        state: ZoteroSyncState,
    ) -> None:
        secret = json.loads(
            decrypt(self.settings.integration_keyring, credential.envelope, aad=credential.aad)
        )
        user_id = secret.get("zotero_user_id")
        if not isinstance(user_id, int) or not 0 < user_id < 2**63:
            raise integration_error("ZOTERO_CONNECTION_TEST_REQUIRED", 409)
        library = f"users/{user_id}"
        if state.library_id != library:
            state.library_id, state.library_version, state.target_version = library, 0, None
            state.phase, state.page_offset, state.collections, state.item_map = (
                "collections",
                0,
                {},
                {},
            )
        params: dict[str, Any] = {"since": state.library_version}
        suffix = state.phase
        if suffix == "items":
            suffix = "items/top"
        elif suffix in {"attachments", "annotations"}:
            params["itemType"] = "attachment" if suffix == "attachments" else "annotation"
            suffix = "items"
        if state.phase != "deleted":
            # Zotero rejects sort=version (HTTP 400). The Last-Modified-Version check below
            # restarts pagination if the library changes before all phases complete.
            params.update(
                start=state.page_offset, limit=PAGE_SIZE, sort="dateModified", direction="asc"
            )
            if state.phase != "collections":
                params["includeTrashed"] = 1
        response = await request_integration(
            self.settings,
            "zotero",
            "GET",
            f"/{library}/{suffix}?{urlencode(params)}",
            headers={
                "Zotero-API-Key": secret["credential"],
                "Zotero-API-Version": "3",
                "If-Modified-Since-Version": str(state.library_version),
            },
            max_bytes=4 * 1024 * 1024,
        )
        observe_backoff(credential, response)
        if response.status in (401, 403):
            raise integration_error("INTEGRATION_AUTH_FAILED")
        if response.status == 429:
            raise integration_error("ZOTERO_RATE_LIMITED", 429)
        if response.status not in (200, 304):
            raise integration_error("INTEGRATION_UNAVAILABLE", 503)
        try:
            version = int(response.headers["Last-Modified-Version"])
            if not state.library_version <= version < 2**63:
                raise ValueError("Library version regressed")
            if state.target_version is not None and state.target_version != version:
                # Concurrent remote edits: revisit all changes since the completed cursor.
                state.phase, state.page_offset, state.target_version = "collections", 0, None
                state.due_at = max(utc_now(), credential.retry_after or utc_now())
                return
            state.target_version = version
            entries = (
                json.loads(response.body)
                if response.status == 200
                else ({} if state.phase == "deleted" else [])
            )
            # Keep successful Backoff metadata even if mapping this page rolls back.
            async with db.begin_nested():
                mapper = ZoteroMapper(
                    db, credential, state, self.settings.research_entity_per_user_quota
                )
                if state.phase == "deleted":
                    if not isinstance(entries, dict):
                        raise ValueError("Expected deletion map")
                    await mapper.deleted(entries)
                else:
                    if not isinstance(entries, list) or len(entries) > PAGE_SIZE:
                        raise ValueError("Expected bounded page")
                    await mapper.apply(entries)
                await db.flush()
        except APIError:
            await db.refresh(state)
            raise
        except (ValueError, KeyError, TypeError, AttributeError, IntegrityError) as exc:
            await db.refresh(state)
            raise integration_error("ZOTERO_RESPONSE_INVALID") from exc
        # 304 applies to the entire library on a first collection request.
        if state.phase == "deleted" or (response.status == 304 and state.phase == "collections"):
            state.library_version = version
            state.target_version, state.phase, state.page_offset = None, "collections", 0
            state.last_sync_at = credential.last_sync_at = utc_now()
            state.due_at = utc_now() + timedelta(minutes=30)
            credential.last_error_code = None
            db.add(
                new_audit_event(
                    request_id="zotero-worker",
                    event_type="integration.sync",
                    actor_id=credential.user_id,
                    target_type="integration",
                    result="success",
                    metadata={"provider": "zotero"},
                )
            )
        else:
            if len(entries) == PAGE_SIZE:
                state.page_offset += PAGE_SIZE
                if state.page_offset > self.settings.research_entity_per_user_quota * 4:
                    raise integration_error("RESOURCE_QUOTA_EXCEEDED", 409)
            else:
                state.phase = PHASES[PHASES.index(state.phase) + 1]
                state.page_offset = 0
            state.due_at = utc_now()
        state.due_at = max(state.due_at, credential.retry_after or state.due_at)
