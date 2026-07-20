import pytest
from logion_api.config import Settings
from logion_api.main import app
from logion_api.workspaces.schemas import WorkspaceOwnershipTransferRequest
from pydantic import ValidationError


def test_ownership_security_rate_limits_are_bounded() -> None:
    settings = Settings()

    assert settings.ownership_transfer_limit_per_hour == 10
    assert settings.membership_leave_limit_per_hour == 10


def test_transfer_contract_cannot_keep_previous_owner_as_owner() -> None:
    with pytest.raises(ValidationError):
        WorkspaceOwnershipTransferRequest(
            target_membership_id="00000000-0000-0000-0000-000000000002",
            expected_workspace_version=1,
            expected_current_owner_version=1,
            expected_target_version=1,
            previous_owner_role="owner",  # type: ignore[arg-type]
        )


def test_ownership_and_leave_are_explicit_post_operations() -> None:
    openapi = app.openapi()

    assert "post" in openapi["paths"]["/api/v1/workspaces/{workspace_id}/ownership/transfer"]
    assert "post" in openapi["paths"]["/api/v1/workspaces/{workspace_id}/members/me/leave"]
