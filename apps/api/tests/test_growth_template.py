import json
from collections.abc import Callable
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from logion_api.growth.schemas import TemplatePackageImport
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[3]


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
