import unicodedata
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.crypto import AIProviderCredentialCipher, validate_provider_base_url
from logion_api.ai_gateway.models import AIProvider
from logion_api.ai_gateway.schemas import AIProviderCreate, AIProviderUpdate
from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Workspace
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


class AIProviderService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces
        self._cipher = AIProviderCredentialCipher(settings)

    async def authorize(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        request_id: str,
    ) -> None:
        await self._workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.AI_CONFIGURE,
        )

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: AIProviderCreate,
        request_id: str,
    ) -> AIProvider:
        await self.authorize(db, context, workspace_id, request_id)
        await db.scalar(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update())
        existing = await db.get(AIProvider, payload.id)
        if existing is not None and existing.workspace_id != workspace_id:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="AI Provider not found.", status_code=404
            )
        if existing is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        count = int(
            await db.scalar(
                select(func.count(AIProvider.id)).where(
                    AIProvider.workspace_id == workspace_id,
                    AIProvider.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.ai_provider_per_workspace_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="AI Provider limit reached.",
                status_code=409,
            )
        normalized_name = self._normalized_name(payload.name)
        base_url = self._base_url(payload.base_url)
        encrypted = self._cipher.encrypt(
            workspace_id, payload.id, payload.credential.get_secret_value()
        )
        provider = AIProvider(
            id=payload.id,
            workspace_id=workspace_id,
            name=payload.name,
            normalized_name=normalized_name,
            provider_type=payload.provider_type,
            base_url=base_url,
            credential_ciphertext=encrypted.credential_ciphertext,
            credential_nonce=encrypted.credential_nonce,
            data_key_ciphertext=encrypted.data_key_ciphertext,
            data_key_nonce=encrypted.data_key_nonce,
            encryption_key_id=encrypted.encryption_key_id,
            enabled=payload.enabled,
            timeout_seconds=payload.timeout_seconds,
            max_retries=payload.max_retries,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        try:
            async with db.begin_nested():
                db.add(provider)
                await db.flush()
        except IntegrityError as exc:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="An AI Provider with this name already exists.",
                status_code=409,
            ) from exc
        db.add(self._audit(provider, context, request_id, "created"))
        return provider

    async def list(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        request_id: str,
    ) -> list[AIProvider]:
        await self.authorize(db, context, workspace_id, request_id)
        return list(
            (
                await db.scalars(
                    select(AIProvider)
                    .where(
                        AIProvider.workspace_id == workspace_id,
                        AIProvider.deleted_at.is_(None),
                    )
                    .order_by(AIProvider.normalized_name, AIProvider.id)
                    .limit(self._settings.ai_provider_per_workspace_quota)
                )
            ).all()
        )

    async def update(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        provider_id: UUID,
        payload: AIProviderUpdate,
        request_id: str,
    ) -> AIProvider:
        await self.authorize(db, context, workspace_id, request_id)
        provider = await self._provider(db, workspace_id, provider_id, lock=True)
        if provider.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The AI Provider changed.",
                status_code=409,
            )
        try:
            async with db.begin_nested():
                provider.name = payload.name
                provider.normalized_name = self._normalized_name(payload.name)
                provider.base_url = self._base_url(payload.base_url)
                provider.enabled = payload.enabled
                provider.timeout_seconds = payload.timeout_seconds
                provider.max_retries = payload.max_retries
                if payload.credential is not None:
                    encrypted = self._cipher.encrypt(
                        workspace_id, provider_id, payload.credential.get_secret_value()
                    )
                    provider.credential_ciphertext = encrypted.credential_ciphertext
                    provider.credential_nonce = encrypted.credential_nonce
                    provider.data_key_ciphertext = encrypted.data_key_ciphertext
                    provider.data_key_nonce = encrypted.data_key_nonce
                    provider.encryption_key_id = encrypted.encryption_key_id
                provider.version += 1
                provider.updated_by = context.user.id
                provider.updated_at = utc_now()
                await db.flush()
        except IntegrityError as exc:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="An AI Provider with this name already exists.",
                status_code=409,
            ) from exc
        db.add(self._audit(provider, context, request_id, "updated"))
        return provider

    async def delete(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        provider_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> None:
        await self.authorize(db, context, workspace_id, request_id)
        provider = await self._provider(db, workspace_id, provider_id, lock=True)
        if provider.version != expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The AI Provider changed.",
                status_code=409,
            )
        provider.deleted_at = utc_now()
        provider.credential_ciphertext = None
        provider.credential_nonce = None
        provider.data_key_ciphertext = None
        provider.data_key_nonce = None
        provider.encryption_key_id = None
        provider.version += 1
        provider.updated_by = context.user.id
        provider.updated_at = utc_now()
        db.add(self._audit(provider, context, request_id, "deleted"))
        await db.flush()

    async def _provider(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        provider_id: UUID,
        *,
        lock: bool,
    ) -> AIProvider:
        statement = select(AIProvider).where(
            AIProvider.id == provider_id,
            AIProvider.workspace_id == workspace_id,
            AIProvider.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update()
        provider = await db.scalar(statement)
        if provider is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="AI Provider not found.", status_code=404
            )
        return provider

    @staticmethod
    def _base_url(value: str) -> str:
        try:
            return validate_provider_base_url(value)
        except ValueError as exc:
            raise APIError(
                code="AI_PROVIDER_URL_BLOCKED",
                message="The AI Provider base URL is not allowed.",
                status_code=422,
            ) from exc

    @staticmethod
    def _normalized_name(value: str) -> str:
        return unicodedata.normalize("NFKC", value).casefold()

    @staticmethod
    def _audit(
        provider: AIProvider,
        context: AuthContext,
        request_id: str,
        action: str,
    ) -> AuditEvent:
        return new_audit_event(
            request_id=request_id,
            event_type=f"ai.provider_{action}",
            result="success",
            actor_id=context.user.id,
            workspace_id=provider.workspace_id,
            target_type="ai_provider",
            target_id=provider.id,
            metadata={},
        )
