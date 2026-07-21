from uuid import uuid4

import pytest
from logion_api.execution.evidence_schemas import EvidenceSubmitRequest
from pydantic import ValidationError


def test_evidence_contract_requires_matching_reference_and_safe_link() -> None:
    base = {
        "evidence_id": uuid4(),
        "verification_id": uuid4(),
        "task_id": uuid4(),
        "evidence_type": "note",
        "note_id": uuid4(),
    }
    assert EvidenceSubmitRequest.model_validate(base).note_id is not None
    with pytest.raises(ValidationError):
        EvidenceSubmitRequest.model_validate({**base, "note_id": None})
    with pytest.raises(ValidationError):
        EvidenceSubmitRequest.model_validate(
            {
                **base,
                "evidence_type": "link",
                "note_id": None,
                "external_url": "javascript:alert(1)",
            }
        )
