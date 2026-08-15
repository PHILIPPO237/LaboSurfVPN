from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from typing import Any

try:
    from passlib.context import CryptContext as _PasslibCryptContext
except ModuleNotFoundError:
    _PasslibCryptContext = None


class _PBKDF2Context:
    def __init__(self, *, rounds: int = 390000) -> None:
        self.rounds = int(rounds)

    def hash(self, password: str) -> str:
        secret = str(password or "")
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt, self.rounds)
        salt_b64 = base64.b64encode(salt).decode("ascii")
        digest_b64 = base64.b64encode(digest).decode("ascii")
        return f"pbkdf2_sha256${self.rounds}${salt_b64}${digest_b64}"

    def verify(self, password: str, hashed: str) -> bool:
        try:
            scheme, rounds_text, salt_b64, digest_b64 = str(hashed or "").split("$", 3)
            if scheme != "pbkdf2_sha256":
                return False
            rounds = int(rounds_text)
            salt = base64.b64decode(salt_b64.encode("ascii"))
            expected = base64.b64decode(digest_b64.encode("ascii"))
        except Exception:
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", str(password or "").encode("utf-8"), salt, rounds)
        return hmac.compare_digest(candidate, expected)


def build_password_context(*, schemes: list[str] | None = None, deprecated: str = "auto", **_: Any):
    if _PasslibCryptContext is not None:
        return _PasslibCryptContext(schemes=schemes or ["bcrypt"], deprecated=deprecated)
    return _PBKDF2Context()
