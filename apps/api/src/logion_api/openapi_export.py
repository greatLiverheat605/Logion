import json
import sys
from pathlib import Path
from typing import Any

from logion_api.main import create_app


def normalize_workbench_openapi(document: dict[str, Any]) -> dict[str, Any]:
    schemas = document.setdefault("components", {}).setdefault("schemas", {})
    preference_extension = "x-logion-component-WorkbenchPreferenceDocumentV1"
    for item in document.get("paths", {}).values():
        for operation in item.values():
            if not isinstance(operation, dict):
                continue
            preference_schema = operation.pop(preference_extension, None)
            if preference_schema is None:
                continue
            for name, schema in preference_schema.pop("$defs", {}).items():
                schemas.setdefault(name, schema)
            schemas["WorkbenchPreferenceDocumentV1"] = preference_schema

    export_output_name = "WorkbenchExportV1-Output"
    if export_output_name in schemas:
        schemas["WorkbenchExportV1"] = schemas.pop(export_output_name)
        for item in document.get("paths", {}).values():
            for operation in item.values():
                if not isinstance(operation, dict):
                    continue
                for response in operation.get("responses", {}).values():
                    schema = response.get("content", {}).get("application/json", {}).get("schema")
                    if isinstance(schema, dict) and schema.get("$ref") == (
                        "#/components/schemas/" + export_output_name
                    ):
                        schema["$ref"] = "#/components/schemas/WorkbenchExportV1"

    base_name = "WorkbenchImportReceipt"
    succeeded = schemas["WorkbenchImportSucceededReceipt"]
    base_schema = json.loads(json.dumps(succeeded))
    base_schema.pop("$defs", None)
    for field in ("status", "retryable", "definitionId"):
        base_schema["properties"].pop(field, None)
        if field in base_schema.get("required", []):
            base_schema["required"].remove(field)
    base_schema.pop("additionalProperties", None)
    base_schema["title"] = base_name
    schemas[base_name] = base_schema
    common_properties = json.loads(json.dumps(base_schema["properties"]))
    common_required = list(base_schema["required"])
    schemas["WorkbenchImportSucceededReceipt"] = {
        "allOf": [
            {"$ref": f"#/components/schemas/{base_name}"},
            {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    **common_properties,
                    "status": {"const": "succeeded"},
                    "retryable": {"const": False},
                    "definitionId": {"type": "string", "format": "uuid"},
                },
                "required": [*common_required, "status", "retryable", "definitionId"],
            },
        ]
    }
    schemas["WorkbenchImportFailedReceipt"] = {
        "allOf": [
            {"$ref": f"#/components/schemas/{base_name}"},
            {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    **common_properties,
                    "status": {"const": "failed"},
                    "retryable": {"const": False},
                    "definitionId": {"const": None, "type": "null"},
                },
                "required": [*common_required, "status", "retryable", "definitionId"],
            },
        ]
    }
    return document


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(
            "usage: python -m logion_api.openapi_export packages/contracts/openapi/openapi.json"
        )

    output_path = Path(sys.argv[1])
    expected_path = Path("packages/contracts/openapi/openapi.json")
    if output_path.resolve() != expected_path.resolve():
        raise SystemExit(f"output path must be exactly {expected_path.as_posix()}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    candidate_app = create_app(include_dormant_contracts=True)
    document = normalize_workbench_openapi(candidate_app.openapi())
    output_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
