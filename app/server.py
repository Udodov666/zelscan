"""
Zelscan backend v8 — production-ready.

Стек: Flask + waitress (1 процесс, 8 потоков), SQLite OrderStore,
      единственный QueueWorker-демон внутри процесса.

Эндпоинты:
  GET  /api/search?q=            → поиск юзера по нику/id/ссылке
  POST /api/orders               → создать заказ (basic/full)
  GET  /api/orders/<id>          → статус + прогресс + результат
  GET  /api/orders               → список заказов (admin)
  POST /api/payment/stub/<id>    → подтвердить оплату (заглушка; потом Zelenka)
  GET  /api/health               → состояние системы

  Legacy aliases (совместимость с текущим фронтом):
  POST /api/queue                → /api/orders
  GET  /api/queue/<id>           → /api/orders/<id>
  GET  /api/queue                → /api/orders
"""
from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import logging
import os
import re
import sys
import threading
import time

import requests
from collections import OrderedDict
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
from flask_cors import CORS

# путь к пакетам
_APP_DIR = Path(__file__).resolve().parent
_SCRIPTS = _APP_DIR.parent / "scripts"
sys.path.insert(0, str(_APP_DIR))
sys.path.insert(0, str(_SCRIPTS))

import config
from store import OrderStore, Status
from worker import QueueWorker
from admin_service import install_admin, get_ai_snapshot
from local_setup import install_local_setup
from security import apply_security_headers, install_log_redaction

# ── logging ───────────────────────────────────────────────────────────────────
_fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
logging.basicConfig(
    level=logging.INFO,
    format=_fmt,
    handlers=[
        logging.StreamHandler(sys.stdout),
        RotatingFileHandler(
            config.LOG_DIR / "zelscan.log",
            maxBytes=10 * 1024 * 1024,
            backupCount=3,
            encoding="utf-8",
        ),
    ],
)
install_log_redaction()
logger = logging.getLogger("zelscan.api")

# ── globals ───────────────────────────────────────────────────────────────────
store = OrderStore()
# Production behavior remains unchanged; tests can suppress import-time threads.
worker = QueueWorker(store)
if os.environ.get("ZELSCAN_DISABLE_QUEUE_WORKER") != "1":
    worker = worker.start()


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(_APP_DIR / "templates"),
        static_folder=str(_APP_DIR / "static"),
    )

    CORS(
        app,
        origins=list(config.ALLOWED_ORIGINS),
        supports_credentials=True,
        vary_header=True,
        allow_headers=["Authorization", "Content-Type", "Accept", "X-CSRF-Token", "X-Turnstile-Token", "Idempotency-Key"],
    )
    app.after_request(apply_security_headers)

    # ── глобальные обработчики ошибок ────────────────────────────────────────

    @app.errorhandler(Exception)
    def handle_exception(e):
        logger.exception("Необработанная ошибка: %s", e)
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500

    @app.errorhandler(404)
    def handle_404(_e):
        return jsonify({"error": "Не найдено"}), 404

    @app.errorhandler(405)
    def handle_405(_e):
        return jsonify({"error": "Метод не поддерживается"}), 405

    # ── bounded, short-window rate limiter ──────────────────────────────────
    _rl: OrderedDict = OrderedDict()
    _RL_MAX_KEYS = 4096
    _RL_IDLE_TTL = 180.0
    _RL_LOCK = threading.Lock()
    _RL_POLICIES = {
        "auth": (20, 60.0),
        "search": (30, 60.0),
        "expensive": (10, 60.0),
        "payment": (12, 60.0),
        "poll": (180, 60.0),
        "default": (120, 60.0),
    }

    def _rate_policy():
        path = request.path
        if path in ("/api/me", "/api/oauth/config") or path.startswith("/api/admin/login"):
            return "auth"
        if path.startswith("/api/search") or path == "/api/avatars":
            return "search"
        if request.method == "POST" and path in ("/api/orders", "/api/queue"):
            return "expensive"
        if "topup" in path or path.startswith("/api/payment/") or "promo" in path:
            return "payment"
        if request.method == "GET" and (
            path.startswith("/api/orders/") or path in ("/api/my/topup-status", "/api/my/topup-pending")
        ):
            return "poll"
        return "default"

    def _rate_limited_response(retry_after: int):
        response = jsonify({"error": "Слишком много запросов", "retry_after": retry_after})
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response

    def _check_rate(cost: float = 1.0) -> bool:
        policy = _rate_policy()
        limit, window = _RL_POLICIES[policy]
        now = time.monotonic()
        ip = request.remote_addr or "unknown"
        key = (ip, policy)
        with _RL_LOCK:
            while _rl and (now - next(iter(_rl.values()))["seen"] > _RL_IDLE_TTL or len(_rl) >= _RL_MAX_KEYS):
                _rl.popitem(last=False)
            bucket = _rl.get(key)
            if bucket is None or now >= bucket["reset"]:
                bucket = {"used": 0.0, "reset": now + window, "seen": now}
                _rl[key] = bucket
            bucket["seen"] = now
            _rl.move_to_end(key)
            if bucket["used"] + cost > limit:
                request.environ["zelscan.retry_after"] = max(1, int(bucket["reset"] - now + 0.999))
                return False
            bucket["used"] += cost
            return True

    @app.after_request
    def _normalize_rate_limit_response(response):
        if response.status_code == 429 and "Retry-After" not in response.headers:
            retry_after = int(request.environ.get("zelscan.retry_after", 60))
            response.headers["Retry-After"] = str(max(1, retry_after))
        return response

    # ── index ─────────────────────────────────────────────────────────────────

    @app.route("/")
    def index():
        return render_template("index.html")

    # ── admin UI (собранный статик-билд Next.js) ──────────────────────────────
    _ADMIN_UI = _APP_DIR / "admin_ui"

    @app.route("/admin")
    @app.route("/admin/")
    def admin_index():
        if not (_ADMIN_UI / "index.html").exists():
            return jsonify({"error": "Админ-панель не собрана"}), 404
        return send_from_directory(_ADMIN_UI, "index.html")

    @app.route("/_next/<path:filename>")
    def admin_next_assets(filename):
        return send_from_directory(_ADMIN_UI / "_next", filename)

    @app.route("/admin/admin-bridge.js")
    def admin_bridge_js():
        resp = send_from_directory(_ADMIN_UI, "admin-bridge.js")
        resp.headers["Content-Type"] = "application/javascript; charset=utf-8"
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.route("/favicon.ico")
    def favicon():
        return "", 204

    # ── auth helper ───────────────────────────────────────────────────────────

    _me_cache: dict = {}      # token_hash → (user_dict, expires_at)
    _me_neg_cache: dict = {}  # token_hash → ((code,json), cooldown_until) — невалидный токен
    _me_inflight: dict = {}   # token_hash → threading.Event (дедуп валидации)
    _ME_TTL     = 300         # short positive cache; JWT exp may shorten it further
    _ME_NEG_TTL = 60          # невалидный токен не дёргаем lolz 60 сек
    _JWT_CLOCK_SKEW = 60
    _JWT_MAX_IAT_FUTURE = 300

    def _decode_jwt_metadata(token: str):
        """Parse JWT metadata for claim hygiene only; trust still comes from upstream."""
        import base64

        if token.count(".") != 2:
            return None, None
        try:
            header_part, payload_part, signature_part = token.split(".")
            if not header_part or not payload_part or not signature_part:
                raise ValueError("missing JWT segment")

            def decode_part(part: str):
                raw = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
                value = json.loads(raw.decode("utf-8"))
                if not isinstance(value, dict):
                    raise ValueError("JWT segment is not an object")
                return value

            header = decode_part(header_part)
            payload = decode_part(payload_part)
            if str(header.get("alg", "")).strip().lower() == "none":
                raise ValueError("alg none is forbidden")
            now = time.time()
            for name in ("exp", "nbf", "iat"):
                if name in payload and (isinstance(payload[name], bool) or not isinstance(payload[name], (int, float))):
                    raise ValueError(f"invalid {name}")
            if "exp" in payload and payload["exp"] <= now - _JWT_CLOCK_SKEW:
                raise ValueError("expired JWT")
            if "nbf" in payload and payload["nbf"] > now + _JWT_CLOCK_SKEW:
                raise ValueError("JWT not active")
            if "iat" in payload and payload["iat"] > now + _JWT_MAX_IAT_FUTURE:
                raise ValueError("JWT issued in future")
            if not payload.get("sub"):
                raise ValueError("missing subject")
            return payload, None
        except Exception:
            return None, (401, {"error": "Некорректный или просроченный токен"})

    def _me_from_lolz(token: str):
        """Проверить токен через lolz API.
        Возвращает (user_dict, None) при успехе либо (None, (код, json)) при ошибке."""
        import urllib.request as _ur
        import urllib.error   as _ue

        payload, claim_error = _decode_jwt_metadata(token)
        if claim_error:
            return None, claim_error
        user_id_from_token = payload.get("sub") if payload else None
        if not user_id_from_token:
            return None, (401, {"error": "Не удалось определить user_id из токена"})

        url = f"https://api.lolz.live/users/{user_id_from_token}"
        req = _ur.Request(url, headers={
            "User-Agent":    "Zelscan/1.0",
            "Authorization": f"Bearer {token}",
        })
        try:
            with _ur.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read())
        except _ue.HTTPError as e:
            body_txt = e.read().decode("utf-8", errors="replace")
            logger.warning("me HTTP %s body=%s", e.code, body_txt[:300])
            return None, (401, {"error": f"HTTP {e.code}", "detail": body_txt[:200]})
        except Exception as e:
            logger.error("me error: %s", e)
            return None, (502, {"error": "Ошибка запроса к форуму", "detail": str(e)})

        user = body.get("user") or {}
        if not user:
            return None, (502, {"error": "Пустой ответ от форума"})

        uid   = user.get("user_id")
        uname = user.get("username", "")
        av    = (user.get("links") or {}).get("avatar", "")
        msgs  = user.get("user_post_count", 0)
        ban   = bool(user.get("user_is_banned", 0))

        username_html = str(user.get("username_html") or "")
        if "<" not in username_html:
            username_html = ""
        db_user = store.upsert_user(uid, uname, av, msgs, ban, username_html)

        result = {
            "user_id":       uid,
            "username":      uname,
            "username_html": username_html or (db_user.get("username_html", "") if db_user else ""),
            "avatar":        av,
            "message_count": msgs,
            "is_banned":     ban,
            "credits":       db_user.get("credits", 0.0) if db_user else 0.0,
            "bonus_credits": db_user.get("bonus_credits", 0.0) if db_user else 0.0,
            "total_orders":  db_user.get("total_orders", 0) if db_user else 0,
            "first_seen":    db_user.get("first_seen") if db_user else None,
        }
        return result, None

    def _token_user(token: str):
        """Validate through Lolz and cache only for a short, claim-bounded TTL."""
        override = app.config.get("TOKEN_USER_VALIDATOR")
        if override is not None:
            return override(token)
        payload, claim_error = _decode_jwt_metadata(token)
        if claim_error:
            return None, claim_error
        now = time.time()
        cache_ttl = _ME_TTL
        if payload and "exp" in payload:
            cache_ttl = min(cache_ttl, max(0, payload["exp"] - now))
            if cache_ttl <= 0:
                return None, (401, {"error": "Некорректный или просроченный токен"})
        cache_key = hashlib.sha256(token.encode()).hexdigest()
        cached = _me_cache.get(cache_key)
        if cached and cached[1] > now:
            return cached[0], None
        neg = _me_neg_cache.get(cache_key)
        if neg and neg[1] > now:
            return None, neg[0]
        # дедуп: одновременно один запрос к lolz на токен
        ev = _me_inflight.get(cache_key)
        if ev:
            ev.wait(timeout=12)
            cached = _me_cache.get(cache_key)
            if cached and cached[1] > time.time():
                return cached[0], None
            return None, (502, {"error": "Валидация токена уже идёт, повторите запрос"})
        ev = threading.Event()
        _me_inflight[cache_key] = ev
        try:
            result, err = _me_from_lolz(token)
        finally:
            _me_inflight.pop(cache_key, None)
            ev.set()
        if result:
            _me_cache[cache_key] = (result, time.time() + cache_ttl)
        elif err and err[0] == 401:
            _me_neg_cache[cache_key] = (err, time.time() + _ME_NEG_TTL)
        return result, err

    # ── opaque browser sessions ──────────────────────────────────────────────
    # Sessions are persisted in SQLite (store.sessions), so a backend restart
    # does NOT log everyone out. Опрортунистическая сборка мусора при чтении.
    _SESSION_MAX_TTL = 15552000

    def _is_local_request():
        return request.host.split(":", 1)[0].lower() in {"localhost", "127.0.0.1"}

    def _cookie_name():
        return "zelscan_session" if _is_local_request() else "__Host-zelscan_session"

    def _session_from_cookie():
        sid = request.cookies.get(_cookie_name(), "")
        if not sid:
            return None
        try:
            return store.session_get(sid)
        except Exception:
            logger.exception("session_get failed")
            return None

    def _require_auth():
        """Return the authenticated user id from a validated Bearer or browser session."""
        cached_user = request.environ.get("zelscan.auth_user")
        if cached_user:
            return cached_user.get("user_id"), None
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and auth[7:].strip():
            token = auth[7:].strip()
            user, _err = _token_user(token)
            if user:
                request.environ["zelscan.auth_user"] = user
                return user.get("user_id"), token
            return None, token
        session = _session_from_cookie()
        if session:
            request.environ["zelscan.auth_user"] = session["user"]
            return session["user"].get("user_id"), None
        return None, None

    def _origin_allowed():
        origin = request.headers.get("Origin", "").rstrip("/")
        return bool(origin and origin in set(config.ALLOWED_ORIGINS) | {"https://app.zelscan.xyz"})

    @app.post("/api/auth/session")
    def create_browser_session():
        if not _origin_allowed():
            return jsonify({"error": "invalid_origin"}), 403
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or not auth[7:].strip():
            return jsonify({"error": "authentication_required"}), 401
        token = auth[7:].strip()
        user, err = _token_user(token)
        if err or not user:
            return jsonify(err[1] if err else {"error": "authentication_required"}), (err[0] if err else 401)
        payload, _ = _decode_jwt_metadata(token)
        now = time.time()
        expires_at = min(now + _SESSION_MAX_TTL, float(payload["exp"])) if payload and payload.get("exp") else now + _SESSION_MAX_TTL
        sid = secrets.token_urlsafe(48)
        store.session_create(sid, user, int(expires_at))
        try:
            store.session_gc()  # opportunistic cleanup of expired rows
        except Exception:
            logger.exception("session_gc failed")
        response = jsonify({"ok": True, "expires_at": int(expires_at)})
        response.set_cookie(_cookie_name(), sid, max_age=max(1, int(expires_at - now)), httponly=True,
                            secure=not _is_local_request(), samesite="Lax", path="/")
        return response

    @app.get("/api/auth/session")
    def check_browser_session():
        session = _session_from_cookie()
        if not session:
            return jsonify({"authenticated": False}), 401
        return jsonify({"authenticated": True, "user": session["user"]})

    @app.post("/api/auth/logout")
    def logout_browser_session():
        if not _origin_allowed():
            return jsonify({"error": "invalid_origin"}), 403
        sid = request.cookies.get(_cookie_name(), "")
        if sid:
            try:
                store.session_delete(sid)
            except Exception:
                logger.exception("session_delete failed")
        response = jsonify({"ok": True})
        response.delete_cookie(_cookie_name(), path="/", secure=not _is_local_request(), httponly=True, samesite="Lax")
        return response

    # ── mandatory server-side auth gate ──────────────────────────────────────
    # /api/search — публичный: это поиск на лендинге, вход в воронку.
    # Расход LZT-квоты прикрывает собственный рейт-лимит роута (30/мин на IP).
    _PUBLIC_API_PATHS = frozenset({"/api/oauth/config", "/api/auth/session", "/api/auth/logout", "/api/captcha/config", "/api/health", "/api/search", "/api/local/setup", "/api/local/setup/test-tokens", "/api/local/setup/test-oauth"})

    @app.before_request
    def _mandatory_auth_gate():
        path = request.path
        if not path.startswith("/api/") or path in _PUBLIC_API_PATHS:
            return None
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and auth[7:].strip():
            user, err = _token_user(auth[7:].strip())
            if not err and user:
                request.environ["zelscan.auth_user"] = user
                return None
        session = _session_from_cookie()
        if session:
            request.environ["zelscan.auth_user"] = session["user"]
            return None
        return jsonify({"error": "authentication_required"}), 401

    # ── ME (OAuth user info) ──────────────────────────────────────────────────

    @app.route("/api/me")
    def get_me():
        """Return the current user for an Authorization: Bearer token only."""
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or not auth[7:].strip():
            return jsonify({"error": "Требуется Authorization: Bearer"}), 401
        user, err = _token_user(auth[7:].strip())
        if err:
            return jsonify(err[1]), err[0]
        return jsonify(user)

    @app.route("/api/oauth/config")
    def oauth_config():
        """GET /api/oauth/config → server-configured OAuth2 parameters."""
        redirect_uri = config.LOLZ_OAUTH_REDIRECT_URI
        return jsonify({
            "client_id":     config.LOLZ_OAUTH_CLIENT_ID,
            "authorize_url": config.LOLZ_OAUTH_AUTHORIZE_URL,
            "redirect_uri":  redirect_uri,
            "scope":         config.LOLZ_OAUTH_SCOPE,
        })

    # Закрытый control center: маршруты ставятся здесь, чтобы использовать
    # ту же серверную проверку Lolz-аккаунта и общий OrderStore.
    install_admin(app, store, worker, _require_auth)
    install_local_setup(app, store, _require_auth)

    # ── NEWS (новости продукта) ──────────────────────────────────────────────
    # Читать ленту может любой (гость тоже). Лайкать — любой авторизованный.
    # Создавать/редактировать/удалять — ТОЛЬКО админ (udodov, user_id 638074),
    # проверяется по user_id из проверенного Bearer-токена (вариант A).
    NEWS_ADMIN_UID = 638074

    def _news_is_admin() -> Optional[int]:
        """Вернуть uid, если это админ (udodov); иначе None."""
        uid, _token = _require_auth()
        if uid and int(uid) == NEWS_ADMIN_UID:
            return int(uid)
        return None

    def _news_parse_tags(raw):
        if not isinstance(raw, list):
            return []
        out = []
        for t in raw:
            s = str(t).strip()
            if s and s not in out:
                out.append(s[:60])
            if len(out) >= 20:
                break
        return out

    @app.route("/api/news", methods=["GET"])
    def list_news():
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        # viewer_id опционален: если авторизован — вернём флаг liked по каждому посту.
        uid, _token = _require_auth()
        posts = store.list_news(viewer_id=uid, limit=200)
        response = jsonify({"posts": posts, "is_admin": bool(uid and int(uid) == NEWS_ADMIN_UID)})
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Vary"] = "Cookie, Authorization"
        return response

    @app.route("/api/news", methods=["POST"])
    def create_news():
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid = _news_is_admin()
        if not uid:
            return jsonify({"error": "Доступ только для администратора"}), 403
        data = request.get_json(silent=True) or {}
        title = str(data.get("title", "")).strip()
        body = str(data.get("body", "")).strip()
        tags = _news_parse_tags(data.get("tags"))
        if not title and not body:
            return jsonify({"error": "Заголовок или текст обязателен"}), 400
        post = store.create_news_post(uid, title, body, tags)
        return jsonify({"post": post}), 201

    @app.route("/api/news/<post_id>", methods=["PUT", "PATCH"])
    def update_news(post_id):
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid = _news_is_admin()
        if not uid:
            return jsonify({"error": "Доступ только для администратора"}), 403
        data = request.get_json(silent=True) or {}
        title = str(data.get("title", "")).strip()
        body = str(data.get("body", "")).strip()
        tags = _news_parse_tags(data.get("tags"))
        if not title and not body:
            return jsonify({"error": "Заголовок или текст обязателен"}), 400
        post = store.update_news_post(post_id, title, body, tags)
        if not post:
            return jsonify({"error": "Пост не найден"}), 404
        return jsonify({"post": post})

    @app.route("/api/news/<post_id>", methods=["DELETE"])
    def delete_news(post_id):
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid = _news_is_admin()
        if not uid:
            return jsonify({"error": "Доступ только для администратора"}), 403
        ok = store.delete_news_post(post_id)
        if not ok:
            return jsonify({"error": "Пост не найден"}), 404
        return jsonify({"ok": True})

    @app.route("/api/news/<post_id>/like", methods=["POST"])
    def like_news(post_id):
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        result = store.toggle_news_like(post_id, int(uid))
        if result is None:
            return jsonify({"error": "Пост не найден"}), 404
        return jsonify(result)

    # ── SETTINGS & NOTIFICATIONS (личный кабинет) ────────────────────────────
    # user_id берётся ТОЛЬКО из токена через _require_auth. Клиент не может
    # передать чужой user_id: он извлекается из проверенного Bearer-токена.

    @app.route("/api/my/settings", methods=["GET"])
    def get_my_settings():
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        return jsonify({"settings": store.get_settings(uid)})

    @app.route("/api/my/settings", methods=["PATCH"])
    def patch_my_settings():
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"error": "Некорректное тело запроса"}), 400
        # store.patch_settings сам применяет whitelist полей.
        settings = store.patch_settings(uid, data)
        return jsonify({"settings": settings})

    @app.route("/api/my/notifications", methods=["GET"])
    def get_my_notifications():
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        try:
            limit = int(request.args.get("limit", 50))
        except (TypeError, ValueError):
            limit = 50
        unread_only = request.args.get("unread") in ("1", "true", "yes")
        return jsonify({
            "notifications": store.list_notifications(uid, limit=limit, unread_only=unread_only),
            "unread": store.count_unread_notifications(uid),
        })

    @app.route("/api/my/notifications/<nid>", methods=["PATCH"])
    def patch_my_notification(nid):
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        is_read = bool(data.get("is_read", True))
        ok = store.mark_notification_read(uid, nid, is_read=is_read)
        if not ok:
            return jsonify({"error": "Уведомление не найдено"}), 404
        return jsonify({"ok": True, "unread": store.count_unread_notifications(uid)})

    @app.route("/api/my/notifications/read-all", methods=["POST"])
    def read_all_my_notifications():
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        notification_ids = data.get("ids")
        if notification_ids is not None:
            if not isinstance(notification_ids, list) or len(notification_ids) > 100:
                return jsonify({"error": "ids должен быть массивом до 100 элементов"}), 400
            if any(not isinstance(nid, str) or not nid for nid in notification_ids):
                return jsonify({"error": "Некорректный id уведомления"}), 400
        n = store.mark_all_notifications_read(uid, notification_ids=notification_ids)
        return jsonify({
            "ok": True,
            "marked": n,
            "unread": store.count_unread_notifications(uid),
        })

    @app.route("/api/my/notifications", methods=["DELETE"])
    def delete_all_my_notifications():
        """Удалить все уведомления текущего авторизованного пользователя."""
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        n = store.delete_all_notifications(uid)
        return jsonify({"ok": True, "deleted": n, "unread": 0})

    @app.route("/api/my/data", methods=["DELETE"])
    def delete_my_data():
        """DELETE /api/my/data  Body: {"confirmation": "УДАЛИТЬ"}
        Безопасно удаляет данные пользователя в сервисе. user_id — только из токена.
        Требует явного подтверждения фразой «УДАЛИТЬ». Идемпотентно.
        Блокируется при активном заказе (409)."""
        if not _check_rate(3):
            return jsonify({"error": "Слишком много запросов"}), 429
        uid, _token = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        confirmation = str(data.get("confirmation") or "").strip()
        if confirmation != "УДАЛИТЬ":
            return jsonify({"error": "Подтвердите удаление фразой «УДАЛИТЬ»", "code": "confirmation_required"}), 400
        result = store.delete_user_data(uid)
        if not result.get("ok"):
            code = result.get("code")
            status = 409 if code == "active_order" else 400
            return jsonify({"error": result.get("error", "Не удалось удалить данные"), "code": code}), status
        logger.info("Данные пользователя %s удалены: %s", uid, result.get("deleted"))
        return jsonify(result)

    # ── SEARCH ────────────────────────────────────────────────────────────────

    def _rank_search_results(query: str, users: list) -> list:
        """Return search results with exact matches first, then likes within one relevance group."""
        query_text = str(query or "").strip()
        query_lower = query_text.casefold()
        query_id = query_text if query_text.isdigit() else ""

        def _as_int(value):
            try:
                return max(0, int(value or 0))
            except (TypeError, ValueError):
                return 0

        normalized = []
        for raw in users or []:
            if not isinstance(raw, dict):
                continue
            user = dict(raw)
            username = str(user.get("username") or "")
            user_id = str(user.get("user_id") or user.get("id") or "")
            likes = _as_int(user.get("user_like_count", user.get("like_count", 0)))
            messages = _as_int(user.get("user_post_count", user.get("message_count", 0)))
            user["likes_received"] = likes
            user["message_count"] = messages

            name_lower = username.casefold()
            if query_id and user_id == query_id:
                relevance = 0
            elif query_lower and name_lower == query_lower:
                relevance = 1
            elif query_lower and name_lower.startswith(query_lower):
                relevance = 2
            elif query_lower and query_lower in name_lower:
                relevance = 3
            else:
                relevance = 4
            normalized.append((relevance, -likes, -messages, name_lower, user_id, user))

        normalized.sort(key=lambda item: item[:5])
        return [item[5] for item in normalized]
    @app.route("/api/search")
    def search_users():
        """GET /api/search?q=ник_или_id_или_ссылка
        Возвращает список пользователей: [{user_id, username, avatar, message_count, is_banned}]
        """
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429

        q = request.args.get("q", "").strip()
        if not q:
            return jsonify({"error": "Параметр q обязателен"}), 400
        if len(q) > 100:
            return jsonify({"error": "Запрос слишком длинный"}), 400

        tokens = _load_tokens()
        if not tokens:
            return jsonify({"error": "Сервис недоступен: нет токенов"}), 503

        try:
            from lolz_analyzer import LolzAnalyzer
            analyzer = LolzAnalyzer(tokens=tokens)
            results = _rank_search_results(q, analyzer.search_users(q))
            # Preserve official rich username markup separately from the clean text nick.
            for user in results:
                rich_name = str(user.get("username_html") or user.get("username") or "")
                user["username_html"] = rich_name if "<" in rich_name else ""
                user["username"] = re.sub(r"<[^>]*>", "", rich_name).strip() or str(user.get("username") or "")
            return jsonify({"users": results})
        except Exception as e:
            logger.error("Ошибка поиска: %s", e)
            return jsonify({"error": "Ошибка поиска", "detail": str(e)}), 500

    # ── POPULAR TOP (топ-20 по лайкам, ники-сид) ──────────────────────────────
    TOP_NICKS = [
        "karandawww", "ememfro", "Композитор", "SEKSI", "GoodPlayers",
        "любительХомиака", "hxrt", "ЗЛОСТЬ", "Fazan", "Jargonium",
        "Подполковник", "Tendrly", "2nd", "Хомиак", "луксмаксер",
        "поляк", "ralsei", "klopybrittan", "BALABOLZTEAM", "00Michael00",
    ]
    _top_cache: dict = {"ts": 0.0, "users": []}

    def _resolve_top_users(analyzer):
        # Отдаём уже собранный рейтинг сразу: открытие поля поиска не должно
        # ожидать последовательные запросы к внешнему API.
        if _top_cache["users"] and time.time() - _top_cache["ts"] < 6 * 3600:
            return _top_cache["users"]

        def resolve_one(nick):
            try:
                # Отдельный экземпляр исключает совместное использование HTTP-сессии
                # между потоками и ограничивает каждую сетевую попытку 8 секундами.
                from lolz_analyzer import LolzAnalyzer
                found = LolzAnalyzer(tokens=tokens).search_users(nick)
            except Exception:
                return None
            low = nick.lower()
            user = next((x for x in found if str(x.get("username", "")).lower() == low), found[0] if found else None)
            return user if user and user.get("user_id") else None

        from concurrent.futures import ThreadPoolExecutor
        workers = min(8, max(1, len(TOP_NICKS)))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="zelscan-top") as pool:
            users = [user for user in pool.map(resolve_one, TOP_NICKS) if user]

        ranked = _rank_search_results("", users)
        if ranked:
            _top_cache["users"] = ranked
            _top_cache["ts"] = time.time()
        return ranked

    @app.route("/api/search/top")
    def search_top():
        """GET /api/search/top — топ-20 популярных (по лайкам) юзеров.
        Возвращает тот же формат, что /api/search: {users: [...]}."""
        if not _check_rate(2):
            return jsonify({"error": "Слишком много запросов"}), 429
        tokens = _load_tokens()
        if not tokens:
            return jsonify({"error": "Сервис недоступен: нет токенов"}), 503
        try:
            from lolz_analyzer import LolzAnalyzer
            analyzer = LolzAnalyzer(tokens=tokens)
            return jsonify({"users": _resolve_top_users(analyzer)})
        except Exception as e:
            logger.error("Ошибка топа: %s", e)
            return jsonify({"error": "Ошибка загрузки топа", "detail": str(e)}), 500

    # ── ORDERS ────────────────────────────────────────────────────────────────

    @app.route("/api/avatars", methods=["POST"])
    def resolve_avatars():
        """POST /api/avatars  Body: {names: ["a", "b"]}
        Пакетно резолвит аватарки юзеров форума по никам — для «Круга общения».
        """
        if not _check_rate(1):
            return jsonify({"error": "Слишком много запросов"}), 429

        data = request.get_json(silent=True) or {}
        names = [str(n).strip()[:60] for n in (data.get("names") or []) if str(n).strip()]
        names = names[:10]
        if not names:
            return jsonify({"avatars": {}}), 200

        tokens = _load_tokens()
        if not tokens:
            return jsonify({"error": "Сервис недоступен: нет токенов"}), 503

        try:
            from lolz_analyzer import LolzAnalyzer
            analyzer = LolzAnalyzer(tokens=tokens)
            avatars = {}
            for name in names:
                resp = analyzer._get("/users/find",
                                     params={"username": name, "limit": 5}, token_idx=0)
                for u in (resp.get("users") or []):
                    if not u:
                        continue
                    uname = str(u.get("username", ""))
                    if uname.lower() != name.lower():
                        continue
                    links = u.get("links") or {}
                    av = links.get("avatar") or u.get("user_avatar") or ""
                    if av:
                        avatars[uname] = av
                    break
            return jsonify({"avatars": avatars})
        except Exception as e:
            logger.error("Ошибка резолва аватарок: %s", e)
            return jsonify({"error": "Ошибка", "detail": str(e)}), 500

    @app.route("/api/orders/existing", methods=["GET"])
    def get_existing_orders():
        buyer_uid, _ = _require_auth()
        if not buyer_uid:
            return jsonify({"error": "Требуется авторизация"}), 401

        raw_user_id = (request.args.get("user_id") or "").strip()
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            return jsonify({"error": "user_id должен быть положительным числом"}), 400
        if user_id <= 0:
            return jsonify({"error": "user_id должен быть положительным числом"}), 400

        def preflight_report(row, include_visibility=False):
            if not row:
                return None
            result = {
                "order_id": row.get("id"),
                "display_id": row.get("display_id"),
                "report_type": row.get("report_type") or "basic",
                "finished_at": row.get("finished_at"),
                "open_url": f"zelscan.html?order={row['id']}",
            }
            if include_visibility:
                result["visibility"] = row.get("visibility")
            return result

        owned_row = store.get_owned_current_report_any(buyer_uid, user_id)
        public_row = None
        for report_type in ("full", "basic"):
            candidate = store.get_public_current_report(user_id, report_type)
            if candidate:
                public_row = candidate
                break

        return jsonify({
            "owned": preflight_report(owned_row, include_visibility=True),
            "public": preflight_report(public_row),
        })

    @app.route("/api/orders/promo-preview", methods=["POST"])
    def order_promo_preview():
        """Preview скидки промокода типа order: {ok, discount, final_cost, percent}."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        code = (data.get("code") or "").strip().upper()
        rt = data.get("report_type", "basic")
        if rt not in ("basic", "full"):
            return jsonify({"error": "report_type: 'basic' или 'full'"}), 400
        cost = config.CREDIT_COST_FULL if rt == "full" else config.CREDIT_COST_BASIC
        res = store.validate_order_promo(uid, code, cost)
        if "error" in res:
            return jsonify(res), 400
        return jsonify(res)

    @app.route("/api/captcha/config")
    def captcha_config():
        return jsonify({"enabled": config.TURNSTILE_ENABLED,
                        "sitekey": config.TURNSTILE_SITEKEY if config.TURNSTILE_ENABLED else ""})

    @app.route("/api/orders", methods=["POST"])
    def create_order():
        """POST /api/orders
        Body: {user_id, report_type?, timeline_pages?, thread_pages?, wall_pages?, refresh?}
        Покупка отчёта с баланса кредитов. Требует авторизации,
        списывает стоимость (config.CREDIT_COST_*), создаёт транзакцию charge.
        """
        if not _check_rate(3):
            return jsonify({"error": "Слишком много запросов"}), 429

        data = request.get_json(silent=True)
        if data is None or not isinstance(data, dict):
            return jsonify({"error": "Некорректный JSON"}), 400

        user_id = data.get("user_id")
        if not user_id:
            return jsonify({"error": "user_id обязателен"}), 400
        try:
            user_id = int(user_id)
        except (ValueError, TypeError):
            return jsonify({"error": "user_id должен быть числом"}), 400

        _cap = _captcha_guard()
        if _cap:
            return _cap
        report_type = data.get("report_type", "basic")
        if report_type not in ("basic", "full"):
            return jsonify({"error": "report_type: 'basic' или 'full'"}), 400

        visibility = data.get("visibility", "private")
        if visibility not in ("private", "unlisted", "public"):
            return jsonify({"error": "visibility: 'private', 'unlisted' или 'public'"}), 400

        # покупка только для авторизованного юзера (платим с баланса)
        buyer_uid, _ = _require_auth()
        if not buyer_uid:
            return jsonify({"error": "Для покупки отчёта требуется авторизация"}), 401

        if "refresh" in data and type(data["refresh"]) is not bool:
            return jsonify({
                "error": "refresh должен быть логическим значением",
                "code": "invalid_refresh",
            }), 400
        is_refresh = data.get("refresh", False)

        if "create_own" in data and type(data["create_own"]) is not bool:
            return jsonify({"error": "create_own должен быть логическим значением",
                            "code": "invalid_create_own"}), 400
        create_own = bool(data.get("create_own", False))
        source_order_id = data.get("source_order_id")

        idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
        if not idempotency_key:
            idempotency_key = "request-" + secrets.token_urlsafe(24)
        if len(idempotency_key) < 8 or len(idempotency_key) > 128:
            return jsonify({
                "error": "Idempotency-Key должен содержать от 8 до 128 символов",
                "code": "invalid_idempotency_key",
            }), 400

        cost = config.CREDIT_COST_FULL if report_type == "full" else config.CREDIT_COST_BASIC
        currency = data.get("currency", "rub")
        if currency not in ("rub", "bonus"):
            return jsonify({"error": "currency: 'rub' or 'bonus'"}), 400
        use_bonus = bool(data.get("use_bonus", False)) or currency == "bonus"

        # ── Промокод типа «order» (скидка на заказ) ────────────────────────────
        promo_code = (data.get("promo_code") or "").strip().upper()
        order_discount = 0.0
        promo_preview = None
        if promo_code:
            promo_preview = store.validate_order_promo(buyer_uid, promo_code, cost)
            if "error" in promo_preview:
                return jsonify({"error": promo_preview["error"], "code": "promo_invalid"}), 400
            order_discount = promo_preview["discount"]
        discounted_cost = max(cost - order_discount, 0)

        bal0 = store.get_user(buyer_uid) or {}
        bonus_use = min(bal0.get("bonus_credits", 0), discounted_cost) if use_bonus else 0
        credits_needed = discounted_cost - bonus_use
        if credits_needed > 0:
            available_credits = bal0.get("credits", 0)
            if available_credits < credits_needed:
                deficit = credits_needed - available_credits
                bonus_pool = bal0.get("bonus_credits", 0) - bonus_use
                auto_bonus = min(bonus_pool, deficit)
                bonus_use += auto_bonus
                credits_needed -= auto_bonus
        if bonus_use > 0 and credits_needed > 0:
            pay_provider = "credits+bonus"
        elif bonus_use > 0:
            pay_provider = "bonus"
        else:
            pay_provider = "credits"

        page_limits = {
            "timeline_pages": (config.DEFAULT_TIMELINE_PAGES, config.MAX_TIMELINE_PAGES),
            "thread_pages": (config.DEFAULT_THREAD_PAGES, config.MAX_THREAD_PAGES),
            "wall_pages": (config.DEFAULT_WALL_PAGES, 20),
        }
        validated_pages = {}
        for field, (default, maximum) in page_limits.items():
            raw_value = data.get(field, default)
            if isinstance(raw_value, bool):
                return jsonify({"error": f"{field} должен быть целым числом от 1 до {maximum}"}), 400
            try:
                value = int(raw_value)
            except (TypeError, ValueError, OverflowError):
                return jsonify({"error": f"{field} должен быть целым числом от 1 до {maximum}"}), 400
            if value < 1 or value > maximum:
                return jsonify({"error": f"{field} должен быть целым числом от 1 до {maximum}"}), 400
            validated_pages[field] = value

        canonical_purchase = {
            "buyer_id": int(buyer_uid),
            "user_id": user_id,
            "report_type": report_type,
            **validated_pages,
            "refresh": is_refresh,
            "visibility": visibility,
            "currency": currency,
            "use_bonus": use_bonus,
            "cost": cost,
            "username": str(data.get("username", "")),
            "username_html": str(data.get("username_html", "")),
            "avatar": str(data.get("avatar", "")),
            "signature_data": str(data.get("signature_data", "")),
        }
        request_hash = hashlib.sha256(
            json.dumps(canonical_purchase, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()

        existing_idempotent = store.get_order_by_idempotency(buyer_uid, idempotency_key)
        if existing_idempotent:
            if existing_idempotent.get("request_hash") != request_hash:
                return jsonify({
                    "error": "Idempotency-Key уже использован для другого запроса",
                    "code": "idempotency_key_conflict",
                }), 409
            replay_response = _order_response(existing_idempotent)
            replay_response["idempotent_replay"] = True
            return jsonify(replay_response), 200

        if is_refresh:
            if not isinstance(source_order_id, str) or not source_order_id:
                return jsonify({"error": "Не указан источник обновления",
                                "code": "refresh_source_required"}), 400
            src = store.get_order(source_order_id)
            # текущее досье владельца независимо от тарифа: обновление доступно
            # «текущим тарифом или лучше» (basic -> basic|full, full -> full)
            current_any = store.get_owned_current_report_any(buyer_uid, user_id)
            tier_rank = {"basic": 0, "full": 1}
            target_rank = tier_rank.get(report_type, 0)
            src_rank = tier_rank.get((src or {}).get("report_type") or "basic", 0)
            if (not src or str(src.get("buyer_id") or "") != str(buyer_uid)
                    or src.get("status") != Status.DONE
                    or int(src.get("user_id") or 0) != int(user_id)
                    or not current_any or current_any["id"] != source_order_id
                    or target_rank < src_rank):
                return jsonify({"error": "Досье не найдено",
                                "code": "refresh_source_invalid"}), 404
        else:
            # проверяем своё досье на субъекте независимо от выбранного тарифа:
            # предложение «открыть/обновить» приоритетнее создания независимого
            owned = store.get_owned_current_report_any(buyer_uid, user_id)
            if owned:
                current_tier = owned.get("report_type") or "basic"
                # обновление доступно только текущим тарифом или лучше
                tiers = ["basic", "full"] if current_tier == "basic" else ["full"]
                tier_costs = {
                    "basic": config.CREDIT_COST_BASIC,
                    "full": config.CREDIT_COST_FULL,
                }
                return jsonify({
                    "error": "У вас уже есть это досье",
                    "code": "existing_report_choice_required",
                    "choice_type": "owned",
                    "existing_report": {
                        "order_id": owned["id"],
                        "display_id": owned.get("display_id"),
                        "report_type": current_tier,
                        "finished_at": owned.get("finished_at"),
                        "visibility": owned.get("visibility"),
                        "open_url": f"zelscan.html?order={owned['id']}",
                    },
                    "actions": {
                        "open": True,
                        "refresh": {
                            "allowed": True,
                            "cost": cost,
                            "tiers": [
                                {"type": t, "cost": tier_costs[t]} for t in tiers
                            ],
                        },
                    },
                }), 409
            if not create_own:
                public = store.get_public_current_report(user_id, report_type)
                if public:
                    return jsonify({
                        "error": "Готовое досье уже опубликовано в «Общих»",
                        "code": "existing_report_choice_required",
                        "choice_type": "public",
                        "existing_report": {
                            "order_id": public["id"],
                            "display_id": public.get("display_id"),
                            "report_type": public.get("report_type"),
                            "finished_at": public.get("finished_at"),
                            "open_url": f"zelscan.html?order={public['id']}",
                        },
                        "actions": {"open": True, "create_own": {"allowed": True, "cost": cost}},
                    }), 409

        active_order = store.get_active_order_by_buyer(buyer_uid)
        if active_order:
            return jsonify({
                "error": "У вас уже есть незавершённый заказ",
                "code": "active_order_exists",
                "active_order_id": active_order["id"],
                "status": active_order["status"],
                "position": active_order["position"],
            }), 409

        params = {
            **validated_pages,
            "refresh": is_refresh,
            "source_order_id": source_order_id if is_refresh else None,
            "ai_config_snapshot": get_ai_snapshot(store),
        }
        params["ai_snapshot"] = get_ai_snapshot(store)

        try:
            order, idempotent_replay = store.purchase_order(
                user_id=user_id,
                buyer_id=buyer_uid,
                report_type=report_type,
                params=params,
                username=str(data.get("username", "")),
                username_html=str(data.get("username_html", "")),
                avatar=str(data.get("avatar", "")),
                visibility=visibility,
                signature_data=str(data.get("signature_data", "")),
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                cost=discounted_cost,
                credits_charge=credits_needed,
                bonus_charge=bonus_use,
                provider=pay_provider,
            )
            # Списание промокода после успешной оплаты.
            # promo_replay_guard_v1: на идемпотентном реплее промо НЕ списываем
            # повторно — заказ уже существует и скидка уже учтена.
            if promo_code and order_discount > 0 and not idempotent_replay:
                _redeem_res = store.redeem_order_promo(buyer_uid, promo_code, order_discount)
                if _redeem_res.get("error"):
                    logger.warning("Промокод %s не списан после оплаты заказа %s: %s",
                                   promo_code, order_id, _redeem_res["error"])
        except ValueError as exc:
            if str(exc) == "insufficient_funds":
                bal = store.get_user(buyer_uid) or {}
                total_bal = bal.get("credits", 0) + bal.get("bonus_credits", 0)
                return jsonify({
                    "error": "Недостаточно средств",
                    "code": "insufficient_funds",
                    "balance": total_bal,
                    "credits": bal.get("credits", 0),
                    "bonus_credits": bal.get("bonus_credits", 0),
                    "need": credits_needed,
                    "bonus_used": bonus_use,
                }), 402
            if str(exc) == "idempotency_mismatch":
                return jsonify({
                    "error": "Idempotency-Key уже использован для другого запроса",
                    "code": "idempotency_key_conflict",
                }), 409
            raise
        except sqlite3.IntegrityError as exc:
            if "orders.buyer_id" in str(exc):
                active_order = store.get_active_order_by_buyer(buyer_uid)
                return jsonify({
                    "error": "У вас уже есть незавершённый заказ",
                    "code": "active_order_exists",
                    "active_order_id": active_order["id"] if active_order else None,
                    "status": active_order["status"] if active_order else None,
                    "position": active_order["position"] if active_order else 0,
                }), 409
            raise

        if idempotent_replay:
            replay_response = _order_response(order)
            replay_response["idempotent_replay"] = True
            return jsonify(replay_response), 200

        order_id = order["id"]
        share_token = None
        if visibility == "unlisted":
            share_token = secrets.token_urlsafe(32)
            with store._write() as c:
                c.execute(
                    "UPDATE orders SET share_token_hash=?, share_token_created_at=?, updated_at=? WHERE id=?",
                    (hashlib.sha256(share_token.encode()).hexdigest(), int(time.time()), int(time.time()), order_id),
                )
            order = store.get_order(order_id)

        # История досье: фиксируем аналитический объект + версию + событие + автограф.
        # Версии вечны, актуальная версия — у каждого владельца своя (см. AUTOGRAPH_HISTORY_PLAN.md).
        try:
            store.record_dossier_event(
                order_id=order_id,
                subject_user_id=user_id,
                report_type=report_type,
                owner_user_id=buyer_uid,
                result_path=None,
                visibility=visibility,
                is_update=bool(data.get("refresh")),
                subject_username=str(data.get("username", "")),
                subject_username_html=str(data.get("username_html", "")),
                subject_avatar=str(data.get("avatar", "")),
                actor_username=(buyer0 := store.get_user(buyer_uid) or {}).get("username", ""),
                actor_username_html=buyer0.get("username_html", "") if isinstance(buyer0, dict) else "",
                actor_avatar=buyer0.get("avatar", "") if isinstance(buyer0, dict) else "",
                signature_image=str(data.get("signature_data", "")),
            )
        except Exception as e:
            logger.error("Не удалось записать историю досье для заказа %s: %s", order_id, e)

        order = store.get_order(order_id)
        logger.info(
            "Создан заказ %s  user=%s  type=%s  buyer=%s  -%s  pos=%s  vis=%s",
            order_id, user_id, report_type, buyer_uid, cost, order.get("position"), visibility,
        )
        resp = _order_response(order)
        if share_token:
            resp["share_token"] = share_token
            resp["share_url"] = f"zelscan.html?order={order_id}&share={share_token}"
        if order_discount > 0:
            resp["promo_discount"] = order_discount
            resp["original_cost"] = cost
            resp["promo_code"] = promo_code
        return jsonify(resp), 201

    def _read_result(order):
        if order.get("status")==Status.DONE and order.get("result_path"):
            try:
                doc=json.loads(Path(order["result_path"]).read_text(encoding="utf-8"))
                # basic_tier_gate_v1: базовый тариф — только обзор, активность,
                # поведение. Секции психологии и анализа (ИИ-слой) не отдаём.
                if (order.get("report_type") or "basic")=="basic":
                    doc=_strip_full_only_sections(doc)
                return doc
            except Exception as e:logger.error("Не удалось прочитать результат %s: %s",order.get("id"),e)
        return None

    def _can_view(order, uid, share_token=""):
        if uid and str(order.get("buyer_id") or "")==str(uid):return "owner"
        if order.get("visibility")=="public" and order.get("status")==Status.DONE:return "public"
        if order.get("visibility")=="unlisted" and share_token and order.get("share_token_hash"):
            if secrets.compare_digest(hashlib.sha256(share_token.encode()).hexdigest(),order["share_token_hash"]):return "shared"
        return None

    def _dossier_viewer_key(uid):
        """Return a durable pseudonymous viewer key, never persisting raw browser IDs."""
        if uid:
            return f"u:{uid}"
        browser_id = (request.headers.get("X-Viewer-Id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", browser_id):
            return None
        return "b:" + hashlib.sha256(browser_id.encode("utf-8")).hexdigest()

    def _track_dossier_view(order, uid):
        # просмотры владельца не считаем: свои заходы не должны
        # накручивать счётчик его же досье
        if uid and str(order.get("buyer_id") or "") == str(uid):
            return int(order.get("view_count") or 0)
        viewer_key = _dossier_viewer_key(uid)
        if viewer_key is None:
            return int(order.get("view_count") or 0)
        # уникальный просмотр = один зритель в 24 часа
        return store.record_dossier_view(order["id"], viewer_key, window_seconds=86400)

    @app.route("/api/orders/<order_id>")
    def get_order(order_id: str):
        order=store.get_order(order_id)
        if not order:return jsonify({"error":"Заказ не найден"}),404
        uid,_=_require_auth(); share=request.headers.get("X-Share-Token","") or request.args.get("share","")
        access=_can_view(order,uid,share)
        if not access:return jsonify({"error":"Заказ не найден"}),404
        resp=_order_response(order); resp["access"]=access; resp["is_owner"]=access=="owner"; resp["result"]=_read_result(order)
        if resp["result"] is not None:
            resp["view_count"]=_track_dossier_view(order,uid)
        return jsonify(resp)

    @app.route("/api/public/dossiers")
    def public_dossiers():
        q=(request.args.get("q") or "").strip(); like=f"%{q}%"
        limit=min(max(int(request.args.get("limit",24)),1),60)
        offset=max(int(request.args.get("offset",0)),0)
        sort=request.args.get("sort","new")
        order_sql=("view_count DESC, COALESCE(updated_at,finished_at,created_at) DESC" if sort=="popular" else "LOWER(COALESCE(username,'')) ASC, user_id ASC" if sort=="alphabet" else "COALESCE(updated_at,finished_at,created_at) DESC")
        where="visibility='public' AND status='done' AND deleted_at IS NULL AND (?='' OR username LIKE ? OR CAST(user_id AS TEXT) LIKE ?)"
        c=store._conn(); total=c.execute(f"SELECT COUNT(*) FROM orders WHERE {where}",(q,like,like)).fetchone()[0]
        rows=c.execute(f"SELECT * FROM orders WHERE {where} ORDER BY {order_sql} LIMIT ? OFFSET ?",(q,like,like,limit,offset)).fetchall()
        items=[]
        for row in rows:
            o=store._hydrate(row); d=_read_result(o) or {}; em=(d.get("portrait") or {}).get("emotion") or {}; empathy=d.get("empathy") or {}; cnt=int(empathy.get("count") or 0); escore=0 if cnt==0 else 3 if cnt<=2 else 6 if cnt<=5 else 8 if cnt<=10 else 10
            items.append({**_public_order_response(o),"summary":((d.get("verdict") or {}).get("summary") if isinstance(d.get("verdict"),dict) else "") or "","metrics":{"conflict":((d.get("portrait") or {}).get("conflict") or {}).get("score",0),"toxic":em.get("toxic_pct",0),"neutral":em.get("neutral_pct",0),"empathy":escore}})
        return jsonify({"dossiers":items,"total":total,"limit":limit,"offset":offset,"has_more":offset+len(items)<total})

    @app.route("/api/public/dossiers/<display_id>")
    def public_dossier(display_id):
        row=store._conn().execute("SELECT * FROM orders WHERE display_id=? AND visibility='public' AND deleted_at IS NULL",(display_id,)).fetchone()
        if not row:return jsonify({"error":"Публичное досье не найдено"}),404
        o=store._hydrate(row); resp=_public_order_response(o); resp.update({"access":"public","is_owner":False,"result":_read_result(o)})
        if resp["result"] is not None:
            uid,_=_require_auth()
            resp["view_count"]=_track_dossier_view(o,uid)
        return jsonify(resp)

    @app.route("/api/dossiers/<subject_id>/history")
    def dossier_history(subject_id):
        """GET /api/dossiers/<subject_id>/history
        История досье: участники и подписи видны всем; переход к версии (can_open_version)
        разрешён только к своей версии, публичной или доступной по share_token.
        Смена видимости в истории не отображается (только в админ-логах).
        """
        raw = store.get_dossier_history(subject_id)
        uid, _ = _require_auth()
        share = request.headers.get("X-Share-Token", "") or request.args.get("share", "")

        # Do not disclose dossier existence or history metadata before access is established.
        history_access = False
        if raw:
            for e in raw["events"]:
                order_id = e.get("v_order_id")
                order = store.get_order(order_id) if order_id else None
                if order and _can_view(order, uid, share):
                    history_access = True
                    break
        if not history_access:
            return jsonify({"error":"Заказ не найден"}),404

        share_hash = hashlib.sha256(share.encode()).hexdigest() if share else ""
        subj = raw["subject"]
        created_at = raw["events"][0]["created_at"] if raw["events"] else subj.get("created_at")
        last_updated_at = raw["events"][-1]["created_at"] if raw["events"] else subj.get("updated_at")

        events_out = []
        for e in raw["events"]:
            can_open = False
            v_order_id = e.get("v_order_id")
            v_visibility = e.get("v_visibility")
            v_owner = e.get("v_owner_id")
            live_order = store.get_order(v_order_id) if v_order_id else None
            version_path = e.get("v_result_path")
            result_available = bool(
                (live_order and _read_result(live_order) is not None)
                or (version_path and Path(version_path).is_file())
            )
            if result_available and uid and str(v_owner or "") == str(uid):
                can_open = True
            elif result_available and v_visibility == "public":
                can_open = True
            elif result_available and v_visibility == "unlisted" and share_hash and live_order:
                if live_order.get("share_token_hash") and secrets.compare_digest(share_hash, live_order["share_token_hash"]):
                    can_open = True
            autograph = None
            if e.get("a_signature"):
                autograph = {"signature_image": e["a_signature"], "signed_at": e.get("a_signed_at")}
            events_out.append({
                "id":         e["id"],
                "type":       e["type"],
                "role":       e["role"],
                "actor": {
                    "username":      e.get("actor_username_snapshot") or "",
                    "username_html": e.get("actor_username_html_snapshot") or "",
                    "avatar":        e.get("actor_avatar_snapshot") or "",
                },
                "created_at":          e["created_at"],
                "is_current_version":  bool(e.get("v_is_current")),
                "can_open_version":    can_open,
                "version_order_id":    v_order_id if can_open else None,
                "version_state":       "available" if result_available else "result_unavailable",
                "result_available":    result_available,
                "autograph":           autograph,
            })

        return jsonify({
            "subject_id": subject_id,
            "subject": {
                "subject_username":      subj.get("subject_username_snapshot") or "",
                "subject_username_html": subj.get("subject_username_html_snapshot") or "",
                "subject_avatar":        subj.get("subject_avatar_snapshot") or "",
                "report_type":           subj.get("report_type", "basic"),
            },
            "status_line": {
                "created_at":      created_at,
                "last_updated_at": last_updated_at,
                "owners_count":    subj.get("owners_count", 0),
            },
            "events": events_out,
        })

    @app.delete("/api/my/orders/<order_id>")
    def my_order_delete(order_id):
        uid,_=_require_auth()
        if not uid:return jsonify({"error":"Требуется авторизация"}),401
        with store._write() as c:
            cur=c.execute("UPDATE orders SET deleted_at=?,visibility='private',share_token_hash=NULL,share_token_created_at=NULL,updated_at=? WHERE id=? AND buyer_id=?",(int(time.time()),int(time.time()),order_id,str(uid)))
            orders_affected=cur.rowcount
            # Также убираем запись из истории досье (dossier_versions), иначе
            # "осиротевшие" версии без строки в orders продолжают висеть в списке "Мои досье".
            ver=c.execute("DELETE FROM dossier_versions WHERE order_id=? AND owner_user_id=?",(order_id,uid))
            versions_affected=ver.rowcount
        if not orders_affected and not versions_affected:return jsonify({"error":"Досье не найдено"}),404
        return jsonify({"ok":True})

    @app.patch("/api/my/orders/<order_id>/visibility")
    def my_order_visibility(order_id):
        uid,_=_require_auth(); d=request.get_json(silent=True) or {}; visibility=d.get("visibility")
        if not uid:return jsonify({"error":"Требуется авторизация"}),401
        if visibility not in ("private","unlisted","public"):return jsonify({"error":"Неизвестный режим доступа"}),400
        o=store.get_order(order_id)
        if not o or str(o.get("buyer_id"))!=str(uid):return jsonify({"error":"Досье не найдено"}),404
        with store._write() as c:
            c.execute("UPDATE orders SET visibility=?,updated_at=? WHERE id=?",(visibility,int(time.time()),order_id))
            if visibility=="private":c.execute("UPDATE orders SET share_token_hash=NULL,share_token_created_at=NULL WHERE id=?",(order_id,))
        return jsonify({"ok":True,"order":_order_response(store.get_order(order_id))})

    @app.post("/api/my/orders/<order_id>/share-link")
    def my_order_share(order_id):
        uid,_=_require_auth()
        if not uid:return jsonify({"error":"Требуется авторизация"}),401
        o=store.get_order(order_id)
        if not o or str(o.get("buyer_id"))!=str(uid):return jsonify({"error":"Досье не найдено"}),404
        token=secrets.token_urlsafe(32)
        with store._write() as c:c.execute("UPDATE orders SET visibility='unlisted',share_token_hash=?,share_token_created_at=?,updated_at=? WHERE id=?",(hashlib.sha256(token.encode()).hexdigest(),int(time.time()),int(time.time()),order_id))
        return jsonify({"ok":True,"share_token":token,"share_url":f"zelscan.html?order={order_id}&share={token}"})

    @app.delete("/api/my/orders/<order_id>/share-link")
    def my_order_unshare(order_id):
        uid,_=_require_auth()
        if not uid:return jsonify({"error":"Требуется авторизация"}),401
        with store._write() as c:
            cur=c.execute("UPDATE orders SET visibility='private',share_token_hash=NULL,share_token_created_at=NULL,updated_at=? WHERE id=? AND buyer_id=?",(int(time.time()),order_id,str(uid)))
        if not cur.rowcount:return jsonify({"error":"Досье не найдено"}),404
        return jsonify({"ok":True})

    @app.route("/api/orders")
    def list_orders_endpoint():
        uid,_=_require_auth()
        if not uid:return jsonify({"error":"Требуется авторизация"}),401
        if int(uid) != NEWS_ADMIN_UID:
            return jsonify({"error":"Доступ только для администратора"}),403
        limit  = min(int(request.args.get("limit", 50)), 200)
        status = request.args.get("status") or None
        orders = store.list_orders(limit=limit, status=status)
        return jsonify({"orders": [_order_response(o) for o in orders]})

    # ── MY (авторизованный юзер) ─────────────────────────────────────────────

    @app.route("/api/my/orders")
    def my_orders():
        """GET /api/my/orders?limit=20&offset=0&status=done
        Заказы текущего авторизованного юзера.
        """
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401

        limit  = min(int(request.args.get("limit",  20)), 100)
        offset = max(int(request.args.get("offset",  0)),   0)
        status = request.args.get("status") or None

        orders = store.get_orders_by_buyer(uid, limit=limit, offset=offset, status=status)
        total = store.count_orders_by_buyer(uid, status=status)
        return jsonify({
            "orders": [_order_response(o) for o in orders],
            "total":  total,
            "limit":  limit,
            "offset": offset,
        })

    @app.route("/api/my/profile")
    def my_profile():
        """GET /api/my/profile — профиль + кредиты + статистика заказов."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401

        user = store.get_user(uid)
        if not user:
            return jsonify({"error": "Пользователь не найден в БД"}), 404

        stats = store.get_user_stats(uid)
        visible = store.get_visible_dossiers_count(uid)
        auth_user = request.environ.get("zelscan.auth_user") or {}
        username_html = str(auth_user.get("username_html") or user.get("username_html") or "")
        if "<" not in username_html:
            username_html = ""
        return jsonify({
            "user_id":       user["user_id"],
            "username":      user["username"],
            "username_html": username_html,
            "avatar":        user["avatar"],
            "message_count": user["message_count"],
            "is_banned":     bool(user["is_banned"]),
            "credits":       user["credits"],
            "bonus_credits": user.get("bonus_credits", 0.0),
            "first_seen":    user["first_seen"],
            "last_seen":     user["last_seen"],
            "stats":         stats,
            "visible_dossiers": visible,
        })

    @app.route("/api/my/transactions")
    def my_transactions():
        """GET /api/my/transactions?limit=50&offset=0&kind=topup|charge."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401

        limit = min(max(int(request.args.get("limit", 50)), 1), 200)
        offset = max(int(request.args.get("offset", 0)), 0)
        kind = request.args.get("kind") or None
        if kind not in (None, "topup", "charge", "refund"):
            return jsonify({"error": "Неизвестный тип транзакции"}), 400

        items = store.list_transactions(uid, limit=limit, offset=offset, kind=kind)
        total = store.count_transactions(uid, kind=kind)
        return jsonify({"transactions": items, "total": total, "limit": limit, "offset": offset})

    def _lzt_market_request(path: str, *, payload: dict = None):
        """Запрос к api.lzt.market от имени мерчанта. Возвращает (dict, err_response)."""
        import urllib.request as _ur
        import urllib.error   as _ue
        url = "https://api.lzt.market" + path
        headers = {
            "User-Agent":    "Zelscan/1.0",
            "Authorization": f"Bearer {config.LOLZ_MARKET_TOKEN}",
        }
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = _ur.Request(url, data=data, headers=headers, method="POST" if payload is not None else "GET")
        try:
            with _ur.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read()), None
        except _ue.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            logger.warning("lzt.market %s HTTP %s: %s", path, e.code, detail)
            return None, (502, {"error": f"Ошибка Lolz Market (HTTP {e.code})", "detail": detail})
        except Exception as e:
            logger.error("lzt.market %s error: %s", path, e)
            return None, (502, {"error": "Ошибка запроса к Lolz Market", "detail": str(e)})

    def _reconcile_pending_topups(uid: int):
        """Догасить pending-пополнения юзера. Возвращает сумму зачисленного."""
        credited_total = 0.0
        rows = store.get_transactions(uid, limit=10, kind="topup") or []
        for tx in rows:
            if tx.get("provider") != "lzt_market" or tx.get("status") not in ("pending", "failed"):
                continue
            desc = tx.get("description") or ""
            if "Invoice #" not in desc:
                continue
            try:
                invoice_id = desc.split("Invoice #")[1].split(" ")[0].strip("()")
            except Exception:
                continue
            res, err = _lzt_market_request(f"/invoice?invoice_id={invoice_id}")
            age = int(time.time()) - int(tx.get("created_at") or 0)
            if err or not isinstance(res, dict):
                # счёт не найден на стороне форума. Если транзакция свежая —
                # возможно лаг репликации, не роняем; старую закрываем.
                if age > 120:
                    amount = float(tx.get("amount_rub") or 0)
                    store.fail_transaction(tx["id"])
                    _topup_set_notification(uid, tx["id"], paid=False,
                        amount=amount, invoice_id=invoice_id)
                continue
            inv = res.get("invoice") or {}
            status = (inv.get("status") or "").lower()
            if status == "paid" or int(inv.get("paid_date") or 0) > 0:
                amount = float(inv.get("amount") or tx.get("amount_rub") or 0)
                done = store.complete_transaction(tx["id"], amount)
                if done:
                    store.add_credits(uid, amount)
                    credited_total += amount
                    _topup_set_notification(uid, tx["id"], paid=True,
                        amount=amount, invoice_id=invoice_id)
                    logger.info("Догашен инвойс user=%s invoice=%s +%s", uid, invoice_id, amount)
        return credited_total

    def _topup_set_notification(uid: int, tx_id: str, *, paid: bool,
                                amount: float, invoice_id, url: str = "") -> None:
        """Статус платежа пишется В ТО ЖЕ уведомление (dedupe topup:{tx_id}):
        создано → оплачено / отменено. Новых уведомлений по ходу не появляется."""
        key = f"topup:{tx_id}"
        if paid:
            done = store.update_notification_by_dedupe(uid, key,
                title="Баланс пополнен",
                body=f"+{amount:g} ₽ зачислены на баланс Zelscan",
                meta={"invoice_id": invoice_id, "amount": amount, "status": "paid"})
            if not done:
                try:
                    store.create_notification(uid, "balance_topup",
                        title="Баланс пополнен",
                        body=f"+{amount:g} ₽ зачислены на баланс Zelscan",
                        meta={"amount": amount, "invoice_id": invoice_id})
                except Exception:
                    pass
        else:
            store.update_notification_by_dedupe(uid, key,
                title="Платёж отменён",
                body="Счёт истёк или был отменён — создай новый",
                meta={"invoice_id": invoice_id, "amount": amount, "status": "failed"})

    @app.route("/api/my/topup-pending")
    def topup_pending():
        """GET /api/my/topup-pending → догасить брошенные инвойсы юзера
        (загрузка страницы). Возвращает сумму, зачисленную при этом вызове."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        credited = _reconcile_pending_topups(uid)
        return jsonify({"credited": credited})

    @app.route("/api/my/topup-intent", methods=["POST"])
    def topup_intent():
        """Создать инвойс Lolz Market на пополнение баланса (1 ₽ = 1 кредит).
        Возвращает invoice_id и ссылку на страницу оплаты."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        try:
            amount = int(data.get("amount", 0))
        except (TypeError, ValueError):
            amount = 0
        if amount < 10 or amount > 100000:
            return jsonify({"error": "Сумма должна быть от 10 до 100 000 ₽"}), 400

        _cap = _captcha_guard()
        if _cap:
            return _cap

        if not config.LOLZ_MARKET_TOKEN or not config.LOLZ_MERCHANT_ID:
            return jsonify({"error": "Мерчант не настроен", "configured": False}), 503

        # убедимся, что юзер есть в БД (логин мог не создасть строку)
        if not store.get_user(uid):
            store.upsert_user(uid, "", "", 0, False)

        # закрыть хвосты: если прошлый инвойс уже оплачен, а модалку закрыли — начислить
        _reconcile_pending_topups(uid)

        payment_id = f"zelscan-{uid}-{int(time.time() * 1000)}"
        success_url = config.LOLZ_TOPUP_SUCCESS_URL

        res, err = _lzt_market_request("/invoice", payload={
            "currency":    "rub",
            "amount":      amount,
            "payment_id":  payment_id,
            "comment":     f"Пополнение Zelscan (user {uid})",
            "url_success": success_url,
            "merchant_id": int(config.LOLZ_MERCHANT_ID),
            "lifetime":    3600,
        })
        if err:
            return jsonify(err[1]), err[0]

        invoice = res.get("invoice") or {}
        invoice_id = invoice.get("invoice_id")
        url = invoice.get("url")
        if not invoice_id or not url:
            return jsonify({"error": "Некорректный ответ Lolz Market"}), 502

        tx = store.create_transaction(
            uid, "topup",
            amount_rub=amount, credits=0,
            status="pending", provider="lzt_market",
            description=f"Invoice #{invoice_id} ({payment_id})",
        )
        try:
            store.create_notification(uid, "balance_topup",
                title="Платёж создан",
                body=f"Счёт на {amount} ₽ — открой уведомление, чтобы оплатить",
                meta={"dedupe_key": f"topup:{tx['id']}", "invoice_id": invoice_id,
                      "tx_id": tx["id"], "url": url, "amount": amount,
                      "status": "pending"})
        except Exception:
            pass
        logger.info("Инвойс создан user=%s amount=%s invoice=%s", uid, amount, invoice_id)
        return jsonify({
            "ok": True,
            "tx_id": tx["id"],
            "invoice_id": invoice_id,
            "url": url,
            "amount": amount,
            "expires_at": invoice.get("expires_at"),
        })

    @app.route("/api/my/topup-cancel", methods=["POST"])
    def topup_cancel():
        """POST /api/my/topup-cancel {tx_id} → платёж помечается отменённым.
        Инвойс на стороне форума остаётся действующим до истечения: если он
        всё-таки будет оплачен — средства зачислятся при сверке."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        data = request.get_json(silent=True) or {}
        tx_id = (data.get("tx_id") or "").strip()
        tx = store.get_transaction(tx_id) if tx_id else None
        if not tx or int(tx.get("user_id", 0)) != int(uid):
            return jsonify({"error": "Транзакция не найдена"}), 404
        if tx.get("status") != "pending":
            return jsonify({"ok": True, "status": tx.get("status")})
        store.fail_transaction(tx_id)
        desc = tx.get("description") or ""
        invoice_id = desc.split("Invoice #")[1].split(" ")[0].strip("()") if "Invoice #" in desc else ""
        _topup_set_notification(uid, tx_id, paid=False,
            amount=float(tx.get("amount_rub") or 0), invoice_id=invoice_id)
        return jsonify({"ok": True, "status": "failed"})

    @app.route("/api/my/topup-status")
    def topup_status():
        """GET /api/my/topup-status?invoice_id=&tx_id= → статус инвойса.
        При оплате начисляет кредиты (однократно) и возвращает новый баланс."""
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Требуется авторизация"}), 401
        invoice_id = (request.args.get("invoice_id") or "").strip()
        tx_id = (request.args.get("tx_id") or "").strip()
        tx = store.get_transaction(tx_id) if tx_id else None
        if not tx or int(tx.get("user_id", 0)) != int(uid):
            return jsonify({"error": "Транзакция не найдена"}), 404
        if tx.get("status") == "completed":
            user = store.get_user(uid)
            return jsonify({"status": "completed", "balance": (user or {}).get("credits", 0.0)})
        if tx.get("status") == "failed":
            return jsonify({"status": "failed"})

        res, err = _lzt_market_request(f"/invoice?invoice_id={invoice_id}")
        age = int(time.time()) - int(tx.get("created_at") or 0)
        if err:
            # счёт не найден на стороне форума. Свежую транзакцию не роняем —
            # возможен лаг репликации market; старую закрываем.
            if age > 120:
                amount = float(tx.get("amount_rub") or 0)
                store.fail_transaction(tx_id)
                _topup_set_notification(uid, tx_id, paid=False,
                    amount=amount, invoice_id=invoice_id)
                return jsonify({"status": "failed"})
            return jsonify({"status": "pending"})

        inv = res.get("invoice") or {}
        status = (inv.get("status") or "").lower()
        paid = status == "paid" or (status == "process" and int(inv.get("paid_date") or 0) > 0)
        amount = float(inv.get("amount") or tx.get("amount_rub") or 0)
        if paid:
            done = store.complete_transaction(tx_id, amount)
            user = store.get_user(uid)
            if done:
                store.add_credits(uid, amount)
                _topup_set_notification(uid, tx_id, paid=True,
                    amount=amount, invoice_id=invoice_id)
                logger.info("Инвойс оплачен user=%s invoice=%s +%s", uid, invoice_id, amount)
                return jsonify({"status": "completed", "balance": (user or {}).get("credits", 0.0), "just_credited": True})
            return jsonify({"status": "completed", "balance": (user or {}).get("credits", 0.0)})
        if status in ("cancelled", "expired", "fail"):
            store.fail_transaction(tx_id)
            _topup_set_notification(uid, tx_id, paid=False,
                amount=float(inv.get("amount") or tx.get("amount_rub") or 0), invoice_id=invoice_id)
            return jsonify({"status": "failed"})
        return jsonify({"status": "pending"})

    # ── PAYMENT stub ──────────────────────────────────────────────────────────

    @app.route("/api/my/preview-promo", methods=["POST"])
    def preview_promo():
        """Preview скидки промокода типа 'order' (не списывает промокод)."""
        if not _check_rate(5):
            return jsonify({"error": "Too many attempts"}), 429
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Authorization required"}), 401
        data = request.get_json(silent=True) or {}
        code = (data.get("code") or "").strip()
        if not code:
            return jsonify({"error": "Введите промокод"}), 400
        report_type = data.get("report_type", "basic")
        if report_type not in ("basic", "full"):
            return jsonify({"error": "report_type: 'basic' или 'full'"}), 400
        cost = config.CREDIT_COST_FULL if report_type == "full" else config.CREDIT_COST_BASIC
        result = store.validate_order_promo(uid, code, cost)
        if result.get("error"):
            return jsonify(result), 400
        return jsonify(result), 200

    @app.route("/api/my/redeem-promo", methods=["POST"])
    def redeem_promo():
        if not _check_rate(2):
            return jsonify({"error": "Too many attempts"}), 429
        uid, _ = _require_auth()
        if not uid:
            return jsonify({"error": "Authorization required"}), 401
        data = request.get_json(silent=True) or {}
        code = (data.get("code") or "").strip()
        if not code:
            return jsonify({"error": "Enter a promo code"}), 400

        _cap = _captcha_guard()
        if _cap:
            return _cap

        if not store.get_user(uid):
            store.upsert_user(uid, "", "", 0, False)

        result = store.redeem_promo(uid, code)
        if result.get("error"):
            return jsonify(result), 400

        bonus = result["bonus"]
        store.create_transaction(
            uid, "bonus",
            amount_rub=0, credits=bonus,
            status="completed", provider="promo",
            description=f"Promo {code.upper()}: +{bonus:g}",
        )
        logger.info("promo user=%s code=%s +%s bonus=%s",
                    uid, code.upper(), bonus, result["balance"])
        return jsonify({
            "ok": True,
            "bonus": bonus,
            "balance": result["balance"],
        })

    @app.route("/api/payment/stub/<order_id>", methods=["POST"])
    def payment_stub(order_id: str):
        """Ручное подтверждение оплаты только в безопасном тестовом режиме."""
        if not (app.testing or app.config.get("ENABLE_SAFE_PAYMENT_STUB", False)):
            uid, _ = _require_auth()
            if not uid:
                return jsonify({"error": "Не найдено"}), 404
            return jsonify({"error": "Доступ запрещён"}), 403
        ok = store.mark_paid(order_id)
        if not ok:
            return jsonify({"error": "Заказ не найден или уже оплачен"}), 404
        order = store.get_order(order_id)
        return jsonify({"ok": True, "order": _order_response(order)})

    # ── HEALTH ────────────────────────────────────────────────────────────────

    @app.route("/api/health")
    def health():
        search_tokens   = config.load_lolz_tokens("search")
        messages_tokens = config.load_lolz_tokens("messages")
        profile_tokens  = config.load_lolz_tokens("profile")
        try:
            from ai_interpreter import get_auth_key, get_deepseek_key
            has_giga     = bool(get_auth_key())
            has_deepseek = bool(get_deepseek_key())
        except Exception:
            has_giga = has_deepseek = False

        return jsonify({
            "ok":           True,
            # legacy-поле: суммарное число токенов (для старого фронта)
            "lolz_tokens":  len(search_tokens) + len(messages_tokens) + len(profile_tokens),
            # новое: раздельно по ролям
            "lolz_tokens_search":   len(search_tokens),
            "lolz_tokens_messages": len(messages_tokens),
            "lolz_tokens_profile":  len(profile_tokens),
            "gigachat":     has_giga,
            "deepseek":     has_deepseek,
            "queue_size":   store.queue_size(),
            "active_order": worker.active_order_id,
            "db":           str(config.DB_PATH),
            "timestamp":    int(time.time()),
        })

    # ── LEGACY aliases (совместимость с текущим фронтом) ─────────────────────

    @app.route("/api/queue", methods=["POST"])
    def legacy_queue_post():
        return create_order()

    @app.route("/api/queue/<task_id>")
    def legacy_queue_get(task_id: str):
        # Совместимость: старый фронт ждёт поле "task_id" и "result"
        return get_order(task_id)

    @app.route("/api/queue")
    def legacy_queue_list():
        return list_orders_endpoint()

    return app


# ── helpers ───────────────────────────────────────────────────────────────────

def _clamp(v, lo, hi):
    try:
        return max(lo, min(hi, v))
    except Exception:
        return lo


# basic_tier_gate_v1: секции, которые в базовом тарифе не отдаются
# (страницы «Психология» и «Анализ» — только для полного).
# ai остаётся в базовом тарифе: им живут блоки обзора (триада, Big Five,
# теги). empathy тоже нужен — плитка «Эмпатия» на обзоре. Базовому не
# отдаём admit_mistakes и psychological_age (страницы психологии/анализа).
_FULL_ONLY_DOC_KEYS = ("admit_mistakes",)

def _turnstile_verify(token: str, remote_ip: str = "") -> bool:
    """Cloudflare Turnstile: True если капча выключена или токен валиден."""
    if not config.TURNSTILE_ENABLED:
        return True
    if not token:
        return False
    try:
        r = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": config.TURNSTILE_SECRET, "response": token,
                  "remoteip": remote_ip or ""},
            timeout=10,
        )
        return bool(r.json().get("success"))
    except Exception:
        logger.exception("Turnstile siteverify failed")
        return False


def _captcha_token() -> str:
    return request.headers.get("X-Turnstile-Token", "") or            (request.get_json(silent=True) or {}).get("captcha_token", "")


def _captcha_guard():
    """Вернуть (jsonify, 400) при провале капчи, иначе None."""
    if not _turnstile_verify(_captcha_token(), request.remote_addr or ""):
        return jsonify({"error": "Капча не пройдена — подтвердите, что вы не робот",
                        "code": "captcha_failed"}), 400
    return None


def _strip_full_only_sections(doc):
    if not isinstance(doc, dict):
        return doc
    doc = {k: v for k, v in doc.items() if k not in _FULL_ONLY_DOC_KEYS}
    portrait = doc.get("portrait")
    if isinstance(portrait, dict) and "psychological_age" in portrait:
        portrait = dict(portrait)
        portrait.pop("psychological_age", None)
        doc["portrait"] = portrait
    return doc


def _order_report_summary(user_id, report_type):
    """Краткая сводка готового отчёта для карточки досье, либо None.

    Источники по приоритету: кэш досье (v2 → легаси) → файл готового отчёта
    последнего выполненного заказа (важно для локальной версии, где кэш-сводок нет).
    """
    rep = None
    try:
        v2, legacy = config.dossier_cache_candidates(user_id, report_type)
        path = v2 if v2.exists() else legacy
        if path.exists():
            rep = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        rep = None
    if rep is None:
        try:
            import sqlite3
            con = sqlite3.connect(str(config.PROJECT_ROOT / 'zelscan.db'))
            row = con.execute(
                "SELECT result_path FROM orders WHERE user_id=? AND report_type=? AND status='done'"
                ' ORDER BY created_at DESC LIMIT 1',
                (user_id, report_type or 'basic')).fetchone()
            con.close()
            if row and row[0]:
                # result_path хранит абсолютный путь исходного сервера —
                # берём только имя файла и ищем в локальном cache/results
                local = config.RESULTS_DIR / Path(row[0]).name
                if local.exists():
                    rep = json.loads(local.read_text(encoding='utf-8'))
        except Exception:
            return None
        if rep is None:
            return None
    try:
        raw = rep.get('raw_stats') or {}
        act = rep.get('activity') or {}
        por = rep.get('portrait') or {}
        repu = rep.get('reputation_disputes') or {}
        conf = (por.get('confidence') or {}).get('score')
        ego = (por.get('ego') or {}).get('per_100')
        confl = (por.get('conflict') or {}).get('score')
        wall = act.get('wall_posts_total')
        if wall is None:
            wall = raw.get('wall_posts_fetched')
        raw_tags = por.get('архетипы') or por.get('archetypes') or []
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        report_tags = []
        if isinstance(raw_tags, (list, tuple)):
            for tag in raw_tags:
                value = str(tag or '').strip()
                if value and value not in report_tags:
                    report_tags.append(value)
                if len(report_tags) == 2:
                    break
        return {
            'tags': report_tags,
            'reputation_score': repu.get('score'),
            'reputation_color': repu.get('level_color'),
            'topics':   raw.get('threads_fetched'),
            'messages': raw.get('message_count'),
            'wall':     wall,
            'likes':    raw.get('like_count'),
            'confidence': round(_clamp(conf, 0, 100)) if conf is not None else None,
            'ego':        round(_clamp(ego, 0, 10) * 10) if ego is not None else None,
            'conflict':   round(_clamp(confl, 0, 10) * 10) if confl is not None else None,
        }
    except Exception:
        return None


def _clamp(v, lo, hi):
    try:
        return max(lo, min(hi, v))
    except Exception:
        return lo


def _order_report_summary(user_id, report_type):
    """Краткая сводка готового отчёта для карточки досье, либо None.

    Источники по приоритету: кэш досье (v2 → легаси) → файл готового отчёта
    последнего выполненного заказа (важно для локальной версии, где кэш-сводок нет).
    """
    rep = None
    try:
        v2, legacy = config.dossier_cache_candidates(user_id, report_type)
        path = v2 if v2.exists() else legacy
        if path.exists():
            rep = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        rep = None
    if rep is None:
        try:
            import sqlite3
            con = sqlite3.connect(str(config.PROJECT_ROOT / 'zelscan.db'))
            row = con.execute(
                "SELECT result_path FROM orders WHERE user_id=? AND report_type=? AND status='done'"
                ' ORDER BY created_at DESC LIMIT 1',
                (user_id, report_type or 'basic')).fetchone()
            con.close()
            if row and row[0]:
                local = config.RESULTS_DIR / Path(row[0]).name
                if local.exists():
                    rep = json.loads(local.read_text(encoding='utf-8'))
        except Exception:
            return None
        if rep is None:
            return None
    try:
        raw = rep.get('raw_stats') or {}
        act = rep.get('activity') or {}
        por = rep.get('portrait') or {}
        repu = rep.get('reputation_disputes') or {}
        conf = (por.get('confidence') or {}).get('score')
        ego = (por.get('ego') or {}).get('per_100')
        confl = (por.get('conflict') or {}).get('score')
        wall = act.get('wall_posts_total')
        if wall is None:
            wall = raw.get('wall_posts_fetched')
        raw_tags = por.get('архетипы') or por.get('archetypes') or []
        if isinstance(raw_tags, str):
            raw_tags = [raw_tags]
        report_tags = []
        if isinstance(raw_tags, (list, tuple)):
            for tag in raw_tags:
                value = str(tag or '').strip()
                if value and value not in report_tags:
                    report_tags.append(value)
                if len(report_tags) == 2:
                    break
        return {
            'tags': report_tags,
            'reputation_score': repu.get('score'),
            'reputation_color': repu.get('level_color'),
            'topics':   raw.get('threads_fetched'),
            'messages': raw.get('message_count'),
            'wall':     wall,
            'likes':    raw.get('like_count'),
            'confidence': round(_clamp(conf, 0, 100)) if conf is not None else None,
            'ego':        round(_clamp(ego, 0, 10) * 10) if ego is not None else None,
            'conflict':   round(_clamp(confl, 0, 10) * 10) if confl is not None else None,
        }
    except Exception:
        return None


def _order_response(order: dict) -> dict:
    buyer_id = str(order.get("buyer_id") or "")
    buyer = {}
    if buyer_id:
        try:
            buyer = store.get_user(int(buyer_id)) or {}
        except Exception:
            buyer = {}
    report_summary = None
    username_html = ""
    subject_id = None
    try:
        if order.get("status") == "done":
            report_summary = _order_report_summary(order["user_id"], order.get("report_type", "basic"))
        _u = store.get_user(int(order["user_id"])) or {}
        username_html = _u.get("username_html") or ""
    except Exception:
        pass
    try:
        subject_id = store.get_subject_id_for_order(order)
    except Exception:
        subject_id = None
    return {
        "subject_id":  order.get("subject_id") or subject_id,
        "order_id":    order["id"],
        "task_id":     order["id"],          # legacy compat
        "user_id":     order["user_id"],
        "username":    order.get("username") or "",
        "username_html": order.get("username_html") or "",
        "avatar":      order.get("avatar")   or "",
        "report_type": order.get("report_type", "basic"),
        "status":      order["status"],
        "position":    order.get("position", 0),
        "progress":    order.get("progress") or {},
        "error":       order.get("error"),
        "created_at":  order.get("created_at"),
        "started_at":  order.get("started_at"),
        "finished_at": order.get("finished_at"),
        "display_id":   order.get("display_id") or ("ZS-"+order["id"][:8].upper()),
        "visibility":   order.get("visibility","private"),
        "view_count":   order.get("view_count",0),
        "signature_data": order.get("signature_data") or "",
        "report":        report_summary,
        "username_html": username_html,
        "buyer_id":     buyer_id,
        "buyer_name":   buyer.get("username") or "",
        "buyer_avatar": buyer.get("avatar") or "",
        "is_archived": bool(order.get("is_archived", False)),
        "result_available": bool(order.get("result_available", order.get("result_path"))),
        "collected_message_count": order.get("collected_message_count"),
        "collected_message_counts": order.get("collected_message_counts") or {},
        "can_open": bool(order.get("can_open", True)),
        "archive_state": order.get("archive_state"),
    }


_PUBLIC_STRIP_FIELDS = ("buyer_id", "buyer",
                        "charge_credits", "charge_bonus",
                        "payment_id", "paid_at", "refunded_at", "idempotency_key",
                        "request_hash", "params", "share_token_hash")


def _public_order_response(order: dict) -> dict:
    resp = _order_response(order)
    for k in _PUBLIC_STRIP_FIELDS:
        resp.pop(k, None)
    return resp


def _load_tokens() -> list[str]:
    # Роль "search": токены для поиска / профиля / аватаров / forum-status
    # (secrets/search/*). Отдельно от тяжёлого парсинга сообщений (messages),
    # чтобы поиск не съедал лимиты у анализа и наоборот.
    return config.load_lolz_tokens("search")


# ── entrypoint ────────────────────────────────────────────────────────────────
app = create_app()

# zelscan-current-user-forum-status-v2
@app.route('/api/me/forum-status')
def api_me_forum_status():
    """Return public forum status data for an authenticated Zelscan account ID."""
    raw_id = (request.args.get('user_id') or '').strip()
    try:
        user_id = int(raw_id)
    except (TypeError, ValueError):
        return jsonify({'error': 'user_id_required'}), 400
    if user_id <= 0:
        return jsonify({'error': 'user_id_required'}), 400
    try:
        from lolz_analyzer import LolzAnalyzer
        analyzer = LolzAnalyzer(tokens=_load_tokens())
        payload = analyzer._get(
            f'/users/{user_id}',
            token_idx=2,
            headers={'Api-Username-Inline-Style': '1'},
        )
        if not isinstance(payload, dict) or payload.get('_errors'):
            return jsonify({'error': 'forum_status_unavailable'}), 502
        user = payload.get('user', payload)
        return jsonify({
            'user_id': user.get('user_id', user_id),
            'username': user.get('username', ''),
            'username_html': user.get('username_html', ''),
            'user_title': user.get('user_title', ''),
            'user_group_id': user.get('user_group_id'),
        })
    except Exception as error:
        logger.warning('Forum status lookup failed for %s: %s', user_id, error)
        return jsonify({'error': 'forum_status_unavailable'}), 502

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("Zelscan v8  port=%d  db=%s", config.PORT, config.DB_PATH)
    tokens = _load_tokens()
    logger.info("Lolz tokens: %d", len(tokens))
    logger.info("Queue: MAX_CONCURRENT=%d", config.MAX_CONCURRENT)

    try:
        from waitress import serve
        logger.info("Запуск через waitress (production)")
        serve(app, host=config.HOST, port=config.PORT, threads=8)
    except ImportError:
        logger.warning("waitress не установлен → Flask dev server (не для прода!)")
        logger.warning("pip install waitress")
        app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG, threaded=True)

# zelscan-username-html-persistence-v1

# zelscan-dossier-report-tags-v1

# zelscan-report-summary-tags-duplicate-fix-v1
