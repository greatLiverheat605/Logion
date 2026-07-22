import asyncio
import math
from collections.abc import Callable
from datetime import date
from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.crypto import AIProviderCredentialCipher
from logion_api.ai_gateway.generation_adapter import (
    GeneratedDraft,
    OpenAICompatibleGenerationAdapter,
)
from logion_api.ai_gateway.models import (
    AIModel,
    AIOutputDraft,
    AIProvider,
    AIRun,
    AIRunCandidate,
    AIUsageMonthly,
)
from logion_api.ai_gateway.run_crypto import AIRunInputCipher
from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event

FALLBACK_ERRORS = {"AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_UNAVAILABLE"}


class AIExecutionService:
    def __init__(
        self,
        settings: Settings,
        adapter_factory: Callable[[], OpenAICompatibleGenerationAdapter] | None = None,
    ) -> None:
        self._settings = settings
        self._provider_cipher = AIProviderCredentialCipher(settings)
        self._input_cipher = AIRunInputCipher(settings)
        self._adapter_factory = adapter_factory or (
            lambda: OpenAICompatibleGenerationAdapter(
                max_response_bytes=settings.ai_provider_response_max_bytes
            )
        )

    async def execute_next(self) -> bool:
        async with session_factory() as db:
            run = await db.scalar(
                select(AIRun)
                .where(AIRun.status == "queued")
                .order_by(AIRun.created_at, AIRun.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if run is None:
                return False
            run.status = "running"
            run.started_at = utc_now()
            run.updated_at = utc_now()
            run.version += 1
            run_id = run.id
            await db.commit()
        await self.execute_run(run_id)
        return True

    async def execute_run(self, run_id: UUID) -> None:
        candidates = await self._candidate_ids(run_id)
        final_error = "AI_ROUTE_UNAVAILABLE"
        for candidate_id in candidates:
            if await self._is_cancelled(run_id):
                await self._finish_cancelled(run_id)
                return
            try:
                candidate, run, model, provider, input_fields = await self._load_attempt(
                    run_id, candidate_id
                )
            except APIError as exc:
                final_error = exc.code
                if exc.code in FALLBACK_ERRORS:
                    continue
                await self._finish_failed(run_id, exc.code)
                return
            attempts = min(provider.max_retries, 2) + 1
            for retry_index in range(attempts):
                if await self._is_cancelled(run_id):
                    await self._finish_cancelled(run_id)
                    return
                await self._record_attempt(run_id)
                credential = ""
                try:
                    credential = self._provider_cipher.decrypt(provider)
                    result = await self._adapter_factory().generate(
                        base_url=provider.base_url,
                        credential=credential,
                        provider_model_id=model.provider_model_id,
                        input_fields=input_fields,
                        expected_output_fields=run.expected_output_fields,
                        max_output_tokens=run.requested_output_tokens,
                        timeout_seconds=provider.timeout_seconds,
                        cancelled=lambda: self._is_cancelled(run_id),
                    )
                except APIError as exc:
                    final_error = exc.code
                    if exc.code == "AI_RUN_CANCELLED":
                        await self._finish_cancelled(run_id)
                        return
                    if exc.code not in FALLBACK_ERRORS:
                        await self._finish_failed(run_id, exc.code)
                        return
                    if retry_index + 1 < attempts:
                        await asyncio.sleep(min(2**retry_index, 4))
                        continue
                    break
                finally:
                    credential = ""
                await self._finish_succeeded(run_id, candidate, model, result)
                return
        await self._finish_failed(run_id, final_error)

    async def _candidate_ids(self, run_id: UUID) -> list[UUID]:
        async with session_factory() as db:
            return list(
                (
                    await db.scalars(
                        select(AIRunCandidate.id)
                        .where(AIRunCandidate.run_id == run_id)
                        .order_by(AIRunCandidate.position)
                    )
                ).all()
            )

    async def _load_attempt(
        self, run_id: UUID, candidate_id: UUID
    ) -> tuple[AIRunCandidate, AIRun, AIModel, AIProvider, dict[str, str]]:
        async with session_factory() as db:
            candidate = await db.get(AIRunCandidate, candidate_id)
            run = await db.get(AIRun, run_id)
            if candidate is None or run is None or candidate.run_id != run_id:
                raise APIError(
                    code="AI_RUN_STATE_INVALID",
                    message="The AI run state requires administrator review.",
                    status_code=503,
                )
            model = await db.scalar(
                select(AIModel).where(
                    AIModel.id == candidate.model_id,
                    AIModel.workspace_id == run.workspace_id,
                    AIModel.enabled.is_(True),
                    AIModel.deleted_at.is_(None),
                )
            )
            provider = await db.scalar(
                select(AIProvider).where(
                    AIProvider.id == candidate.provider_id,
                    AIProvider.workspace_id == run.workspace_id,
                    AIProvider.enabled.is_(True),
                    AIProvider.last_health_status == "healthy",
                    AIProvider.deleted_at.is_(None),
                )
            )
            if model is None or provider is None:
                raise APIError(
                    code="AI_PROVIDER_UNAVAILABLE",
                    message="The selected AI Provider is unavailable.",
                    status_code=503,
                    retryable=True,
                )
            return candidate, run, model, provider, self._input_cipher.decrypt(run)

    async def _record_attempt(self, run_id: UUID) -> None:
        async with session_factory() as db:
            run = await db.scalar(select(AIRun).where(AIRun.id == run_id).with_for_update())
            if run is None or run.status != "running":
                raise APIError(
                    code="AI_RUN_STATE_INVALID",
                    message="The AI run state requires administrator review.",
                    status_code=503,
                )
            run.attempt_count += 1
            run.version += 1
            run.updated_at = utc_now()
            await db.commit()

    async def _is_cancelled(self, run_id: UUID) -> bool:
        async with session_factory() as db:
            run = await db.get(AIRun, run_id)
            return run is None or run.cancel_requested_at is not None or run.status == "cancelled"

    async def _finish_succeeded(
        self,
        run_id: UUID,
        candidate: AIRunCandidate,
        model: AIModel,
        result: GeneratedDraft,
    ) -> None:
        async with session_factory() as db:
            run = await db.scalar(select(AIRun).where(AIRun.id == run_id).with_for_update())
            if run is None or run.status != "running":
                return
            if run.cancel_requested_at is not None:
                await self._terminal(db, run, "cancelled", "AI_RUN_CANCELLED", None, None)
                await db.commit()
                return
            actual_tokens = result.input_tokens + result.output_tokens
            actual_cost = math.ceil(
                (
                    result.input_tokens * model.input_cost_per_million_minor
                    + result.output_tokens * model.output_cost_per_million_minor
                )
                / 1_000_000
            )
            run.selected_model_id = candidate.model_id
            run.selected_provider_id = candidate.provider_id
            run.selected_candidate_position = candidate.position
            run.actual_input_tokens = result.input_tokens
            run.actual_output_tokens = result.output_tokens
            run.actual_cost_minor = actual_cost
            db.add(
                AIOutputDraft(
                    workspace_id=run.workspace_id,
                    run_id=run.id,
                    target_type=run.target_type,
                    target_id=run.target_id,
                    target_version=run.target_version,
                    structured_output=result.output,
                )
            )
            await self._terminal(db, run, "succeeded", None, actual_tokens, actual_cost)
            await db.commit()

    async def _finish_failed(self, run_id: UUID, error_code: str) -> None:
        async with session_factory() as db:
            run = await db.scalar(select(AIRun).where(AIRun.id == run_id).with_for_update())
            if run is None or run.status not in {"queued", "running"}:
                return
            await self._terminal(db, run, "failed", error_code, None, None)
            await db.commit()

    async def _finish_cancelled(self, run_id: UUID) -> None:
        async with session_factory() as db:
            run = await db.scalar(select(AIRun).where(AIRun.id == run_id).with_for_update())
            if run is None or run.status in {"succeeded", "failed", "cancelled"}:
                return
            await self._terminal(db, run, "cancelled", "AI_RUN_CANCELLED", None, None)
            await db.commit()

    async def _terminal(
        self,
        db: AsyncSession,
        run: AIRun,
        status: Literal["succeeded", "failed", "cancelled"],
        error_code: str | None,
        actual_tokens: int | None,
        actual_cost: int | None,
    ) -> None:
        usage = await db.scalar(
            select(AIUsageMonthly)
            .where(
                AIUsageMonthly.workspace_id == run.workspace_id,
                AIUsageMonthly.period_start == self._period_start(run.created_at.date()),
            )
            .with_for_update()
        )
        if (
            usage is None
            or usage.reserved_tokens < run.reserved_tokens
            or usage.reserved_cost_minor < run.reserved_cost_minor
        ):
            raise APIError(
                code="AI_BUDGET_LEDGER_INVALID",
                message="The AI usage ledger requires administrator review.",
                status_code=503,
            )
        usage.reserved_tokens -= run.reserved_tokens
        usage.reserved_cost_minor -= run.reserved_cost_minor
        if actual_tokens is not None and actual_cost is not None:
            usage.consumed_tokens += actual_tokens
            usage.consumed_cost_minor += actual_cost
        usage.version += 1
        usage.updated_at = utc_now()
        run.status = status
        run.error_code = error_code
        run.completed_at = utc_now()
        run.updated_at = utc_now()
        run.version += 1
        if not run.retain_input:
            self._clear_input(run)
        db.add(
            new_audit_event(
                request_id=f"worker:{run.id}",
                event_type=f"ai.run_{status}",
                result="success" if status == "succeeded" else status,
                actor_id=run.requested_by,
                workspace_id=run.workspace_id,
                target_type="ai_run",
                target_id=run.id,
                metadata={
                    "attempt_count": run.attempt_count,
                    "error_code": error_code,
                    "actual_tokens": actual_tokens,
                    "actual_cost_minor": actual_cost,
                },
            )
        )

    @staticmethod
    def _clear_input(run: AIRun) -> None:
        run.input_ciphertext = None
        run.input_nonce = None
        run.input_data_key_ciphertext = None
        run.input_data_key_nonce = None
        run.input_encryption_key_id = None

    @staticmethod
    def _period_start(value: date) -> date:
        return value.replace(day=1)
