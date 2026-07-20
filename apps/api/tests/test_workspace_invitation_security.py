import pytest
from logion_api.config import Settings
from logion_api.main import app
from logion_api.workspaces.schemas import (
    WorkspaceInvitationAcceptRequest,
    WorkspaceInvitationCreateRequest,
)
from pydantic import ValidationError


def test_invitation_security_defaults_are_bounded() -> None:
    settings = Settings()

    assert settings.invitation_ttl_days == 7
    assert settings.invitation_create_limit_per_hour == 30
    assert settings.invitation_accept_limit_per_five_minutes == 20


def test_owner_cannot_be_issued_by_invitation_contract() -> None:
    with pytest.raises(ValidationError):
        WorkspaceInvitationCreateRequest(email="invitee@example.com", role="owner")  # type: ignore[arg-type]


def test_invitation_contract_validates_email_and_token_shape() -> None:
    with pytest.raises(ValidationError):
        WorkspaceInvitationCreateRequest(email="not-an-email", role="viewer")
    with pytest.raises(ValidationError):
        WorkspaceInvitationAcceptRequest(
            token="too-short"  # noqa: S106 - deliberately invalid public fixture
        )


def test_invitation_secret_is_only_accepted_in_request_body() -> None:
    openapi = app.openapi()
    accept = openapi["paths"]["/api/v1/invitations/accept"]["post"]

    assert all(parameter["name"] != "token" for parameter in accept.get("parameters", []))
    assert "requestBody" in accept
    assert all("{token}" not in path for path in openapi["paths"])
