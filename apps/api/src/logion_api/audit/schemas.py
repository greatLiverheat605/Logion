from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class AuditEventResponse(BaseModel):
    id: UUID
    event_type: str
    result: str
    actor_id: UUID | None
    target_type: str
    target_id: UUID | None
    occurred_at: datetime


class AuditEventPageResponse(BaseModel):
    events: list[AuditEventResponse]
    next_cursor: str | None
