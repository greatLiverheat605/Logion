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


def acceptance_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_FEATURE_DISABLED",
        message="AI knowledge acceptance is not available.",
        status_code=404,
        headers=PRIVATE_NO_STORE,
    )


def attachment_ingest_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_ATTACHMENT_INGEST_DISABLED",
        message="Knowledge attachment ingestion is not available.",
        status_code=404,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_disabled_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_DISABLED",
        message="Local Worker execution is not available.",
        status_code=404,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_token_invalid_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_TOKEN_INVALID",
        message="The Local Worker lease is not valid.",
        status_code=401,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_lease_expired_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_LEASE_EXPIRED",
        message="The Local Worker lease has expired.",
        status_code=401,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_scope_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_SCOPE_CONFLICT",
        message="The Local Worker scope or input does not match the lease.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_state_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_STATE_CONFLICT",
        message="The Local Worker job is not in an acceptable state for this operation.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_idempotency_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_IDEMPOTENCY_CONFLICT",
        message="The result idempotency key was reused with a different payload.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def local_worker_checkpoint_too_large_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_LOCAL_WORKER_CHECKPOINT_TOO_LARGE",
        message="The Local Worker checkpoint exceeds the bounded size limit.",
        status_code=413,
        headers=PRIVATE_NO_STORE,
    )


def acceptance_version_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_VERSION_CONFLICT",
        message="The knowledge draft or one of its evidence endpoints changed.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def acceptance_idempotency_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_IDEMPOTENCY_CONFLICT",
        message="The acceptance idempotency key was reused with a different payload.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def acceptance_state_conflict_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_STATE_CONFLICT",
        message="The draft cannot be accepted in its current state.",
        status_code=409,
        headers=PRIVATE_NO_STORE,
    )


def acceptance_precondition_invalid_error() -> APIError:
    return APIError(
        code="KNOWLEDGE_PRECONDITION_INVALID",
        message="The acceptance payload digest does not match the canonical request.",
        status_code=400,
        headers=PRIVATE_NO_STORE,
    )
