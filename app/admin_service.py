"""Zelscan admin control plane: protected access, audit, analytics and AI registry."""
from __future__ import annotations
import base64, datetime, hashlib, hmac, json, os, secrets, sqlite3, time, uuid
import requests
from pathlib import Path
from typing import Any
from flask import jsonify, request, session

import config

ADMIN_UID = int(os.environ.get("ADMIN_LOLZ_USER_ID", "638074"))
ROOT = Path(__file__).resolve().parent.parent
PW_FILE = ROOT / ".admin_password_hash"
SECRET_FILE = ROOT / ".admin_session_secret"
MASTER_FILE = ROOT / ".admin_master_key"

SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_login_state(
  subject TEXT PRIMARY KEY, fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0, last_fail INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS admin_audit(
  id TEXT PRIMARY KEY, admin_uid INTEGER NOT NULL, action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', before_json TEXT, after_json TEXT,
  ip_hash TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY, user_id INTEGER, session_id TEXT NOT NULL DEFAULT '',
  event TEXT NOT NULL, object_type TEXT NOT NULL DEFAULT '', object_id TEXT NOT NULL DEFAULT '',
  meta_json TEXT, utm_source TEXT NOT NULL DEFAULT '', utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '', referrer TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS visitor_attribution(
  visitor_id TEXT PRIMARY KEY, user_id INTEGER, first_source TEXT DEFAULT '', first_medium TEXT DEFAULT '',
  first_campaign TEXT DEFAULT '', first_referrer TEXT DEFAULT '', first_seen INTEGER NOT NULL,
  last_source TEXT DEFAULT '', last_medium TEXT DEFAULT '', last_campaign TEXT DEFAULT '',
  last_referrer TEXT DEFAULT '', last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_providers(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'openai',
  base_url TEXT NOT NULL DEFAULT '', encrypted_key TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
  balance REAL, balance_currency TEXT DEFAULT 'USD', balance_updated_at INTEGER,
  spend_30d REAL, spend_total REAL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_models(
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model TEXT NOT NULL, label TEXT NOT NULL,
  input_per_million REAL NOT NULL DEFAULT 0, output_per_million REAL NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL,
  UNIQUE(provider_id, model)
);
CREATE TABLE IF NOT EXISTS ai_config(
  id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1,
  lite_model_id TEXT, max_model_id TEXT, psychologist_model_id TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_usage(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id INTEGER, slot TEXT NOT NULL,
  provider_id TEXT, model TEXT NOT NULL DEFAULT '', prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1, error TEXT DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_order ON ai_usage(order_id);
"""


def _ensure_column(c, table: str, name: str, decl: str):
    cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
    if name not in cols: c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def init_admin_db(store):
    with store._write() as c:
        c.executescript(SCHEMA)
        _ensure_column(c, "users", "admin_banned", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(c, "users", "ban_reason", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(c, "users", "user_group", "TEXT NOT NULL DEFAULT 'regular'")
        c.execute("UPDATE users SET user_group='admin' WHERE user_id=?", (ADMIN_UID,))
        _ensure_column(c, "ai_providers", "spend_30d", "REAL")
        _ensure_column(c, "ai_providers", "spend_total", "REAL")
        _ensure_column(c, "orders", "ai_snapshot_json", "TEXT")
        _ensure_column(c, "orders", "deleted_at", "INTEGER")
        _ensure_column(c, "orders", "refunded_at", "INTEGER")
        _ensure_column(c, "orders", "visibility", "TEXT NOT NULL DEFAULT 'private'")
        _ensure_column(c, "orders", "display_id", "TEXT")
        _ensure_column(c, "orders", "share_token_hash", "TEXT")
        _ensure_column(c, "orders", "share_token_created_at", "INTEGER")
        _ensure_column(c, "orders", "view_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(c, "orders", "updated_at", "INTEGER")
        _ensure_column(c, "ai_config", "model_id", "TEXT")
        c.execute("INSERT OR IGNORE INTO ai_config(id,version,updated_at) VALUES(1,1,?)", (int(time.time()),))
        c.execute("UPDATE ai_config SET model_id=lite_model_id WHERE model_id IS NULL AND lite_model_id IS NOT NULL")
        now=int(time.time())
        legacy=[
          ("pr_deepseek","DeepSeek","openai","https://api.deepseek.com/v1",ROOT/".deepseek_key"),
          ("pr_fireworks","Fireworks AI","openai","https://api.fireworks.ai/inference/v1",ROOT/".fireworks_keys"),
        ]
        for pid,name,kind,base,keyfile in legacy:
            # Для Fireworks читаем первый ключ из файла (остальные будут в админке)
            if pid == "pr_fireworks" and keyfile.exists():
                keys = [line.strip() for line in keyfile.read_text().splitlines() if line.strip() and not line.startswith("#")]
                key = keys[0] if keys else ""
            else:
                key=keyfile.read_text().strip() if keyfile.exists() else ""
            row=c.execute("SELECT encrypted_key FROM ai_providers WHERE id=?",(pid,)).fetchone()
            enc=(row[0] if row and row[0] else (encrypt_secret(key) if key else ""))
            c.execute("INSERT INTO ai_providers(id,name,kind,base_url,encrypted_key,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,encrypted_key=CASE WHEN ai_providers.encrypted_key='' THEN excluded.encrypted_key ELSE ai_providers.encrypted_key END,updated_at=excluded.updated_at",(pid,name,kind,base,enc,now,now))
        
        # Модели с реальными ценами (за 1М токенов в USD)
        # Цены Fireworks: https://docs.fireworks.ai/serverless/pricing (Standard tier)
        # Qwen3p7-plus: $0.1/1M input, $0.1/1M output
        # DeepSeek-v4-flash: $0.2/1M input, $0.2/1M output
        # DeepSeek-v4-pro: $1.0/1M input, $1.0/1M output
        # GLM-5p2: $0.5/1M input, $0.5/1M output
        seeded=[
            ("mo_deep_chat","pr_deepseek","deepseek-chat","DeepSeek Chat",0.14,0.28),
            ("mo_deep_reason","pr_deepseek","deepseek-reasoner","DeepSeek Reasoner",0.55,2.19),
            ("mo_fw_qwen","pr_fireworks","accounts/fireworks/models/qwen3p7-plus","Qwen 3.7B Plus",0.1,0.1),
            ("mo_fw_ds_flash","pr_fireworks","accounts/fireworks/models/deepseek-v4-flash","DeepSeek V4 Flash",0.2,0.2),
            ("mo_101c43f9ac0d","pr_fireworks","accounts/fireworks/routers/kimi-k3-fast","Kimi K3 Fast",0.6,2.4),
        ]
        for mid,pid,model,label,inp,outp in seeded:
            c.execute("INSERT INTO ai_models(id,provider_id,model,label,input_per_million,output_per_million,enabled,created_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET input_per_million=excluded.input_per_million,output_per_million=excluded.output_per_million",(mid,pid,model,label,inp,outp,now))

        if config.LOCAL_OPEN_ADMIN:
            # локальная версия: DeepSeek/Fireworks не используем — только Aki.io и OpenRouter
            c.execute("DELETE FROM ai_models WHERE provider_id IN ('pr_deepseek','pr_fireworks')")
            c.execute("DELETE FROM ai_providers WHERE id IN ('pr_deepseek','pr_fireworks')")


def ensure_secrets():
    if not SECRET_FILE.exists(): SECRET_FILE.write_text(secrets.token_hex(48))
    if not MASTER_FILE.exists(): MASTER_FILE.write_bytes(secrets.token_bytes(32))
    try:
        os.chmod(SECRET_FILE, 0o600); os.chmod(MASTER_FILE, 0o600)
    except OSError: pass
    return SECRET_FILE.read_text().strip()


def make_password_hash(password: str) -> str:
    salt = secrets.token_bytes(16); n, r, p = 2**15, 8, 1
    digest = hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, dklen=32, maxmem=128*1024*1024)
    return f"scrypt${n}${r}${p}${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str) -> bool:
    try:
        _, ns, rs, ps, salt, expected = PW_FILE.read_text().strip().split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.urlsafe_b64decode(salt), n=int(ns), r=int(rs), p=int(ps), dklen=32, maxmem=128*1024*1024)
        return hmac.compare_digest(got, base64.urlsafe_b64decode(expected))
    except Exception: return False


def _cipher_key(): return MASTER_FILE.read_bytes()
def encrypt_secret(value: str) -> str:
    if not value: return ""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce=secrets.token_bytes(12); ct=AESGCM(_cipher_key()).encrypt(nonce,value.encode(),b"zelscan-ai-key-v1")
    return base64.urlsafe_b64encode(nonce+ct).decode()
def decrypt_secret(value: str) -> str:
    if not value: return ""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw=base64.urlsafe_b64decode(value); return AESGCM(_cipher_key()).decrypt(raw[:12],raw[12:],b"zelscan-ai-key-v1").decode()

def _ip_hash(): return hashlib.sha256((request.remote_addr or "unknown").encode()).hexdigest()[:20]
def _json(v):
    if v is None:
        return None
    from security import safe_json
    return safe_json(v)

def audit(store, action, target_type="", target_id="", reason="", before=None, after=None):
    with store._write() as c:
        c.execute("INSERT INTO admin_audit VALUES(?,?,?,?,?,?,?,?,?,?)",(
          "au_"+uuid.uuid4().hex[:16], int(session.get("admin_uid",0)), action,target_type,str(target_id),
          reason[:500],_json(before),_json(after),_ip_hash(),int(time.time())))

def _csrf_ok(): return hmac.compare_digest(request.headers.get("X-CSRF-Token",""),session.get("admin_csrf","_"))
def _admin_guard(csrf=False):
    if config.LOCAL_OPEN_ADMIN:
        # локальная версия: любой авторизованный юзер — админ, пароля нет
        if session.get("admin_uid") != ADMIN_UID or int(session.get("admin_until",0)) < int(time.time()):
            now=int(time.time()); session.permanent=True
            session["admin_uid"]=ADMIN_UID; session["admin_until"]=now+28800
            session.setdefault("admin_csrf", secrets.token_urlsafe(32))
        if csrf and not _csrf_ok(): return jsonify({"error":"CSRF-проверка не пройдена"}),403
        return None
    if session.get("admin_uid") != ADMIN_UID or int(session.get("admin_until",0)) < int(time.time()):
        return jsonify({"error":"Требуется вход в админ-панель"}),401
    if csrf and not _csrf_ok(): return jsonify({"error":"CSRF-проверка не пройдена"}),403
    return None

def _rowdict(r): return dict(r) if r else None

_SNAPSHOT_FIELDS = (
    "id", "provider_id", "model", "label", "input_per_million",
    "output_per_million", "enabled", "provider_name", "kind", "base_url",
    "provider_enabled",
)


def _safe_snapshot_item(value):
    if not isinstance(value, dict):
        return {}
    return {key: value.get(key) for key in _SNAPSHOT_FIELDS if key in value}


def sanitize_ai_snapshot(snapshot):
    """Strip plaintext/encrypted credentials from current and legacy snapshots."""
    if not isinstance(snapshot, dict):
        return {}
    slots = {
        slot: _safe_snapshot_item(item)
        for slot, item in (snapshot.get("slots") or {}).items()
        if slot in ("lite", "max", "psychologist") and isinstance(item, dict)
    }
    return {
        "version": snapshot.get("version", 1),
        "captured_at": snapshot.get("captured_at"),
        "slots": slots,
    }


def get_ai_snapshot(store):
    c = store._conn()
    cfg = _rowdict(c.execute("SELECT * FROM ai_config WHERE id=1").fetchone()) or {}
    slots = {}

    def _load(model_id):
        return c.execute(
            """SELECT m.*, p.name provider_name, p.kind, p.base_url,
                      p.enabled provider_enabled
               FROM ai_models m
               JOIN ai_providers p ON p.id = m.provider_id
               WHERE m.id = ?""",
            (model_id,),
        ).fetchone() if model_id else None

    for slot in ("lite", "max", "psychologist"):
        row = _load(cfg.get(f"{slot}_model_id") or cfg.get("model_id"))
        if row:
            slots[slot] = _safe_snapshot_item(dict(row))

    return {"version": cfg.get("version", 1), "captured_at": int(time.time()), "slots": slots}


def resolve_ai_runtime(store, snapshot):
    """Resolve provider metadata only; credentials stay encrypted until HTTP call."""
    safe_snapshot = sanitize_ai_snapshot(snapshot)
    out = {"version": safe_snapshot.get("version", 1), "slots": {}, "fallbacks": []}
    c = store._conn()
    for slot, item in (safe_snapshot.get("slots") or {}).items():
        provider_id = item.get("provider_id")
        provider = c.execute(
            "SELECT id,base_url,kind,enabled FROM ai_providers WHERE id=?", (provider_id,)
        ).fetchone()
        if provider:
            pd = dict(provider)
            out["slots"][slot] = {
                **item,
                "provider_id": pd["id"],
                "base_url": pd["base_url"],
                "kind": pd["kind"],
                "provider_enabled": pd["enabled"],
            }
    try:
        rows = c.execute("""SELECT m.provider_id,m.model,m.label,m.input_per_million,m.output_per_million,
                                   p.base_url,p.kind
                            FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id
                            WHERE m.enabled=1 AND p.enabled=1
                              AND m.model NOT LIKE '%embedding%'
                              AND m.model NOT LIKE '%rerank%'
                            ORDER BY p.created_at,m.id LIMIT 12""").fetchall()
        keys = ("provider_id", "model", "label", "input_per_million",
                "output_per_million", "base_url", "kind")
        out["fallbacks"] = [dict(zip(keys, row)) for row in rows]
    except Exception:
        pass
    out["_store"] = store
    return out


def resolve_ai_api_key(store, provider_id):
    """Decrypt one provider key just-in-time for a single outbound request."""
    if not provider_id:
        return ""
    row = store._conn().execute(
        "SELECT encrypted_key FROM ai_providers WHERE id=? AND enabled=1", (provider_id,)
    ).fetchone()
    return decrypt_secret(row["encrypted_key"]) if row and row["encrypted_key"] else ""

def record_ai_usage(store, order, ai_result, snapshot):
    now=int(time.time()); slots=(snapshot or {}).get("slots",{})
    with store._write() as c:
        for slot in ("lite","max","psychologist"):
            result=(ai_result or {}).get(slot) or {}; usage=result.get("usage") or {}; spec=slots.get(slot) or {}
            # фолбэк мог отработать на другой модели/провайдере — учитываем факт
            pid=result.get("provider_id") or spec.get("provider_id")
            pmod=store._conn().execute("SELECT input_per_million,output_per_million FROM ai_models WHERE provider_id=? AND model=?",(pid,result.get("model") or spec.get("model",""))).fetchone()
            if pmod: ipr,opr=float(pmod[0]),float(pmod[1])
            else: ipr,opr=float(spec.get("input_per_million",0)),float(spec.get("output_per_million",0))
            pin=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0); pout=int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
            cost=pin*ipr/1e6+pout*opr/1e6
            c.execute("INSERT INTO ai_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(
              "ai_"+uuid.uuid4().hex[:16],order["id"],int(order.get("buyer_id") or 0),slot,pid,
              result.get("model") or spec.get("model",""),pin,pout,int(usage.get("total_tokens") or pin+pout),cost,
              int(float((ai_result or {}).get("elapsed_seconds",0))*1000),0 if result.get("error") else 1,str(result.get("error") or "")[:500],now))

def install_admin(app, store, worker, require_auth):
    from security import secure_cookie_for_request

    init_admin_db(store); app.secret_key=ensure_secrets(); app.config.update(SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE="Strict",SESSION_COOKIE_SECURE=config.SESSION_COOKIE_SECURE,PERMANENT_SESSION_LIFETIME=28800)

    @app.before_request
    def _admin_cookie_transport_policy():
        # Flask reads this setting when serializing the session response.
        app.config["SESSION_COOKIE_SECURE"] = secure_cookie_for_request()

    @app.get("/api/admin/access")
    def admin_access():
        uid,_=require_auth()
        if config.LOCAL_OPEN_ADMIN:
            # все — админы: авто-разблокировка без пароля
            now=int(time.time())
            if session.get("admin_uid") != ADMIN_UID or int(session.get("admin_until",0)) < now:
                session.permanent=True; session["admin_uid"]=ADMIN_UID
                session["admin_until"]=now+28800; session["admin_csrf"]=secrets.token_urlsafe(32)
            return jsonify({"eligible":True,"unlocked":True,"admin_user_id":uid,"csrf":session.get("admin_csrf"),"expires_at":session["admin_until"]})
        eligible=(uid==ADMIN_UID); unlocked=eligible and session.get("admin_uid")==ADMIN_UID and int(session.get("admin_until",0))>int(time.time())
        return jsonify({"eligible":eligible,"unlocked":unlocked,"admin_user_id":ADMIN_UID if eligible else None,"csrf":session.get("admin_csrf") if unlocked else None,"expires_at":session.get("admin_until") if unlocked else None})

    @app.post("/api/admin/login")
    def admin_login():
        uid,_=require_auth()
        if uid!=ADMIN_UID: return jsonify({"error":"Доступ закрыт"}),403
        key=f"{uid}:{_ip_hash()}"; now=int(time.time()); c=store._conn(); st=c.execute("SELECT * FROM admin_login_state WHERE subject=?",(key,)).fetchone()
        if st and st["locked_until"]>now: return jsonify({"error":"Слишком много попыток","retry_after":st["locked_until"]-now}),429
        password=str((request.get_json(silent=True) or {}).get("password", ""))
        if not verify_password(password):
            fails=(st["fail_count"] if st else 0)+1; cooldown=0 if fails<5 else min(21600,900*(2**min(fails-5,5)))
            with store._write() as w: w.execute("INSERT INTO admin_login_state VALUES(?,?,?,?) ON CONFLICT(subject) DO UPDATE SET fail_count=excluded.fail_count,locked_until=excluded.locked_until,last_fail=excluded.last_fail",(key,fails,now+cooldown,now))
            audit(store,"admin_login_failed","auth",uid,after={"fails":fails,"cooldown":cooldown})
            return jsonify({"error":"Неверный пароль","attempts_left":max(0,5-fails),"retry_after":cooldown}),401
        with store._write() as w: w.execute("DELETE FROM admin_login_state WHERE subject=?",(key,))
        session.clear(); session.permanent=True; session["admin_uid"]=ADMIN_UID; session["admin_until"]=now+28800; session["admin_csrf"]=secrets.token_urlsafe(32)
        audit(store,"admin_login_success","auth",uid)
        return jsonify({"ok":True,"csrf":session["admin_csrf"],"expires_at":session["admin_until"]})

    @app.post("/api/admin/logout")
    def admin_logout():
        g=_admin_guard(True)
        if g:return g
        audit(store,"admin_logout","auth",ADMIN_UID); session.clear(); return jsonify({"ok":True})

    @app.get("/api/admin/overview")
    def admin_overview():
        g=_admin_guard()
        if g:return g
        c=store._conn(); now=int(time.time()); day=now-86400; month=now-30*86400; hour=now-3600
        one=lambda q,p=(): c.execute(q,p).fetchone()[0] or 0
        ntest="COALESCE(u.user_group,'regular')!='tester'"
        series=[dict(r) for r in c.execute("""SELECT date(created_at,'unixepoch') day,COUNT(*) orders,SUM(status='done') done FROM orders WHERE created_at>=? GROUP BY day ORDER BY day""",(now-30*86400,))]
        return jsonify({"kpis":{"users":one("SELECT COUNT(*) FROM users WHERE user_group!='tester'"),"active_day":one("SELECT COUNT(DISTINCT e.user_id) FROM events e LEFT JOIN users u ON u.user_id=e.user_id WHERE e.created_at>=? AND "+ntest,(day,)),"orders_hour":one("SELECT COUNT(*) FROM orders WHERE created_at>=?",(hour,)),"orders_day":one("SELECT COUNT(*) FROM orders WHERE created_at>=?",(day,)),"orders_month":one("SELECT COUNT(*) FROM orders WHERE created_at>=?",(month,)),"done_month":one("SELECT COUNT(*) FROM orders WHERE created_at>=? AND status='done'",(month,)),"revenue_month":one("SELECT COALESCE(SUM(t.amount_rub),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.created_at>=? AND t.kind='charge' AND t.status='completed' AND t.provider='credits' AND COALESCE(u.user_group,'regular') NOT IN ('tester','admin')",(month,)),"avg_ltv":one("SELECT AVG(total) FROM (SELECT SUM(CASE WHEN t.kind='topup' AND t.status='completed' THEN t.amount_rub ELSE 0 END) total FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE "+ntest+" GROUP BY t.user_id)"),"ai_cost_month":one("SELECT SUM(cost_usd) FROM ai_usage WHERE created_at>=?",(month,)),"queue":store.queue_size()},"series":series,"recent_events":[dict(r) for r in c.execute("SELECT * FROM events ORDER BY created_at DESC LIMIT 12")]})

    @app.get("/api/admin/users")
    def admin_users():
        g=_admin_guard()
        if g:return g
        q=(request.args.get("q") or "").strip(); like=f"%{q}%"
        rows=store._conn().execute("""SELECT u.*,COUNT(DISTINCT o.id) orders_count,COALESCE(SUM(CASE WHEN t.kind='topup' AND t.status='completed' THEN t.amount_rub ELSE 0 END),0) ltv
          FROM users u LEFT JOIN orders o ON CAST(o.buyer_id AS INTEGER)=u.user_id LEFT JOIN transactions t ON t.user_id=u.user_id
          WHERE ?='' OR u.username LIKE ? OR CAST(u.user_id AS TEXT) LIKE ? GROUP BY u.user_id ORDER BY u.last_seen DESC LIMIT 200""",(q,like,like)).fetchall()
        return jsonify({"users":[dict(r) for r in rows]})

    @app.get("/api/admin/users/<int:uid>")
    def admin_user(uid):
        g=_admin_guard()
        if g:return g
        c=store._conn(); u=c.execute("SELECT * FROM users WHERE user_id=?",(uid,)).fetchone()
        if not u:return jsonify({"error":"Пользователь не найден"}),404
        return jsonify({"user":dict(u),"orders":[dict(r) for r in c.execute("SELECT * FROM orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100",(str(uid),))],"transactions":[dict(r) for r in c.execute("SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100",(uid,))],"events":[dict(r) for r in c.execute("SELECT * FROM events WHERE user_id=? ORDER BY created_at DESC LIMIT 200",(uid,))]})

    @app.post("/api/admin/users/<int:uid>/credits")
    def admin_credits(uid):
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; amount=float(d.get("amount",0)); reason=str(d.get("reason","")).strip()
        if not reason or amount==0 or abs(amount)>1_000_000:return jsonify({"error":"Нужны корректная сумма и причина"}),400
        before=store.get_user(uid); balance=store.add_credits(uid,amount); store.create_transaction(uid,"admin_adjustment",amount_rub=0,credits=amount,status="completed",provider="admin",description=reason)
        audit(store,"credits_adjusted","user",uid,reason,before={"credits":before.get("credits") if before else None},after={"credits":balance,"delta":amount}); return jsonify({"ok":True,"balance":balance})

    @app.post("/api/admin/users/<int:uid>/balance")
    def admin_balance(uid):
        """Пополнение/списание любого баланса: credits (рубли) или bonus (бонусы)."""
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}
        balance_type = str(d.get("type", "credits"))  # 'credits' или 'bonus'
        amount = float(d.get("amount", 0))
        reason = str(d.get("reason", "")).strip()
        
        if balance_type not in ("credits", "bonus"):
            return jsonify({"error":"type должен быть 'credits' или 'bonus'"}),400
        if not reason or amount == 0 or abs(amount) > 1_000_000:
            return jsonify({"error":"Нужны корректная сумма и причина"}),400
        
        before = store.get_user(uid)
        if not before:
            return jsonify({"error":"Пользователь не найден"}),404
        
        if balance_type == "credits":
            if amount > 0:
                new_balance = store.add_credits(uid, amount)
                kind = "admin_credit_topup"
            else:
                ok = store.deduct_credits(uid, -amount)
                if not ok:
                    return jsonify({"error":"Недостаточно средств на рублёвом балансе"}),400
                new_balance = store._conn().execute("SELECT credits FROM users WHERE user_id=?",(uid,)).fetchone()[0]
                kind = "admin_credit_charge"
        else:  # bonus
            if amount > 0:
                new_balance = store.add_bonus(uid, amount)
                kind = "admin_bonus_topup"
            else:
                ok = store.deduct_bonus(uid, -amount)
                if not ok:
                    return jsonify({"error":"Недостаточно средств на бонусном балансе"}),400
                new_balance = store._conn().execute("SELECT bonus_credits FROM users WHERE user_id=?",(uid,)).fetchone()[0]
                kind = "admin_bonus_charge"
        
        store.create_transaction(uid, kind, amount_rub=amount, credits=amount if balance_type=="credits" else 0, status="completed", provider="admin", description=reason)
        audit(store, f"balance_{'topup' if amount>0 else 'charge'}", "user", uid, reason,
              before={balance_type: before.get(balance_type)},
              after={balance_type: new_balance, "delta": amount})
        return jsonify({"ok": True, "balance": new_balance, "type": balance_type})

    @app.get("/api/admin/users/<int:uid>/transactions")
    def admin_user_transactions(uid):
        """История операций пользователя."""
        g=_admin_guard()
        if g:return g
        limit = min(int(request.args.get("limit", 50)), 200)
        offset = max(int(request.args.get("offset", 0)), 0)
        conn = store._conn()
        total = conn.execute(
            "SELECT COUNT(*) FROM transactions WHERE user_id=?", (uid,)
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (uid, limit, offset)
        ).fetchall()
        return jsonify({"transactions": [dict(r) for r in rows], "total": total})

    @app.get("/api/admin/finance")
    def admin_finance():
        """Сводка по финансам: общие балансы, выдано, списано за период."""
        g=_admin_guard()
        if g:return g
        now = int(time.time())
        day = now - 86400
        month = now - 30*86400
        
        c = store._conn()
        
        # Общие балансы (без тестеров)
        total_credits = c.execute("SELECT COALESCE(SUM(credits),0) FROM users WHERE user_group!='tester'").fetchone()[0]
        total_bonus = c.execute("SELECT COALESCE(SUM(bonus_credits),0) FROM users WHERE user_group!='tester'").fetchone()[0]
        user_topups = c.execute("SELECT COALESCE(SUM(t.amount_rub),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind='topup' AND t.status='completed' AND COALESCE(u.user_group,'regular')!='tester'").fetchone()[0] or 0
        
        # Операции за период (без тестеров)
        def sum_kind(kind, since):
            return c.execute(
                "SELECT COALESCE(SUM(t.credits),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind=? AND t.status='completed' AND t.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'",
                (kind, since)
            ).fetchone()[0] or 0
        
        def sum_amount_rub(kind, since):
            return c.execute(
                "SELECT COALESCE(SUM(t.amount_rub),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind=? AND t.status='completed' AND t.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'",
                (kind, since)
            ).fetchone()[0] or 0
        
        # Пополнения и списания
        topups_24h = sum_kind("admin_credit_topup", day) + sum_kind("admin_bonus_topup", day)
        charges_24h = sum_kind("admin_credit_charge", day) + sum_kind("admin_bonus_charge", day)
        topups_30d = sum_kind("admin_credit_topup", month) + sum_kind("admin_bonus_topup", month)
        charges_30d = sum_kind("admin_credit_charge", month) + sum_kind("admin_bonus_charge", month)
        
        # Выдано по промокодам (без тестеров)
        promo_24h = c.execute(
            "SELECT COALESCE(SUM(pr.bonus),0) FROM promo_redemptions pr LEFT JOIN users u ON u.user_id=pr.user_id WHERE pr.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'", (day,)
        ).fetchone()[0] or 0
        promo_30d = c.execute(
            "SELECT COALESCE(SUM(pr.bonus),0) FROM promo_redemptions pr LEFT JOIN users u ON u.user_id=pr.user_id WHERE pr.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'", (month,)
        ).fetchone()[0] or 0
        
        # Списано за заказы (без тестеров)
        order_spent_24h = c.execute(
            "SELECT COALESCE(SUM(t.credits),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind='charge' AND t.status='completed' AND t.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'",
            (day,)
        ).fetchone()[0] or 0
        order_spent_30d = c.execute(
            "SELECT COALESCE(SUM(t.credits),0) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind='charge' AND t.status='completed' AND t.created_at>=? AND COALESCE(u.user_group,'regular')!='tester'",
            (month,)
        ).fetchone()[0] or 0
        
        return jsonify({
            "totals": {
                "credits": total_credits,
                "bonus": total_bonus,
                "user_topups": user_topups
            },
            "period_24h": {
                "topups": topups_24h,
                "charges": charges_24h,
                "promo_given": promo_24h,
                "order_spent": order_spent_24h,
                "net": topups_24h - charges_24h
            },
            "period_30d": {
                "topups": topups_30d,
                "charges": charges_30d,
                "promo_given": promo_30d,
                "order_spent": order_spent_30d,
                "net": topups_30d - charges_30d
            }
        })

    @app.get("/api/admin/analytics")
    def admin_analytics():
        """Бизнес-метрики: CAC, LTV, ROAS, ARPU, retention, конверсии."""
        g=_admin_guard()
        if g:return g
        now = int(time.time())
        month = now - 30*86400
        
        c = store._conn()
        
        # --- Базовые агрегаты ---
        # Тестеры исключаются из денежных/пользовательских метрик, но их отчёты учитываются
        total_users = c.execute("SELECT COUNT(*) FROM users WHERE user_group!='tester'").fetchone()[0] or 0
        paying_users = c.execute("SELECT COUNT(DISTINCT t.user_id) FROM transactions t LEFT JOIN users u ON u.user_id=t.user_id WHERE t.kind IN ('topup','admin_credit_topup') AND t.status='completed' AND COALESCE(u.user_group,'regular')!='tester'").fetchone()[0] or 0
        total_orders = c.execute("SELECT COUNT(*) FROM orders WHERE status='done'").fetchone()[0] or 0
        full_orders = c.execute("SELECT COUNT(*) FROM orders WHERE status='done' AND report_type='full'").fetchone()[0] or 0
        basic_orders = total_orders - full_orders
        
        # --- LTV (сумма всех пополнений по пользователям, без тестеров) ---
        ltv_rows = c.execute("""
            SELECT t.user_id, SUM(t.credits) as ltv 
            FROM transactions t
            LEFT JOIN users u ON u.user_id = t.user_id
            WHERE t.kind IN ('topup','admin_credit_topup') AND t.status='completed'
              AND COALESCE(u.user_group,'regular')!='tester'
            GROUP BY t.user_id
        """).fetchall()
        total_ltv = sum(r["ltv"] for r in ltv_rows)
        avg_ltv = total_ltv / paying_users if paying_users > 0 else 0
        
        # --- ARPU (средний доход на пользователя) ---
        arpu = total_ltv / total_users if total_users > 0 else 0
        
        # --- CAC (стоимость привлечения) - сумма бонусов/промокодов / кол-во привлеченных ---
        total_promo_spent = c.execute("SELECT COALESCE(SUM(pr.bonus),0) FROM promo_redemptions pr LEFT JOIN users u ON u.user_id=pr.user_id WHERE COALESCE(u.user_group,'regular')!='tester'").fetchone()[0] or 0
        acquired_via_promo = c.execute("SELECT COUNT(DISTINCT pr.user_id) FROM promo_redemptions pr LEFT JOIN users u ON u.user_id=pr.user_id WHERE COALESCE(u.user_group,'regular')!='tester'").fetchone()[0] or 0
        cac = total_promo_spent / acquired_via_promo if acquired_via_promo > 0 else 0
        
        # --- ROAS (возврат маркетинговых вложений) ---
        # LTV от пользователей, пришедших через промокоды (без тестеров)
        promo_ltv_rows = c.execute("""
            SELECT t.user_id, SUM(t.credits) as ltv
            FROM transactions t
            JOIN promo_redemptions pr ON pr.user_id = t.user_id
            LEFT JOIN users u ON u.user_id = t.user_id
            WHERE t.kind IN ('topup','admin_credit_topup') AND t.status='completed'
              AND COALESCE(u.user_group,'regular')!='tester'
            GROUP BY t.user_id
        """).fetchall()
        promo_ltv = sum(r["ltv"] for r in promo_ltv_rows)
        roas = promo_ltv / total_promo_spent if total_promo_spent > 0 else 0
        
        # --- Retention: повторные заказы ---
        repeat_customers = c.execute("""
            SELECT COUNT(*) FROM (
                SELECT buyer_id, COUNT(*) as cnt
                FROM orders
                WHERE status='done' AND buyer_id IS NOT NULL
                GROUP BY buyer_id
                HAVING cnt > 1
            )
        """).fetchone()[0] or 0
        retention_rate = repeat_customers / paying_users if paying_users > 0 else 0
        avg_orders_per_user = total_orders / paying_users if paying_users > 0 else 0
        
        # --- Конверсия basic -> full ---
        full_conversion = full_orders / total_orders if total_orders > 0 else 0
        
        # --- Средний чек ---
        aov = total_ltv / total_orders if total_orders > 0 else 0
        
        # --- AI расходы ---
        ai_cost_month = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM ai_usage WHERE created_at>=?", (month,)).fetchone()[0] or 0
        ai_cost_total = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM ai_usage").fetchone()[0] or 0
        
        # --- Маржа (LTV - CAC - AI costs) ---
        margin = total_ltv - total_promo_spent - ai_cost_total
        
        # --- По дням (последние 30 дней) ---
        daily = c.execute("""
            SELECT date(created_at,'unixepoch') as day,
                   COUNT(*) as orders,
                   SUM(CASE WHEN report_type='full' THEN 1 ELSE 0 END) as full,
                   SUM(CASE WHEN report_type='basic' THEN 1 ELSE 0 END) as basic
            FROM orders
            WHERE created_at>=?
            GROUP BY day
            ORDER BY day
        """, (month,)).fetchall()
        
        return jsonify({
            "kpis": {
                "total_users": total_users,
                "paying_users": paying_users,
                "total_orders": total_orders,
                "full_orders": full_orders,
                "basic_orders": basic_orders,
                "ltv_total": round(total_ltv, 2),
                "ltv_avg": round(avg_ltv, 2),
                "arpu": round(arpu, 2),
                "cac": round(cac, 2),
                "roas": round(roas, 2),
                "retention_rate": round(retention_rate * 100, 1),
                "avg_orders_per_user": round(avg_orders_per_user, 2),
                "full_conversion_pct": round(full_conversion * 100, 1),
                "aov": round(aov, 2),
                "ai_cost_month": round(ai_cost_month, 4),
                "ai_cost_total": round(ai_cost_total, 4),
                "promo_spent": round(total_promo_spent, 2),
                "margin": round(margin, 2)
            },
            "daily": [dict(r) for r in daily]
        })

    @app.get("/api/admin/promo")
    def admin_promo_list():
        g=_admin_guard()
        if g:return g
        active_only = request.args.get("active", "true").lower() != "false"
        return jsonify({"promos":store.list_promos(active_only=active_only)})

    @app.post("/api/admin/promo")
    def admin_promo_create():
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}
        code=str(d.get("code","")).strip().upper()
        try:bonus=float(d.get("bonus",0))
        except (TypeError,ValueError):bonus=0
        try:max_uses=int(d.get("max_uses",1))
        except (TypeError,ValueError):max_uses=1
        try:per_user=int(d.get("per_user",1))
        except (TypeError,ValueError):per_user=1
        expires_at=d.get("expires_at") or None
        if expires_at is not None:
            try:expires_at=int(expires_at)
            except (TypeError,ValueError):expires_at=None
        bonus_type=str(d.get("bonus_type","bonus"))
        value_type=str(d.get("value_type","fixed"))
        budget=d.get("budget")
        if budget is not None:
            try:budget=float(budget)
            except (TypeError,ValueError):budget=None
        description=str(d.get("description","")).strip()
        if not code or bonus<=0:return jsonify({"error":"Нужны код и положительный бонус"}),400
        if max_uses<1 or per_user<1:return jsonify({"error":"Лимиты должны быть >= 1"}),400
        if bonus_type not in ("bonus","credits","order"):return jsonify({"error":"bonus_type должен быть 'bonus', 'credits' или 'order'"}),400
        if value_type not in ("fixed","percent"):return jsonify({"error":"value_type должен быть 'fixed' или 'percent'"}),400
        if store._conn().execute("SELECT 1 FROM promo_codes WHERE code=?",(code,)).fetchone():
            return jsonify({"error":"Промокод c таким кодом уже есть"}),409
        promo=store.create_promo(code,bonus,max_uses=max_uses,per_user=per_user,expires_at=expires_at,
                                 bonus_type=bonus_type,value_type=value_type,budget=budget,description=description)
        audit(store,"promo_created","promo",code,f"bonus={bonus:g} max_uses={max_uses} type={bonus_type}",after=promo)
        return jsonify({"ok":True,"promo":promo})

    @app.post("/api/admin/promo/<code>/toggle")
    def admin_promo_toggle(code):
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; active=bool(d.get("active"))
        ok=store.toggle_promo(code,active)
        if not ok:return jsonify({"error":"Промокод не найден"}),404
        audit(store,"promo_toggled","promo",code.upper(),f"active={int(active)}")
        return jsonify({"ok":True})

    @app.post("/api/admin/promo/<code>/update")
    def admin_promo_update(code):
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}
        code=code.strip().upper()
        before=store._conn().execute("SELECT * FROM promo_codes WHERE code=?",(code,)).fetchone()
        if not before:return jsonify({"error":"Промокод не найден"}),404
        before=dict(before)
        # Можно менять: bonus, max_uses, per_user, expires_at, bonus_type, value_type, budget, description, active
        with store._write() as c:
            if "bonus" in d:
                c.execute("UPDATE promo_codes SET bonus=? WHERE code=?",(float(d["bonus"]),code))
            if "max_uses" in d:
                c.execute("UPDATE promo_codes SET max_uses=? WHERE code=?",(int(d["max_uses"]),code))
            if "per_user" in d:
                c.execute("UPDATE promo_codes SET per_user=? WHERE code=?",(int(d["per_user"]),code))
            if "expires_at" in d:
                v=d["expires_at"]; c.execute("UPDATE promo_codes SET expires_at=? WHERE code=?",(int(v) if v else None,code))
            if "bonus_type" in d:
                if d["bonus_type"] not in ("bonus","credits"):return jsonify({"error":"bonus_type должен быть 'bonus' или 'credits'"}),400
                c.execute("UPDATE promo_codes SET bonus_type=? WHERE code=?",(d["bonus_type"],code))
            if "value_type" in d:
                if d["value_type"] not in ("fixed","percent"):return jsonify({"error":"value_type должен быть 'fixed' или 'percent'"}),400
                c.execute("UPDATE promo_codes SET value_type=? WHERE code=?",(d["value_type"],code))
            if "budget" in d:
                v=d["budget"]; c.execute("UPDATE promo_codes SET budget=? WHERE code=?",(float(v) if v else None,code))
            if "description" in d:
                c.execute("UPDATE promo_codes SET description=? WHERE code=?",(str(d["description"]).strip(),code))
            if "active" in d:
                c.execute("UPDATE promo_codes SET active=? WHERE code=?",(int(bool(d["active"])),code))
        after=store._conn().execute("SELECT * FROM promo_codes WHERE code=?",(code,)).fetchone()
        audit(store,"promo_updated","promo",code,"Обновление промокода",before=before,after=dict(after))
        return jsonify({"ok":True,"promo":dict(after)})

    @app.delete("/api/admin/promo/<code>")
    def admin_promo_delete(code):
        g=_admin_guard(True)
        if g:return g
        code=code.strip().upper()
        before=store._conn().execute("SELECT * FROM promo_codes WHERE code=?",(code,)).fetchone()
        if not before:return jsonify({"error":"Промокод не найден"}),404
        before=dict(before)
        with store._write() as c:
            c.execute("DELETE FROM promo_codes WHERE code=?",(code,))
        audit(store,"promo_deleted","promo",code,"Удаление промокода",before=before)
        return jsonify({"ok":True})

    @app.get("/api/admin/notifications")
    def admin_notifications_list():
        g=_admin_guard()
        if g:return g
        return jsonify({
            "broadcasts": store.list_broadcasts(limit=100),
            "segments": store.segment_sizes(),
            "types": list(store._NOTIFICATION_TYPES),
        })

    @app.post("/api/admin/notifications")
    def admin_notifications_send():
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}
        ntype=str(d.get("type","news")).strip()
        title=str(d.get("title","")).strip()
        body=str(d.get("body","")).strip()
        segment=str(d.get("segment","all")).strip()
        group=str(d.get("group","")).strip()
        target_uid=None
        if segment=="user":
            try:target_uid=int(d.get("user_id"))
            except (TypeError,ValueError):return jsonify({"error":"Nekorrektnyy user_id"}),400
        try:
            res=store.broadcast_notification(
                ntype=ntype,title=title,body=body,segment=segment,
                group=group,user_id=target_uid,admin_id=ADMIN_UID,
            )
        except ValueError as e:
            return jsonify({"error":str(e)}),400
        audit(store,"notification_broadcast","notification",res.get("broadcast_id",""),
              "Broadcast: "+(title or body)[:80],after=res)
        return jsonify({"ok":True,**res})

    @app.delete("/api/admin/notifications/<bid>")
    def admin_notifications_delete(bid):
        g=_admin_guard(True)
        if g:return g
        ok=store.delete_broadcast(bid.strip())
        if not ok:return jsonify({"error":"Rassylka ne naydena"}),404
        audit(store,"notification_broadcast_deleted","notification",bid,"Broadcast deleted")
        return jsonify({"ok":True})

    @app.post("/api/admin/users/<int:uid>/ban")
    def admin_ban(uid):
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; banned=bool(d.get("banned")); reason=str(d.get("reason","")).strip()
        if not reason:return jsonify({"error":"Укажи причину"}),400
        before=store.get_user(uid); 
        with store._write() as c:c.execute("UPDATE users SET admin_banned=?,ban_reason=? WHERE user_id=?",(int(banned),reason if banned else "",uid))
        audit(store,"user_banned" if banned else "user_unbanned","user",uid,reason,before=before,after=store.get_user(uid)); return jsonify({"ok":True})

    @app.post("/api/admin/users/<int:uid>/group")
    def admin_user_group(uid):
        """Группа пользователя: regular / tester / admin.
        Тестеры исключаются из денежных метрик проекта."""
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}
        group=str(d.get("group") or "regular").strip()
        if group not in {"regular","tester","admin"}:
            return jsonify({"error":"Недопустимая группа: regular / tester / admin"}),400
        with store._write() as c:
            row=c.execute("SELECT user_group FROM users WHERE user_id=?", (uid,)).fetchone()
            if not row:return jsonify({"error":"Пользователь не найден"}),404
            c.execute("UPDATE users SET user_group=? WHERE user_id=?", (group, uid))
        audit(store,"user_group_changed","user",uid,str(d.get("reason","Смена группы")).strip() or "Смена группы",
              before={"user_group":row[0]},after={"user_group":group})
        return jsonify({"ok":True,"user_group":group})

    @app.get("/api/admin/orders")
    def admin_orders():
        g=_admin_guard()
        if g:return g
        rows=store._conn().execute("""SELECT o.*,COALESCE(SUM(a.total_tokens),0) ai_tokens,COALESCE(SUM(a.cost_usd),0) ai_cost FROM orders o LEFT JOIN ai_usage a ON a.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 300""").fetchall()
        return jsonify({"orders":[dict(r) for r in rows]})

    @app.post("/api/admin/orders/<oid>/action")
    def admin_order_action(oid):
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; action=d.get("action"); reason=str(d.get("reason","")).strip(); before=store.get_order(oid)
        if not before:return jsonify({"error":"Заказ не найден"}),404
        if not reason:return jsonify({"error":"Укажи причину"}),400
        now=int(time.time()); generated_share_token=None
        with store._write() as c:
            if action=="retry": c.execute("UPDATE orders SET status='paid',error=NULL,started_at=NULL,finished_at=NULL WHERE id=? AND status='error'",(oid,))
            elif action=="cancel": c.execute("UPDATE orders SET status='cancelled',finished_at=? WHERE id=? AND status IN('pending_payment','paid')",(now,oid))
            elif action=="hide": c.execute("UPDATE orders SET deleted_at=? WHERE id=?",(now,oid))
            elif action=="mark_paid": c.execute("UPDATE orders SET status='paid',paid_at=? WHERE id=? AND status='pending_payment'",(now,oid))
            elif action=="regenerate_share":
                generated_share_token=secrets.token_urlsafe(32)
                c.execute("UPDATE orders SET visibility='unlisted',share_token_hash=?,share_token_created_at=?,updated_at=? WHERE id=?",(hashlib.sha256(generated_share_token.encode()).hexdigest(),now,now,oid))
            elif action=="revoke_share":
                c.execute("UPDATE orders SET visibility='private',share_token_hash=NULL,share_token_created_at=NULL,updated_at=? WHERE id=?",(now,oid))
            elif action in ("visibility_private","visibility_unlisted","visibility_public"):
                visibility=action.replace("visibility_","")
                c.execute("UPDATE orders SET visibility=?,updated_at=? WHERE id=?",(visibility,now,oid))
                if visibility=="private": c.execute("UPDATE orders SET share_token_hash=NULL,share_token_created_at=NULL WHERE id=?",(oid,))
            elif action=="refund":
                pass
            elif action=="retry_ai":
                # Перезапуск AI для заказа (если full без AI или ошибка)
                if before.get("report_type") != "full":
                    return jsonify({"error":"AI доступен только для full-отчётов"}),400
                c.execute("UPDATE orders SET status='paid',error=NULL,started_at=NULL,finished_at=NULL WHERE id=?",(oid,))
                # worker сам подхватит при следующем цикле
            else:return jsonify({"error":"Неизвестное действие"}),400
        if action == "refund":
            refund = store.refund_failed_order(oid)
            if not refund:
                return jsonify({"error":"Заказ не подлежит возврату или уже возвращён"}),409
        audit(store,"order_"+str(action),"order",oid,reason,before=before,after=store.get_order(oid)); return jsonify({"ok":True,"share_token":generated_share_token,"share_url":(f"zelscan.html?order={oid}&share={generated_share_token}" if generated_share_token else None)})

    @app.get("/api/admin/ai")
    def admin_ai():
        g=_admin_guard()
        if g:return g
        c=store._conn(); providers=[]
        for r in c.execute("SELECT * FROM ai_providers ORDER BY CASE WHEN name LIKE '%Fireworks%' THEN 0 WHEN name LIKE '%DeepSeek%' THEN 1 ELSE 2 END, name"):
            d=dict(r); d["key_masked"]=("••••"+decrypt_secret(d.pop("encrypted_key"))[-4:]) if d.get("encrypted_key") else "не задан"; d["models"]=[dict(x) for x in c.execute("SELECT * FROM ai_models WHERE provider_id=? ORDER BY label",(d["id"],))]; providers.append(d)
        cfg=dict(c.execute("SELECT * FROM ai_config WHERE id=1").fetchone()); usage=[dict(r) for r in c.execute("SELECT model,SUM(total_tokens) tokens,SUM(cost_usd) cost,COUNT(DISTINCT order_id) reports FROM ai_usage WHERE created_at>=? GROUP BY model ORDER BY cost DESC",(int(time.time())-30*86400,))]
        return jsonify({"providers":providers,"config":cfg,"usage":usage,"snapshot":get_ai_snapshot(store)})

    @app.get("/api/admin/ai/usage/<oid>")
    def admin_ai_usage_detail(oid):
        """Детальный расход токенов по заказу."""
        g=_admin_guard()
        if g:return g
        c=store._conn()
        order = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
        if not order: return jsonify({"error":"Заказ не найден"}),404
        rows = c.execute("""
            SELECT * FROM ai_usage 
            WHERE order_id=? 
            ORDER BY slot, created_at
        """, (oid,)).fetchall()
        total_tokens = sum(r["total_tokens"] for r in rows)
        total_cost = sum(r["cost_usd"] for r in rows)
        by_slot = {}
        for r in rows:
            slot = r["slot"]
            if slot not in by_slot:
                by_slot[slot] = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0, "cost_usd": 0, "models": set()}
            by_slot[slot]["calls"] += 1
            by_slot[slot]["prompt_tokens"] += r["prompt_tokens"]
            by_slot[slot]["completion_tokens"] += r["completion_tokens"]
            by_slot[slot]["total_tokens"] += r["total_tokens"]
            by_slot[slot]["cost_usd"] += r["cost_usd"]
            by_slot[slot]["models"].add(r["model"])
        
        # Конвертируем set в list для JSON
        for s in by_slot.values():
            s["models"] = list(s["models"])
        
        return jsonify({
            "order_id": oid,
            "report_type": order["report_type"],
            "ai_analysis_present": bool(order.get("result_path")),
            "total_tokens": total_tokens,
            "total_cost_usd": total_cost,
            "by_slot": by_slot,
            "details": [dict(r) for r in rows]
        })

    @app.post("/api/admin/ai/providers")
    def admin_provider_save():
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; pid=str(d.get("id") or "pr_"+uuid.uuid4().hex[:10]); name=str(d.get("name","")).strip(); base=str(d.get("base_url","")).strip().rstrip("/"); kind=str(d.get("kind","openai"))
        if not name or kind not in ("openai","gigachat"):return jsonify({"error":"Проверь название и тип"}),400
        old=store._conn().execute("SELECT * FROM ai_providers WHERE id=?",(pid,)).fetchone(); enc=encrypt_secret(str(d.get("api_key"))) if d.get("api_key") else (old["encrypted_key"] if old else ""); now=int(time.time())
        with store._write() as c:c.execute("INSERT INTO ai_providers VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,base_url=excluded.base_url,encrypted_key=excluded.encrypted_key,enabled=excluded.enabled,updated_at=excluded.updated_at",(pid,name,kind,base,enc,int(d.get("enabled",1)),None,"USD",None,now,now))
        audit(store,"ai_provider_saved","provider",pid,str(d.get("reason","Настройка провайдера")),before=dict(old) if old else None,after={"name":name,"kind":kind,"base_url":base,"key":"masked"}); return jsonify({"ok":True,"id":pid})

    @app.post("/api/admin/ai/models")
    def admin_model_save():
        g=_admin_guard(True)
        if g:return g
        d=request.get_json(silent=True) or {}; mid=str(d.get("id") or "mo_"+uuid.uuid4().hex[:10]); now=int(time.time())
        with store._write() as c:c.execute("INSERT INTO ai_models VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider_id=excluded.provider_id,model=excluded.model,label=excluded.label,input_per_million=excluded.input_per_million,output_per_million=excluded.output_per_million,enabled=excluded.enabled",(mid,d.get("provider_id"),d.get("model"),d.get("label") or d.get("model"),float(d.get("input_per_million",0)),float(d.get("output_per_million",0)),int(d.get("enabled",1)),now))
        audit(store,"ai_model_saved","model",mid,str(d.get("reason","Настройка модели")),after={k:v for k,v in d.items() if k!="api_key"}); return jsonify({"ok":True,"id":mid})

    @app.post("/api/admin/ai/config")
    def admin_config_save():
        g = _admin_guard(True)
        if g:
            return g

        data = request.get_json(silent=True) or {}
        reason = str(data.get("reason", "")).strip() or "Настройка моделей генерации"
        fallback_model_id = str(data.get("model_id") or "").strip() or None
        slot_ids = {
            slot: (str(data.get(f"{slot}_model_id") or fallback_model_id or "").strip() or None)
            for slot in ("lite", "max", "psychologist")
        }
        if not all(slot_ids.values()):
            return jsonify({"error": "Для Lite, Max и Psychologist нужно выбрать модель"}), 400

        with store._write() as c:
            rows = c.execute(
                """SELECT m.id, p.enabled provider_enabled, m.enabled model_enabled
                   FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id
                   WHERE m.id IN (?,?,?)""",
                (slot_ids["lite"], slot_ids["max"], slot_ids["psychologist"]),
            ).fetchall()
            valid = {row["id"] for row in rows if row["provider_enabled"] and row["model_enabled"]}
            missing = [slot for slot, model_id in slot_ids.items() if model_id not in valid]
            if missing:
                return jsonify({"error": "Выбрана недоступная модель: " + ", ".join(missing)}), 400

            before = dict(c.execute("SELECT * FROM ai_config WHERE id=1").fetchone())
            now = int(time.time())
            # model_id is retained for compatibility with older consumers and mirrors Lite.
            c.execute(
                """UPDATE ai_config
                   SET version=version+1, lite_model_id=?, max_model_id=?, psychologist_model_id=?,
                       model_id=?, updated_at=?
                   WHERE id=1""",
                (slot_ids["lite"], slot_ids["max"], slot_ids["psychologist"], slot_ids["lite"], now),
            )

        after = dict(store._conn().execute("SELECT * FROM ai_config WHERE id=1").fetchone())
        audit(store, "ai_config_changed", "config", after["version"], reason, before=before, after=after)
        return jsonify({"ok": True, "config": after})

    def _provider_runtime(pid):
        row=store._conn().execute("SELECT * FROM ai_providers WHERE id=?",(pid,)).fetchone()
        if not row: return None
        d=dict(row); d["api_key"]=decrypt_secret(d.get("encrypted_key") or ""); return d

    @app.post("/api/admin/ai/providers/<pid>/sync-models")
    def admin_ai_sync_models(pid):
        g=_admin_guard(True)
        if g:return g
        p=_provider_runtime(pid)
        if not p or not p.get("api_key"):return jsonify({"error":"Провайдер или ключ не найден"}),404
        if p.get("kind")=="gigachat":return jsonify({"error":"GigaChat не публикует OpenAI models endpoint"}),400
        try:
            r=requests.get(p["base_url"].rstrip("/")+"/models",headers={"Authorization":"Bearer "+p["api_key"]},timeout=20)
            if r.status_code!=200:return jsonify({"error":f"HTTP {r.status_code}: {r.text[:300]}"}),502
            items=(r.json().get("data") or []); now=int(time.time()); added=0
            with store._write() as c:
                for item in items:
                    model=str(item.get("id") or "").strip()
                    if not model:continue
                    mid="mo_"+hashlib.sha256((pid+":"+model).encode()).hexdigest()[:12]
                    c.execute("INSERT OR IGNORE INTO ai_models(id,provider_id,model,label,created_at) VALUES(?,?,?,?,?)",(mid,pid,model,model,now)); added+=1
            audit(store,"ai_models_synced","provider",pid,"Синхронизация моделей",after={"received":len(items),"added":added})
            return jsonify({"ok":True,"received":len(items),"models":[x.get("id") for x in items if x.get("id")]})
        except Exception as e:return jsonify({"error":str(e)}),502

    @app.post("/api/admin/ai/providers/<pid>/test")
    def admin_ai_test(pid):
        g=_admin_guard(True)
        if g:return g
        p=_provider_runtime(pid); d=request.get_json(silent=True) or {}; candidate_token=str(d.get("candidate_token") or "").strip(); model=str(d.get("model") or "").strip()
        message=str(d.get("message") or "").strip() or "Ответь одним словом: работает"
        if not p or not p.get("api_key"):return jsonify({"error":"Провайдер или ключ не найден"}),404
        if candidate_token:
            p={**p,"api_key":candidate_token}
        # model может быть id записи ai_models (mo_...) или строкой API — резолвим в строку API
        if model:
            row=store._conn().execute("SELECT model FROM ai_models WHERE id=?",(model,)).fetchone()
            if row: model=row["model"]
        if not model:
            row=store._conn().execute("SELECT model FROM ai_models WHERE provider_id=? AND enabled=1 ORDER BY created_at LIMIT 1",(pid,)).fetchone(); model=row[0] if row else ""
        if not model:return jsonify({"error":"Сначала добавь или синхронизируй модель"}),400
        t=time.monotonic()
        try:
            if p.get("kind")=="gigachat":
                from ai_interpreter import GigaChatClient
                out=GigaChatClient(p["api_key"]).chat(model,message,"",0,16)
                if out.get("error"):return jsonify({"error":out["error"]}),502
                content=out.get("content") or ""
            else:
                r=requests.post(p["base_url"].rstrip("/")+"/chat/completions",headers={"Authorization":"Bearer "+p["api_key"],"Content-Type":"application/json"},json={"model":model,"messages":[{"role":"user","content":message}],"max_tokens":500,"temperature":0},timeout=35)
                if r.status_code!=200:return jsonify({"error":f"HTTP {r.status_code}: {r.text[:300]}"}),502
                content=r.json()["choices"][0]["message"]["content"]
            ms=int((time.monotonic()-t)*1000); audit(store,"ai_provider_tested","provider",pid,"Тестовый запрос",after={"model":model,"latency_ms":ms})
            return jsonify({"ok":True,"model":model,"latency_ms":ms,"response":str(content)[:2000]})
        except Exception as e:return jsonify({"error":str(e)}),502

    @app.delete("/api/admin/ai/providers/<pid>")
    def admin_provider_delete(pid):
        g=_admin_guard(True)
        if g:return g
        c=store._conn(); old=c.execute("SELECT * FROM ai_providers WHERE id=?",(pid,)).fetchone()
        if not old:return jsonify({"error":"Провайдер не найден"}),404
        reason=str((request.get_json(silent=True) or {}).get("reason","") or "Удаление провайдера").strip()
        model_ids={r[0] for r in c.execute("SELECT id FROM ai_models WHERE provider_id=?",(pid,)).fetchall()}
        cfg=dict(c.execute("SELECT * FROM ai_config WHERE id=1").fetchone() or {})
        refs={cfg.get("model_id"),cfg.get("lite_model_id"),cfg.get("max_model_id"),cfg.get("psychologist_model_id")}
        touched=bool(model_ids & refs); now=int(time.time())
        with store._write() as w:
            w.execute("DELETE FROM ai_models WHERE provider_id=?",(pid,))
            w.execute("DELETE FROM ai_providers WHERE id=?",(pid,))
            if touched:
                w.execute("UPDATE ai_config SET version=version+1,lite_model_id=NULL,max_model_id=NULL,psychologist_model_id=NULL,model_id=NULL,updated_at=? WHERE id=1",(now,))
        audit(store,"ai_provider_deleted","provider",pid,reason,before={"name":old["name"],"kind":old["kind"]})
        return jsonify({"ok":True})

    def _fw_money(m):
        if not m: return 0.0
        return float(m.get("units") or 0) + float(m.get("nanos") or 0) / 1e9

    def _fw_costs(api_key, account_id, start_iso, end_iso):
        """Суммарная стоимость (USD) за период по Fireworks usageCosts:query."""
        body={"startTime":start_iso,"endTime":end_iso,"scope":"ACCOUNT","groupBy":["DAY"]}
        r=requests.post(f"https://api.fireworks.ai/v1/accounts/{account_id}/usageCosts:query",
                        json=body,headers={"Authorization":"Bearer "+api_key,"Accept":"application/json"},timeout=25)
        if r.status_code!=200: raise RuntimeError(f"Fireworks usageCosts: HTTP {r.status_code}: {r.text[:300]}")
        return _fw_money((r.json() or {}).get("subtotal"))

    def _fireworks_balance(store, pid, api_key):
        """Баланс Fireworks = стартовые $6 минус суммарный расход аккаунта."""
        fw="https://api.fireworks.ai"; h={"Authorization":"Bearer "+api_key,"Accept":"application/json"}
        try:
            acc=requests.get(fw+"/v1/accounts",headers=h,timeout=15)
            if acc.status_code!=200:return jsonify({"error":f"Fireworks: HTTP {acc.status_code}: {acc.text[:300]}"}),502
            accts=(acc.json() or {}).get("accounts") or []
            if not accts:return jsonify({"error":"Fireworks: по этому ключу нет аккаунтов"}),400
            a=accts[0]; aid=str(a.get("name") or "").split("/")[-1]
            now=datetime.datetime.now(datetime.timezone.utc)
            # старт расхода — дата создания аккаунта
            try: created=datetime.datetime.fromisoformat(str(a.get("createTime") or "").replace("Z","+00:00"))
            except Exception: created=now-datetime.timedelta(days=3650)
            end=(now+datetime.timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
            start_total=created.strftime("%Y-%m-%dT00:00:00Z")
            start_30=(now-datetime.timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
            total=_fw_costs(api_key,aid,start_total,end)
            spend_30=_fw_costs(api_key,aid,start_30,end)
            balance=max(0.0, 6.0-total)
            now_ts=int(time.time())
            with store._write() as c:c.execute(
                "UPDATE ai_providers SET balance=?,balance_currency=?,balance_updated_at=?,spend_30d=?,spend_total=? WHERE id=?",
                (round(balance,4),"USD",now_ts,round(spend_30,6),round(total,6),pid))
            return jsonify({"ok":True,"balance":round(balance,4),"currency":"USD",
                            "spend_total":round(total,6),"spend_30d":round(spend_30,6),"account":aid,
                            "raw":{"account_create":a.get("createTime"),"base_credit":6.0}})
        except Exception as e:return jsonify({"error":f"Fireworks: {e}"}),502

    # zelscan-fireworks-token-rotation-v1
    def _verify_fireworks_candidate(token: str):
        """Проверяет кандидат-ключ живым коротким запросом, не сохраняя его."""
        token = str(token or "").strip()
        if len(token) < 16:
            return False, {"error": "Вставь полный токен Fireworks"}
        c = store._conn()
        provider = c.execute("SELECT base_url FROM ai_providers WHERE id='pr_fireworks'").fetchone()
        model_row = c.execute("SELECT model FROM ai_models WHERE provider_id='pr_fireworks' AND enabled=1 ORDER BY rowid ASC LIMIT 1").fetchone()
        base_url = (provider[0] if provider else "https://api.fireworks.ai/inference/v1").rstrip("/")
        model = model_row[0] if model_row else "accounts/fireworks/models/qwen3p7-plus"
        try:
            response = requests.post(
                base_url + "/chat/completions",
                headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Ответь одним словом: OK"}],
                    "max_tokens": 5,
                    "temperature": 0,
                },
                timeout=20,
            )
        except requests.RequestException:
            return False, {"error": "Fireworks не ответил за отведённое время. Ключ не был сохранён."}
        if response.status_code < 200 or response.status_code >= 300:
            return False, {"error": f"Fireworks отклонил проверку (HTTP {response.status_code}). Ключ не был сохранён."}
        try:
            payload = response.json()
            choices = payload.get("choices") or []
            reply = ((choices[0].get("message") or {}).get("content") if choices else "") or "OK"
        except Exception:
            return False, {"error": "Fireworks вернул некорректный ответ. Ключ не был сохранён."}
        return True, {"model": model, "reply": str(reply).strip()[:160] or "OK"}

    @app.post("/api/admin/ai/fireworks/token/verify")
    def admin_fireworks_token_verify():
        g = _admin_guard(True)
        if g: return g
        data = request.get_json(silent=True) or {}
        ok, result = _verify_fireworks_candidate(data.get("token"))
        return jsonify({"ok": ok, **result}), 200 if ok else 422

    @app.post("/api/admin/ai/fireworks/token/replace")
    def admin_fireworks_token_replace():
        g = _admin_guard(True)
        if g: return g
        data = request.get_json(silent=True) or {}
        token = str(data.get("token") or "").strip()
        ok, result = _verify_fireworks_candidate(token)
        if not ok:
            return jsonify({"ok": False, **result}), 422
        now = int(time.time())
        with store._write() as w:
            exists = w.execute("SELECT 1 FROM ai_providers WHERE id='pr_fireworks'").fetchone()
            if not exists:
                return jsonify({"ok": False, "error": "Провайдер Fireworks не найден"}), 404
            w.execute("UPDATE ai_providers SET encrypted_key=?, enabled=1, updated_at=? WHERE id='pr_fireworks'", (encrypt_secret(token), now))
        try:
            (ROOT / ".fireworks_keys").unlink(missing_ok=True)
        except Exception:
            logger.warning("Не удалось удалить старый файл ключей Fireworks")
        audit(store, "fireworks_token_replaced", "ai_provider", "pr_fireworks", "Новый Fireworks-токен проверен и применён", after={"model": result.get("model")})
        return jsonify({"ok": True, "message": "Новый токен Fireworks проверен и сохранён. Старый ключ удалён.", **result})

    @app.post("/api/admin/ai/providers/<pid>/balance")
    def admin_ai_balance(pid):
        g=_admin_guard(True)
        if g:return g
        p=_provider_runtime(pid)
        if not p or not p.get("api_key"):return jsonify({"error":"Провайдер или ключ не найден"}),404
        base=p["base_url"].rstrip("/")
        if "fireworks.ai" in base:
            return _fireworks_balance(store, pid, p["api_key"])
        roots=[base]
        if base.endswith('/v1'): roots.append(base[:-3])
        paths=["/user/balance","/balance","/dashboard/billing/credit_grants"]
        last=""
        for rt in roots:
            for path in paths:
                try:
                    r=requests.get(rt+path,headers={"Authorization":"Bearer "+p["api_key"],"Accept":"application/json"},timeout=15)
                    if r.status_code==200:
                        data=r.json(); amount=None; currency="USD"
                        if isinstance(data,dict):
                            if data.get("balance_infos"):
                                info=data["balance_infos"][0]; amount=info.get("total_balance"); currency=info.get("currency","USD")
                            for key in ("balance","total_available","total_granted","credit","remaining"):
                                if amount is None and key in data: amount=data.get(key)
                        with store._write() as c:c.execute("UPDATE ai_providers SET balance=?,balance_currency=?,balance_updated_at=? WHERE id=?",(float(amount) if amount is not None else None,currency,int(time.time()),pid))
                        return jsonify({"ok":True,"balance":amount,"currency":currency,"raw":data})
                    last=f"{path}: HTTP {r.status_code}"
                except Exception as e:last=str(e)
        return jsonify({"error":"Провайдер не открыл API баланса","detail":last}),501

    @app.get("/api/admin/traffic")
    def admin_traffic():
        g=_admin_guard()
        if g:return g
        c=store._conn(); since=int(time.time())-30*86400
        sources=[dict(r) for r in c.execute("SELECT COALESCE(NULLIF(utm_source,''),'direct') source,COUNT(*) visits,COUNT(DISTINCT user_id) users FROM events WHERE created_at>=? GROUP BY source ORDER BY visits DESC",(since,))]
        campaigns=[dict(r) for r in c.execute("SELECT utm_campaign campaign,COUNT(*) visits,COUNT(DISTINCT user_id) users FROM events WHERE created_at>=? AND utm_campaign!='' GROUP BY campaign ORDER BY visits DESC",(since,))]
        referrers=[dict(r) for r in c.execute("SELECT COALESCE(NULLIF(referrer,''),'прямой переход') referrer,COUNT(*) visits FROM events WHERE created_at>=? GROUP BY referrer ORDER BY visits DESC LIMIT 10",(since,))]
        events_by_type=[dict(r) for r in c.execute("SELECT event,COUNT(*) count,COUNT(DISTINCT user_id) users FROM events WHERE created_at>=? GROUP BY event ORDER BY count DESC",(since,))]
        daily=[dict(r) for r in c.execute("SELECT date(created_at,'unixepoch') day,COUNT(*) visits,COUNT(DISTINCT user_id) users FROM events WHERE created_at>=? GROUP BY day ORDER BY day",(since,))]
        funnel={"visits":c.execute("SELECT COUNT(DISTINCT session_id) FROM events WHERE created_at>=?",(since,)).fetchone()[0],"users":c.execute("SELECT COUNT(DISTINCT user_id) FROM events WHERE created_at>=? AND user_id IS NOT NULL",(since,)).fetchone()[0],"orders":c.execute("SELECT COUNT(*) FROM orders WHERE created_at>=?",(since,)).fetchone()[0],"paid":c.execute("SELECT COUNT(*) FROM orders WHERE paid_at>=?",(since,)).fetchone()[0],"done":c.execute("SELECT COUNT(*) FROM orders WHERE finished_at>=? AND status='done'",(since,)).fetchone()[0]}
        return jsonify({"sources":sources,"campaigns":campaigns,"referrers":referrers,"events":events_by_type,"daily":daily,"funnel":funnel})

    @app.delete("/api/admin/traffic")
    def admin_traffic_reset():
        g=_admin_guard(True)
        if g:return g
        with store._write() as c:
            n=c.execute("DELETE FROM events").rowcount
            m=c.execute("DELETE FROM visitor_attribution").rowcount
        audit(store,"traffic_reset","traffic","*",f"Сброс статистики трафика: {n} событий, {m} атрибуций")
        return jsonify({"ok":True,"deleted_events":n,"deleted_attributions":m})

    @app.get("/api/admin/audit")
    def admin_audit():
        g=_admin_guard()
        if g:return g
        return jsonify({"audit":[dict(r) for r in store._conn().execute("SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 500")]})

    @app.post("/api/events")
    def capture_event():
        d=request.get_json(silent=True) or {}; uid,_=require_auth(); event=str(d.get("event","page_view"))[:50]
        if event not in {"page_view","login","order_started","order_viewed","report_viewed","topup_started","topup_completed"}:return jsonify({"error":"bad event"}),400
        now=int(time.time()); vid=str(d.get("visitor_id") or "")[:80]; sid=str(d.get("session_id") or vid)[:80]; src=str(d.get("utm_source", ""))[:100]; med=str(d.get("utm_medium", ""))[:100]; camp=str(d.get("utm_campaign", ""))[:150]; ref=str(d.get("referrer", ""))[:500]
        with store._write() as c:
            c.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",("ev_"+uuid.uuid4().hex[:16],uid,sid,event,str(d.get("object_type", ""))[:50],str(d.get("object_id", ""))[:100],_json(d.get("meta",{})),src,med,camp,ref,now))
            if vid:c.execute("INSERT INTO visitor_attribution VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(visitor_id) DO UPDATE SET user_id=COALESCE(excluded.user_id,visitor_attribution.user_id),last_source=excluded.last_source,last_medium=excluded.last_medium,last_campaign=excluded.last_campaign,last_referrer=excluded.last_referrer,last_seen=excluded.last_seen",(vid,uid,src,med,camp,ref,now,src,med,camp,ref,now))
        return jsonify({"ok":True}),201

# zelscan-aki-token-rotation-v1
    def _verify_aki_candidate(token: str):
        import requests as _req
        token = (token or "").strip()
        if not token:
            return False, "Ключ не может быть пустым"
        try:
            r = _req.get(
                "https://aki.io/openai/v1/models",
                headers={"Authorization": f"Bearer {token}"},
                timeout=15,
            )
            if r.status_code == 200:
                return True, "ok"
            return False, f"Aki вернул HTTP {r.status_code}: {r.text[:120]}"
        except Exception as exc:
            return False, f"Ошибка соединения: {exc}"

    @app.post("/api/admin/ai/aki/token/verify")
    def admin_aki_token_verify():
        if not _admin_ok():
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        ok, result = _verify_aki_candidate(data.get("token"))
        return jsonify({"ok": ok, "result": result})

    @app.post("/api/admin/ai/aki/token/replace")
    def admin_aki_token_replace():
        if not _admin_ok():
            return jsonify({"error": "forbidden"}), 403
        data = request.get_json(silent=True) or {}
        token = (data.get("token") or "").strip()
        ok, result = _verify_aki_candidate(token)
        if not ok:
            return jsonify({"ok": False, "error": result})
        encrypted = encrypt_secret(token)
        with store._conn() as w:
            w.execute(
                "UPDATE ai_providers SET encrypted_key=?, enabled=1, updated_at=? WHERE name='Aki.io'",
                (encrypted, int(__import__("time").time()))
            )
        audit(store, "aki_token_replaced", "ai_provider", "Aki.io",
              "Новый Aki-токен проверен и применён через админку")
        return jsonify({"ok": True})

