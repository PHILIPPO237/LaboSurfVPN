from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import HTMLResponse


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
_LINK_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
_SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9_.-]+")


class Helpers:
    def __init__(self, *, cfg: Any) -> None:
        self.cfg = cfg
        self._template_cache: dict[str, str] = {}
        self._template_lock = threading.Lock()
        self.template_preload_names = tuple(
            name
            for name in ("index.html", "acces.html", "dashboard.html")
            if self._resolve_template_path(name) is not None
        )
        self.template_background_warmup_names: tuple[str, ...] | None = None

    @property
    def templates_dir(self) -> Path:
        base_dir = Path(getattr(self.cfg, "BASE_DIR", Path.cwd()) or Path.cwd())
        return Path(getattr(self.cfg, "TEMPLATES_DIR", base_dir / "templates") or (base_dir / "templates"))

    def _normalize_template_name(self, name: str) -> str:
        text = str(name or "").strip().replace("\\", "/")
        if not text:
            return ""
        parts = [part for part in text.split("/") if part not in {"", "."}]
        if not parts or any(part == ".." for part in parts):
            return ""
        return "/".join(parts)

    def _resolve_template_path(self, name: str) -> Path | None:
        normalized = self._normalize_template_name(name)
        if not normalized:
            return None
        root = self.templates_dir.resolve()
        candidate = (root / normalized).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return candidate

    def read_template(self, name: str) -> str | None:
        normalized = self._normalize_template_name(name)
        if not normalized:
            return None
        with self._template_lock:
            cached = self._template_cache.get(normalized)
            if cached is not None:
                return cached
        path = self._resolve_template_path(normalized)
        if path is None:
            return None
        try:
            content = path.read_text(encoding="utf-8")
        except Exception:
            return None
        with self._template_lock:
            return self._template_cache.setdefault(normalized, content)

    def preload_templates(self, names: list[str] | tuple[str, ...] | None = None) -> int:
        if names is None:
            try:
                candidates = [
                    str(path.relative_to(self.templates_dir)).replace("\\", "/")
                    for path in self.templates_dir.rglob("*")
                    if path.is_file()
                ]
            except Exception:
                candidates = []
        else:
            candidates = [str(name) for name in names]

        loaded = 0
        for name in candidates:
            normalized = self._normalize_template_name(name)
            if not normalized:
                continue
            with self._template_lock:
                already_cached = normalized in self._template_cache
            if already_cached:
                continue
            if self.read_template(normalized) is not None:
                loaded += 1
        return loaded

    def now_ts(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def as_bool(self, value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        text = str(value or "").strip().lower()
        return text in {"1", "true", "yes", "y", "on"}

    def html_response(self, content: str, status_code: int = 200) -> HTMLResponse:
        return HTMLResponse(content=content, status_code=status_code)

    def get_form_value(self, request: Request, key: str, default: str = "") -> str:
        return str(request.query_params.get(key, default) or "").strip()

    def parse_date_yyyy_mm_dd(self, value: str):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text)
        except Exception:
            return None

    def parse_quota_gb(self, value: str):
        text = str(value or "").strip().replace(",", ".")
        if not text or text.lower() in {"illimite", "illimitee", "none", "null"}:
            return None
        try:
            val = float(text)
        except Exception:
            return None
        if val <= 0:
            return None
        return round(val, 3)

    def is_user_expired(self, user: dict) -> bool:
        if not isinstance(user, dict):
            return False
        if str(user.get("type", "")).strip() == "ADMIN":
            return False
        raw = str(user.get("expiration", "") or "").strip()
        if not raw:
            return False
        try:
            return date.fromisoformat(raw) < date.today()
        except Exception:
            return False

    def generate_license_key(self) -> str:
        return f"LIC-{secrets.token_hex(8).upper()}"

    def generate_uuid(self) -> str:
        return str(uuid.uuid4())

    def normalize_license(self, value: str) -> str:
        return str(value or "").strip().upper().replace(" ", "")

    def normalize_uuid(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        try:
            return str(uuid.UUID(text))
        except Exception:
            return ""

    def normalize_recovery_secret(self, value: str) -> str:
        return str(value or "").strip()

    def safe_next_url(self, value: str) -> str:
        text = str(value or "").strip()
        if not text.startswith("/") or text.startswith("//"):
            return "/dashboard"
        return text[:500]

    def safe_avatar_url(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        if text.startswith("/static/avatars/"):
            return text
        if text.startswith("https://") or text.startswith("http://"):
            return text
        return ""

    def delete_local_avatar(self, avatar_url: str) -> None:
        url = str(avatar_url or "").strip()
        if not url.startswith("/static/avatars/"):
            return
        file_path = self.cfg.BASE_DIR / url.lstrip("/")
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception:
            pass

    def hash_recovery_secret(self, value: str) -> str:
        text = self.normalize_recovery_secret(value).lower()
        return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""

    def is_valid_email(self, value: str) -> bool:
        return bool(_EMAIL_RE.match(str(value or "").strip()))

    def is_valid_cameroon_phone(self, value: str) -> bool:
        digits = re.sub(r"\D+", "", str(value or ""))
        if digits.startswith("237"):
            digits = digits[3:]
        return len(digits) == 9 and digits[0] in {"6", "2"}

    def normalize_cameroon_phone(self, value: str) -> str:
        digits = re.sub(r"\D+", "", str(value or ""))
        if digits.startswith("237"):
            digits = digits[3:]
        return f"+237{digits}"

    def validate_contact(self, value: str) -> bool:
        text = str(value or "").strip()
        return self.is_valid_email(text) or self.is_valid_cameroon_phone(text)

    def contains_link(self, value: str) -> bool:
        return bool(_LINK_RE.search(str(value or "")))

    def find_single_non_admin_user_by_identity(
        self,
        users: list[dict],
        username: str,
        license_code: str,
    ) -> dict | None:
        uname = str(username or "").strip().lower()
        lic = self.normalize_license(license_code)
        if not uname or not lic:
            return None
        matches = [
            u
            for u in users
            if isinstance(u, dict)
            and str(u.get("type", "")).strip() != "ADMIN"
            and str(u.get("username", "")).strip().lower() == uname
            and self.normalize_license(str(u.get("license", ""))) == lic
        ]
        return matches[0] if len(matches) == 1 else None

    def find_single_non_admin_user_by_username(self, users: list[dict], username: str) -> dict | None:
        uname = str(username or "").strip().lower()
        if not uname:
            return None
        matches = [
            u
            for u in users
            if isinstance(u, dict)
            and str(u.get("type", "")).strip() != "ADMIN"
            and str(u.get("username", "")).strip().lower() == uname
        ]
        return matches[0] if len(matches) == 1 else None

    def suggest_usernames(self, base: str, users: list[dict], limit: int = 3) -> list[str]:
        clean = _SAFE_NAME_RE.sub("", str(base or "").strip())
        clean = clean[:24] or "user"
        existing = {str(u.get("username", "")).strip().lower() for u in users if isinstance(u, dict)}
        out: list[str] = []
        out_lower: set[str] = set()
        idx = 1
        while len(out) < max(1, int(limit)):
            cand = f"{clean}{idx}" if idx <= 9 else f"{clean}_{secrets.randbelow(999):03d}"
            cand_lower = cand.lower()
            if cand_lower not in existing and cand_lower not in out_lower:
                out.append(cand)
                out_lower.add(cand_lower)
            idx += 1
            if idx > 2000:
                break
        return out

    def load_admin_password(self) -> str:
        try:
            path = self.cfg.BASE_DIR / ".admin_password"
            return path.read_text(encoding="utf-8").strip()
        except Exception as exc:
            print(f"[startup] Impossible de lire .admin_password : {exc}", flush=True)
            return ""


def create_helpers(*, cfg: Any) -> Helpers:
    return Helpers(cfg=cfg)