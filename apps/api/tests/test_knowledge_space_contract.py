from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.dependencies import get_current_context, get_identity_service
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.authorization import KnowledgeAction, authorize_space_policy
from logion_api.knowledge_space.cursors import (
    DecodedKnowledgeCursor,
    KnowledgeCursorCodec,
    KnowledgeCursorScope,
)
from logion_api.knowledge_space.errors import query_timeout_error, resource_not_found_error
from logion_api.knowledge_space.limits import (
    DRAFT_ACCEPT_RATE,
    GRAPH_READ_RATE,
    ITEM_READ_RATE,
    KNOWLEDGE_WRITE_RATE,
    enforce_dual_rate_limit,
)
from logion_api.knowledge_space.preconditions import (
    if_none_match_matches,
    make_strong_etag,
    validate_write_precondition,
)
from logion_api.knowledge_space.schemas import (
    GRAPH_MAX_BYTES,
    GRAPH_MAX_EDGES,
    GRAPH_MAX_NODES,
    CitationTarget,
    GraphEdgeType,
    GraphTruncationReason,
    KnowledgeGraphLimits,
    KnowledgeGraphNode,
    KnowledgeGraphResponse,
    KnowledgeGraphRoot,
    KnowledgeSearchPageResponse,
    KnowledgeSearchRequest,
    KnowledgeSearchResult,
    KnowledgeTargetType,
    SourceExcerptCreateRequest,
    SourceLocator,
)
from logion_api.knowledge_space.service import KnowledgeService
from logion_api.main import app
from logion_api.workspaces.permissions import SpaceVisibility, WorkspaceRole
from pydantic import SecretStr, ValidationError

BASE_PATH = "/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge"
NOW = datetime(2026, 8, 5, 16, 0, tzinfo=UTC)
TEST_KEY_CURRENT = b"current-test-key-material-32-bytes-minimum"
TEST_KEY_PREVIOUS = b"previous-test-key-material-32-bytes-minimum"


def _excerpt_payload(*, excerpt_text: str = "bounded evidence") -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "resource_id": str(uuid4()),
        "excerpt_text": excerpt_text,
        "locator": {"page_start": 1, "page_end": 1},
        "source_version_key": "source-version-1",
        "source_version_sha256": "a" * 64,
    }


def _cursor_scope(*, subject: str = "subject-hash") -> KnowledgeCursorScope:
    return KnowledgeCursorScope(
        subject_hash=subject,
        workspace_id=str(uuid4()),
        space_id=str(uuid4()),
        endpoint="source-excerpt-list",
    )


def _cursor_codec(
    *,
    active: str = "current",
    previous: str | None = "previous",
) -> KnowledgeCursorCodec:
    return KnowledgeCursorCodec(
        active_key_id=active,
        previous_key_id=previous,
        keys={"current": TEST_KEY_CURRENT, "previous": TEST_KEY_PREVIOUS},
    )


def test_knowledge_flags_default_closed_and_reject_unsafe_combinations() -> None:
    settings = Settings()
    assert settings.knowledge_space_api_enabled is False
    assert settings.knowledge_space_shared_writes_enabled is False
    assert settings.knowledge_space_deletion_enabled is False
    assert settings.knowledge_space_attachment_ingest_enabled is False
    assert settings.knowledge_space_local_worker_enabled is False

    with pytest.raises(ValidationError, match="SHARED_WRITES_ENABLED requires"):
        Settings(knowledge_space_shared_writes_enabled=True)
    with pytest.raises(ValidationError, match="DELETION_ENABLED requires"):
        Settings(knowledge_space_deletion_enabled=True)
    with pytest.raises(ValidationError, match="ATTACHMENT_INGEST_ENABLED requires"):
        Settings(knowledge_space_attachment_ingest_enabled=True)
    with pytest.raises(ValidationError, match="LOCAL_WORKER_ENABLED requires"):
        Settings(knowledge_space_local_worker_enabled=True)
    with pytest.raises(ValidationError, match="ACTIVE_KEY_ID"):
        Settings(knowledge_space_api_enabled=True)

    enabled = Settings(
        knowledge_space_api_enabled=True,
        knowledge_space_attachment_ingest_enabled=True,
        knowledge_space_local_worker_enabled=True,
        knowledge_cursor_active_key_id="current",
        knowledge_cursor_keys={"current": SecretStr("x" * 32)},
    )
    assert enabled.knowledge_space_api_enabled is True
    assert enabled.knowledge_space_shared_writes_enabled is False
    assert enabled.knowledge_space_deletion_enabled is False
    assert enabled.knowledge_space_attachment_ingest_enabled is True
    assert enabled.knowledge_space_local_worker_enabled is True


def test_knowledge_query_timeout_is_retryable_and_private() -> None:
    error = query_timeout_error()

    assert (error.status_code, error.code, error.retryable) == (
        503,
        "KNOWLEDGE_QUERY_TIMEOUT",
        True,
    )
    assert error.headers == {"Cache-Control": "private, no-store"}


def test_source_excerpt_contract_enforces_locator_text_bytes_and_controls() -> None:
    payload = SourceExcerptCreateRequest.model_validate(_excerpt_payload())
    assert payload.locator.page_start == 1
    assert payload.normalization_version == "utf8-nfc-lf-v1"

    with pytest.raises(ValidationError, match="at least one complete locator"):
        SourceLocator()
    with pytest.raises(ValidationError, match="supplied together"):
        SourceLocator(page_start=1)
    with pytest.raises(ValidationError, match="UTF-8 byte limit"):
        SourceExcerptCreateRequest.model_validate(_excerpt_payload(excerpt_text="界" * 11_000))
    with pytest.raises(ValidationError, match="control character"):
        SourceExcerptCreateRequest.model_validate(_excerpt_payload(excerpt_text="bad\x00text"))


def test_citation_target_requires_exactly_one_typed_target() -> None:
    target = CitationTarget(topic_id=uuid4())
    assert target.kind is KnowledgeTargetType.TOPIC
    with pytest.raises(ValidationError, match="exactly one"):
        CitationTarget()
    with pytest.raises(ValidationError, match="exactly one"):
        CitationTarget(topic_id=uuid4(), note_id=uuid4())


def test_graph_contract_enforces_hard_caps_and_truncation_shape() -> None:
    root = KnowledgeGraphRoot(type=KnowledgeTargetType.TOPIC, id=uuid4())
    node = KnowledgeGraphNode(
        type=root.type,
        id=root.id,
        label="Root",
        version=1,
    )
    response = KnowledgeGraphResponse(
        root=root,
        depth=2,
        nodes=[node],
        edges=[],
        truncated=True,
        truncation_reasons=[GraphTruncationReason.NODE_LIMIT],
        next_cursor="opaque",
        limits=KnowledgeGraphLimits(),
    )
    assert response.limits.model_dump() == {
        "nodes": GRAPH_MAX_NODES,
        "edges": GRAPH_MAX_EDGES,
        "bytes": GRAPH_MAX_BYTES,
    }
    assert GraphEdgeType.TOPIC_DEPENDENCY.value == "topic_dependency"

    with pytest.raises(ValidationError, match="truncated must agree"):
        KnowledgeGraphResponse(
            root=root,
            depth=1,
            nodes=[node],
            edges=[],
            truncated=False,
            truncation_reasons=[GraphTruncationReason.EDGE_LIMIT],
            limits=KnowledgeGraphLimits(),
        )
    with pytest.raises(ValidationError):
        KnowledgeGraphResponse(
            root=root,
            depth=1,
            nodes=[node] * (GRAPH_MAX_NODES + 1),
            edges=[],
            truncated=True,
            truncation_reasons=[GraphTruncationReason.NODE_LIMIT],
            limits=KnowledgeGraphLimits(),
        )


def test_knowledge_search_contract_is_strict_and_bounded() -> None:
    request = KnowledgeSearchRequest.model_validate(
        {"query": "  spaced topic  ", "target_types": ["topic"], "limit": 5}
    )
    assert request.query == "spaced topic"
    assert request.limit == 5
    with pytest.raises(ValidationError, match="non-whitespace"):
        KnowledgeSearchRequest(query="  ")
    with pytest.raises(ValidationError, match="target_types must be unique"):
        KnowledgeSearchRequest(target_types=[KnowledgeTargetType.TOPIC] * 2)

    result = KnowledgeSearchResult(
        target_type=KnowledgeTargetType.TOPIC,
        id=uuid4(),
        label="Topic",
        snippet="A bounded snippet",
        version=1,
        updated_at=NOW,
    )
    page = KnowledgeSearchPageResponse(results=[result], next_cursor="opaque")
    assert page.results[0].label == "Topic"


def test_knowledge_search_rejects_controls_and_escapes_like_wildcards() -> None:
    with pytest.raises(ValidationError, match="control character"):
        KnowledgeSearchRequest(query="topic\x00name")
    with pytest.raises(ValidationError, match="at most 100"):
        KnowledgeSearchRequest(query="a" * 101)

    assert KnowledgeService._escape_like("50%_done\\") == "50\\%\\_done\\\\"


def test_search_cursor_position_is_bound_to_search_filters_and_shape() -> None:
    scope = _cursor_scope()
    issued_at = datetime.now(UTC).replace(microsecond=0)
    cutoff_at = issued_at
    updated_at = issued_at.replace(second=max(0, issued_at.second - 1))
    filters: dict[str, object] = {
        "query": "topic",
        "target_types": ["topic"],
        "limit": 25,
    }
    identifier = uuid4()
    codec = _cursor_codec()
    cursor = codec.encode(
        scope=scope,
        filters=filters,
        position={
            "score": 8,
            "updated_at": updated_at.isoformat(),
            "id": str(identifier),
            "target_type": "topic",
        },
        cutoff_at=cutoff_at,
        now=issued_at,
    )
    service = KnowledgeService(
        Settings(
            knowledge_cursor_active_key_id="current",
            knowledge_cursor_keys={"current": SecretStr(TEST_KEY_CURRENT.decode())},
        ),
        IdentitySecurity("test-only-security-key-material-32-bytes"),
    )
    cutoff, position = service._search_cursor_window(
        cursor,
        scope=scope,
        filters=filters,
    )
    assert cutoff == cutoff_at
    assert position == (-8, -updated_at.timestamp(), str(identifier), "topic")

    with pytest.raises(APIError) as wrong_filter:
        service._search_cursor_window(
            cursor,
            scope=scope,
            filters={**filters, "limit": 10},
        )
    assert wrong_filter.value.code == "KNOWLEDGE_CURSOR_INVALID"

    malformed = codec.encode(
        scope=scope,
        filters=filters,
        position={
            "score": 1,
            "updated_at": "not-a-time",
            "id": str(identifier),
            "target_type": "topic",
        },
        cutoff_at=cutoff_at,
        now=issued_at,
    )
    with pytest.raises(APIError) as invalid_position:
        service._search_cursor_window(malformed, scope=scope, filters=filters)
    assert invalid_position.value.code == "KNOWLEDGE_CURSOR_INVALID"


def test_graph_cursor_position_validation_is_fail_closed() -> None:
    valid = DecodedKnowledgeCursor(
        cutoff_at=NOW,
        position={
            "hop": 1,
            "edge_type": "topic_dependency",
            "edge_id": str(uuid4()),
            "node_id": str(uuid4()),
        },
    )
    KnowledgeService._validate_graph_cursor_position(valid)

    invalid = DecodedKnowledgeCursor(
        cutoff_at=NOW,
        position={
            "hop": 3,
            "edge_type": "topic_dependency",
            "edge_id": str(uuid4()),
            "node_id": str(uuid4()),
        },
    )
    with pytest.raises(APIError) as raised:
        KnowledgeService._validate_graph_cursor_position(invalid)
    assert raised.value.code == "KNOWLEDGE_CURSOR_INVALID"


def test_cursor_roundtrip_is_bound_to_scope_filters_and_cutoff() -> None:
    codec = _cursor_codec()
    scope = _cursor_scope()
    filters = {"page_size": 25, "resource_id": None, "stale": False}
    token = codec.encode(
        scope=scope,
        filters=filters,
        position={"created_at": "2026-08-05T15:59:00Z", "id": str(uuid4())},
        cutoff_at=NOW,
        now=NOW,
    )
    decoded = codec.decode(token, scope=scope, filters=filters, now=NOW)

    assert len(token) <= 1024
    assert decoded.cutoff_at == NOW
    assert decoded.position["created_at"] == "2026-08-05T15:59:00Z"


def test_cursor_failures_are_non_distinguishing_and_rotation_is_bounded() -> None:
    old_codec = _cursor_codec(active="previous", previous=None)
    scope = _cursor_scope()
    filters = {"page_size": 25}
    old_token = old_codec.encode(
        scope=scope,
        filters=filters,
        position={"id": str(uuid4())},
        cutoff_at=NOW,
        now=NOW,
    )
    rotated = _cursor_codec()
    assert rotated.decode(old_token, scope=scope, filters=filters, now=NOW).cutoff_at == NOW

    tampered = f"{old_token[:-1]}{'A' if old_token[-1] != 'A' else 'B'}"
    failures: list[APIError] = []
    for token, candidate_scope, candidate_filters, candidate_now in (
        (tampered, scope, filters, NOW),
        (old_token, _cursor_scope(subject="different"), filters, NOW),
        (old_token, scope, {"page_size": 50}, NOW),
        (old_token, scope, filters, NOW + timedelta(minutes=21)),
    ):
        with pytest.raises(APIError) as raised:
            rotated.decode(
                token,
                scope=candidate_scope,
                filters=candidate_filters,
                now=candidate_now,
            )
        failures.append(raised.value)

    assert {(error.status_code, error.code, error.message) for error in failures} == {
        (400, "KNOWLEDGE_CURSOR_INVALID", "The knowledge cursor is invalid or no longer applies.")
    }
    with pytest.raises(APIError, match="knowledge cursor"):
        _cursor_codec(previous=None).decode(old_token, scope=scope, filters=filters, now=NOW)


def test_etag_is_opaque_versioned_and_does_not_disclose_current_version() -> None:
    entity_id = uuid4()
    first = make_strong_etag(
        key=TEST_KEY_CURRENT,
        entity_kind="source-excerpt",
        entity_id=entity_id,
        version=1,
    )
    second = make_strong_etag(
        key=TEST_KEY_CURRENT,
        entity_kind="source-excerpt",
        entity_id=entity_id,
        version=2,
    )
    assert first.startswith('"') and first.endswith('"')
    assert str(entity_id) not in first
    assert first != second
    assert if_none_match_matches(f'"other", {second}', second)

    with pytest.raises(APIError) as stale:
        validate_write_precondition(
            expected_version=1,
            current_version=2,
            if_match=first,
            current_etag=second,
        )
    assert stale.value.code == "KNOWLEDGE_VERSION_CONFLICT"
    assert stale.value.details == {}

    with pytest.raises(APIError) as inconsistent:
        validate_write_precondition(
            expected_version=2,
            current_version=2,
            if_match=first,
            current_etag=second,
        )
    assert inconsistent.value.code == "KNOWLEDGE_PRECONDITION_INVALID"
    assert inconsistent.value.details == {}


def test_rate_policies_match_the_approved_dual_buckets() -> None:
    assert (ITEM_READ_RATE.caller_limit, ITEM_READ_RATE.workspace_limit) == (120, 1_200)
    assert (GRAPH_READ_RATE.caller_limit, GRAPH_READ_RATE.workspace_limit) == (20, 200)
    assert (GRAPH_READ_RATE.caller_concurrency, GRAPH_READ_RATE.workspace_concurrency) == (2, 20)
    assert (KNOWLEDGE_WRITE_RATE.caller_limit, KNOWLEDGE_WRITE_RATE.workspace_limit) == (60, 600)
    assert (DRAFT_ACCEPT_RATE.caller_concurrency, DRAFT_ACCEPT_RATE.workspace_concurrency) == (
        1,
        10,
    )


@pytest.mark.parametrize(
    ("role", "action", "allowed_when_enabled"),
    [
        (WorkspaceRole.OWNER, KnowledgeAction.WRITE, True),
        (WorkspaceRole.ADMIN, KnowledgeAction.ACCEPT, True),
        (WorkspaceRole.EDITOR, KnowledgeAction.ACCEPT, True),
        (WorkspaceRole.CONTRIBUTOR, KnowledgeAction.WRITE, True),
        (WorkspaceRole.CONTRIBUTOR, KnowledgeAction.ACCEPT, False),
        (WorkspaceRole.REVIEWER, KnowledgeAction.WRITE, False),
        (WorkspaceRole.REVIEWER, KnowledgeAction.ACCEPT, True),
        (WorkspaceRole.VIEWER, KnowledgeAction.WRITE, False),
    ],
)
def test_shared_authorization_policy_matches_the_approved_role_matrix(
    role: WorkspaceRole,
    action: KnowledgeAction,
    allowed_when_enabled: bool,
) -> None:
    caller_id = uuid4()
    if allowed_when_enabled:
        authorize_space_policy(
            role=role,
            visibility=SpaceVisibility.SHARED,
            caller_user_id=caller_id,
            owner_user_id=uuid4(),
            action=action,
            shared_writes_enabled=True,
        )
    else:
        with pytest.raises(APIError) as denied:
            authorize_space_policy(
                role=role,
                visibility=SpaceVisibility.SHARED,
                caller_user_id=caller_id,
                owner_user_id=uuid4(),
                action=action,
                shared_writes_enabled=True,
            )
        assert denied.value.code == "KNOWLEDGE_OPERATION_DENIED"

    if action is not KnowledgeAction.READ and allowed_when_enabled:
        with pytest.raises(APIError) as disabled:
            authorize_space_policy(
                role=role,
                visibility=SpaceVisibility.SHARED,
                caller_user_id=caller_id,
                owner_user_id=uuid4(),
                action=action,
                shared_writes_enabled=False,
            )
        assert disabled.value.code == "KNOWLEDGE_SHARED_WRITES_DISABLED"


def test_private_space_policy_hides_non_owner_even_from_workspace_owner() -> None:
    with pytest.raises(APIError) as denied:
        authorize_space_policy(
            role=WorkspaceRole.OWNER,
            visibility=SpaceVisibility.PRIVATE,
            caller_user_id=uuid4(),
            owner_user_id=uuid4(),
            action=KnowledgeAction.READ,
            shared_writes_enabled=True,
        )
    assert (denied.value.status_code, denied.value.code, denied.value.details) == (
        404,
        "RESOURCE_NOT_FOUND",
        {},
    )


class _RecordingRateLimiter:
    def __init__(self, *, reject_call: int | None = None) -> None:
        self.calls: list[dict[str, str | int]] = []
        self.reject_call = reject_call

    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None:
        self.calls.append(
            {
                "scope": scope,
                "subject_hash": subject_hash,
                "limit": limit,
                "window": window,
            }
        )
        if self.reject_call == len(self.calls):
            raise APIError(
                code="AUTH_RATE_LIMITED",
                message="rate limited",
                status_code=429,
            )


@pytest.mark.asyncio
async def test_dual_rate_limit_uses_two_privacy_hashed_buckets_and_one_public_error() -> None:
    caller_id = str(uuid4())
    workspace_id = str(uuid4())
    limiter = _RecordingRateLimiter()
    security = IdentitySecurity("test-only-security-key-material-32-bytes")

    await enforce_dual_rate_limit(
        limiter,
        security,
        operation="graph-read",
        caller_id=caller_id,
        workspace_id=workspace_id,
        policy=GRAPH_READ_RATE,
    )
    assert [call["limit"] for call in limiter.calls] == [20, 200]
    assert [call["scope"] for call in limiter.calls] == [
        "knowledge:graph-read:caller",
        "knowledge:graph-read:workspace",
    ]
    assert all(
        caller_id not in str(call) and workspace_id not in str(call) for call in limiter.calls
    )

    rejected = _RecordingRateLimiter(reject_call=2)
    with pytest.raises(APIError) as raised:
        await enforce_dual_rate_limit(
            rejected,
            security,
            operation="graph-read",
            caller_id=caller_id,
            workspace_id=workspace_id,
            policy=GRAPH_READ_RATE,
        )
    assert raised.value.code == "KNOWLEDGE_RATE_LIMITED"
    assert raised.value.headers["Retry-After"] == "60"
    assert raised.value.retryable is True


def test_openapi_contract_is_additive_bounded_and_strict() -> None:
    schema = app.openapi()
    base = BASE_PATH
    expected_operations = {
        "knowledge_source_excerpt_create",
        "knowledge_source_excerpt_get",
        "knowledge_source_excerpt_list",
        "knowledge_source_excerpt_delete",
        "knowledge_citation_create",
        "knowledge_citation_get",
        "knowledge_citation_list",
        "knowledge_citation_replace",
        "knowledge_citation_delete",
        "knowledge_draft_accept",
        "knowledge_search",
        "knowledge_graph_get",
    }
    operations = {
        operation["operationId"]
        for path, item in schema["paths"].items()
        if path.startswith(base)
        for operation in item.values()
        if isinstance(operation, dict) and "operationId" in operation
    }
    assert operations == expected_operations

    graph = schema["paths"][f"{base}/graph"]["get"]
    parameters = {parameter["name"]: parameter for parameter in graph["parameters"]}
    assert parameters["depth"]["schema"]["maximum"] == 2
    assert parameters["cursor"]["schema"]["anyOf"][0]["maxLength"] == 1024
    assert set(graph["responses"]) >= {"200", "400", "401", "403", "404", "422", "429", "503"}

    components = schema["components"]["schemas"]
    for component in (
        "SourceExcerptCreateRequest",
        "KnowledgeCitationCreateRequest",
        "KnowledgeDraftAcceptanceRequest",
        "KnowledgeGraphResponse",
    ):
        assert components[component]["additionalProperties"] is False
    assert "total" not in components["SourceExcerptPageResponse"]["properties"]
    assert "total" not in components["KnowledgeCitationPageResponse"]["properties"]

    mutation = schema["paths"][f"{base}/source-excerpts"]["post"]
    assert "x-csrf-token" in {parameter["name"] for parameter in mutation["parameters"]}


class _FakeIdentityService:
    def validate_csrf(self, session: object, supplied: str | None, cookie: str | None) -> None:
        if supplied != "csrf-ok" or cookie != "csrf-ok":
            raise APIError(
                code="AUTH_CSRF_INVALID",
                message="The CSRF token is invalid.",
                status_code=403,
            )


@pytest.mark.asyncio
async def test_contract_routes_authenticate_and_validate_csrf_before_failing_closed() -> None:
    workspace_id = uuid4()
    space_id = uuid4()
    path = BASE_PATH.format(workspace_id=workspace_id, space_id=space_id)
    transport = ASGITransport(app=app, client=("192.0.2.50", 50000))

    async with AsyncClient(transport=transport, base_url="http://test") as anonymous:
        response = await anonymous.get(f"{path}/source-excerpts")
    assert response.status_code == 401

    async def fake_context() -> AuthContext:
        return cast(AuthContext, SimpleNamespace(session=object()))

    app.dependency_overrides[get_current_context] = fake_context
    app.dependency_overrides[get_identity_service] = _FakeIdentityService
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as authenticated:
            read = await authenticated.get(f"{path}/source-excerpts")
            missing_origin = await authenticated.post(
                f"{path}/source-excerpts",
                json=_excerpt_payload(),
            )
            authenticated.cookies.set("logion_csrf", "csrf-ok")
            valid_boundary = await authenticated.post(
                f"{path}/source-excerpts",
                headers={
                    "Origin": "http://localhost:3000",
                    "X-CSRF-Token": "csrf-ok",
                },
                json=_excerpt_payload(),
            )
            invalid_body_while_disabled = await authenticated.post(
                f"{path}/source-excerpts",
                headers={
                    "Origin": "http://localhost:3000",
                    "X-CSRF-Token": "csrf-ok",
                },
                json={"unexpected": "field"},
            )
    finally:
        app.dependency_overrides.clear()

    assert (read.status_code, read.json()["code"]) == (404, "KNOWLEDGE_FEATURE_DISABLED")
    assert (missing_origin.status_code, missing_origin.json()["code"]) == (
        403,
        "AUTH_ORIGIN_INVALID",
    )
    assert (valid_boundary.status_code, valid_boundary.json()["code"]) == (
        404,
        "KNOWLEDGE_FEATURE_DISABLED",
    )
    assert (
        invalid_body_while_disabled.status_code,
        invalid_body_while_disabled.json()["code"],
    ) == (404, "KNOWLEDGE_FEATURE_DISABLED")
    assert read.headers["Cache-Control"] == "private, no-store"
    assert valid_boundary.headers["Cache-Control"] == "private, no-store"


def test_non_enumeration_contract_uses_one_resource_not_found_shape() -> None:
    errors = [resource_not_found_error() for _ in range(5)]
    assert all(
        (
            error.status_code,
            error.code,
            error.message,
            error.details,
        )
        == (404, "RESOURCE_NOT_FOUND", "The requested resource was not found.", {})
        for error in errors
    )


def test_cursor_scope_values_are_strings_not_authorization_tokens() -> None:
    scope = _cursor_scope()
    assert UUID(scope.workspace_id)
    assert UUID(scope.space_id)
    assert scope.subject_hash == "subject-hash"
