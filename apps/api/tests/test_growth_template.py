import json
from collections.abc import Callable
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from logion_api.growth.schemas import (
    TemplateFromGoalCreate,
    TemplatePackageImport,
    TemplatePackageResponse,
)
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]


def valid_create_payload() -> dict[str, Any]:
    return {
        "id": uuid4(),
        "template_key": uuid4(),
        "source_space_id": uuid4(),
        "source_goal_id": uuid4(),
        "name": "Tenant template",
        "author_name": "Author",
        "license": "CC-BY-4.0",
        "target_personas": ["execution"],
    }


def test_official_response_allows_global_scope() -> None:
    payload = {
        "id": uuid4(),
        "workspace_id": None,
        "template_key": uuid4(),
        "version_number": 1,
        "name": "官方模板",
        "description": "",
        "schema_version": 1,
        "product_min_version": "0.1.0",
        "author_name": "Logion",
        "license": "CC-BY-4.0",
        "locale": "zh-CN",
        "target_personas": ["execution"],
        "changelog": "初版",
        "content_hash": "a" * 64,
        "risk_metadata": {},
        "object_graph": {},
        "visibility": "official",
        "status": "active",
        "created_at": datetime.now(UTC),
    }

    assert TemplatePackageResponse.model_validate(payload).workspace_id is None


def test_user_create_payload_rejects_official_visibility() -> None:
    with pytest.raises(ValidationError):
        TemplateFromGoalCreate.model_validate(
            {**valid_create_payload(), "visibility": "official"}
        )


def example_payload() -> dict[str, Any]:
    return json.loads(
        (ROOT / "examples/templates/ai-presemester-47-day.template.json").read_text(
            encoding="utf-8"
        )
    )


def test_47_day_package_has_contiguous_bounded_structure() -> None:
    package = TemplatePackageImport.model_validate(example_payload())

    assert len(package.goal_plan.phases) == 7
    tasks = [task for phase in package.goal_plan.phases for task in phase.tasks]
    assert len(tasks) == 47
    assert [task.day_offset for task in tasks] == list(range(47))
    assert package.goal_plan.target_day_offset == 46
    assert sum(len(task.resources) for task in tasks) == 8


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (lambda value: value.update({"unexpected": True}), "extra_forbidden"),
        (
            lambda value: value["goal_plan"]["phases"][0]["tasks"][0]["resources"][0].update(
                {"source_url": "file:///etc/passwd"}
            ),
            "source_url must use http or https",
        ),
        (
            lambda value: value["goal_plan"]["phases"][1].update({"position": 7}),
            "phase positions must be contiguous and ordered",
        ),
    ],
)
def test_import_schema_fails_closed(
    mutate: Callable[[dict[str, Any]], None], expected: str
) -> None:
    payload = deepcopy(example_payload())
    mutate(payload)

    with pytest.raises(ValidationError) as captured:
        TemplatePackageImport.model_validate(payload)
    assert expected in str(captured.value)
