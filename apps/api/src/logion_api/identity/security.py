import hashlib
import hmac
import secrets
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


@dataclass(frozen=True)
class SessionSecrets:
    access_token: str
    refresh_token: str
    csrf_token: str


class IdentitySecurity:
    def __init__(self, secret_key: str) -> None:
        self._secret_key = secret_key.encode("utf-8")
        self._password_hasher = PasswordHasher(
            time_cost=3,
            memory_cost=65536,
            parallelism=4,
            hash_len=32,
            salt_len=16,
        )
        self._dummy_hash = self._password_hasher.hash("not-a-real-password")

    def hash_password(self, password: str) -> str:
        return self._password_hasher.hash(password)

    def verify_password(self, password_hash: str | None, password: str) -> bool:
        candidate_hash = password_hash or self._dummy_hash
        try:
            verified = self._password_hasher.verify(candidate_hash, password)
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False
        return bool(verified and password_hash is not None)

    def password_needs_rehash(self, password_hash: str) -> bool:
        return self._password_hasher.check_needs_rehash(password_hash)

    def new_session_secrets(self) -> SessionSecrets:
        return SessionSecrets(
            access_token=secrets.token_urlsafe(32),
            refresh_token=secrets.token_urlsafe(48),
            csrf_token=secrets.token_urlsafe(32),
        )

    def new_access_token(self) -> str:
        return secrets.token_urlsafe(32)

    def new_refresh_token(self) -> str:
        return secrets.token_urlsafe(48)

    def new_mfa_challenge_token(self) -> str:
        return secrets.token_urlsafe(48)

    def new_recovery_code(self) -> str:
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw = "".join(secrets.choice(alphabet) for _ in range(16))
        return "-".join(raw[index : index + 4] for index in range(0, 16, 4))

    def hash_recovery_code(self, code: str) -> str:
        return self._password_hasher.hash(self.normalize_recovery_code(code))

    def verify_recovery_code(self, code_hash: str, code: str) -> bool:
        try:
            return bool(self._password_hasher.verify(code_hash, self.normalize_recovery_code(code)))
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False

    def recovery_code_lookup_hash(self, code: str) -> str:
        return self.token_hash(f"recovery:{self.normalize_recovery_code(code)}")

    def token_hash(self, token: str) -> str:
        return hmac.new(self._secret_key, token.encode("utf-8"), hashlib.sha256).hexdigest()

    def privacy_hash(self, value: str | None) -> str | None:
        if not value:
            return None
        return self.token_hash(value)

    def constant_time_equal(self, left: str, right: str) -> bool:
        return hmac.compare_digest(left, right)

    @staticmethod
    def normalize_recovery_code(code: str) -> str:
        return code.strip().replace("-", "").upper()
