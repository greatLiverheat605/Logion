import json
import os
import sys
from pathlib import Path
from typing import Any, cast

import pytest
from logion_api import openapi_export
from logion_api.main import create_app
from logion_api.openapi_export import normalize_workbench_openapi
from logion_api.workbenches.schemas import WorkbenchDefinitionCreateRequest
from pydantic import ValidationError

BASE_PATH = "/api/v1/users/me/workbenches"
EXPECTED_OPERATIONS = {
    ("GET", BASE_PATH): ("workbench_definition_list", None, "WorkbenchDefinitionPageResponse"),
    ("POST", BASE_PATH): (
        "workbench_definition_create",
        "WorkbenchDefinitionCreateRequest",
        "WorkbenchDefinitionResponse",
    ),
    ("POST", f"{BASE_PATH}/imports"): (
        "workbench_import",
        "WorkbenchImportRequest",
        "WorkbenchImportSucceededReceipt",
    ),
    ("GET", f"{BASE_PATH}/{{workbench_id}}"): (
        "workbench_definition_get",
        None,
        "WorkbenchDefinitionResponse",
    ),
    ("PUT", f"{BASE_PATH}/{{workbench_id}}"): (
        "workbench_definition_replace",
        "WorkbenchDefinitionReplaceRequest",
        "WorkbenchDefinitionResponse",
    ),
    ("DELETE", f"{BASE_PATH}/{{workbench_id}}"): (
        "workbench_definition_delete",
        "WorkbenchDefinitionDeleteRequest",
        "WorkbenchDefinitionDeleteReceipt",
    ),
    ("POST", f"{BASE_PATH}/{{workbench_id}}/archive"): (
        "workbench_definition_archive",
        "WorkbenchDefinitionLifecycleRequest",
        "WorkbenchDefinitionResponse",
    ),
    ("POST", f"{BASE_PATH}/{{workbench_id}}/restore"): (
        "workbench_definition_restore",
        "WorkbenchDefinitionLifecycleRequest",
        "WorkbenchDefinitionResponse",
    ),
    ("GET", f"{BASE_PATH}/{{workbench_id}}/deletion-impact"): (
        "workbench_definition_deletion_impact_get",
        None,
        "WorkbenchDefinitionDeletionImpact",
    ),
    ("GET", f"{BASE_PATH}/{{workbench_id}}/export"): (
        "workbench_definition_export",
        None,
        "WorkbenchExportV1",
    ),
    ("GET", f"{BASE_PATH}/{{workbench_id}}/links"): (
        "workbench_link_list",
        None,
        "WorkbenchLinkPageResponse",
    ),
    ("POST", f"{BASE_PATH}/{{workbench_id}}/links"): (
        "workbench_link_create",
        "WorkbenchLinkCreateRequest",
        "WorkbenchObjectLinkResponse",
    ),
    ("PATCH", f"{BASE_PATH}/{{workbench_id}}/links/{{link_id}}"): (
        "workbench_link_patch",
        "WorkbenchLinkPatchRequest",
        "WorkbenchObjectLinkResponse",
    ),
    ("DELETE", f"{BASE_PATH}/{{workbench_id}}/links/{{link_id}}"): (
        "workbench_link_delete",
        "WorkbenchLinkDeleteRequest",
        "WorkbenchLinkDeleteReceipt",
    ),
    ("POST", f"{BASE_PATH}/{{workbench_id}}/links/reorder"): (
        "workbench_link_reorder",
        "WorkbenchLinkReorderRequest",
        "WorkbenchLinkSetResponse",
    ),
}

MUTATION_ORIGIN_OPERATIONS = {
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
}
ERROR_REFS = {
    "400": "WorkbenchPreconditionInvalidErrorResponse",
    "401": "ErrorResponse",
    "403": "WorkbenchForbiddenErrorResponse",
    "404": "WorkbenchNotFoundErrorResponse",
    "409": "WorkbenchConflictErrorResponse",
    "413": "ErrorResponse",
    "422": "WorkbenchValidationErrorResponse",
    "429": "WorkbenchRateLimitedErrorResponse",
    "503": "ErrorResponse",
}

EXPECTED_ERROR_CODES = {
    "workbench_definition_list": {"401", "422", "429", "503"},
    "workbench_definition_create": {"401", "403", "409", "413", "422", "429", "503"},
    "workbench_import": {"401", "403", "409", "413", "422", "429", "503"},
    "workbench_definition_get": {"401", "404", "422", "429", "503"},
    "workbench_definition_replace": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_definition_archive": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_definition_restore": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_definition_deletion_impact_get": {"401", "404", "422", "429", "503"},
    "workbench_definition_delete": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_definition_export": {"401", "403", "404", "422", "429", "503"},
    "workbench_link_list": {"401", "404", "422", "429", "503"},
    "workbench_link_create": {"401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_link_patch": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_link_delete": {"400", "401", "403", "404", "409", "413", "422", "429", "503"},
    "workbench_link_reorder": {"401", "403", "404", "409", "413", "422", "429", "503"},
}

EXPECTED_PARAMETER_NAMES = {
    "workbench_definition_list": {"lifecycle", "limit", "cursor"},
    "workbench_definition_create": {"Origin", "X-CSRF-Token", "Idempotency-Key"},
    "workbench_import": {"Origin", "X-CSRF-Token", "Idempotency-Key"},
    "workbench_definition_get": {"workbench_id", "If-None-Match"},
    "workbench_definition_replace": {"workbench_id", "Origin", "X-CSRF-Token", "If-Match"},
    "workbench_definition_archive": {"workbench_id", "Origin", "X-CSRF-Token", "If-Match"},
    "workbench_definition_restore": {"workbench_id", "Origin", "X-CSRF-Token", "If-Match"},
    "workbench_definition_deletion_impact_get": {"workbench_id"},
    "workbench_definition_delete": {
        "workbench_id",
        "Origin",
        "X-CSRF-Token",
        "Idempotency-Key",
        "If-Match",
    },
    "workbench_definition_export": {"workbench_id", "Origin", "X-CSRF-Token", "include_links"},
    "workbench_link_list": {"workbench_id", "limit", "cursor"},
    "workbench_link_create": {"workbench_id", "Origin", "X-CSRF-Token", "Idempotency-Key"},
    "workbench_link_patch": {"workbench_id", "link_id", "Origin", "X-CSRF-Token", "If-Match"},
    "workbench_link_delete": {"workbench_id", "link_id", "Origin", "X-CSRF-Token", "If-Match"},
    "workbench_link_reorder": {"workbench_id", "Origin", "X-CSRF-Token"},
}

EXPECTED_SUCCESS_HEADERS = {
    "workbench_definition_list": {"Cache-Control"},
    "workbench_definition_create": {"Location", "ETag", "Cache-Control"},
    "workbench_import": {"Cache-Control"},
    "workbench_definition_get": {"ETag", "Cache-Control"},
    "workbench_definition_replace": {"ETag", "Cache-Control"},
    "workbench_definition_archive": {"ETag", "Cache-Control"},
    "workbench_definition_restore": {"ETag", "Cache-Control"},
    "workbench_definition_deletion_impact_get": {"Cache-Control"},
    "workbench_definition_delete": {"Cache-Control"},
    "workbench_definition_export": {"Content-Disposition", "Cache-Control"},
    "workbench_link_list": {"ETag", "Cache-Control"},
    "workbench_link_create": {"Location", "ETag", "Cache-Control"},
    "workbench_link_patch": {"ETag", "Cache-Control"},
    "workbench_link_delete": {"ETag", "Cache-Control"},
    "workbench_link_reorder": {"ETag", "Cache-Control"},
}


def _ref(name: str) -> str:
    return f"#/components/schemas/{name}"


def _operation(document: dict[str, Any], method: str, path: str) -> dict[str, Any]:
    return cast(dict[str, Any], document["paths"][path][method.lower()])


def _response_ref(operation: dict[str, Any], status_code: str) -> str | None:
    schema = (
        operation["responses"][status_code]
        .get("content", {})
        .get("application/json", {})
        .get("schema")
    )
    return schema.get("$ref") if isinstance(schema, dict) else None


def test_default_app_keeps_workbench_routes_disabled() -> None:
    document = create_app().openapi()
    assert not any(path.startswith(BASE_PATH) for path in document["paths"])


def test_exporter_rejects_output_outside_contract_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", ["openapi_export", "tmp/not-openapi.json"])
    with pytest.raises(SystemExit, match="output path must be exactly"):
        openapi_export.main()


def test_dormant_app_has_exact_paths_operations_and_ids() -> None:
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    paths = {path: value for path, value in document["paths"].items() if path.startswith(BASE_PATH)}
    assert len(paths) == 10
    assert (
        sum(
            1
            for path in paths.values()
            for method in ("get", "post", "put", "patch", "delete")
            if method in path
        )
        == 15
    )
    observed: dict[tuple[str, str], tuple[str, str | None, str | None]] = {}
    for (method, path), (
        operation_id,
        request_model,
        response_model,
    ) in EXPECTED_OPERATIONS.items():
        operation = _operation(document, method, path)
        request_body = operation.get("requestBody")
        request_ref = None
        if request_body is not None:
            request_ref = request_body["content"]["application/json"]["schema"]["$ref"]
        response_ref = _response_ref(
            operation,
            "201"
            if method == "POST"
            and path in {BASE_PATH, f"{BASE_PATH}/imports", f"{BASE_PATH}/{{workbench_id}}/links"}
            else "200",
        )
        observed[(method, path)] = (
            operation["operationId"],
            request_ref,
            response_ref,
        )
        assert operation_id == operation["operationId"]
        if request_model is None:
            assert request_body is None
        else:
            assert request_body is not None
            assert request_body["required"] is True
            assert observed[(method, path)][1] == _ref(request_model)
        assert observed[(method, path)][2] == _ref(response_model)
        assert "security" not in operation
        operation_id_observed = operation["operationId"]
        success_codes = {
            "201"
            if method == "POST"
            and path in {BASE_PATH, f"{BASE_PATH}/imports", f"{BASE_PATH}/{{workbench_id}}/links"}
            else "200"
        }
        if operation_id_observed == "workbench_import":
            success_codes.add("200")
        if operation_id_observed == "workbench_definition_get":
            success_codes.add("304")
        assert (
            set(operation["responses"])
            == success_codes | EXPECTED_ERROR_CODES[operation_id_observed]
        )
        assert {
            parameter["name"] for parameter in operation.get("parameters", [])
        } == EXPECTED_PARAMETER_NAMES[operation_id_observed]
        for parameter in operation.get("parameters", []):
            if parameter["name"] in {"Origin", "X-CSRF-Token", "Idempotency-Key"}:
                assert parameter["required"] is True
            if parameter["name"] in {"workbench_id", "link_id"}:
                assert parameter["in"] == "path"
                assert parameter["schema"] == {
                    "type": "string",
                    "format": "uuid",
                    "title": parameter["name"].replace("_", " ").title(),
                }
        for status_code, response in operation["responses"].items():
            if status_code in EXPECTED_ERROR_CODES[operation_id_observed]:
                assert response["content"]["application/json"]["schema"]["$ref"]
                assert response["headers"]["Cache-Control"]["schema"] == {
                    "type": "string",
                    "const": "private, no-store",
                }
                if status_code == "429":
                    assert response["headers"]["Retry-After"]["schema"] == {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 3600,
                    }
        success_code = "201" if "201" in operation["responses"] else "200"
        assert (
            set(operation["responses"][success_code].get("headers", {}))
            == EXPECTED_SUCCESS_HEADERS[operation_id_observed]
        )
    assert set(observed) == set(EXPECTED_OPERATIONS)


def test_workbench_integer_schemas_are_bounded() -> None:
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())

    def assert_bounded(value: Any, path: str) -> None:
        if isinstance(value, dict):
            if value.get("type") == "integer" and "const" not in value:
                assert "minimum" in value, path
                assert "maximum" in value, path
            for key, child in value.items():
                assert_bounded(child, f"{path}.{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                assert_bounded(child, f"{path}[{index}]")

    for name, schema in document["components"]["schemas"].items():
        if name.startswith("Workbench"):
            assert_bounded(schema, name)


def test_preference_component_is_generated_without_changing_settings_routes() -> None:
    default_document = create_app().openapi()
    candidate = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    preference = candidate["components"]["schemas"]["WorkbenchPreferenceDocumentV1"]
    assert preference["additionalProperties"] is False
    assert preference["properties"]["contract"]["const"] == "workbench.preference"
    assert preference["properties"]["schemaVersion"]["const"] == 1
    assert preference["properties"]["revision"]["$ref"] == "#/components/schemas/Revision"
    assert (
        candidate["paths"]["/api/v1/users/me/settings"]
        == default_document["paths"]["/api/v1/users/me/settings"]
    )
    assert "x-logion-component-WorkbenchPreferenceDocumentV1" not in json.dumps(candidate["paths"])


def test_security_headers_and_error_refs_are_explicit() -> None:
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    for (method, path), (_, _, _) in EXPECTED_OPERATIONS.items():
        operation = _operation(document, method, path)
        parameters = {parameter["name"]: parameter for parameter in operation.get("parameters", [])}
        is_export = path.endswith("/export")
        if method in MUTATION_ORIGIN_OPERATIONS or is_export:
            assert parameters["Origin"]["in"] == "header"
            assert parameters["Origin"]["required"] is True
            assert parameters["X-CSRF-Token"]["required"] is True
        for code, schema_name in ERROR_REFS.items():
            if code not in operation["responses"]:
                continue
            response = operation["responses"][code]
            expected_schema = (
                "WorkbenchImportRetryableErrorResponse"
                if operation["operationId"] == "workbench_import" and code == "503"
                else schema_name
            )
            assert _response_ref(operation, code) == _ref(expected_schema)
            assert response["headers"]["Cache-Control"]["schema"]["const"] == "private, no-store"
            if code == "429":
                retry_schema = response["headers"]["Retry-After"]["schema"]
                assert retry_schema == {"type": "integer", "minimum": 1, "maximum": 3600}


def test_import_receipts_are_distinct_const_overlays() -> None:
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    schemas = document["components"]["schemas"]
    for name, status_value, definition_value in (
        ("WorkbenchImportSucceededReceipt", "succeeded", {"type": "string", "format": "uuid"}),
        ("WorkbenchImportFailedReceipt", "failed", {"const": None, "type": "null"}),
    ):
        schema = schemas[name]
        assert schema["allOf"][0] == {"$ref": _ref("WorkbenchImportReceipt")}
        overlay = schema["allOf"][1]
        assert overlay["properties"]["status"] == {"const": status_value}
        assert overlay["properties"]["retryable"] == {"const": False}
        assert overlay["properties"]["definitionId"] == definition_value
    base_schema = schemas["WorkbenchImportReceipt"]
    assert "additionalProperties" not in base_schema
    assert {"status", "retryable", "definitionId"}.isdisjoint(base_schema["properties"])
    for name in ("WorkbenchImportSucceededReceipt", "WorkbenchImportFailedReceipt"):
        overlay = schemas[name]["allOf"][1]
        assert set(base_schema["properties"]) < set(overlay["properties"])
        assert set(base_schema["required"]) < set(overlay["required"])
    import_operation = _operation(document, "POST", f"{BASE_PATH}/imports")
    assert _response_ref(import_operation, "201") == _ref("WorkbenchImportSucceededReceipt")
    assert _response_ref(import_operation, "200") == _ref("WorkbenchImportFailedReceipt")
    assert _response_ref(import_operation, "503") == _ref("WorkbenchImportRetryableErrorResponse")
    retryable_error = schemas["WorkbenchImportRetryableErrorResponse"]
    assert retryable_error["properties"]["retryable"] == {
        "type": "boolean",
        "const": True,
        "title": "Retryable",
    }
    assert set(retryable_error["required"]) == {
        "code",
        "message",
        "details",
        "retryable",
        "request_id",
    }


def test_definition_owner_is_response_only() -> None:
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    schemas = document["components"]["schemas"]
    for name in ("WorkbenchDefinitionSummary", "WorkbenchDefinitionResponse"):
        schema = schemas[name]
        assert schema["properties"]["ownerUserId"] == {
            "type": "string",
            "format": "uuid",
            "title": "Owneruserid",
        }
        assert "ownerUserId" in schema["required"]

    for name, schema in schemas.items():
        if name.startswith("Workbench") and name.endswith("Request"):
            assert schema["additionalProperties"] is False
            assert "ownerUserId" not in json.dumps(schema)

    with pytest.raises(ValidationError) as exc_info:
        WorkbenchDefinitionCreateRequest.model_validate({"ownerUserId": "not-accepted"})
    assert any(
        error["type"] == "extra_forbidden" and error["loc"] == ("ownerUserId",)
        for error in exc_info.value.errors()
    )

    link_response = schemas["WorkbenchObjectLinkResponse"]
    assert link_response["properties"]["ownerUserId"]["format"] == "uuid"
    assert "ownerUserId" in link_response["required"]


def test_evidence_manifest_and_non_leakage_are_written_when_requested(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    evidence_dir = Path(os.environ.get("LOGION_I3_C5_EVIDENCE", str(tmp_path)))
    evidence_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("LOGION_I3_C5_EVIDENCE", str(evidence_dir))
    document = normalize_workbench_openapi(create_app(include_dormant_contracts=True).openapi())
    workbench_paths = sorted(path for path in document["paths"] if path.startswith(BASE_PATH))
    manifest = {
        "paths": {
            path: {
                method: {
                    key: operation[key]
                    for key in ("operationId", "parameters", "requestBody", "responses", "security")
                    if key in operation
                }
                for method, operation in document["paths"][path].items()
                if method in {"get", "post", "put", "patch", "delete"}
            }
            for path in workbench_paths
        },
        "components": {
            name: schema
            for name, schema in document["components"]["schemas"].items()
            if name.startswith("Workbench")
        },
    }
    (evidence_dir / "semantic-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    forbidden_runtime_fields = {
        "aclDetails",
        "databaseId",
        "featureFlag",
        "internalOwnerId",
        "objectBody",
        "rejectedValue",
        "remainingQuota",
        "requestFingerprint",
        "serverFingerprint",
        "sessionCookie",
        "spaceAcl",
        "workspaceRole",
    }
    serialized_manifest = json.dumps(manifest, ensure_ascii=False)
    observed_forbidden = sorted(
        field for field in forbidden_runtime_fields if field in serialized_manifest
    )
    assert observed_forbidden == []
    (evidence_dir / "non-leakage.json").write_text(
        json.dumps(
            {
                "forbiddenRuntimeFields": sorted(forbidden_runtime_fields),
                "observed": observed_forbidden,
                "checked": True,
            },
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    assert (evidence_dir / "semantic-manifest.json").exists()
    assert (evidence_dir / "non-leakage.json").exists()
    monkeypatch.delenv("LOGION_I3_C5_EVIDENCE")
