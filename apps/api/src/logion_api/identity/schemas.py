from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    device_name: str = Field(min_length=1, max_length=80)
    platform: Literal["web", "ios_pwa", "android_pwa"] = "web"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    device_name: str = Field(min_length=1, max_length=80)
    platform: Literal["web", "ios_pwa", "android_pwa"] = "web"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    status: Literal["active", "suspended", "deleted"]
    email_verified_at: datetime | None
    created_at: datetime


class AuthResponse(BaseModel):
    user: UserResponse
    session_expires_at: datetime


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    platform: str
    first_seen_at: datetime
    last_seen_at: datetime
    revoked_at: datetime | None
    current: bool = False


class DeviceListResponse(BaseModel):
    devices: list[DeviceResponse]


class MessageResponse(BaseModel):
    status: Literal["ok"] = "ok"
