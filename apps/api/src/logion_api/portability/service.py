import csv
import hashlib
import io
import json
import re
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.collaboration.models import GroupFeedback, ReportSnapshot, ReviewRequest, Rubric
from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.db import session_factory, utc_now
from logion_api.engagement.service import EngagementService
from logion_api.errors import APIError
from logion_api.exam.models import Exam, MockExam, ScoreRecord, Subject, SyllabusNode
from logion_api.execution.evidence_models import EvidenceItem, VerificationRecord
from logion_api.execution.models import StudySession, Task
from logion_api.identity.audit import new_audit_event
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
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.portability.crypto import ExportArtifactCipher
from logion_api.portability.models import DataExportJob
from logion_api.research.models import (
    ExperimentRun,
    MetricRecord,
    PaperRecord,
    ResearchClaim,
    ResearchFeedback,
    ResearchQuestion,
)
from logion_api.self_study.models import Deliverable, InboxItem, LearningTrack, StudyProject
from logion_api.workspaces.models import Space, Workspace
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

EXPORT_SCHEMA = "logion-export-v1"
SHARED_MODELS = (
    LearningGoal,
    LearningPlan,
    PlanVersion,
    PlanPhase,
    Task,
    StudySession,
    Note,
    Resource,
    EvidenceItem,
    VerificationRecord,
    Topic,
    TopicDependency,
    QuizItem,
    Rubric,
    ReviewRequest,
    GroupFeedback,
    ReportSnapshot,
)
PERSONAL_MODELS = (
    Exam,
    Subject,
    SyllabusNode,
    MockExam,
    ScoreRecord,
    MasteryRecord,
    ReviewSchedule,
    QuizAttempt,
    ErrorPattern,
    AuditReview,
    ReviewFinding,
    LearningTrack,
    StudyProject,
    InboxItem,
    Deliverable,
    PaperRecord,
    ResearchClaim,
    ResearchQuestion,
    ExperimentRun,
    MetricRecord,
    ResearchFeedback,
)
OMITTED_COLUMNS = {"workspace_id", "user_id", "created_by", "updated_by"}


class PortabilityService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._cipher = ExportArtifactCipher(settings)
        self._workspaces = workspaces

    async def create_export(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        job_id: UUID,
        request_id: str,
    ) -> DataExportJob:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        existing = await db.get(DataExportJob, job_id)
        if existing is not None:
            if existing.workspace_id == workspace_id and existing.requested_by == context.user.id:
                return existing
            raise self._not_found()
        active_count = await db.scalar(
            select(DataExportJob.id)
            .where(
                DataExportJob.workspace_id == workspace_id,
                DataExportJob.requested_by == context.user.id,
                DataExportJob.status.in_(("queued", "running")),
            )
            .limit(3)
        )
        if active_count is not None:
            raise APIError(
                code="EXPORT_ALREADY_PENDING",
                message="Finish or cancel the pending export before creating another.",
                status_code=409,
            )
        now = utc_now()
        row = DataExportJob(
            id=job_id,
            workspace_id=workspace_id,
            requested_by=context.user.id,
            schema_version=EXPORT_SCHEMA,
            expires_at=now + timedelta(hours=24),
        )
        db.add(row)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="data.export_requested",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="data_export",
                target_id=row.id,
                metadata={"schema_version": EXPORT_SCHEMA},
            )
        )
        await db.flush()
        return row

    async def list_exports(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[DataExportJob]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        return list(
            (
                await db.scalars(
                    select(DataExportJob)
                    .where(
                        DataExportJob.workspace_id == workspace_id,
                        DataExportJob.requested_by == context.user.id,
                    )
                    .order_by(DataExportJob.created_at.desc(), DataExportJob.id.desc())
                    .limit(50)
                )
            ).all()
        )

    async def get_artifact(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        export_id: UUID,
        request_id: str,
    ) -> tuple[DataExportJob, bytes]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        row = await db.scalar(
            select(DataExportJob).where(
                DataExportJob.id == export_id,
                DataExportJob.workspace_id == workspace_id,
                DataExportJob.requested_by == context.user.id,
            )
        )
        if row is None or row.status != "succeeded" or row.expires_at <= utc_now():
            raise self._not_found()
        value = self._cipher.decrypt(row)
        if hashlib.sha256(value).hexdigest() != row.artifact_sha256:
            raise APIError(
                code="EXPORT_ARTIFACT_INTEGRITY_FAILED",
                message="The export artifact failed integrity verification.",
                status_code=503,
            )
        return row, value

    async def cancel_export(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        export_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> DataExportJob:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        row = await db.scalar(
            select(DataExportJob)
            .where(
                DataExportJob.id == export_id,
                DataExportJob.workspace_id == workspace_id,
                DataExportJob.requested_by == context.user.id,
            )
            .with_for_update()
        )
        if row is None:
            raise self._not_found()
        if row.version != expected_version:
            raise APIError(
                code="VERSION_CONFLICT",
                message="The export changed. Refresh before retrying.",
                status_code=409,
            )
        if row.status in {"queued", "running"}:
            row.status = "cancelled"
            row.artifact_ciphertext = None
            row.artifact_nonce = None
            row.artifact_encryption_key_id = None
            row.version += 1
            row.completed_at = utc_now()
            await db.flush()
        return row

    async def execute_next(self) -> bool:
        async with session_factory() as db:
            row = await db.scalar(
                select(DataExportJob)
                .where(DataExportJob.status == "queued")
                .order_by(DataExportJob.created_at, DataExportJob.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if row is None:
                return False
            row.status = "running"
            row.started_at = utc_now()
            row.version += 1
            export_id = row.id
            await db.commit()
        await self.execute(export_id)
        return True

    async def execute(self, export_id: UUID) -> None:
        try:
            async with session_factory() as db:
                row = await db.get(DataExportJob, export_id)
                if row is None or row.status != "running":
                    return
                artifact = await self._build_archive(db, row)
                ciphertext, nonce, key_id = self._cipher.encrypt(row.id, row.workspace_id, artifact)
                row = await db.scalar(
                    select(DataExportJob).where(DataExportJob.id == export_id).with_for_update()
                )
                if row is None or row.status != "running":
                    return
                row.artifact_ciphertext = ciphertext
                row.artifact_nonce = nonce
                row.artifact_encryption_key_id = key_id
                row.artifact_sha256 = hashlib.sha256(artifact).hexdigest()
                row.artifact_bytes = len(artifact)
                row.status = "succeeded"
                row.completed_at = utc_now()
                row.version += 1
                await EngagementService.emit(
                    db,
                    workspace_id=row.workspace_id,
                    recipient_user_id=row.requested_by,
                    category="system",
                    title="Data export ready",
                    summary="Your encrypted export artifact is ready for authenticated download.",
                    dedupe_key=f"data-export:{row.id}",
                    target_type="data_export",
                    target_id=row.id,
                )
                db.add(
                    new_audit_event(
                        request_id=f"worker:{row.id}",
                        event_type="data.export_succeeded",
                        result="success",
                        actor_id=row.requested_by,
                        workspace_id=row.workspace_id,
                        target_type="data_export",
                        target_id=row.id,
                        metadata={"artifact_bytes": len(artifact), "schema_version": EXPORT_SCHEMA},
                    )
                )
                await db.commit()
        except Exception:  # noqa: BLE001
            async with session_factory() as db:
                row = await db.scalar(
                    select(DataExportJob).where(DataExportJob.id == export_id).with_for_update()
                )
                if row is not None and row.status == "running":
                    row.status = "failed"
                    row.error_code = "EXPORT_GENERATION_FAILED"
                    row.completed_at = utc_now()
                    row.version += 1
                    await db.commit()

    async def _build_archive(self, db: AsyncSession, job: DataExportJob) -> bytes:
        workspace = await db.get(Workspace, job.workspace_id)
        if workspace is None:
            raise self._not_found()
        spaces = list(
            (
                await db.scalars(
                    select(Space).where(
                        Space.workspace_id == job.workspace_id,
                        Space.status != "deleted",
                        or_(Space.visibility == "shared", Space.owner_user_id == job.requested_by),
                    )
                )
            ).all()
        )
        space_ids = [row.id for row in spaces]
        allowed_plan_ids = select(LearningPlan.id).where(
            LearningPlan.workspace_id == job.workspace_id,
            LearningPlan.space_id.in_(space_ids),
        )
        allowed_plan_version_ids = select(PlanVersion.id).where(
            PlanVersion.workspace_id == job.workspace_id,
            PlanVersion.plan_id.in_(allowed_plan_ids),
        )
        objects: dict[str, list[dict[str, Any]]] = {"spaces": [self._record(row) for row in spaces]}
        for model in SHARED_MODELS:
            query = select(model).where(model.workspace_id == job.workspace_id)
            if hasattr(model, "space_id"):
                query = query.where(model.space_id.in_(space_ids))
            elif model is PlanVersion:
                query = query.where(model.plan_id.in_(allowed_plan_ids))
            elif model is PlanPhase:
                query = query.where(model.plan_version_id.in_(allowed_plan_version_ids))
            if hasattr(model, "deleted_at"):
                query = query.where(model.deleted_at.is_(None))
            objects[model.__tablename__] = [
                self._record(row) for row in (await db.scalars(query)).all()
            ]
        for personal_model in PERSONAL_MODELS:
            query = select(personal_model).where(
                personal_model.workspace_id == job.workspace_id,
                personal_model.user_id == job.requested_by,
            )
            if hasattr(personal_model, "deleted_at"):
                query = query.where(personal_model.deleted_at.is_(None))
            objects[personal_model.__tablename__] = [
                self._record(row) for row in (await db.scalars(query)).all()
            ]
        package = {
            "schema_version": EXPORT_SCHEMA,
            "product": "Logion",
            "exported_at": datetime.now(UTC).isoformat(),
            "workspace": {"id": str(workspace.id), "name": workspace.name},
            "scope": "requester_authorized_content",
            "excluded": [
                "credentials",
                "sessions",
                "recovery_material",
                "provider_secrets",
                "ai_inputs",
                "share_and_calendar_tokens",
                "attachments_binary",
            ],
            "objects": objects,
        }
        return self._zip(package)

    @staticmethod
    def _record(row: Any) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for column in inspect(row).mapper.column_attrs:
            key = column.key
            if key in OMITTED_COLUMNS:
                continue
            value = getattr(row, key)
            if isinstance(value, (datetime,)):
                result[key] = value.isoformat()
            elif isinstance(value, UUID):
                result[key] = str(value)
            else:
                result[key] = value
        return result

    @staticmethod
    def _zip(package: dict[str, Any]) -> bytes:
        buffer = io.BytesIO()
        objects = package["objects"]
        notes = objects.get("notes", [])
        tasks = objects.get("tasks", [])
        papers = objects.get("paper_records", [])
        markdown = "\n\n".join(
            f"# {row.get('title', 'Untitled')}\n\n{row.get('markdown_body', '')}" for row in notes
        )
        csv_buffer = io.StringIO(newline="")
        writer = csv.DictWriter(
            csv_buffer,
            fieldnames=["id", "title", "status", "priority", "due_at", "estimated_minutes"],
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(
            {field: PortabilityService._csv_cell(row.get(field)) for field in writer.fieldnames}
            for row in tasks
        )
        bibtex = "\n\n".join(PortabilityService._bibtex(row) for row in papers)
        manifest = {
            "schema_version": package["schema_version"],
            "product": package["product"],
            "exported_at": package["exported_at"],
            "workspace": package["workspace"],
            "scope": package["scope"],
            "excluded": package["excluded"],
            "counts": {name: len(rows) for name, rows in objects.items()},
        }
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            archive.writestr("data.json", json.dumps(package, ensure_ascii=False, indent=2))
            archive.writestr("notes.md", markdown)
            archive.writestr("tasks.csv", csv_buffer.getvalue())
            archive.writestr("papers.bib", bibtex)
        return buffer.getvalue()

    @staticmethod
    def _bibtex(row: dict[str, Any]) -> str:
        key = re.sub(r"[^A-Za-z0-9_:-]", "_", str(row.get("citation_key") or "paper"))[:160]
        title = str(row.get("title") or "Untitled").replace("{", "").replace("}", "")
        url = str(row.get("source_url") or "").replace("{", "").replace("}", "")
        fields = [f"  title = {{{title}}}"]
        if url:
            fields.append(f"  url = {{{url}}}")
        return "@misc{" + key + ",\n" + ",\n".join(fields) + "\n}"

    @staticmethod
    def _csv_cell(value: Any) -> Any:
        if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
            return f"'{value}"
        return value

    @staticmethod
    def _not_found() -> APIError:
        return APIError(code="EXPORT_NOT_FOUND", message="Export not found.", status_code=404)
