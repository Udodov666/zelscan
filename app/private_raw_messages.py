"""Private, non-web-accessible persistence for complete timeline collections."""
from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

_ORDER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


def validate_order_id(order_id: object) -> str:
    value = str(order_id or "")
    if not _ORDER_ID_RE.fullmatch(value):
        raise ValueError("invalid order_id")
    return value


def _restrict_windows_acl(path: Path) -> None:
    """Best-effort ACL hardening; failure must not prevent dossier generation."""
    username = os.environ.get("USERNAME")
    if os.name != "nt" or not username:
        return
    try:
        grant = subprocess.run(
            ["icacls", str(path), "/grant:r", f"{username}:F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        if grant.returncode == 0:
            subprocess.run(
                ["icacls", str(path), "/inheritance:r"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
    except (OSError, subprocess.SubprocessError):
        pass


def ensure_private_directory(directory: Path) -> Path:
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        os.chmod(directory, 0o700)
    else:
        _restrict_windows_acl(directory)
    return directory


def raw_messages_path(directory: Path, order_id: object) -> Path:
    root = Path(directory).resolve()
    safe_id = validate_order_id(order_id)
    target = (root / f"{safe_id}.json").resolve()
    if target.parent != root:
        raise ValueError("raw message path escaped private directory")
    return target


def _json_value(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        from dataclasses import asdict
        return asdict(value)
    if hasattr(value, "_asdict"):
        return value._asdict()
    if hasattr(value, "__dict__"):
        return dict(vars(value))
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def persist_raw_messages(
    directory: Path,
    order_id: object,
    user_id: object,
    messages: Iterable[Any],
    *,
    timestamp: str | None = None,
    provenance: dict[str, Any] | None = None,
) -> Path:
    """Atomically replace the predictable per-order JSON file."""
    root = ensure_private_directory(directory)
    target = raw_messages_path(root, order_id)
    complete_messages = list(messages)
    metadata = {
        "order_id": validate_order_id(order_id),
        "user_id": int(user_id),
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
        "count": len(complete_messages),
    }
    if provenance:
        metadata["provenance"] = dict(provenance)
    payload = {
        "metadata": metadata,
        "messages": complete_messages,
    }

    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{target.stem}.", suffix=".tmp", dir=str(root)
    )
    temporary = Path(temporary_name)
    try:
        if os.name == "posix":
            os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, default=_json_value)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        if os.name == "posix":
            os.chmod(target, 0o600)
        else:
            _restrict_windows_acl(target)
        return target
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        temporary.unlink(missing_ok=True)
        raise
