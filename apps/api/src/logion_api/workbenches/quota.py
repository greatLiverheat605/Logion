import time
from typing import Literal
from uuid import UUID

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.dependencies import get_security
from logion_api.identity.rate_limit import RateLimiter

type WorkbenchQuotaOperation = Literal[
    "read",
    "definition_create",
    "definition_replace",
    "definition_archive",
    "definition_restore",
    "definition_delete",
    "import",
    "export",
    "link_create",
    "link_patch",
    "link_delete",
    "link_reorder",
]

_LIMIT_FIELDS: dict[WorkbenchQuotaOperation, str] = {
    "read": "workbench_read_limit_per_hour",
    "definition_create": "workbench_definition_create_limit_per_hour",
    "definition_replace": "workbench_definition_replace_limit_per_hour",
    "definition_archive": "workbench_definition_archive_limit_per_hour",
    "definition_restore": "workbench_definition_restore_limit_per_hour",
    "definition_delete": "workbench_definition_delete_limit_per_hour",
    "import": "workbench_import_limit_per_hour",
    "export": "workbench_export_limit_per_hour",
    "link_create": "workbench_link_create_limit_per_hour",
    "link_patch": "workbench_link_patch_limit_per_hour",
    "link_delete": "workbench_link_delete_limit_per_hour",
    "link_reorder": "workbench_link_reorder_limit_per_hour",
}


async def enforce_workbench_quota(
    limiter: RateLimiter,
    settings: Settings,
    owner_user_id: UUID,
    operation: WorkbenchQuotaOperation,
) -> None:
    window = settings.workbench_rate_limit_window_seconds
    subject = get_security().privacy_hash(f"workbench:{owner_user_id}") or "unknown"
    try:
        await limiter.enforce(
            scope=f"workbench_{operation}",
            subject_hash=subject,
            limit=int(getattr(settings, _LIMIT_FIELDS[operation])),
            window=window,
        )
    except APIError as error:
        if error.status_code == 429:
            retry_after = max(1, min(3600, window - int(time.time()) % window))
            raise APIError(
                code="WORKBENCH_RATE_LIMITED",
                message="Too many Workbench requests. Try again later.",
                status_code=429,
                retryable=True,
                headers={
                    "Cache-Control": "private, no-store",
                    "Retry-After": str(retry_after),
                },
            ) from error
        if error.status_code == 503:
            error.headers.setdefault("Cache-Control", "private, no-store")
        raise
