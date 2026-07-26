from typing import Any

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from logion_api.config import get_settings


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    retryable: bool = False
    request_id: str


class APIError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
        clear_auth_cookies: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.retryable = retryable
        self.clear_auth_cookies = clear_auth_cookies


def _request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unavailable"))


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    payload = ErrorResponse(
        code=exc.code,
        message=exc.message,
        details=exc.details,
        retryable=exc.retryable,
        request_id=_request_id(request),
    )
    response = JSONResponse(status_code=exc.status_code, content=payload.model_dump())
    if exc.clear_auth_cookies:
        settings = get_settings()
        response.headers["Cache-Control"] = "no-store"
        for name in (
            settings.access_cookie_name,
            settings.refresh_cookie_name,
            settings.csrf_cookie_name,
            settings.device_cookie_name,
        ):
            response.delete_cookie(name, path="/", domain=settings.cookie_domain)
    return response


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {"type": error["type"], "loc": error["loc"], "msg": error["msg"]} for error in exc.errors()
    ]
    payload = ErrorResponse(
        code="VALIDATION_ERROR",
        message="The request contains invalid fields.",
        details={"errors": errors},
        request_id=_request_id(request),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content=payload.model_dump(),
    )


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    payload = ErrorResponse(
        code="HTTP_ERROR",
        message=str(exc.detail),
        request_id=_request_id(request),
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=payload.model_dump(),
        headers=exc.headers,
    )
