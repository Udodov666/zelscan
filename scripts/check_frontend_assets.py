"""Check active first-party JavaScript syntax and local HTML asset references."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
JS_ROOTS = (ROOT / "landing" / "assets", ROOT / "app" / "static")
HTML_FILES = (
    ROOT / "app" / "templates" / "index.html",
    ROOT / "landing" / "index.html",
    ROOT / "landing" / "zelscan.html",
    ROOT / "landing" / "my-dossiers-cards-lab.html",
    ROOT / "landing" / "admin.html",
    ROOT / "landing" / "admin" / "index.html",
)
REF_RE = re.compile(r"\b(?:src|href)\s*=\s*(['\"])(.*?)\1", re.IGNORECASE)


def active_js(path: Path) -> bool:
    lower = path.as_posix().lower()
    name = path.name.lower()
    return (
        path.suffix.lower() == ".js"
        and ".before" not in name
        and not name.endswith(".min.js")
        and "/vendor/" not in lower
        and "/_next/" not in lower
        and "/build/" not in lower
        and "/dist/" not in lower
    )


def local_reference(raw: str) -> bool:
    value = raw.strip()
    lower = value.lower()
    return bool(value) and not (
        lower.startswith(("http://", "https://", "//", "data:", "mailto:", "tel:", "javascript:", "#"))
        or "{{" in value or "{%" in value or "${" in value
    )


def resolve_reference(html: Path, raw: str) -> Path | None:
    path = unquote(urlsplit(raw).path)
    if not path or path == "/":
        return None
    if path.startswith("/static/"):
        return ROOT / "app" / path.lstrip("/")
    if path.startswith("/assets/") or path.startswith("/_next/"):
        return ROOT / "landing" / path.lstrip("/")
    if path.startswith("/"):
        return ROOT / "landing" / path.lstrip("/")
    return html.parent / path


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("FAIL node executable not found")
        return 1

    failures = []
    checked_js = 0
    for root in JS_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.js")):
            if not active_js(path):
                continue
            checked_js += 1
            result = subprocess.run(
                [node, "--check", str(path)], capture_output=True, text=True
            )
            if result.returncode:
                failures.append(f"JS syntax: {path.relative_to(ROOT)}\n{result.stderr.strip()}")

    checked_refs = 0
    for html in HTML_FILES:
        if not html.is_file():
            continue
        text = html.read_text(encoding="utf-8", errors="replace")
        for match in REF_RE.finditer(text):
            raw = match.group(2)
            if not local_reference(raw):
                continue
            target = resolve_reference(html, raw)
            if target is None:
                continue
            checked_refs += 1
            if not target.resolve().exists():
                failures.append(
                    f"Missing asset: {html.relative_to(ROOT)} -> {raw}"
                )

    print(f"Checked JavaScript files: {checked_js}")
    print(f"Checked local HTML references: {checked_refs}")
    if failures:
        print("\n".join(f"FAIL {failure}" for failure in failures))
        return 1
    print("PASS frontend assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
