from typing import cast

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ExceptionHandler

from logion_api import __version__
from logion_api.ai_gateway.routes import model_router as ai_model_router
from logion_api.ai_gateway.routes import router as ai_router
from logion_api.ai_gateway.routing_routes import router as ai_routing_router
from logion_api.ai_gateway.run_routes import router as ai_run_router
from logion_api.audit.routes import router as audit_router
from logion_api.audit.routes import workspace_router as workspace_audit_router
from logion_api.collaboration.routes import router as collaboration_router
from logion_api.config import get_settings
from logion_api.content.routes import router as content_router
from logion_api.engagement.routes import public_router as public_calendar_router
from logion_api.engagement.routes import router as engagement_router
from logion_api.errors import (
    APIError,
    api_error_handler,
    http_error_handler,
    validation_error_handler,
)
from logion_api.exam.routes import router as exam_router
from logion_api.execution.evidence_routes import router as evidence_router
from logion_api.execution.routes import router as execution_router
from logion_api.growth.routes import public_router as public_share_router
from logion_api.growth.routes import router as growth_router
from logion_api.health import router as health_router
from logion_api.identity.passkey_routes import router as passkey_router
from logion_api.identity.routes import router as identity_router
from logion_api.identity.totp_routes import router as totp_router
from logion_api.identity.verification_routes import router as verification_router
from logion_api.memory.routes import router as memory_router
from logion_api.middleware import request_id_middleware
from logion_api.planning.routes import router as planning_router
from logion_api.portability.routes import import_router as portability_import_router
from logion_api.portability.routes import router as portability_router
from logion_api.research.routes import router as research_router
from logion_api.self_study.routes import router as self_study_router
from logion_api.sync.routes import router as sync_router
from logion_api.workspaces.invitation_routes import (
    invitation_router,
    workspace_invitation_router,
)
from logion_api.workspaces.routes import router as workspace_router


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Logion API",
        summary="Offline-first learning and research platform API",
        version=__version__,
        openapi_version="3.1.0",
        docs_url=None,
        redoc_url=None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token", "X-Request-ID"],
    )
    application.middleware("http")(request_id_middleware)
    application.add_exception_handler(APIError, cast(ExceptionHandler, api_error_handler))
    application.add_exception_handler(
        RequestValidationError,
        cast(ExceptionHandler, validation_error_handler),
    )
    application.add_exception_handler(HTTPException, cast(ExceptionHandler, http_error_handler))
    application.include_router(health_router)
    application.include_router(identity_router)
    application.include_router(passkey_router)
    application.include_router(totp_router)
    application.include_router(verification_router)
    application.include_router(audit_router)
    application.include_router(workspace_audit_router)
    application.include_router(invitation_router)
    application.include_router(workspace_invitation_router)
    application.include_router(workspace_router)
    application.include_router(sync_router)
    application.include_router(planning_router)
    application.include_router(execution_router)
    application.include_router(content_router)
    application.include_router(evidence_router)
    application.include_router(memory_router)
    application.include_router(exam_router)
    application.include_router(self_study_router)
    application.include_router(research_router)
    application.include_router(collaboration_router)
    application.include_router(ai_router)
    application.include_router(ai_model_router)
    application.include_router(ai_routing_router)
    application.include_router(ai_run_router)
    application.include_router(growth_router)
    application.include_router(public_share_router)
    application.include_router(engagement_router)
    application.include_router(public_calendar_router)
    application.include_router(portability_router)
    application.include_router(portability_import_router)
    return application


app = create_app()
