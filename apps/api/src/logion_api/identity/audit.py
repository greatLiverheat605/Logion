from typing import Any
from uuid import UUID

from logion_api.identity.models import AuditEvent


def new_audit_event(
    *,
    request_id: str,
    event_type: str,
    result: str,
    actor_id: UUID | None = None,
    target_type: str = "auth_session",
    target_id: UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    return AuditEvent(
        request_id=request_id,
        event_type=event_type,
        target_type=target_type,
        target_id=target_id,
        actor_id=actor_id,
        result=result,
        event_metadata=metadata or {},
    )
