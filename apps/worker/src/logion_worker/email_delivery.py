import hashlib
import hmac
import html
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, cast
from urllib.parse import quote, urlencode
from uuid import UUID, uuid4

import httpx
from alibabacloud_credentials.client import (  # type: ignore[import-untyped]
    Client as CredentialClient,
)
from alibabacloud_credentials.models import (  # type: ignore[import-untyped]
    Config as CredentialConfig,
)
from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import EmailOutbox, IdentityActionToken
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_worker.health import health_payload

_MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024


@dataclass(frozen=True)
class EmailMessage:
    recipient: str
    subject: str
    text_body: str
    html_body: str


@dataclass(frozen=True)
class DeliveryReceipt:
    provider_event_id: str | None
    provider_request_id: str | None


class EmailDeliveryFailure(Exception):
    def __init__(self, code: str, *, retryable: bool) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class EmailTransport(Protocol):
    async def send(self, message: EmailMessage) -> DeliveryReceipt: ...


class CredentialClientProtocol(Protocol):
    async def get_credential_async(self) -> object: ...


class ProviderResponseError(Exception):
    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class DeliveryWorkItem:
    outbox_id: UUID
    purpose: str
    attempt: int
    message: EmailMessage


class AliyunDirectMailTransport:
    _ENDPOINTS = {
        "cn-hangzhou": "dm.aliyuncs.com",
        "ap-southeast-1": "dm.ap-southeast-1.aliyuncs.com",
        "us-east-1": "dm.us-east-1.aliyuncs.com",
        "eu-central-1": "dm.eu-central-1.aliyuncs.com",
    }

    def __init__(
        self,
        settings: Settings,
        credentials: CredentialClientProtocol | None = None,
        transport_factory: Callable[[], httpx.AsyncBaseTransport] | None = None,
        clock: Callable[[], datetime] | None = None,
        nonce_factory: Callable[[], str] | None = None,
    ) -> None:
        self._settings = settings
        self._credentials = credentials or self._create_credentials(settings)
        self._transport_factory = transport_factory or (
            lambda: httpx.AsyncHTTPTransport(retries=0)
        )
        self._clock = clock or (lambda: datetime.now(UTC))
        self._nonce_factory = nonce_factory or (lambda: uuid4().hex)

    @staticmethod
    def _create_credentials(settings: Settings) -> CredentialClientProtocol:
        role_name = settings.aliyun_directmail_ram_role_name
        if not role_name:
            raise EmailDeliveryFailure("EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE", retryable=True)
        return cast(
            CredentialClientProtocol,
            CredentialClient(
                CredentialConfig(
                    type="ecs_ram_role",
                    role_name=role_name,
                    disable_imds_v1=True,
                    timeout=settings.aliyun_directmail_read_timeout_seconds * 1000,
                    connect_timeout=settings.aliyun_directmail_connect_timeout_seconds * 1000,
                )
            )
        )

    async def send(self, message: EmailMessage) -> DeliveryReceipt:
        account_name = self._settings.aliyun_directmail_account_name
        if account_name is None:
            raise EmailDeliveryFailure("EMAIL_PROVIDER_CONFIGURATION_INVALID", retryable=False)
        endpoint = self._settings.aliyun_directmail_endpoint or self._ENDPOINTS.get(
            self._settings.aliyun_directmail_region_id
        )
        if endpoint is None:
            raise EmailDeliveryFailure("EMAIL_PROVIDER_CONFIGURATION_INVALID", retryable=False)
        endpoint = endpoint.casefold().rstrip(".")
        fields = {
            "AccountName": str(account_name),
            "AddressType": "1",
            "ReplyToAddress": "false",
            "FromAlias": self._settings.aliyun_directmail_from_alias,
            "Subject": message.subject,
            "TextBody": message.text_body,
            "HtmlBody": message.html_body,
            "ToAddress": message.recipient,
            "ClickTrace": "0",
            "UnSubscribeFilterLevel": "disabled",
            "UnSubscribeLinkType": "disabled",
        }
        if self._settings.aliyun_directmail_tag_name is not None:
            fields["TagName"] = self._settings.aliyun_directmail_tag_name
        payload = urlencode(fields).encode()
        try:
            credential = await self._credentials.get_credential_async()
            headers = signed_directmail_headers(
                endpoint=endpoint,
                payload=payload,
                credential=credential,
                now=self._clock(),
                nonce=self._nonce_factory(),
            )
            timeout = httpx.Timeout(
                connect=self._settings.aliyun_directmail_connect_timeout_seconds,
                read=self._settings.aliyun_directmail_read_timeout_seconds,
                write=self._settings.aliyun_directmail_read_timeout_seconds,
                pool=self._settings.aliyun_directmail_connect_timeout_seconds,
            )
            async with httpx.AsyncClient(
                transport=self._transport_factory(),
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,
            ) as client, client.stream(
                "POST",
                f"https://{endpoint}/",
                headers=headers,
                content=payload,
            ) as response:
                response_status = response.status_code
                response_body = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    if len(response_body) + len(chunk) > _MAX_PROVIDER_RESPONSE_BYTES:
                        raise EmailDeliveryFailure(
                            "EMAIL_PROVIDER_INVALID_RESPONSE",
                            retryable=True,
                        )
                    response_body.extend(chunk)
            response_data = _response_json(bytes(response_body))
            if response_status >= 300:
                raise ProviderResponseError(
                    _response_error_code(response_data),
                    response_status,
                )
            request_id = _safe_identifier(response_data.get("RequestId"))
            if request_id is None:
                raise EmailDeliveryFailure("EMAIL_PROVIDER_INVALID_RESPONSE", retryable=True)
        except Exception as exc:  # noqa: BLE001
            raise classify_provider_failure(exc) from exc
        return DeliveryReceipt(
            provider_event_id=_safe_identifier(response_data.get("EnvId")),
            provider_request_id=request_id,
        )


class EmailDeliveryService:
    def __init__(
        self,
        settings: Settings,
        transport: EmailTransport | None = None,
    ) -> None:
        self._settings = settings
        self._cipher = EmailDeliveryCipher(settings)
        self._transport = transport
        if self._transport is None and settings.email_delivery_provider == "aliyun_directmail":
            self._transport = AliyunDirectMailTransport(settings)

    async def execute_next(self) -> bool:
        if self._transport is None:
            return False
        handled, work = await self._lease_next()
        if not handled:
            return False
        if work is None:
            return True
        try:
            receipt = await self._transport.send(work.message)
        except EmailDeliveryFailure as exc:
            await self._finish_failure(work, exc)
            self._emit(
                "email_delivery_failed",
                work,
                error_code=exc.code,
                retryable=exc.retryable,
            )
            return True
        await self._finish_success(work.outbox_id)
        self._emit(
            "email_delivery_succeeded",
            work,
            provider_event_id=receipt.provider_event_id,
            provider_request_id=receipt.provider_request_id,
        )
        return True

    async def _lease_next(self) -> tuple[bool, DeliveryWorkItem | None]:
        now = utc_now()
        async with session_factory() as db:
            row = await db.scalar(
                select(EmailOutbox)
                .where(
                    or_(
                        and_(EmailOutbox.status == "pending", EmailOutbox.available_at <= now),
                        and_(
                            EmailOutbox.status == "leased",
                            EmailOutbox.lease_expires_at.is_not(None),
                            EmailOutbox.lease_expires_at <= now,
                        ),
                    )
                )
                .order_by(EmailOutbox.available_at, EmailOutbox.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if row is None:
                return False, None
            if not await self._action_is_deliverable(db, row, now):
                self._terminal(row, "dead", now)
                await db.commit()
                self._emit_dead(row)
                return True, None
            try:
                message = render_email(
                    row.purpose,
                    self._cipher.decrypt(row),
                    self._settings.email_public_base_url,
                )
            except (APIError, EmailDeliveryFailure):
                self._terminal(row, "dead", now)
                await db.commit()
                self._emit_dead(row)
                return True, None
            row.status = "leased"
            row.attempts += 1
            row.lease_expires_at = now + timedelta(
                seconds=self._settings.email_delivery_lease_seconds
            )
            work = DeliveryWorkItem(
                outbox_id=row.id,
                purpose=row.purpose,
                attempt=row.attempts,
                message=message,
            )
            await db.commit()
            return True, work

    @staticmethod
    async def _action_is_deliverable(
        db: AsyncSession,
        row: EmailOutbox,
        now: datetime,
    ) -> bool:
        if row.action_token_id is None:
            return row.purpose == "security_notification"
        action = await db.get(IdentityActionToken, row.action_token_id)
        return bool(
            action is not None
            and action.purpose == row.purpose
            and action.used_at is None
            and action.revoked_at is None
            and action.expires_at > now
        )

    async def _finish_success(self, outbox_id: UUID) -> None:
        now = utc_now()
        async with session_factory() as db:
            row = await db.scalar(
                select(EmailOutbox).where(EmailOutbox.id == outbox_id).with_for_update()
            )
            if row is None or row.status != "leased":
                return
            row.status = "sent"
            row.sent_at = now
            row.terminal_at = now
            row.lease_expires_at = None
            self._clear_payload(row)
            await db.commit()

    async def _finish_failure(
        self,
        work: DeliveryWorkItem,
        failure: EmailDeliveryFailure,
    ) -> None:
        now = utc_now()
        async with session_factory() as db:
            row = await db.scalar(
                select(EmailOutbox).where(EmailOutbox.id == work.outbox_id).with_for_update()
            )
            if row is None or row.status != "leased":
                return
            if failure.retryable and row.attempts < self._settings.email_delivery_max_attempts:
                row.status = "pending"
                row.available_at = now + retry_delay(row.attempts)
                row.lease_expires_at = None
            else:
                self._terminal(row, "failed", now)
            await db.commit()

    @classmethod
    def _terminal(
        cls,
        row: EmailOutbox,
        status: Literal["dead", "failed"],
        now: datetime,
    ) -> None:
        row.status = status
        row.terminal_at = now
        row.lease_expires_at = None
        cls._clear_payload(row)

    @staticmethod
    def _clear_payload(row: EmailOutbox) -> None:
        row.payload_ciphertext = b""
        row.payload_nonce = b""

    @staticmethod
    def _emit(event: str, work: DeliveryWorkItem, **metadata: object) -> None:
        print(
            json.dumps(
                {
                    **health_payload(),
                    "event": event,
                    "outbox_id": str(work.outbox_id),
                    "purpose": work.purpose,
                    "attempt": work.attempt,
                    **metadata,
                }
            )
        )

    @staticmethod
    def _emit_dead(row: EmailOutbox) -> None:
        print(
            json.dumps(
                {
                    **health_payload(),
                    "event": "email_delivery_discarded",
                    "outbox_id": str(row.id),
                    "purpose": row.purpose,
                    "attempt": row.attempts,
                    "error_code": "EMAIL_PAYLOAD_OR_ACTION_INVALID",
                }
            )
        )


def render_email(purpose: str, payload: dict[str, str], base_url: str) -> EmailMessage:
    recipient = payload.get("recipient", "")
    if not recipient or "\n" in recipient or "\r" in recipient:
        raise EmailDeliveryFailure("EMAIL_PAYLOAD_INVALID", retryable=False)
    if purpose == "email_verification":
        token = _required_token(payload)
        return _action_email(
            recipient=recipient,
            subject="确认您的 Logion 邮箱",
            lead="请确认邮箱并设置 Logion 登录密码。",
            link=f"{base_url}/auth/verify#{quote(token, safe='-_~')}",
            action_label="确认邮箱",
            expiry="链接将在 24 小时后失效，并且只能使用一次。",
        )
    if purpose == "password_recovery":
        token = _required_token(payload)
        return _action_email(
            recipient=recipient,
            subject="重置您的 Logion 密码",
            lead="我们收到了 Logion 密码重置请求。",
            link=f"{base_url}/auth/recover#{quote(token, safe='-_~')}",
            action_label="重置密码",
            expiry="链接将在 30 分钟后失效，并且只能使用一次。",
        )
    if purpose == "security_notification":
        event = payload.get("event")
        messages = {
            "password_recovery_attempts_exhausted": (
                "Logion 密码恢复请求已被锁定",
                "由于连续验证失败，密码恢复请求已失效。如非本人操作，请检查账户安全。",
            ),
            "password_recovery_completed": (
                "Logion 密码已更新",
                "您的 Logion 密码已成功更新，所有在线会话均已退出。"
                "如非本人操作，请立即联系管理员。",
            ),
        }
        content = messages.get(event or "")
        if content is None:
            raise EmailDeliveryFailure("EMAIL_PAYLOAD_INVALID", retryable=False)
        subject, message = content
        return EmailMessage(
            recipient=recipient,
            subject=subject,
            text_body=f"{message}\n\n这是一封自动安全通知，请勿回复。",
            html_body=(
                "<!doctype html><html lang=\"zh-CN\"><body>"
                f"<h1>{html.escape(subject)}</h1><p>{html.escape(message)}</p>"
                "<p>这是一封自动安全通知，请勿回复。</p></body></html>"
            ),
        )
    raise EmailDeliveryFailure("EMAIL_PAYLOAD_INVALID", retryable=False)


def _action_email(
    *,
    recipient: str,
    subject: str,
    lead: str,
    link: str,
    action_label: str,
    expiry: str,
) -> EmailMessage:
    escaped_link = html.escape(link, quote=True)
    return EmailMessage(
        recipient=recipient,
        subject=subject,
        text_body=(
            f"{lead}\n\n{action_label}：{link}\n\n{expiry}\n"
            "如果这不是您的操作，请忽略本邮件。"
        ),
        html_body=(
            "<!doctype html><html lang=\"zh-CN\"><body>"
            f"<h1>{html.escape(subject)}</h1><p>{html.escape(lead)}</p>"
            f"<p><a href=\"{escaped_link}\">{html.escape(action_label)}</a></p>"
            f"<p>{html.escape(expiry)}</p>"
            "<p>如果这不是您的操作，请忽略本邮件。</p></body></html>"
        ),
    )


def _required_token(payload: dict[str, str]) -> str:
    token = payload.get("token", "")
    if not token or len(token) > 512 or "\n" in token or "\r" in token:
        raise EmailDeliveryFailure("EMAIL_PAYLOAD_INVALID", retryable=False)
    return token


def retry_delay(attempt: int) -> timedelta:
    schedule = (60, 300, 900, 3600, 14400)
    return timedelta(seconds=schedule[min(max(attempt, 1), len(schedule)) - 1])


def signed_directmail_headers(
    *,
    endpoint: str,
    payload: bytes,
    credential: object,
    now: datetime,
    nonce: str,
) -> dict[str, str]:
    access_key_id = _credential_value(credential, "access_key_id")
    access_key_secret = _credential_value(credential, "access_key_secret")
    security_token = _credential_value(credential, "security_token", required=False)
    normalized_endpoint = endpoint.casefold().rstrip(".")
    payload_hash = hashlib.sha256(payload).hexdigest()
    headers = {
        "accept": "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "host": normalized_endpoint,
        "user-agent": "logion-email-worker",
        "x-acs-action": "SingleSendMail",
        "x-acs-content-sha256": payload_hash,
        "x-acs-date": now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "x-acs-signature-nonce": nonce,
        "x-acs-version": "2015-11-23",
    }
    if security_token:
        headers["x-acs-accesskey-id"] = access_key_id
        headers["x-acs-security-token"] = security_token
    canonical_headers = "".join(
        f"{key}:{headers[key].strip()}\n" for key in sorted(headers)
    )
    signed_headers = ";".join(sorted(headers))
    canonical_request = (
        f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )
    string_to_sign = (
        "ACS3-HMAC-SHA256\n"
        f"{hashlib.sha256(canonical_request.encode()).hexdigest()}"
    )
    signature = hmac.new(
        access_key_secret.encode(),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    headers["authorization"] = (
        "ACS3-HMAC-SHA256 "
        f"Credential={access_key_id},SignedHeaders={signed_headers},Signature={signature}"
    )
    return headers


def _credential_value(
    credential: object,
    field: str,
    *,
    required: bool = True,
) -> str:
    value = getattr(credential, field, None)
    if value is None:
        getter = getattr(credential, f"get_{field}", None)
        if callable(getter):
            value = getter()
    if not isinstance(value, str) or (required and not value):
        if required:
            raise EmailDeliveryFailure("EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE", retryable=True)
        return ""
    return value


def _response_json(response_body: bytes) -> dict[str, object]:
    try:
        value = json.loads(response_body)
    except (ValueError, UnicodeDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _response_error_code(response: dict[str, object]) -> str:
    for key in ("Code", "code"):
        value = response.get(key)
        if isinstance(value, str) and value:
            return value
    return "HTTP_ERROR"


def classify_provider_failure(exc: Exception) -> EmailDeliveryFailure:
    if isinstance(exc, EmailDeliveryFailure):
        return exc
    if isinstance(
        exc,
        (
            TimeoutError,
            ConnectionError,
            httpx.TimeoutException,
            httpx.NetworkError,
        ),
    ):
        return EmailDeliveryFailure("EMAIL_PROVIDER_UNAVAILABLE", retryable=True)
    raw_code = str(getattr(exc, "code", "")).casefold()
    raw_status = getattr(exc, "status_code", None)
    status = raw_status if isinstance(raw_status, int) else None
    if status in {408, 409, 425, 429} or (status is not None and status >= 500):
        return EmailDeliveryFailure("EMAIL_PROVIDER_UNAVAILABLE", retryable=True)
    if status is not None and 300 <= status < 500:
        return EmailDeliveryFailure("EMAIL_PROVIDER_REJECTED", retryable=False)
    if any(
        marker in raw_code
        for marker in ("throttl", "timeout", "temporar", "serviceunavailable", "internalerror")
    ):
        return EmailDeliveryFailure("EMAIL_PROVIDER_UNAVAILABLE", retryable=True)
    if any(marker in raw_code for marker in ("forbidden", "unauthorized", "invalid", "denied")):
        return EmailDeliveryFailure("EMAIL_PROVIDER_REJECTED", retryable=False)
    return EmailDeliveryFailure("EMAIL_PROVIDER_UNAVAILABLE", retryable=True)


def _safe_identifier(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 128:
        return None
    if not all(character.isalnum() or character in "-_:" for character in value):
        return None
    return value
