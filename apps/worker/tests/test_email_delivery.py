from datetime import UTC, datetime
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest
from logion_api.config import Settings
from logion_worker.email_delivery import (
    AliyunDirectMailTransport,
    DeliveryReceipt,
    EmailDeliveryFailure,
    EmailMessage,
    classify_provider_failure,
    render_email,
    retry_delay,
)
from pydantic import ValidationError


class FakeCredentialClient:
    def __init__(self) -> None:
        self.calls = 0

    async def get_credential_async(self) -> object:
        self.calls += 1
        return SimpleNamespace(
            access_key_id="test-access-key",  # noqa: S106
            access_key_secret="test-access-secret",  # noqa: S106
            security_token="test-security-token",  # noqa: S106
        )


def delivery_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "allowed_origins": ["https://logion.example"],
        "webauthn_rp_id": "logion.example",
        "webauthn_origins": ["https://logion.example"],
        "email_delivery_provider": "aliyun_directmail",
        "email_public_base_url": "https://logion.example",
        "aliyun_directmail_region_id": "cn-hangzhou",
        "aliyun_directmail_account_name": "no-reply@mail.example.com",
        "aliyun_directmail_from_alias": "Logion",
        "aliyun_directmail_ram_role_name": "LogionDirectMailSender",
    }
    values.update(overrides)
    return Settings(**values)


def test_email_templates_keep_tokens_in_url_fragments() -> None:
    verification = render_email(
        "email_verification",
        {"recipient": "person@example.com", "token": "token-123"},
        "https://logion.example",
    )
    recovery = render_email(
        "password_recovery",
        {"recipient": "person@example.com", "token": "recovery-456"},
        "https://logion.example",
    )

    assert "https://logion.example/auth/verify#token-123" in verification.text_body
    assert "https://logion.example/auth/recover#recovery-456" in recovery.text_body
    assert "?token=" not in verification.text_body + recovery.text_body


def test_email_templates_reject_unknown_or_header_injected_payloads() -> None:
    with pytest.raises(EmailDeliveryFailure, match="EMAIL_PAYLOAD_INVALID"):
        render_email(
            "security_notification",
            {"recipient": "person@example.com", "event": "unknown"},
            "https://logion.example",
        )
    with pytest.raises(EmailDeliveryFailure, match="EMAIL_PAYLOAD_INVALID"):
        render_email(
            "email_verification",
            {"recipient": "person@example.com\nBcc: attacker@example.com", "token": "token"},
            "https://logion.example",
        )


def test_aliyun_transport_creates_imdsv2_only_ram_role_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[object] = []

    def fake_client(config: object) -> FakeCredentialClient:
        captured.append(config)
        return FakeCredentialClient()

    monkeypatch.setattr("logion_worker.email_delivery.CredentialClient", fake_client)

    AliyunDirectMailTransport(delivery_settings())

    assert len(captured) == 1
    config = captured[0]
    assert config.type == "ecs_ram_role"
    assert config.role_name == "LogionDirectMailSender"
    assert config.disable_imds_v1 is True
    assert config.proxy is None


@pytest.mark.asyncio
async def test_aliyun_transport_uses_transactional_sender_without_tracking() -> None:
    client = FakeCredentialClient()
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"EnvId": "env-123", "RequestId": "request-456"},
        )

    transport = AliyunDirectMailTransport(
        delivery_settings(),
        client,
        transport_factory=lambda: httpx.MockTransport(handle),
        clock=lambda: datetime(2026, 7, 28, 8, 9, 10, tzinfo=UTC),
        nonce_factory=lambda: "fixed-nonce",
    )

    receipt = await transport.send(
        EmailMessage(
            recipient="person@example.com",
            subject="Subject",
            text_body="Text",
            html_body="<p>HTML</p>",
        )
    )

    assert receipt == DeliveryReceipt("env-123", "request-456")
    assert client.calls == 1
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://dm.aliyuncs.com/"
    fields = parse_qs(request.content.decode(), keep_blank_values=True)
    assert fields == {
        "AccountName": ["no-reply@mail.example.com"],
        "AddressType": ["1"],
        "ReplyToAddress": ["false"],
        "FromAlias": ["Logion"],
        "Subject": ["Subject"],
        "TextBody": ["Text"],
        "HtmlBody": ["<p>HTML</p>"],
        "ToAddress": ["person@example.com"],
        "ClickTrace": ["0"],
        "UnSubscribeFilterLevel": ["disabled"],
        "UnSubscribeLinkType": ["disabled"],
    }
    assert request.headers["x-acs-action"] == "SingleSendMail"
    assert request.headers["x-acs-version"] == "2015-11-23"
    assert request.headers["x-acs-date"] == "2026-07-28T08:09:10Z"
    assert request.headers["x-acs-signature-nonce"] == "fixed-nonce"
    assert request.headers["x-acs-security-token"] == "test-security-token"
    assert request.headers["authorization"] == (
        "ACS3-HMAC-SHA256 Credential=test-access-key,"
        "SignedHeaders=accept;content-type;host;user-agent;x-acs-accesskey-id;"
        "x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;"
        "x-acs-signature-nonce;x-acs-version,"
        "Signature=191fc3abb8e60e307a512b26021ab77f9565b76e387c099fffac82e4e56770a1"
    )


@pytest.mark.asyncio
async def test_aliyun_transport_does_not_follow_redirects() -> None:
    calls = 0

    def handle(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(307, headers={"location": "https://attacker.example/"})

    transport = AliyunDirectMailTransport(
        delivery_settings(),
        FakeCredentialClient(),
        transport_factory=lambda: httpx.MockTransport(handle),
    )

    with pytest.raises(EmailDeliveryFailure) as captured:
        await transport.send(EmailMessage("person@example.com", "Subject", "Text", "HTML"))

    assert captured.value.code == "EMAIL_PROVIDER_REJECTED"
    assert captured.value.retryable is False
    assert calls == 1


@pytest.mark.asyncio
async def test_aliyun_transport_retries_an_invalid_success_response() -> None:
    transport = AliyunDirectMailTransport(
        delivery_settings(),
        FakeCredentialClient(),
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(200, text="unexpected response")
        ),
    )

    with pytest.raises(EmailDeliveryFailure) as captured:
        await transport.send(EmailMessage("person@example.com", "Subject", "Text", "HTML"))

    assert captured.value.code == "EMAIL_PROVIDER_INVALID_RESPONSE"
    assert captured.value.retryable is True


@pytest.mark.asyncio
async def test_aliyun_transport_bounds_provider_response_size() -> None:
    transport = AliyunDirectMailTransport(
        delivery_settings(),
        FakeCredentialClient(),
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(200, content=b"x" * (64 * 1024 + 1))
        ),
    )

    with pytest.raises(EmailDeliveryFailure) as captured:
        await transport.send(EmailMessage("person@example.com", "Subject", "Text", "HTML"))

    assert captured.value.code == "EMAIL_PROVIDER_INVALID_RESPONSE"
    assert captured.value.retryable is True


@pytest.mark.parametrize(
    ("exception", "code", "retryable"),
    [
        (TimeoutError(), "EMAIL_PROVIDER_UNAVAILABLE", True),
        (httpx.ConnectError("network unavailable"), "EMAIL_PROVIDER_UNAVAILABLE", True),
        (
            SimpleNamespace(code="Throttling.User", status_code=429),
            "EMAIL_PROVIDER_UNAVAILABLE",
            True,
        ),
        (
            SimpleNamespace(code="Forbidden.RAM", status_code=403),
            "EMAIL_PROVIDER_REJECTED",
            False,
        ),
    ],
)
def test_provider_failures_are_classified_without_messages(
    exception: object,
    code: str,
    retryable: bool,
) -> None:
    value = exception if isinstance(exception, Exception) else ProviderException(exception)
    failure = classify_provider_failure(value)

    assert failure.code == code
    assert failure.retryable is retryable


def test_retry_schedule_is_bounded() -> None:
    assert retry_delay(1).total_seconds() == 60
    assert retry_delay(3).total_seconds() == 900
    assert retry_delay(99).total_seconds() == 14400


def test_directmail_settings_fail_closed() -> None:
    with pytest.raises(ValidationError, match="RAM_ROLE_NAME"):
        delivery_settings(aliyun_directmail_ram_role_name="")
    with pytest.raises(ValidationError, match="official aliyuncs.com"):
        delivery_settings(aliyun_directmail_endpoint="metadata.internal")
    with pytest.raises(ValidationError, match="official aliyuncs.com"):
        delivery_settings(aliyun_directmail_endpoint="dm.unlisted.aliyuncs.com")
    with pytest.raises(ValidationError, match="must match an origin"):
        delivery_settings(email_public_base_url="https://other.example")
    with pytest.raises(ValidationError, match="required for this region"):
        delivery_settings(aliyun_directmail_region_id="cn-unknown")
    with pytest.raises(ValidationError, match="must exceed DirectMail network timeouts"):
        delivery_settings(
            email_delivery_lease_seconds=30,
            aliyun_directmail_connect_timeout_seconds=15,
            aliyun_directmail_read_timeout_seconds=60,
        )


class ProviderException(Exception):
    def __init__(self, source: object) -> None:
        self.code = getattr(source, "code", "")
        self.status_code = getattr(source, "status_code", None)
