from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Literal, Never
from uuid import UUID

from fastapi import APIRouter, Header, Path, Query, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from logion_api.errors import ErrorResponse
from logion_api.workbenches.schemas import (
    WorkbenchConflictErrorResponse,
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDeleteReceipt,
    WorkbenchDefinitionDeleteRequest,
    WorkbenchDefinitionDeletionImpact,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionPageResponse,
    WorkbenchDefinitionReplaceRequest,
    WorkbenchDefinitionResponse,
    WorkbenchExportV1,
    WorkbenchForbiddenErrorResponse,
    WorkbenchImportFailedReceipt,
    WorkbenchImportRequest,
    WorkbenchImportRetryableErrorResponse,
    WorkbenchImportSucceededReceipt,
    WorkbenchLinkCreateRequest,
    WorkbenchLinkDeleteReceipt,
    WorkbenchLinkDeleteRequest,
    WorkbenchLinkPageResponse,
    WorkbenchLinkPatchRequest,
    WorkbenchLinkReorderRequest,
    WorkbenchLinkSetResponse,
    WorkbenchNotFoundErrorResponse,
    WorkbenchObjectLinkResponse,
    WorkbenchPreconditionInvalidErrorResponse,
    WorkbenchPreferenceDocumentV1,
    WorkbenchRateLimitedErrorResponse,
    WorkbenchValidationErrorResponse,
)


class DormantContractRoute(APIRoute):
    """Return the existing opaque 404 before FastAPI parses a request."""

    def get_route_handler(self) -> Callable[[Request], Any]:
        async def dormant_handler(_: Request) -> Response:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"detail": "Not Found"},
            )

        return dormant_handler


router = APIRouter(
    prefix="/api/v1/users/me/workbenches",
    tags=["workbenches"],
    route_class=DormantContractRoute,
)

PREFERENCE_COMPONENT_EXTENSION = WorkbenchPreferenceDocumentV1.model_json_schema(
    by_alias=True,
    ref_template="#/components/schemas/{model}",
)

CACHE_HEADER = {
    "Cache-Control": {
        "description": "Workbench responses are private and must not be stored.",
        "schema": {"type": "string", "const": "private, no-store"},
    }
}
ETAG_HEADER = {
    "ETag": {
        "description": "Strong opaque entity validator. Clients must not parse it.",
        "schema": {"type": "string", "minLength": 2, "maxLength": 256},
    }
}
LOCATION_HEADER = {
    "Location": {
        "description": "Location of the newly created Workbench resource.",
        "schema": {"type": "string"},
    }
}
CONTENT_DISPOSITION_HEADER = {
    "Content-Disposition": {
        "description": "Attachment disposition for the Workbench export.",
        "schema": {
            "type": "string",
            "pattern": r'^attachment; filename="workbench-[0-9a-f-]{36}\.json"$',
        },
    }
}
RETRY_AFTER_HEADER = {
    "Retry-After": {
        "description": "Seconds before the caller should retry.",
        "schema": {"type": "integer", "minimum": 1, "maximum": 3600},
        "required": True,
    }
}


def _error_headers(*, rate_limited: bool = False) -> dict[str, Any]:
    headers: dict[str, Any] = dict(CACHE_HEADER)
    if rate_limited:
        headers.update(RETRY_AFTER_HEADER)
    return headers


def _errors(codes: tuple[int, ...]) -> dict[int | str, dict[str, Any]]:
    models: dict[int, Any] = {
        400: WorkbenchPreconditionInvalidErrorResponse,
        401: ErrorResponse,
        403: WorkbenchForbiddenErrorResponse,
        404: WorkbenchNotFoundErrorResponse,
        409: WorkbenchConflictErrorResponse,
        413: ErrorResponse,
        422: WorkbenchValidationErrorResponse,
        429: WorkbenchRateLimitedErrorResponse,
        503: ErrorResponse,
    }
    return {
        code: {
            "model": models[code],
            "headers": _error_headers(rate_limited=code == 429),
        }
        for code in codes
    }


Origin = Annotated[str, Header(alias="Origin", min_length=1, max_length=2048)]
Csrf = Annotated[str, Header(alias="X-CSRF-Token", min_length=1, max_length=4096)]
IdempotencyKey = Annotated[UUID, Header(alias="Idempotency-Key")]
WorkBenchId = Annotated[UUID, Path(alias="workbench_id")]
LinkId = Annotated[UUID, Path(alias="link_id")]
IfMatch = Annotated[str | None, Header(alias="If-Match", min_length=2, max_length=256)]
IfNoneMatch = Annotated[str | None, Header(alias="If-None-Match", min_length=1, max_length=1024)]

_READ_CODES = (401, 404, 422, 429, 503)
_LIST_CODES = (401, 422, 429, 503)
_MUTATION_CODES = (400, 401, 403, 404, 409, 413, 422, 429, 503)
_DEFINITION_CREATE_CODES = (401, 403, 409, 413, 422, 429, 503)
_IMPORT_CODES = (401, 403, 409, 413, 422, 429, 503)
_LINK_CREATE_CODES = (401, 403, 404, 409, 413, 422, 429, 503)
_REORDER_CODES = (401, 403, 404, 409, 413, 422, 429, 503)


def _unreachable() -> Never:
    raise RuntimeError("dormant contract handler must intercept before execution")


@router.get(
    "",
    response_model=WorkbenchDefinitionPageResponse,
    operation_id="workbench_definition_list",
    responses={**_errors(_LIST_CODES), 200: {"headers": CACHE_HEADER}},
    openapi_extra={
        "x-logion-component-WorkbenchPreferenceDocumentV1": PREFERENCE_COMPONENT_EXTENSION
    },
)
async def list_workbenches(
    lifecycle: Annotated[Literal["active", "archived"] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> WorkbenchDefinitionPageResponse:
    return _unreachable()


@router.post(
    "",
    response_model=WorkbenchDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="workbench_definition_create",
    responses={
        **_errors(_DEFINITION_CREATE_CODES),
        201: {"headers": {**LOCATION_HEADER, **ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def create_workbench(
    payload: WorkbenchDefinitionCreateRequest,
    origin: Origin,
    csrf: Csrf,
    idempotency_key: IdempotencyKey,
) -> WorkbenchDefinitionResponse:
    return _unreachable()


@router.post(
    "/imports",
    response_model=WorkbenchImportSucceededReceipt,
    status_code=status.HTTP_201_CREATED,
    operation_id="workbench_import",
    responses={
        **_errors(_IMPORT_CODES),
        200: {"model": WorkbenchImportFailedReceipt, "headers": CACHE_HEADER},
        201: {"headers": CACHE_HEADER},
        503: {"model": WorkbenchImportRetryableErrorResponse, "headers": CACHE_HEADER},
    },
)
async def import_workbench(
    payload: WorkbenchImportRequest,
    origin: Origin,
    csrf: Csrf,
    idempotency_key: IdempotencyKey,
) -> WorkbenchImportSucceededReceipt:
    return _unreachable()


@router.get(
    "/{workbench_id}",
    response_model=WorkbenchDefinitionResponse,
    operation_id="workbench_definition_get",
    responses={
        **_errors(_READ_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
        304: {
            "description": "Not modified after authorization was revalidated.",
            "headers": {**ETAG_HEADER, **CACHE_HEADER},
        },
    },
)
async def get_workbench(
    workbench_id: WorkBenchId,
    if_none_match: IfNoneMatch = None,
) -> WorkbenchDefinitionResponse:
    return _unreachable()


@router.put(
    "/{workbench_id}",
    response_model=WorkbenchDefinitionResponse,
    operation_id="workbench_definition_replace",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def replace_workbench(
    workbench_id: WorkBenchId,
    payload: WorkbenchDefinitionReplaceRequest,
    origin: Origin,
    csrf: Csrf,
    if_match: IfMatch = None,
) -> WorkbenchDefinitionResponse:
    return _unreachable()


@router.post(
    "/{workbench_id}/archive",
    response_model=WorkbenchDefinitionResponse,
    operation_id="workbench_definition_archive",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def archive_workbench(
    workbench_id: WorkBenchId,
    payload: WorkbenchDefinitionLifecycleRequest,
    origin: Origin,
    csrf: Csrf,
    if_match: IfMatch = None,
) -> WorkbenchDefinitionResponse:
    return _unreachable()


@router.post(
    "/{workbench_id}/restore",
    response_model=WorkbenchDefinitionResponse,
    operation_id="workbench_definition_restore",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def restore_workbench(
    workbench_id: WorkBenchId,
    payload: WorkbenchDefinitionLifecycleRequest,
    origin: Origin,
    csrf: Csrf,
    if_match: IfMatch = None,
) -> WorkbenchDefinitionResponse:
    return _unreachable()


@router.get(
    "/{workbench_id}/deletion-impact",
    response_model=WorkbenchDefinitionDeletionImpact,
    operation_id="workbench_definition_deletion_impact_get",
    responses={**_errors(_READ_CODES), 200: {"headers": CACHE_HEADER}},
)
async def get_deletion_impact(workbench_id: WorkBenchId) -> WorkbenchDefinitionDeletionImpact:
    return _unreachable()


@router.delete(
    "/{workbench_id}",
    response_model=WorkbenchDefinitionDeleteReceipt,
    operation_id="workbench_definition_delete",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**CACHE_HEADER}},
    },
)
async def delete_workbench(
    workbench_id: WorkBenchId,
    payload: WorkbenchDefinitionDeleteRequest,
    origin: Origin,
    csrf: Csrf,
    idempotency_key: IdempotencyKey,
    if_match: IfMatch = None,
) -> WorkbenchDefinitionDeleteReceipt:
    return _unreachable()


@router.get(
    "/{workbench_id}/export",
    response_model=WorkbenchExportV1,
    operation_id="workbench_definition_export",
    responses={
        **_errors((401, 403, 404, 422, 429, 503)),
        200: {"headers": {**CONTENT_DISPOSITION_HEADER, **CACHE_HEADER}},
    },
)
async def export_workbench(
    workbench_id: WorkBenchId,
    origin: Origin,
    csrf: Csrf,
    include_links: Annotated[bool, Query()] = False,
) -> WorkbenchExportV1:
    return _unreachable()


@router.get(
    "/{workbench_id}/links",
    response_model=WorkbenchLinkPageResponse,
    operation_id="workbench_link_list",
    responses={
        **_errors(_READ_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def list_links(
    workbench_id: WorkBenchId,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
) -> WorkbenchLinkPageResponse:
    return _unreachable()


@router.post(
    "/{workbench_id}/links",
    response_model=WorkbenchObjectLinkResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="workbench_link_create",
    responses={
        **_errors(_LINK_CREATE_CODES),
        201: {"headers": {**LOCATION_HEADER, **ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def create_link(
    workbench_id: WorkBenchId,
    payload: WorkbenchLinkCreateRequest,
    origin: Origin,
    csrf: Csrf,
    idempotency_key: IdempotencyKey,
) -> WorkbenchObjectLinkResponse:
    return _unreachable()


@router.patch(
    "/{workbench_id}/links/{link_id}",
    response_model=WorkbenchObjectLinkResponse,
    operation_id="workbench_link_patch",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def patch_link(
    workbench_id: WorkBenchId,
    link_id: LinkId,
    payload: WorkbenchLinkPatchRequest,
    origin: Origin,
    csrf: Csrf,
    if_match: IfMatch = None,
) -> WorkbenchObjectLinkResponse:
    return _unreachable()


@router.delete(
    "/{workbench_id}/links/{link_id}",
    response_model=WorkbenchLinkDeleteReceipt,
    operation_id="workbench_link_delete",
    responses={
        **_errors(_MUTATION_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def delete_link(
    workbench_id: WorkBenchId,
    link_id: LinkId,
    payload: WorkbenchLinkDeleteRequest,
    origin: Origin,
    csrf: Csrf,
    if_match: IfMatch = None,
) -> WorkbenchLinkDeleteReceipt:
    return _unreachable()


@router.post(
    "/{workbench_id}/links/reorder",
    response_model=WorkbenchLinkSetResponse,
    operation_id="workbench_link_reorder",
    responses={
        **_errors(_REORDER_CODES),
        200: {"headers": {**ETAG_HEADER, **CACHE_HEADER}},
    },
)
async def reorder_links(
    workbench_id: WorkBenchId,
    payload: WorkbenchLinkReorderRequest,
    origin: Origin,
    csrf: Csrf,
) -> WorkbenchLinkSetResponse:
    return _unreachable()
