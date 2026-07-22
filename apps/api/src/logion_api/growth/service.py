import hashlib
import json
import re
import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.growth.models import ShareSnapshot, TemplateInstallation, TemplatePackage
from logion_api.growth.schemas import (
    ShareSnapshotCreate,
    TemplateFromGoalCreate,
    TemplateInstall,
)
from logion_api.identity.audit import new_audit_event
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.planning.schemas import GoalPlanCreateRequest
from logion_api.planning.service import PlanningService
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

URL_PATTERN = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)


@dataclass(frozen=True)
class GoalGraph:
    goal: LearningGoal
    plan: LearningPlan
    plan_version: PlanVersion
    phases: list[PlanPhase]


class GrowthService:
    def __init__(
        self,
        settings: Settings,
        workspaces: WorkspaceService,
        planning: PlanningService,
    ) -> None:
        self._workspaces = workspaces
        self._planning = planning
        self._security = IdentitySecurity(settings.secret_key.get_secret_value())

    async def create_template(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: TemplateFromGoalCreate,
        request_id: str,
    ) -> TemplatePackage:
        source_space = await self._authorize_template_write(
            db, context, workspace_id, payload.source_space_id, request_id
        )
        if payload.visibility == "workspace" and source_space.visibility != "shared":
            raise APIError(
                code="TEMPLATE_PRIVATE_SOURCE_BLOCKED",
                message="Workspace templates must be created from a shared Space.",
                status_code=422,
            )
        graph = await self._goal_graph(
            db, workspace_id, payload.source_space_id, payload.source_goal_id
        )
        if not graph.phases:
            raise APIError(
                code="TEMPLATE_PACKAGE_INVALID",
                message="A goal plan template requires at least one phase.",
                status_code=422,
            )
        identifier = await db.get(TemplatePackage, payload.id)
        if identifier is not None and identifier.workspace_id != workspace_id:
            raise self._not_found("Template")
        if identifier is not None:
            raise self._conflict("Template identifier exists.")
        if payload.previous_template_id is None:
            exists = await db.scalar(
                select(TemplatePackage.id).where(
                    TemplatePackage.workspace_id == workspace_id,
                    TemplatePackage.template_key == payload.template_key,
                    or_(
                        TemplatePackage.visibility == "workspace",
                        TemplatePackage.created_by == context.user.id,
                    ),
                )
            )
            if exists is not None:
                raise self._conflict("A template lineage already exists.")
            version_number = 1
        else:
            previous = await db.scalar(
                select(TemplatePackage).where(
                    TemplatePackage.id == payload.previous_template_id,
                    TemplatePackage.workspace_id == workspace_id,
                    TemplatePackage.template_key == payload.template_key,
                    or_(
                        TemplatePackage.visibility == "workspace",
                        TemplatePackage.created_by == context.user.id,
                    ),
                )
            )
            if previous is None:
                raise self._not_found("Template")
            latest = int(
                await db.scalar(
                    select(TemplatePackage.version_number)
                    .where(
                        TemplatePackage.workspace_id == workspace_id,
                        TemplatePackage.template_key == payload.template_key,
                    )
                    .order_by(TemplatePackage.version_number.desc())
                    .limit(1)
                )
                or 0
            )
            if previous.version_number != latest:
                raise self._conflict("New template versions must extend the latest version.")
            version_number = latest + 1
        object_graph = self._template_graph(graph)
        external_links = sorted(
            {
                match.group(0)
                for match in URL_PATTERN.finditer(
                    json.dumps(object_graph, ensure_ascii=False, sort_keys=True)
                )
            }
        )[:100]
        risk = {
            "external_links": external_links,
            "contains_executable": False,
            "contains_members_or_tokens": False,
            "contains_provider_credentials": False,
            "source_scope": "authorized_goal_plan",
        }
        manifest = {
            "schema_version": 1,
            "product_min_version": payload.product_min_version,
            "author": payload.author_name,
            "license": payload.license,
            "locale": payload.locale,
            "target_personas": payload.target_personas,
            "objects": object_graph,
            "changelog": payload.changelog,
            "risk_metadata": risk,
        }
        content_hash = hashlib.sha256(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        row = TemplatePackage(
            id=payload.id,
            workspace_id=workspace_id,
            template_key=payload.template_key,
            version_number=version_number,
            name=payload.name,
            description=payload.description,
            schema_version=1,
            product_min_version=payload.product_min_version,
            author_name=payload.author_name,
            license=payload.license,
            locale=payload.locale,
            target_personas=payload.target_personas,
            changelog=payload.changelog,
            content_hash=content_hash,
            risk_metadata=risk,
            object_graph=object_graph,
            visibility=payload.visibility,
            created_by=context.user.id,
        )
        try:
            async with db.begin_nested():
                db.add(row)
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("The template version already exists.") from exc
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="template.version_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="template_package",
                target_id=row.id,
                metadata={
                    "version_number": version_number,
                    "external_link_count": len(external_links),
                },
            )
        )
        return row

    async def list_templates(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[TemplatePackage]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        return list(
            (
                await db.scalars(
                    select(TemplatePackage)
                    .where(
                        TemplatePackage.workspace_id == workspace_id,
                        or_(
                            TemplatePackage.visibility == "workspace",
                            TemplatePackage.created_by == context.user.id,
                        ),
                    )
                    .order_by(
                        TemplatePackage.template_key,
                        TemplatePackage.version_number.desc(),
                    )
                    .limit(500)
                )
            ).all()
        )

    async def install_template(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: TemplateInstall,
        request_id: str,
    ) -> TemplateInstallation:
        await self._authorize_template_write(
            db, context, workspace_id, payload.target_space_id, request_id
        )
        template = await db.scalar(
            select(TemplatePackage).where(
                TemplatePackage.id == payload.template_id,
                TemplatePackage.workspace_id == workspace_id,
                TemplatePackage.status == "active",
                or_(
                    TemplatePackage.visibility == "workspace",
                    TemplatePackage.created_by == context.user.id,
                ),
            )
        )
        if template is None:
            raise self._not_found("Template")
        identifier = await db.get(TemplateInstallation, payload.id)
        if identifier is not None and identifier.workspace_id != workspace_id:
            raise self._not_found("Template installation")
        if identifier is not None:
            raise self._conflict("Template installation identifier exists.")
        goal_id, plan_id, version_id = uuid7(), uuid7(), uuid7()
        try:
            source = template.object_graph["goal_plan"]
            if not isinstance(source, dict):
                raise ValueError
            raw_phases = source["phases"]
            if not isinstance(raw_phases, list):
                raise ValueError
            phase_ids = [uuid7() for _ in raw_phases]
            create = GoalPlanCreateRequest.model_validate(
                {
                    "goal_id": goal_id,
                    "plan_id": plan_id,
                    "plan_version_id": version_id,
                    "title": source["title"],
                    "description": source["description"],
                    "desired_outcome": source["desired_outcome"],
                    "weekly_minutes": source["weekly_minutes"],
                    "target_date": source["target_date"],
                    "phases": [
                        {**phase, "id": phase_ids[position]}
                        for position, phase in enumerate(raw_phases)
                    ],
                }
            )
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            raise APIError(
                code="TEMPLATE_PACKAGE_INVALID",
                message="The template package is incompatible or invalid.",
                status_code=422,
            ) from exc
        await self._planning.create(
            db,
            context,
            workspace_id,
            payload.target_space_id,
            create,
            request_id=request_id,
        )
        installed = TemplateInstallation(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=payload.target_space_id,
            template_id=template.id,
            template_content_hash=template.content_hash,
            installed_object_ids={
                "goal_id": str(goal_id),
                "plan_id": str(plan_id),
                "plan_version_id": str(version_id),
                "phase_ids": [str(value) for value in phase_ids],
            },
            installed_by=context.user.id,
        )
        db.add(installed)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="template.installed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="template_installation",
                target_id=installed.id,
                metadata={
                    "template_id": str(template.id),
                    "template_version": template.version_number,
                },
            )
        )
        await db.flush()
        return installed

    async def create_share(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: ShareSnapshotCreate,
        request_id: str,
    ) -> tuple[ShareSnapshot, str]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.SHARE_CREATE
        )
        await self._workspaces.resolve_space(
            db,
            context,
            workspace_id,
            payload.source_space_id,
            request_id=request_id,
        )
        graph = await self._goal_graph(
            db, workspace_id, payload.source_space_id, payload.source_goal_id
        )
        existing = await db.get(ShareSnapshot, payload.id)
        if existing is not None:
            if existing.workspace_id != workspace_id:
                raise self._not_found("Share")
            raise self._conflict("Share identifier exists.")
        complete = self._share_graph(graph)
        snapshot = {field: complete[field] for field in payload.fields}
        token = secrets.token_urlsafe(32)
        row = ShareSnapshot(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=payload.source_space_id,
            object_type="goal_plan",
            object_id=payload.source_goal_id,
            title=payload.title,
            snapshot=snapshot,
            token_hash=self._share_token_hash(token),
            expires_at=utc_now() + timedelta(days=payload.expires_in_days),
            created_by=context.user.id,
        )
        db.add(row)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="share.snapshot_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="share_snapshot",
                target_id=row.id,
                metadata={
                    "field_count": len(payload.fields),
                    "expires_in_days": payload.expires_in_days,
                },
            )
        )
        await db.flush()
        return row, token

    async def list_shares(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[ShareSnapshot]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.SHARE_CREATE
        )
        return list(
            (
                await db.scalars(
                    select(ShareSnapshot)
                    .where(ShareSnapshot.workspace_id == workspace_id)
                    .order_by(ShareSnapshot.created_at.desc(), ShareSnapshot.id.desc())
                    .limit(500)
                )
            ).all()
        )

    async def revoke_share(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        share_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> ShareSnapshot:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.SHARE_CREATE
        )
        row = await db.scalar(
            select(ShareSnapshot)
            .where(
                ShareSnapshot.id == share_id,
                ShareSnapshot.workspace_id == workspace_id,
            )
            .with_for_update()
        )
        if row is None:
            raise self._not_found("Share")
        if row.version != expected_version:
            raise self._conflict("The share changed.")
        if row.status == "revoked":
            return row
        row.status = "revoked"
        row.version += 1
        row.revoked_by = context.user.id
        row.revoked_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="share.snapshot_revoked",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="share_snapshot",
                target_id=row.id,
                metadata={},
            )
        )
        await db.flush()
        return row

    async def public_share(self, db: AsyncSession, token: str) -> ShareSnapshot:
        row = await db.scalar(
            select(ShareSnapshot).where(
                ShareSnapshot.token_hash == self._share_token_hash(token),
                ShareSnapshot.status == "active",
                ShareSnapshot.expires_at > utc_now(),
            )
        )
        if row is None:
            raise self._not_found("Share")
        return row

    async def _authorize_template_write(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> Space:
        space = await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if space.visibility == "shared":
            await self._workspaces.resolve_workspace(
                db,
                context,
                workspace_id,
                request_id=request_id,
                permission=Permission.SHARED_PLAN_WRITE,
            )
        return space

    @staticmethod
    async def _goal_graph(
        db: AsyncSession, workspace_id: UUID, space_id: UUID, goal_id: UUID
    ) -> GoalGraph:
        goal = await db.scalar(
            select(LearningGoal).where(
                LearningGoal.id == goal_id,
                LearningGoal.workspace_id == workspace_id,
                LearningGoal.space_id == space_id,
                LearningGoal.deleted_at.is_(None),
            )
        )
        if goal is None:
            raise GrowthService._not_found("Goal")
        plan = await db.scalar(select(LearningPlan).where(LearningPlan.goal_id == goal.id))
        if plan is None:
            raise GrowthService._not_found("Plan")
        version = await db.scalar(
            select(PlanVersion)
            .where(PlanVersion.plan_id == plan.id)
            .order_by(PlanVersion.version_number.desc())
            .limit(1)
        )
        if version is None:
            raise GrowthService._not_found("Plan version")
        phases = list(
            (
                await db.scalars(
                    select(PlanPhase)
                    .where(PlanPhase.plan_version_id == version.id)
                    .order_by(PlanPhase.position)
                )
            ).all()
        )
        return GoalGraph(goal, plan, version, phases)

    @staticmethod
    def _template_graph(graph: GoalGraph) -> dict[str, object]:
        return {
            "goal_plan": {
                "title": graph.goal.title,
                "description": graph.goal.description,
                "desired_outcome": graph.goal.desired_outcome,
                "weekly_minutes": graph.goal.weekly_minutes,
                "target_date": graph.goal.target_date.isoformat()
                if graph.goal.target_date
                else None,
                "phases": [
                    {
                        "title": phase.title,
                        "description": phase.description,
                        "position": phase.position,
                        "estimated_minutes": phase.estimated_minutes,
                        "acceptance_criteria": phase.acceptance_criteria,
                    }
                    for phase in graph.phases
                ],
            }
        }

    @staticmethod
    def _share_graph(graph: GoalGraph) -> dict[str, object]:
        return {
            "title": graph.goal.title,
            "description": graph.goal.description,
            "desired_outcome": graph.goal.desired_outcome,
            "status": graph.goal.status,
            "weekly_minutes": graph.goal.weekly_minutes,
            "target_date": graph.goal.target_date.isoformat() if graph.goal.target_date else None,
            "phases": [
                {
                    "title": phase.title,
                    "description": phase.description,
                    "position": phase.position,
                    "estimated_minutes": phase.estimated_minutes,
                    "acceptance_criteria": phase.acceptance_criteria,
                }
                for phase in graph.phases
            ],
        }

    def _share_token_hash(self, token: str) -> str:
        return self._security.token_hash(f"share-snapshot:{token}")

    @staticmethod
    def _not_found(name: str) -> APIError:
        return APIError(code="RESOURCE_NOT_FOUND", message=f"{name} not found.", status_code=404)

    @staticmethod
    def _conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)
