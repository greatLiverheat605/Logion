"""Map AI labels to server-selected sources; never accept model-supplied entity IDs."""

import json
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.models import AIRun
from logion_api.ai_gateway.research_context import (
    CONTEXT_MODELS,
    ContextEntity,
    build_research_context,
)
from logion_api.errors import APIError
from logion_api.identity.models import User
from logion_api.knowledge.schemas import EdgeCreate, LinkSuggestions
from logion_api.knowledge.service import (
    edge_quota,
    identity_filter,
    new_edge,
    owned_edges,
    validate_endpoints,
)
from logion_api.library.service import not_found
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import ROLE_PERMISSIONS, Permission, WorkspaceRole


def invalid_output() -> APIError:
    return APIError(
        code="AI_DRAFT_SCHEMA_INVALID", message="Invalid link suggestions.", status_code=422
    )


async def validate_link_run(
    db: AsyncSession,
    run: AIRun,
    input_fields: dict[str, str],
    *,
    lock: bool = False,
) -> tuple[UUID, dict[str, ContextEntity]]:
    if (
        run.prompt_version != "research-v1/link_suggest"
        or run.expected_output_fields != ["links"]
        or not 2 <= len(input_fields) <= 32
    ):
        raise invalid_output()
    try:
        refs = {
            f"source_{index}": ContextEntity.model_validate(
                json.loads(input_fields[f"source_{index}"])["ref"]
            )
            for index in range(len(input_fields))
        }
    except (KeyError, ValueError, TypeError) as exc:
        raise invalid_output() from exc
    first = refs["source_0"]
    if (first.entity_type, first.id, first.version) != (
        run.target_type,
        run.target_id,
        run.target_version,
    ) or [ref.entity_type for ref in refs.values()] != run.context_entity_types:
        raise invalid_output()
    model: Any = CONTEXT_MODELS.get(run.target_type)
    if model is None:
        raise not_found()
    space_id = await db.scalar(
        select(model.space_id).where(
            model.id == run.target_id,
            model.workspace_id == run.workspace_id,
            model.deleted_at.is_(None),
        )
    )
    if space_id is None:
        raise not_found()
    membership = (
        select(WorkspaceMembership)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .join(Space, Space.workspace_id == Workspace.id)
        .join(User, User.id == WorkspaceMembership.user_id)
        .where(
            Workspace.id == run.workspace_id,
            Workspace.status == "active",
            Space.id == space_id,
            Space.status == "active",
            (Space.visibility == "shared") | (Space.owner_user_id == run.requested_by),
            WorkspaceMembership.user_id == run.requested_by,
            WorkspaceMembership.status == "active",
            WorkspaceMembership.role.in_(
                [
                    role.value
                    for role in WorkspaceRole
                    if Permission.AI_USE in ROLE_PERMISSIONS[role]
                ]
            ),
            User.status == "active",
        )
    )
    if (
        await db.scalar(membership.with_for_update(of=WorkspaceMembership) if lock else membership)
        is None
    ):
        raise not_found()
    # Reuse the same allowlist, owner checks and source version checks immediately before
    # egress and again before storing suggestions. No idea loader exists in this builder.
    await build_research_context(
        db,
        workspace_id=run.workspace_id,
        space_id=space_id,
        user_id=run.requested_by,
        task_type="link_suggest",
        entities=list(refs.values()),
    )
    return space_id, refs


async def save_link_suggestions(
    db: AsyncSession,
    run: AIRun,
    input_fields: dict[str, str],
    output: dict[str, str],
    *,
    maximum: int,
) -> dict[str, str]:
    if set(output) != {"links"}:
        raise invalid_output()
    try:
        candidates = LinkSuggestions.model_validate({"links": json.loads(output["links"])})
    except (ValueError, TypeError) as exc:
        raise invalid_output() from exc
    space, refs = await validate_link_run(db, run, input_fields, lock=True)
    kinds = {
        "resource": "resource",
        "research_question": "question",
        "topic": "topic",
        "research_claim": "claim",
    }
    accepted = []
    pending = []
    seen: set[tuple[str, UUID, str, UUID, str]] = set()
    for candidate in candidates.links:
        try:
            source, target = refs[candidate.from_source], refs[candidate.to_source]
            evidence = refs[candidate.evidence_source] if candidate.evidence_source else None
            if evidence is not None and evidence.entity_type != "source_excerpt":
                raise invalid_output()
            fields = EdgeCreate.model_validate(
                {
                    "from_type": kinds[source.entity_type],
                    "from_id": source.id,
                    "to_type": kinds[target.entity_type],
                    "to_id": target.id,
                    "relation": candidate.relation,
                    "reason": candidate.reason,
                    "evidence_excerpt_id": evidence.id if evidence else None,
                }
            )
        except (KeyError, ValidationError) as exc:
            raise invalid_output() from exc
        await validate_endpoints(db, run.workspace_id, space, run.requested_by, fields)
        key = (fields.from_type, fields.from_id, fields.to_type, fields.to_id, fields.relation)
        if key in seen:
            continue
        seen.add(key)
        existing = await db.scalar(
            owned_edges(run.workspace_id, space, run.requested_by).where(identity_filter(fields))
        )
        if existing is not None:
            # Includes rejected tombstones: never resurrect or repeat them in any draft.
            continue
        pending.append(new_edge(run.workspace_id, space, run.requested_by, fields, run_id=run.id))
        accepted.append(candidate.model_dump(mode="json"))
    await edge_quota(db, run.workspace_id, run.requested_by, len(pending), maximum)
    db.add_all(pending)
    await db.flush()
    return {"links": json.dumps(accepted, ensure_ascii=False)}
