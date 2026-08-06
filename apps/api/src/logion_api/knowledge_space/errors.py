from logion_api.errors import APIError

PRIVATE_NO_STORE = {"Cache-Control": "private, no-store"}


def knowledge_feature_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_FEATURE_DISABLED",
        message="The knowledge-space feature is not available.",
        status_code=404,
        headers=PRIVATE_NO_STORE,
    )


def resource_not_found_error() -> APIError:
    return APIError(
        code="RESOURCE_NOT_FOUND",
        message="The requested resource was not found.",
        status_code=404,
        headers=PRIVATE_NO_STORE,
    )


def operation_denied_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_OPERATION_DENIED",
        message="This knowledge-space operation is not allowed.",
        status_code=403,
        headers=PRIVATE_NO_STORE,
    )


def shared_writes_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_SHARED_WRITES_DISABLED",
        message="Shared knowledge writes are not enabled.",
        status_code=403,
        headers=PRIVATE_NO_STORE,
    )


def deletion_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_DELETION_DISABLED",
        message="Knowledge deletion is not enabled.",
        status_code=403,
        headers=PRIVATE_NO_STORE,
    )


def query_timeout_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_QUERY_TIMEOUT",
        message="The knowledge query could not produce a bounded response in time.",
        status_code=503,
        headers=PRIVATE_NO_STORE,
        retryable=True,
    )
