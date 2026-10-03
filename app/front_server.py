
# zelscan-production landing root
from pathlib import Path as _ProductionPath
from flask import send_from_directory as _production_send_from_directory
_PRODUCTION_LENDOS = _ProductionPath(__file__).resolve().parents[1] / "landing" / "lendos"

"""Frontend server for Zelscan.

Serves the multi-page UI from landing/ on FRONT_PORT (default 8080) and
proxies all /api/* requests to the backend on BACKEND_PORT (default 5050).
Run:  python app/front_server.py
"""

import json
import logging
import os
import re
import secrets
from urllib.parse import urlsplit

import requests
from flask import Flask, Response, jsonify, redirect, request, send_from_directory

from security import apply_security_headers, safe_request_id

_APP_DIR   = os.path.dirname(os.path.abspath(__file__))
_ROOT      = os.path.dirname(_APP_DIR)
LANDING    = os.path.join(_ROOT, "landing")
FRONT_HOST = os.environ.get("FRONT_HOST", "0.0.0.0").strip() or "0.0.0.0"
FRONT_PORT = int(os.environ.get("FRONT_PORT", "8080"))

BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "5050"))
BACKEND_URL  = os.environ.get("BACKEND_URL", f"http://127.0.0.1:{BACKEND_PORT}")

# asset_auto_version_v1: подстановка ?v=<mtime> для локальных ассетов в HTML
_ASSET_URL_RE = re.compile(r'((?:assets/)[^"\'\s>]+?\.(?:js|css))(?:\?v=\d+)?')

app = Flask(__name__)
logger = logging.getLogger("zelscan.front")


@app.after_request
def _security_headers(response):
    return apply_security_headers(response)


@app.after_request
def _cache_headers(response):
    """HTML — всегда ревалидация; версионированные ассеты — кэш навсегда."""
    if response.status_code != 200:
        return response
    path = request.path
    is_oauth_callback = path in {"/oauth_callback.html", "/oauth/callback", "/oauth/callback/"}
    is_oauth_callback_script = path == "/assets/js/pages/oauth_callback.js"
    if is_oauth_callback or is_oauth_callback_script:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    elif path.startswith("/assets/") and re.search(r"\.(js|css|png|svg|webp|jpg)$", path):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif response.mimetype == "text/html":
        response.headers["Cache-Control"] = "no-cache"
    return response

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-encoding",
    "content-length", "host",
}


_PUBLIC_FILES = frozenset({
    "favicon.ico", "favicon.svg", "logo-4crypto.svg", "logolzt.svg", "firma.svg", "text.svg", "plus.svg",
    "logomove.webm", "logo_breath_preview.webm",
})
_PUBLIC_PREFIXES = ("assets/", "images/", "logo/", "logo-anim/", "_next/")
_LENDOS_PUBLIC_PREFIXES = ("css/", "js/", "images/", "fonts/", "svg/")
_CLEAN_ROUTES = {
    "/app": "zelscan_dashboard.html",
    "/dossiers": "my_dossiers.html",
    "/explore": "public_dossiers.html",
    "/billing": "transactions.html",
    "/updates": "news.html",
    "/report": "zelscan.html",
    "/report/activity": "zelscan_activity.html",
    "/report/behavior": "zelscan_behavior.html",
    "/report/psychology": "zelscan_psychology.html",
    "/report/analysis": "zelscan_analysis.html",
}
_LEGACY_ROUTES = {filename: route for route, filename in _CLEAN_ROUTES.items()}
_PRIVATE_HTML = frozenset({*_LEGACY_ROUTES, "admin.html", "admin56.html"})
_LOCAL_RETURN_HOSTS = frozenset({"localhost", "127.0.0.1"})
_PRODUCTION_APP_ORIGIN = "https://app.zelscan.xyz"


def _safe_return_to(value: str | None) -> str:
    """Allow only the local callback origin or the canonical production app."""
    if not value:
        return "/"
    value = value.strip()
    if value.startswith("/") and not value.startswith("//"):
        return value if value.split("?", 1)[0] in {"/", "/oauth/callback"} else "/"
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "/"
    if parsed.username or parsed.password or parsed.path not in {"/", "/oauth/callback"}:
        return "/"
    if parsed.hostname in _LOCAL_RETURN_HOSTS and parsed.scheme in {"http", "https"}:
        return value
    if f"{parsed.scheme}://{parsed.netloc}" == _PRODUCTION_APP_ORIGIN:
        return value
    return "/"


def _local_setup_done() -> bool:
    """Гейт сетапа работает только в локальной сборке (маркер .zelscan_local
    в корне проекта; на проде файла нет — гейт выключен)."""
    if not (_PRODUCTION_LENDOS.parent.parent / ".zelscan_local").exists():
        return True
    return (_PRODUCTION_LENDOS.parent.parent / ".local_setup_done").exists()


@app.route("/")
def index():
    if not _local_setup_done():
        return send_from_directory(str(_PRODUCTION_LENDOS), "setup.html")
    return _production_send_from_directory(str(_PRODUCTION_LENDOS), "index.html")

@app.route("/setup")
def local_setup_page():
    return send_from_directory(str(_PRODUCTION_LENDOS), "setup.html")

@app.route("/oauth/callback")
@app.route("/oauth/callback/")
def oauth_callback():
    _safe_return_to(request.args.get("return_to"))
    return send_from_directory(LANDING, "oauth_callback.html")


@app.route("/oauth_callback.html")
def oauth_callback_legacy():
    # Do not redirect: URL fragments never reach the server and would be lost.
    return send_from_directory(LANDING, "oauth_callback.html")


@app.route("/app")
@app.route("/dossiers")
@app.route("/explore")
@app.route("/billing")
@app.route("/updates")
@app.route("/report")
@app.route("/report/activity")
@app.route("/report/behavior")
@app.route("/report/psychology")
@app.route("/report/analysis")
def production_page():
    if not _local_setup_done():
        return redirect("/setup", code=302)
    # /app always serves the minimal auth shell. The early client guard checks
    # the HttpOnly cookie session before revealing any dashboard content.
    # Protected APIs remain server-side guarded; other private pages retain
    # this defense-in-depth session check.
    if request.path == "/app":
        return send_from_directory(LANDING, _CLEAN_ROUTES[request.path])
    try:
        check = requests.get(
            f"{BACKEND_URL}/api/auth/session",
            headers={"Cookie": request.headers.get("Cookie", "")},
            timeout=5,
        )
    except requests.RequestException:
        return redirect("/", code=302)
    if check.status_code != 200:
        return redirect("/", code=302)
    return send_from_directory(LANDING, _CLEAN_ROUTES[request.path])


def _proxy(target: str) -> Response:
    request_id = safe_request_id(request.headers.get("X-Request-ID")) or secrets.token_hex(12)
    headers = {k: v for k, v in request.headers if k.lower() not in HOP_BY_HOP}
    headers["X-Request-ID"] = request_id
    try:
        upstream = requests.request(
            request.method,
            target,
            headers=headers,
            data=request.get_data(),
            timeout=120,
        )
    except requests.RequestException:
        logger.exception("backend proxy failure request_id=%s path=%s", request_id, request.path)
        response = Response(
            json.dumps({"error": "backend unavailable", "request_id": request_id}),
            status=502,
            content_type="application/json",
        )
        response.headers["X-Request-ID"] = request_id
        return response
    resp_headers = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in HOP_BY_HOP and k.lower() != "server"
    }
    resp_headers["X-Request-ID"] = request_id
    if request.method == "GET" and request.path == "/api/news":
        resp_headers["Cache-Control"] = "private, no-store"
        resp_headers["Vary"] = "Cookie, Authorization"
    return Response(upstream.content, status=upstream.status_code, headers=resp_headers)


@app.route("/api/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def api_proxy(_rest):
    target = f"{BACKEND_URL}/{request.full_path}"
    if target.endswith("?"):
        target = target[:-1]
    return _proxy(target)


# Админка живёт на бэкенде — проксируем её и её статику (Next.js ассеты),
# чтобы она была доступна и через фронтовый порт.
@app.route("/admin", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/admin/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/admin/admin-bridge.js", methods=["GET"])
@app.route("/admin/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
@app.route("/_next/<path:_rest>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
def admin_proxy(_rest=None):
    # Flask's generic /<path:filename> route can win over /admin/<path> for this
    # static file. Serve it explicitly here as a defense-in-depth fallback.
    if request.path == "/admin/admin-bridge.js":
        return _proxy(f"{BACKEND_URL}{request.full_path.rstrip('?')}")
    # A direct browser navigation cannot carry a Bearer token, but it does carry
    # the HttpOnly OAuth session cookie. Gate admin HTML/assets on that cookie
    # session AND on the caller actually being the admin (udodov): ask the
    # backend via /api/admin/access, which resolves the user from the cookie and
    # reports `eligible` only for ADMIN_UID. Non-admins (guests or regular users)
    # are bounced to the public bootstrap without a redirect loop. The admin API
    # itself stays independently protected by the backend _admin_guard.
    # API/XHR calls (which do carry Bearer) are proxied through unconditionally.
    auth = request.headers.get("Authorization", "")
    has_bearer = auth.startswith("Bearer ") and bool(auth[7:].strip())
    if not has_bearer:
        try:
            access = requests.get(
                f"{BACKEND_URL}/api/admin/access",
                headers={"Cookie": request.headers.get("Cookie", "")},
                timeout=5,
            )
        except requests.RequestException:
            return redirect("/", code=302)
        if access.status_code != 200 or not access.json().get("eligible"):
            return redirect("/", code=302)
    target = f"{BACKEND_URL}{request.path}"
    if request.query_string:
        target += "?" + request.query_string.decode("latin-1")
    return _proxy(target)


@app.route("/<path:filename>")
def landing_files(filename):
    """Serve only explicitly public bootstrap assets; never arbitrary files."""
    normalized = filename.replace("\\", "/").lstrip("/")
    if normalized == "admin/admin-bridge.js":
        return _proxy(f"{BACKEND_URL}{request.full_path.rstrip('?')}")
    if ".." in normalized.split("/"):
        return jsonify({"error": "not_found"}), 404
    # Страница «О проекте» — статичная папка внутри lendos. Резолвим её ДО
    # общего префикс-правила, иначе "zelscan-moderation-minimal/assets/..."
    # перехватится маркером "/assets/" и уйдёт в LANDING вместо lendos.
    if normalized == "about":
        # без слэша относительные ссылки css/js резолвятся от корня — канонизируем
        return redirect("/about/", code=301)
    if normalized in ("about/",):
        return send_from_directory(str(_PRODUCTION_LENDOS / "about"), "index.html")
    if normalized.startswith("about/"):
        return send_from_directory(str(_PRODUCTION_LENDOS), normalized)
    # старый длинный путь страницы «О проекте» — на новый короткий
    if normalized.rstrip("/") == "zelscan-moderation-minimal":
        return redirect("/about/", code=301)
    # Вложенные clean-роуты (напр. /report/behavior) подключают ассеты относительным
    # путём ("assets/..."), поэтому браузер запрашивает /report/behavior/assets/... .
    # Такой путь не начинается с публичного префикса и раньше отдавал 404 (из-за чего
    # пропадали sidebar-lab.css/.js и ломалась шапка). Если публичный префикс встречается
    # где-то внутри пути — резолвим ассет от него (эквивалент абсолютного /assets/...).
    if not normalized.startswith(_PUBLIC_PREFIXES):
        for _prefix in _PUBLIC_PREFIXES:
            _marker = "/" + _prefix
            _idx = normalized.find(_marker)
            if _idx != -1:
                normalized = normalized[_idx + 1:]
                break
    if normalized in _LEGACY_ROUTES:
        target = _LEGACY_ROUTES[normalized]
        if request.query_string:
            target += "?" + request.query_string.decode("latin-1")
        return redirect(target, code=301)
    if normalized in _PRIVATE_HTML or normalized.endswith(".html"):
        return redirect("/", code=302)
    if normalized in _PUBLIC_FILES:
        return send_from_directory(LANDING, normalized)
    if normalized.startswith(_LENDOS_PUBLIC_PREFIXES):
        return send_from_directory(str(_PRODUCTION_LENDOS), normalized)
    if not normalized.startswith(_PUBLIC_PREFIXES):
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(LANDING, normalized)


if __name__ == "__main__":
    app.run(host=FRONT_HOST, port=FRONT_PORT, threaded=True)
