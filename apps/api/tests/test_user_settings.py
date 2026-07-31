import json
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.errors import APIError
from logion_api.main import app
from logion_api.users.models import UserSetting
from logion_api.users.schemas import UserSettingBatchUpdate, UserSettingWrite
from logion_api.users.settings import UserSettingService
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession


class _ScalarResult:
    def __init__(self, rows: list[UserSetting]) -> None:
        self.rows = rows

    def all(self) -> list[UserSetting]:
        return self.rows


class _NestedTransaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *args: object) -> None:
        return None


class _FakeSession:
    def __init__(self, rows: list[UserSetting]) -> None:
        self.rows = rows
        self.added: list[UserSetting] = []

    async def scalars(self, _query: object) -> _ScalarResult:
        return _ScalarResult(self.rows)

    def begin_nested(self) -> _NestedTransaction:
        return _NestedTransaction()

    def add(self, row: UserSetting) -> None:
        self.added.append(row)

    async def flush(self) -> None:
        return None


def _session(rows: list[UserSetting]) -> tuple[AsyncSession, _FakeSession]:
    fake = _FakeSession(rows)
    return cast(AsyncSession, cast(Any, fake)), fake


def test_user_setting_payload_rejects_duplicate_and_invalid_keys() -> None:
    with pytest.raises(ValidationError):
        UserSettingBatchUpdate(
            settings=[
                UserSettingWrite(key="theme", value="dark", version=0),
                UserSettingWrite(key="theme", value="light", version=0),
            ]
        )
    with pytest.raises(ValidationError):
        UserSettingWrite(key="Invalid key", value="x", version=0)
    with pytest.raises(ValidationError):
        UserSettingWrite(key="theme", value="x" * 8193, version=0)


@pytest.mark.asyncio
async def test_user_setting_service_creates_and_increments_versions() -> None:
    service = UserSettingService()
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    db, fake = _session([])
    created = await service.update(
        db,
        user_id,
        [UserSettingWrite(key="persona", value='{"activePersonaId":"self"}', version=0)],
    )
    assert created[0].version == 1
    assert fake.added == created

    db, _ = _session(created)
    updated = await service.update(
        db,
        user_id,
        [UserSettingWrite(key="persona", value='{"activePersonaId":"exam"}', version=1)],
    )
    assert updated[0].version == 2
    assert updated[0].value == '{"activePersonaId":"exam"}'


@pytest.mark.asyncio
async def test_user_setting_service_detects_conflicts_before_mutating_batch() -> None:
    service = UserSettingService()
    user_id = UUID("00000000-0000-0000-0000-000000000002")
    persona = UserSetting(user_id=user_id, key="persona", value="before", version=2)
    theme = UserSetting(user_id=user_id, key="theme", value="dark", version=1)
    db, _ = _session([persona, theme])

    with pytest.raises(APIError) as raised:
        await service.update(
            db,
            user_id,
            [
                UserSettingWrite(key="persona", value="after", version=2),
                UserSettingWrite(key="theme", value="light", version=0),
            ],
        )
    assert getattr(raised.value, "code", None) == "USER_SETTING_VERSION_CONFLICT"
    assert persona.value == "before"
    assert persona.version == 2


async def register(client: AsyncClient, label: str) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"user-settings-{label}-{uuid4()}@example.com",
            "password": "a-strong-password-123",
            "device_name": label,
        },
    )
    assert response.status_code == 201, response.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_user_settings_are_private_versioned_and_atomic() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.210", 49210)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.211", 49211)),
            base_url=origin,
            headers={"Origin": origin},
        ) as other,
        AsyncClient(transport=ASGITransport(app=app), base_url=origin) as anonymous,
    ):
        unauthorized = await anonymous.get("/api/v1/users/me/settings")
        assert unauthorized.status_code == 401

        await register(owner, "owner")
        await register(other, "other")
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}

        empty = await owner.get("/api/v1/users/me/settings")
        assert empty.status_code == 200
        assert empty.headers["Cache-Control"] == "no-store"
        assert empty.json() == {"settings": []}

        payload = {
            "activePersonaId": "self",
            "customPersonas": [
                {
                    "id": f"custom-{uuid4()}",
                    "name": f"custom-{index}",
                    "icon": "target",
                    "description": "A versioned custom persona",
                    "routes": ["/app/today", "/app/settings"],
                    "isBuiltin": False,
                }
                for index in range(3)
            ],
        }
        create_body = {
            "settings": [
                {"key": "persona", "value": json.dumps(payload), "version": 0},
                {"key": "theme", "value": "dark", "version": 0},
            ]
        }
        missing_csrf = await owner.put("/api/v1/users/me/settings", json=create_body)
        assert missing_csrf.status_code == 403

        created = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json=create_body,
        )
        assert created.status_code == 200, created.text
        assert created.headers["Cache-Control"] == "no-store"
        assert created.json()["settings"] == [
            {"key": "persona", "value": json.dumps(payload), "version": 1},
            {"key": "theme", "value": "dark", "version": 1},
        ]

        persona = await owner.get("/api/v1/users/me/settings", params={"key": "persona"})
        assert persona.status_code == 200
        assert json.loads(persona.json()["settings"][0]["value"]) == payload
        assert (await other.get("/api/v1/users/me/settings")).json() == {"settings": []}

        stale = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json={
                "settings": [
                    {"key": "persona", "value": "stale", "version": 0},
                ]
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "USER_SETTING_VERSION_CONFLICT"
        assert stale.json()["details"] == {"keys": ["persona"]}

        updated_payload = {**payload, "activePersonaId": "exam"}
        updated = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json={
                "settings": [
                    {
                        "key": "persona",
                        "value": json.dumps(updated_payload),
                        "version": 1,
                    }
                ]
            },
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["settings"][0]["version"] == 2

        atomic_conflict = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json={
                "settings": [
                    {"key": "persona", "value": "must-not-persist", "version": 2},
                    {"key": "theme", "value": "light", "version": 0},
                ]
            },
        )
        assert atomic_conflict.status_code == 409
        unchanged = await owner.get(
            "/api/v1/users/me/settings",
            params={"key": "persona"},
        )
        assert unchanged.json()["settings"] == [
            {"key": "persona", "value": json.dumps(updated_payload), "version": 2}
        ]

        duplicate = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json={
                "settings": [
                    {"key": "theme", "value": "dark", "version": 1},
                    {"key": "theme", "value": "light", "version": 1},
                ]
            },
        )
        assert duplicate.status_code == 422

        invalid_key = await owner.put(
            "/api/v1/users/me/settings",
            headers=csrf,
            json={"settings": [{"key": "Invalid key", "value": "x", "version": 0}]},
        )
        assert invalid_key.status_code == 422
