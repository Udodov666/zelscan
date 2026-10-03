"""Shared HTTP hardening helpers for the backend and frontend servers."""
from __future__ import annotations

import ipaddress
import json
import logging
import os
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from flask import request


CSP = "; ".join((
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://lolz.team https://lolz.live https://zelenka.guru",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://api.lolz.live https://api.lzt.market https://lolz.live https://lolz.team https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
))

PERMISSIONS_POLICY = (
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), "
    "geolocation=(), gyroscope=(), magnetometer=(), microphone=(), "
    "payment=(), usb=()"
)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"} if value else default


def _trusted_proxy_networks():
    networks = []
    for raw in os.environ.get("TRUSTED_PROXY_CIDRS", "").split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            networks.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def request_is_https() -> bool:
    """Trust forwarded proto only from explicitly configured proxy networks."""
    if request.is_secure:
        return True
    remote = request.remote_addr
    if not remote:
        return False
    try:
        address = ipaddress.ip_address(remote)
    except ValueError:
        return False
    if not any(address in network for network in _trusted_proxy_networks()):
        return False
    forwarded = request.headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip().lower()
    return forwarded == "https"


def production_mode() -> bool:
    return os.environ.get("APP_ENV", os.environ.get("FLASK_ENV", "")).strip().lower() in {
        "production", "prod"
    }


def secure_cookie_for_request() -> bool:
    """Production is fail-safe; local HTTP remains usable outside production."""
    return production_mode() or request_is_https() or _env_bool("SESSION_COOKIE_SECURE", False)


def apply_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = CSP
    response.headers.pop("Server", None)

    if request_is_https() and production_mode():
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    path = request.path
    if path.startswith(("/api/me", "/api/my/", "/api/admin/", "/api/oauth/")):
        response.headers["Cache-Control"] = "no-store"
    return response


_SECRET_KEYS = re.compile(
    r"(?:authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"token|secret|password|passwd|cookie|set-cookie)", re.IGNORECASE
)
_BEARER_RE = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
_ASSIGNMENT_RE = re.compile(
    r"(?i)(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|cookie)\b\s*[:=]\s*)([^\s,;&]+)"
)
_URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _redact_url(value: str) -> str:
    try:
        parts = urlsplit(value)
        if not parts.query:
            return value
        query = urlencode([
            (key, "[REDACTED]" if _SECRET_KEYS.search(key) else item)
            for key, item in parse_qsl(parts.query, keep_blank_values=True)
        ])
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    except (TypeError, ValueError):
        return value


def redact_sensitive(value):
    """Return a log/audit-safe copy while preserving useful non-secret context."""
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _SECRET_KEYS.search(str(key)) else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    if not isinstance(value, str):
        return value
    text = _BEARER_RE.sub(lambda match: match.group(1) + " [REDACTED]", value)
    text = _JWT_RE.sub("[REDACTED]", text)
    text = _ASSIGNMENT_RE.sub(lambda match: match.group(1) + "[REDACTED]", text)
    return _URL_RE.sub(lambda match: _redact_url(match.group(0)), text)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            rendered = record.getMessage()
        except Exception:
            rendered = str(record.msg)
        record.msg = redact_sensitive(rendered)
        record.args = ()
        return True


def install_log_redaction() -> None:
    """Install once on existing and subsequently configured root handlers."""
    root = logging.getLogger()
    for handler in root.handlers:
        if not any(isinstance(item, RedactingFilter) for item in handler.filters):
            handler.addFilter(RedactingFilter())


def safe_json(value) -> str:
    return json.dumps(redact_sensitive(value), ensure_ascii=False, default=str)


def safe_request_id(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if 1 <= len(value) <= 128 and all(ch.isalnum() or ch in "-_." for ch in value):
        return value
    return None
