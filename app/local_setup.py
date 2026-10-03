"""Локальная версия: стартовый визард + ручной режим заказа.

Визард (/api/local/setup) принимает ключи юзера и раскладывает их по местам:
токены LZT → secrets/<role>/, ключи AI → ai_providers (шифрование как в админке),
OAuth client_id/redirect → корневые файлы. До настройки фронт редиректит на /setup.

Ручной режим (/api/orders/manual) собирает досье офлайн — из данных, которые
юзер ввёл сам. Форум не запрашивается ни разу.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from flask import jsonify, request

import config
from admin_service import encrypt_secret

SETUP_MARKER = config.PROJECT_ROOT / ".local_setup_done"


def _configured() -> bool:
    return SETUP_MARKER.exists()


def _status() -> dict:
    done = {}
    if _configured():
        try:
            done = json.loads(SETUP_MARKER.read_text(encoding="utf-8"))
        except Exception:
            done = {}
    providers = {}
    try:
        import sqlite3
        con = sqlite3.connect(str(config.PROJECT_ROOT / "zelscan.db"))
        for pid, name, enc, enabled in con.execute(
            "SELECT id, name, encrypted_key, enabled FROM ai_providers"
        ):
            providers[pid] = {"name": name, "key_set": bool(enc), "enabled": bool(enabled)}
        con.close()
    except Exception:
        pass
    oauth_file = config.PROJECT_ROOT / ".lolz_oauth_client_id"
    return {
        "configured": _configured(),
        "mode": done.get("mode", ""),
        "lzt_tokens_set": bool(config.load_lolz_tokens("messages")),
        "providers": providers,
        "oauth_client_id_set": bool(config.LOLZ_OAUTH_CLIENT_ID or oauth_file.exists()),
        "oauth_redirect_uri": config.LOLZ_OAUTH_REDIRECT_URI
                              or "http://localhost:8080/oauth/callback",
    }


def install_local_setup(app, store, require_auth):
    def _write_role_tokens(tokens: list[str]) -> None:
        base = config.SECRETS_DIR
        for role in ("messages", "profile", "search"):
            role_dir = base / role
            role_dir.mkdir(parents=True, exist_ok=True)
            # чистим старые файлы роли, чтобы не осталось чужих токенов
            for old in role_dir.iterdir():
                if old.is_file() and not old.name.startswith("."):
                    old.unlink()
            for i, tok in enumerate(tokens):
                (role_dir / f"{i + 1:02d}.txt").write_text(tok.strip(), encoding="utf-8")

    def _set_provider_key(pid: str, key: str, enabled: bool = True) -> None:
        import sqlite3
        con = sqlite3.connect(str(config.PROJECT_ROOT / "zelscan.db"))
        con.execute(
            "UPDATE ai_providers SET encrypted_key=?, enabled=? WHERE id=?",
            (encrypt_secret(key) if key else "", 1 if (key and enabled) else 0, pid),
        )
        con.commit()
        con.close()

    @app.get("/api/local/setup")
    def local_setup_status():
        return jsonify(_status())

    @app.post("/api/local/setup")
    def local_setup_save():
        if _configured():
            return jsonify({"error": "Проект уже настроен; правки — через удаление .local_setup_done"}), 403
        body = request.get_json(silent=True) or {}
        mode = body.get("mode") if body.get("mode") in ("manual", "auto") else "manual"

        tokens = [t.strip() for t in str(body.get("lzt_tokens") or "").splitlines() if t.strip()]
        if mode == "auto" and not tokens:
            return jsonify({"error": "Для авто-режима нужен хотя бы один LZT API-токен"}), 400

        if mode == "auto" and tokens:
            _write_role_tokens(tokens)
        else:
            # ручной режим: чистим на всякий случай, токены не нужны
            for role in ("messages", "profile", "search"):
                role_dir = config.SECRETS_DIR / role
                role_dir.mkdir(parents=True, exist_ok=True)
                for old in role_dir.iterdir():
                    if old.is_file() and not old.name.startswith("."):
                        old.unlink()

        providers = body.get("providers") or {}
        _set_provider_key("b6ebd712-0770-44", str(providers.get("aki") or ""), bool(providers.get("aki")))
        _set_provider_key("pr_openrouter", str(providers.get("openrouter") or ""), bool(providers.get("openrouter")))

        oauth_id = str(body.get("oauth_client_id") or "").strip()
        if not oauth_id:
            return jsonify({"error": "Нужен Client ID вашего OAuth-приложения (иначе вход не заработает)"}), 400
        (config.PROJECT_ROOT / ".lolz_oauth_client_id").write_text(oauth_id, encoding="utf-8")
        redirect_uri = str(body.get("oauth_redirect_uri") or "").strip() or "http://localhost:8080/oauth/callback"
        (config.PROJECT_ROOT / ".lolz_oauth_redirect_uri").write_text(redirect_uri, encoding="utf-8")

        SETUP_MARKER.write_text(json.dumps({"mode": mode, "ts": int(time.time())}), encoding="utf-8")
        return jsonify({"ok": True, "mode": mode})

    @app.post("/api/orders/manual")
    def manual_order():
        uid, _token = require_auth()
        body = request.get_json(silent=True) or {}
        username = str(body.get("username") or "").strip()
        texts = [t.strip() for t in (body.get("texts") or []) if str(t).strip()]
        report_type = "full" if body.get("report_type") == "full" else "basic"
        if not username or not texts:
            return jsonify({"error": "Нужны ник и хотя бы одно сообщение"}), 400
        if len(texts) > 3000:
            return jsonify({"error": "Слишком много сообщений (максимум 3000)"}), 400

        from lolz_analyzer import LolzAnalyzer, Profile, UserPost, strip_bbcode

        now = int(time.time())
        try:
            user_id = int(body.get("user_id") or 0)
        except (TypeError, ValueError):
            user_id = 0
        if not user_id:
            user_id = abs(hash(username.lower())) % 10_000_000

        profile = Profile(
            user_id=user_id,
            username=username,
            avatar=str(body.get("avatar") or ""),
            register_date=int(body.get("register_date") or (now - 3 * 365 * 86400)),
            message_count=int(body.get("message_count") or len(texts)),
            like_count=int(body.get("like_count") or 0),
        )
        posts = [
            UserPost(
                post_id=i + 1,
                body=strip_bbcode(str(t)),
                body_raw=str(t),
                create_date=now - (len(texts) - i) * 3600,
                thread_id=0,
                thread_title="",
                like_count=0,
                comment_count=0,
                is_first_post=False,
                forum_title="",
            )
            for i, t in enumerate(texts)
        ]

        analyzer = LolzAnalyzer(tokens=["local-offline"], on_progress=None)
        dossier = analyzer._build_dossier(profile, posts, [], [], None)

        ai_error = ""
        if report_type == "full" and body.get("ai", True):
            try:
                from ai_interpreter import analyze_with_ai
                ai_result = analyze_with_ai(dossier, posts, runtime_config=None)
                from lolz_analyzer import sanitize_dossier
                dossier["ai_analysis"] = sanitize_dossier(ai_result)
            except Exception as exc:  # AI опционален: без ключей досье всё равно строится
                ai_error = str(exc)

        order_id = store.create_order(
            user_id=user_id,
            report_type=report_type,
            params={"mode": "manual", "manual": True},
            username=username,
            avatar=str(body.get("avatar") or ""),
            visibility=str(body.get("visibility") or "public"),
            buyer_id=str(uid or ""),
        )
        store.mark_paid(order_id, payment_id="manual", buyer_id=str(uid or ""))
        result_path = config.RESULTS_DIR / f"{order_id}.json"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
        store.mark_done(order_id, str(result_path), collected_message_counts={
            "total": len(posts), "timeline_posts": len(posts), "threads": 0, "wall_posts": 0,
        })
        resp = {"ok": True, "order_id": order_id, "display_id": "ZS-" + order_id[:8].upper()}
        if ai_error:
            resp["ai_warning"] = "AI-анализ не выполнен: " + ai_error
        return jsonify(resp)
