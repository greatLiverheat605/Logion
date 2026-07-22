from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
BaseUrl = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2048)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AIProviderCreate(Strict):
    id: UUID
    name: Name
    provider_type: Literal["openai_compatible"] = "openai_compatible"
    base_url: BaseUrl
    credential: SecretStr = Field(min_length=8, max_length=8192)
    enabled: bool = True
    timeout_seconds: int = Field(default=30, ge=1, le=300)
    max_retries: int = Field(default=2, ge=0, le=5)


class AIProviderUpdate(Strict):
    expected_version: int = Field(ge=1)
    name: Name
    base_url: BaseUrl
    credential: SecretStr | None = Field(default=None, min_length=8, max_length=8192)
    enabled: bool
    timeout_seconds: int = Field(ge=1, le=300)
    max_retries: int = Field(ge=0, le=5)


class AIProviderDelete(Strict):
    expected_version: int = Field(ge=1)


class AIProviderResponse(Strict):
    id: UUID
    workspace_id: UUID
    name: str
    provider_type: Literal["openai_compatible"]
    base_url: str
    credential_configured: bool
    enabled: bool
    timeout_seconds: int
    max_retries: int
    version: int


class AIProviderList(Strict):
    providers: list[AIProviderResponse]
