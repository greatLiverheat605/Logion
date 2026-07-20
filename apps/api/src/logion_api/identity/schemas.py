from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

WebAuthnTransport = Literal["usb", "nfc", "ble", "smart-card", "internal", "cable", "hybrid"]


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


class WebAuthnRpEntity(BaseModel):
    id: str
    name: str


class WebAuthnUserEntity(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    display_name: str = Field(alias="displayName")


class WebAuthnCredentialParameter(BaseModel):
    type: Literal["public-key"]
    alg: Literal[-8, -7, -257]


class WebAuthnCredentialDescriptor(BaseModel):
    id: str
    type: Literal["public-key"]
    transports: list[WebAuthnTransport] | None = None


class WebAuthnAuthenticatorSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    resident_key: Literal["required"] = Field(alias="residentKey")
    require_resident_key: bool = Field(alias="requireResidentKey")
    user_verification: Literal["required"] = Field(alias="userVerification")


class PasskeyRegistrationPublicKey(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    rp: WebAuthnRpEntity
    user: WebAuthnUserEntity
    challenge: str
    pub_key_cred_params: list[WebAuthnCredentialParameter] = Field(alias="pubKeyCredParams")
    timeout: int
    exclude_credentials: list[WebAuthnCredentialDescriptor] = Field(alias="excludeCredentials")
    authenticator_selection: WebAuthnAuthenticatorSelection = Field(
        alias="authenticatorSelection"
    )
    attestation: Literal["none"]


class PasskeyAuthenticationPublicKey(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    challenge: str
    timeout: int
    rp_id: str = Field(alias="rpId")
    allow_credentials: list[WebAuthnCredentialDescriptor] = Field(alias="allowCredentials")
    user_verification: Literal["required"] = Field(alias="userVerification")


class PasskeyRegistrationOptionsResponse(BaseModel):
    challenge_id: UUID
    public_key: PasskeyRegistrationPublicKey


class PasskeyAuthenticationOptionsResponse(BaseModel):
    challenge_id: UUID
    public_key: PasskeyAuthenticationPublicKey


class RegistrationAuthenticatorResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    client_data_json: str = Field(alias="clientDataJSON", min_length=1, max_length=8192)
    attestation_object: str = Field(alias="attestationObject", min_length=1, max_length=65536)
    authenticator_data: str | None = Field(
        default=None,
        alias="authenticatorData",
        max_length=8192,
    )
    public_key: str | None = Field(default=None, alias="publicKey", max_length=8192)
    public_key_algorithm: Literal[-8, -7, -257] | None = Field(
        default=None,
        alias="publicKeyAlgorithm",
    )
    transports: list[WebAuthnTransport] = Field(default_factory=list, max_length=16)


class AuthenticationAuthenticatorResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    client_data_json: str = Field(alias="clientDataJSON", min_length=1, max_length=8192)
    authenticator_data: str = Field(alias="authenticatorData", min_length=1, max_length=8192)
    signature: str = Field(min_length=1, max_length=8192)
    user_handle: str | None = Field(default=None, alias="userHandle", max_length=2048)


class RegistrationCredentialRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=2048)
    raw_id: str = Field(alias="rawId", min_length=1, max_length=2048)
    response: RegistrationAuthenticatorResponse
    authenticator_attachment: Literal["platform", "cross-platform"] | None = Field(
        default=None,
        alias="authenticatorAttachment",
        max_length=32,
    )
    type: Literal["public-key"]
    client_extension_results: dict[str, Any] = Field(
        default_factory=dict,
        alias="clientExtensionResults",
        max_length=0,
    )


class AuthenticationCredentialRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=2048)
    raw_id: str = Field(alias="rawId", min_length=1, max_length=2048)
    response: AuthenticationAuthenticatorResponse
    authenticator_attachment: Literal["platform", "cross-platform"] | None = Field(
        default=None,
        alias="authenticatorAttachment",
        max_length=32,
    )
    type: Literal["public-key"]
    client_extension_results: dict[str, Any] = Field(
        default_factory=dict,
        alias="clientExtensionResults",
        max_length=0,
    )


class PasskeyRegistrationVerifyRequest(BaseModel):
    challenge_id: UUID
    name: str = Field(min_length=1, max_length=80)
    credential: RegistrationCredentialRequest


class PasskeyAuthenticationVerifyRequest(BaseModel):
    challenge_id: UUID
    device_name: str = Field(min_length=1, max_length=80)
    platform: Literal["web", "ios_pwa", "android_pwa"] = "web"
    credential: AuthenticationCredentialRequest


class PasskeyCredentialResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    transports: list[WebAuthnTransport]
    credential_device_type: Literal["single_device", "multi_device"]
    backed_up: bool
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class PasskeyCredentialListResponse(BaseModel):
    credentials: list[PasskeyCredentialResponse]
