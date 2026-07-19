from fastapi import FastAPI

from logion_api import __version__
from logion_api.health import router as health_router
from logion_api.middleware import request_id_middleware


def create_app() -> FastAPI:
    application = FastAPI(
        title="Logion API",
        summary="Offline-first learning and research platform API",
        version=__version__,
        openapi_version="3.1.0",
        docs_url=None,
        redoc_url=None,
    )
    application.middleware("http")(request_id_middleware)
    application.include_router(health_router)
    return application


app = create_app()
