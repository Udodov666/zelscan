"""
SQLite-backed order store.

Персистентная очередь заказов — переживает рестарты и краши.
Position считается на лету (нет дрейфа при параллельных вставках).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import config
from security import redact_sensitive


def _safe_order_params(params):
    """Remove credentials from current/legacy order payloads before persistence."""
    value = redact_sensitive(params or {})
    if not isinstance(value, dict):
        return {}
    for name in ("ai_config_snapshot", "ai_snapshot"):
        snapshot = value.get(name)
        if isinstance(snapshot, dict):
            slots = snapshot.get("slots") or {}
            snapshot["slots"] = {
                slot: {
                    key: item
                    for key, item in spec.items()
                    if key not in {"api_key", "encrypted_key", "token", "secret", "password"}
                }
                for slot, spec in slots.items()
                if isinstance(spec, dict)
            }
    return value


# ── статусы ──────────────────────────────────────────────────────────────────
class Status:
    PENDING = "pending_payment"   # создан, не оплачен
    PAID    = "paid"              # оплачен, ждёт воркера
    RUNNING = "running"           # воркер взял
    DONE    = "done"              # готово
    ERROR   = "error"             # упал
    EXPIRED = "expired"           # не оплачен > 1ч


_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS users (
    user_id       INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL DEFAULT '',
    avatar        TEXT    DEFAULT '',
    message_count INTEGER DEFAULT 0,
    is_banned     INTEGER DEFAULT 0,
    credits       REAL    NOT NULL DEFAULT 0,
    total_orders  INTEGER NOT NULL DEFAULT 0,
    first_seen    INTEGER NOT NULL,
    last_seen     INTEGER NOT NULL,
    user_group    TEXT    NOT NULL DEFAULT 'regular'
);

CREATE TABLE IF NOT EXISTS orders (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    username      TEXT    DEFAULT '',
    username_html TEXT    DEFAULT '',
    avatar        TEXT    DEFAULT '',
    report_type   TEXT    NOT NULL DEFAULT 'basic',
    status        TEXT    NOT NULL DEFAULT 'pending_payment',
    progress_json TEXT,
    result_path   TEXT,
    error         TEXT,
    params_json   TEXT,
    payment_id    TEXT,
    buyer_id      TEXT,
    created_at    INTEGER NOT NULL,
    paid_at       INTEGER,
    started_at    INTEGER,
    finished_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_uid     ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_status ON orders(buyer_id, status);

CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    amount_rub  REAL    NOT NULL DEFAULT 0,
    credits     REAL    NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'pending',
    provider    TEXT    NOT NULL DEFAULT 'zelenka',
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created
ON transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS promo_codes (
    code        TEXT    PRIMARY KEY,
    bonus       REAL    NOT NULL,
    bonus_type  TEXT    NOT NULL DEFAULT 'bonus',
    value_type  TEXT    NOT NULL DEFAULT 'fixed',
    max_uses    INTEGER NOT NULL DEFAULT 1,
    used_count  INTEGER NOT NULL DEFAULT 0,
    per_user    INTEGER NOT NULL DEFAULT 1,
    budget      REAL,
    spent       REAL    NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    expires_at  INTEGER,
    created_at  INTEGER NOT NULL,
    description TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    id          TEXT    PRIMARY KEY,
    code        TEXT    NOT NULL,
    user_id     INTEGER NOT NULL,
    bonus       REAL    NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code_user
ON promo_redemptions(code, user_id);

-- ── Автографы и история досье ───────────────────────────────────────────────
-- Аналитический объект: якорь по (subject_user_id, report_type).
CREATE TABLE IF NOT EXISTS dossier_subjects (
    id                              TEXT PRIMARY KEY,
    subject_user_id                 INTEGER NOT NULL,
    report_type                     TEXT    NOT NULL DEFAULT 'basic',
    subject_username_snapshot       TEXT    NOT NULL DEFAULT '',
    subject_username_html_snapshot  TEXT    NOT NULL DEFAULT '',
    subject_avatar_snapshot         TEXT    NOT NULL DEFAULT '',
    owners_count                    INTEGER NOT NULL DEFAULT 0,
    created_at                      INTEGER NOT NULL,
    updated_at                      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_subjects_uid_type
ON dossier_subjects(subject_user_id, report_type);
CREATE INDEX IF NOT EXISTS idx_dossier_subjects_uid ON dossier_subjects(subject_user_id);

-- Версия = независимый результат конкретной покупки/обновления. Версии вечны.
CREATE TABLE IF NOT EXISTS dossier_versions (
    id                    TEXT PRIMARY KEY,
    subject_id            TEXT    NOT NULL,
    order_id              TEXT    NOT NULL,
    owner_user_id         INTEGER NOT NULL,
    result_path           TEXT,
    visibility            TEXT    NOT NULL DEFAULT 'private',
    is_current_for_owner  INTEGER NOT NULL DEFAULT 1,
    created_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dossier_versions_subject ON dossier_versions(subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dossier_versions_owner   ON dossier_versions(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_dossier_versions_order   ON dossier_versions(order_id);

-- Журнал истории (append-only). Смена видимости сюда НЕ пишется.
CREATE TABLE IF NOT EXISTS dossier_events (
    id                            TEXT PRIMARY KEY,
    subject_id                    TEXT    NOT NULL,
    version_id                    TEXT,
    type                          TEXT    NOT NULL,   -- created | reacquired | updated
    actor_user_id                 INTEGER NOT NULL,
    role                          TEXT    NOT NULL,   -- author | owner | updater
    actor_username_snapshot       TEXT    NOT NULL DEFAULT '',
    actor_username_html_snapshot  TEXT    NOT NULL DEFAULT '',
    actor_avatar_snapshot         TEXT    NOT NULL DEFAULT '',
    created_at                    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dossier_events_subject ON dossier_events(subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dossier_events_actor   ON dossier_events(actor_user_id);

-- Рисованная подпись, привязана к событию. Immutable: не редактируется/не удаляется.
CREATE TABLE IF NOT EXISTS dossier_autographs (
    id               TEXT PRIMARY KEY,
    event_id         TEXT    NOT NULL,
    subject_id       TEXT    NOT NULL,
    author_user_id   INTEGER NOT NULL,
    signature_image  TEXT    NOT NULL DEFAULT '',
    signed_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dossier_autographs_event   ON dossier_autographs(event_id);
CREATE INDEX IF NOT EXISTS idx_dossier_autographs_subject ON dossier_autographs(subject_id);

-- One durable, pseudonymous viewer window per report version.
CREATE TABLE IF NOT EXISTS dossier_view_windows (
    order_id          TEXT    NOT NULL,
    viewer_key        TEXT    NOT NULL,
    window_started_at INTEGER NOT NULL,
    PRIMARY KEY (order_id, viewer_key)
);

-- ── Пользовательские настройки (1 строка на пользователя) ───────────────────
CREATE TABLE IF NOT EXISTS user_settings (
    user_id              INTEGER PRIMARY KEY,
    show_balance         INTEGER NOT NULL DEFAULT 0,
    notifications_enabled INTEGER NOT NULL DEFAULT 1,
    notify_dossier_ready  INTEGER NOT NULL DEFAULT 1,
    notify_formation_error INTEGER NOT NULL DEFAULT 1,
    notify_balance_topup  INTEGER NOT NULL DEFAULT 1,
    notify_news          INTEGER NOT NULL DEFAULT 1,
    notify_important     INTEGER NOT NULL DEFAULT 1,
    auto_open_dossier    INTEGER NOT NULL DEFAULT 0,
    remember_tariff      INTEGER NOT NULL DEFAULT 1,
    last_tariff          TEXT    NOT NULL DEFAULT 'basic',
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

-- ── Уведомления пользователя ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    type        TEXT    NOT NULL,   -- dossier_ready | formation_error | balance_topup | news
    title       TEXT    NOT NULL DEFAULT '',
    body        TEXT    NOT NULL DEFAULT '',
    meta_json   TEXT,
    dedupe_key  TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, is_read);

-- ── Журнал админских рассылок уведомлений ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_broadcasts (
    id             TEXT    PRIMARY KEY,
    admin_id       INTEGER NOT NULL DEFAULT 0,
    type           TEXT    NOT NULL,
    title          TEXT    NOT NULL DEFAULT '',
    body           TEXT    NOT NULL DEFAULT '',
    segment        TEXT    NOT NULL DEFAULT 'all',
    user_group     TEXT    NOT NULL DEFAULT '',
    target_user_id INTEGER,
    targeted       INTEGER NOT NULL DEFAULT 0,
    delivered      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created
ON admin_broadcasts(created_at DESC);

-- ── Новости (посты продукта) ───────────────────────────────────────────────
-- Создавать/редактировать/удалять может только админ (udodov). Лайкать — любой
-- авторизованный пользователь; лайки хранятся в news_likes (уникально на юзера).
CREATE TABLE IF NOT EXISTS news_posts (
    id            TEXT    PRIMARY KEY,
    author_id     INTEGER NOT NULL,
    author_name   TEXT    NOT NULL DEFAULT '',
    author_avatar TEXT    NOT NULL DEFAULT '',
    title         TEXT    NOT NULL DEFAULT '',
    body         TEXT    NOT NULL DEFAULT '',
    tags_json    TEXT    NOT NULL DEFAULT '[]',
    like_count   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_posts_created ON news_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS news_likes (
    post_id    TEXT    NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_news_likes_user ON news_likes(user_id);

-- opaque browser sessions (cookie -> user). Persisted so a backend restart
-- does NOT log everyone out. `user_json` is the same user dict the API returns.
CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT    PRIMARY KEY,
    user_id    INTEGER,
    user_json  TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
"""


class OrderStore:
    """Thread-safe SQLite order store с WAL-режимом."""

    def __init__(self, db_path: Path = config.DB_PATH):
        self._db_path  = db_path
        self._local    = threading.local()
        self._wlock    = threading.Lock()   # сериализуем запись
        self._init_db()

    # ── connection ────────────────────────────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        """Один коннект на поток (WAL позволяет параллельные чтения)."""
        if not getattr(self._local, "conn", None):
            conn = sqlite3.connect(str(self._db_path), check_same_thread=False, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = conn
        return self._local.conn

    def _init_db(self):
        with self._wlock:
            self._conn().executescript(_CREATE_SQL)
            cols = {r[1] for r in self._conn().execute("PRAGMA table_info(orders)")}
            migrations = {
                "username_html": "TEXT DEFAULT ''",
                "visibility": "TEXT NOT NULL DEFAULT 'private'",
                "display_id": "TEXT",
                "share_token_hash": "TEXT",
                "share_token_created_at": "INTEGER",
                "view_count": "INTEGER NOT NULL DEFAULT 0",
                "updated_at": "INTEGER",
                "signature_data": "TEXT",
                "deleted_at": "INTEGER",
                "refunded_at": "INTEGER",
                "idempotency_key": "TEXT",
                "request_hash": "TEXT",
                "charge_credits": "REAL NOT NULL DEFAULT 0",
                "charge_bonus": "REAL NOT NULL DEFAULT 0",
                "collected_message_count": "INTEGER",
                "collected_message_counts_json": "TEXT",
            }
            for name, decl in migrations.items():
                if name not in cols:
                    self._conn().execute(f"ALTER TABLE orders ADD COLUMN {name} {decl}")
            # миграция users: бонусные рубли (валюта Б) — частичная оплата
            ucols = {r[1] for r in self._conn().execute("PRAGMA table_info(users)")}
            user_migrations = {
                "bonus_credits": "REAL NOT NULL DEFAULT 0",
                "bonus_type": "TEXT NOT NULL DEFAULT 'bonus'",
                "username_html": "TEXT NOT NULL DEFAULT ''",
            }
            for name, decl in user_migrations.items():
                if name not in ucols:
                    self._conn().execute(f"ALTER TABLE users ADD COLUMN {name} {decl}")
            # миграция promo_codes: новые поля для гибкой системы
            pcols = {r[1] for r in self._conn().execute("PRAGMA table_info(promo_codes)")}
            promo_migrations = {
                "bonus_type": "TEXT NOT NULL DEFAULT 'bonus'",  # 'bonus' или 'credits' (рубли)
                "value_type": "TEXT NOT NULL DEFAULT 'fixed'",  # 'fixed' или 'percent'
                "budget": "REAL",  # суммарный лимит выдачи
                "spent": "REAL NOT NULL DEFAULT 0",  # сколько уже выдано
                "description": "TEXT NOT NULL DEFAULT ''",  # комментарий админа
            }
            for name, decl in promo_migrations.items():
                if name not in pcols:
                    self._conn().execute(f"ALTER TABLE promo_codes ADD COLUMN {name} {decl}")
            self._conn().execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_display_id ON orders(display_id)")
            self._conn().execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_buyer_idempotency ON orders(buyer_id, idempotency_key) WHERE idempotency_key IS NOT NULL")
            self._conn().execute("CREATE INDEX IF NOT EXISTS idx_orders_visibility ON orders(visibility, finished_at DESC)")
            rows = self._conn().execute("SELECT id FROM orders WHERE display_id IS NULL OR display_id='' ").fetchall()
            for row in rows:
                self._conn().execute("UPDATE orders SET display_id=? WHERE id=?", ("ZS-" + row["id"][:8].upper(), row["id"]))
            # миграция user_settings: новые поля-переключатели (на случай старой БД)
            scols = {r[1] for r in self._conn().execute("PRAGMA table_info(user_settings)")}
            settings_migrations = {
                "show_balance": "INTEGER NOT NULL DEFAULT 0",
                "notifications_enabled": "INTEGER NOT NULL DEFAULT 1",
                "notify_dossier_ready": "INTEGER NOT NULL DEFAULT 1",
                "notify_formation_error": "INTEGER NOT NULL DEFAULT 1",
                "notify_balance_topup": "INTEGER NOT NULL DEFAULT 1",
                "notify_news": "INTEGER NOT NULL DEFAULT 1",
                "notify_important": "INTEGER NOT NULL DEFAULT 1",
                "auto_open_dossier": "INTEGER NOT NULL DEFAULT 0",
                "remember_tariff": "INTEGER NOT NULL DEFAULT 1",
                "last_tariff": "TEXT NOT NULL DEFAULT 'basic'",
            }
            if scols:  # таблица уже была — доводим схему
                for name, decl in settings_migrations.items():
                    if name not in scols:
                        self._conn().execute(f"ALTER TABLE user_settings ADD COLUMN {name} {decl}")
            news_cols = {r[1] for r in self._conn().execute("PRAGMA table_info(news_posts)")}
            for name in ("author_name", "author_avatar"):
                if name not in news_cols:
                    self._conn().execute(
                        f"ALTER TABLE news_posts ADD COLUMN {name} TEXT NOT NULL DEFAULT ''"
                    )
            # Snapshot the public author identity onto each post. This makes the
            # feed independent of the viewer/session and of later user-cache state.
            self._conn().execute(
                """UPDATE news_posts
                   SET author_name=COALESCE(NULLIF(author_name, ''),
                       (SELECT username FROM users WHERE users.user_id=news_posts.author_id), ''),
                       author_avatar=COALESCE(NULLIF(author_avatar, ''),
                       (SELECT avatar FROM users WHERE users.user_id=news_posts.author_id), '')
                   WHERE author_name='' OR author_avatar=''"""
            )
            ncols = {r[1] for r in self._conn().execute("PRAGMA table_info(notifications)")}
            if "dedupe_key" not in ncols:
                self._conn().execute("ALTER TABLE notifications ADD COLUMN dedupe_key TEXT")
            self._conn().execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe "
                "ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL"
            )
            self._conn().execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_refund_order "
                "ON transactions(description) WHERE kind='refund'"
            )
            # Cross-process guard: one unfinished order per buyer, regardless
            # of target, tariff, or whether the order is a refresh.
            self._conn().execute("DROP INDEX IF EXISTS idx_orders_one_active_refresh")
            self._conn().execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_active_buyer "
                "ON orders(buyer_id) "
                "WHERE buyer_id IS NOT NULL AND buyer_id != '' "
                "AND status IN ('pending_payment','paid','running')"
            )
            self._conn().commit()

    @contextmanager
    def _write(self):
        with self._wlock:
            conn = self._conn()
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise

    # ── BROWSER SESSIONS (persistent) ─────────────────────────────────────────
    # Opaque cookie -> user mapping, stored in SQLite so a backend restart does
    # NOT invalidate everyone's login. `user` is the same dict the API returns.

    def session_create(self, sid: str, user: dict, expires_at: int) -> None:
        uid = None
        if isinstance(user, dict):
            try:
                uid = int(user.get("user_id")) if user.get("user_id") is not None else None
            except (TypeError, ValueError):
                uid = None
        with self._write() as c:
            c.execute(
                "INSERT OR REPLACE INTO sessions (sid, user_id, user_json, created_at, expires_at) "
                "VALUES (?,?,?,?,?)",
                (sid, uid, json.dumps(user, ensure_ascii=False), int(time.time()), int(expires_at)),
            )

    def session_get(self, sid: str) -> Optional[dict]:
        """Return {"user", "expires_at"} for a live session, else None.

        Expired rows are deleted lazily on read.
        """
        if not sid:
            return None
        row = self._conn().execute(
            "SELECT user_json, expires_at FROM sessions WHERE sid=?", (sid,)
        ).fetchone()
        if not row:
            return None
        if float(row["expires_at"]) <= time.time():
            self.session_delete(sid)
            return None
        try:
            user = json.loads(row["user_json"])
        except (TypeError, ValueError):
            return None
        return {"user": user, "expires_at": int(row["expires_at"])}

    def session_delete(self, sid: str) -> None:
        if not sid:
            return
        with self._write() as c:
            c.execute("DELETE FROM sessions WHERE sid=?", (sid,))

    def session_gc(self) -> int:
        """Purge expired sessions. Returns number of rows removed."""
        with self._write() as c:
            cur = c.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
            return cur.rowcount or 0

    # ── USER SETTINGS ─────────────────────────────────────────────────────────

    # Публичный контракт настроек: имя поля -> дефолт. Порядок фиксирован.
    _SETTINGS_DEFAULTS = {
        "show_balance": False,
        "notifications_enabled": True,
        "notify_dossier_ready": True,
        "notify_formation_error": True,
        "notify_balance_topup": True,
        "notify_news": True,
        "notify_important": True,
        "auto_open_dossier": False,
        "remember_tariff": True,
        "last_tariff": "basic",
    }
    _SETTINGS_BOOL_FIELDS = (
        "show_balance", "notifications_enabled", "notify_dossier_ready",
        "notify_formation_error", "notify_balance_topup", "notify_news",
        "notify_important", "auto_open_dossier", "remember_tariff",
    )
    _ALLOWED_TARIFFS = ("basic", "pro")

    def _row_to_settings(self, row) -> dict:
        """Нормализовать строку БД в публичный контракт (bool + last_tariff)."""
        d = {}
        for k in self._SETTINGS_BOOL_FIELDS:
            d[k] = bool(row[k])
        lt = row["last_tariff"] if row["last_tariff"] in self._ALLOWED_TARIFFS else "basic"
        d["last_tariff"] = lt
        return d

    def get_settings(self, user_id: int) -> dict:
        """Вернуть настройки пользователя. Если строки нет — дефолты (без записи)."""
        row = self._conn().execute(
            "SELECT * FROM user_settings WHERE user_id=?", (user_id,)
        ).fetchone()
        if not row:
            return dict(self._SETTINGS_DEFAULTS)
        return self._row_to_settings(row)

    def _ensure_settings_row(self, conn, user_id: int) -> None:
        now = int(time.time())
        d = self._SETTINGS_DEFAULTS
        conn.execute(
            """INSERT OR IGNORE INTO user_settings
               (user_id, show_balance, notifications_enabled, notify_dossier_ready,
                notify_formation_error, notify_balance_topup, notify_news, notify_important,
                auto_open_dossier, remember_tariff, last_tariff, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, int(d["show_balance"]), int(d["notifications_enabled"]),
             int(d["notify_dossier_ready"]), int(d["notify_formation_error"]),
             int(d["notify_balance_topup"]), int(d["notify_news"]), int(d["notify_important"]),
             int(d["auto_open_dossier"]), int(d["remember_tariff"]),
             d["last_tariff"], now, now),
        )

    def patch_settings(self, user_id: int, patch: dict) -> dict:
        """Частично обновить настройки. Принимает ТОЛЬКО whitelisted-поля.
        Неизвестные поля игнорируются. Возвращает актуальные настройки."""
        patch = patch or {}
        set_parts, params = [], []
        for field in self._SETTINGS_BOOL_FIELDS:
            if field in patch:
                set_parts.append(f"{field}=?")
                params.append(int(bool(patch[field])))
        if "last_tariff" in patch:
            val = patch["last_tariff"]
            if val in self._ALLOWED_TARIFFS:
                set_parts.append("last_tariff=?")
                params.append(val)
        with self._write() as c:
            self._ensure_settings_row(c, user_id)
            if set_parts:
                params.append(int(time.time()))
                params.append(user_id)
                c.execute(
                    f"UPDATE user_settings SET {', '.join(set_parts)}, updated_at=? WHERE user_id=?",
                    tuple(params),
                )
        return self.get_settings(user_id)

    # ── NOTIFICATIONS ─────────────────────────────────────────────────────────

    _NOTIFICATION_TYPES = ("dossier_ready", "formation_error", "balance_topup", "news", "important")

    def create_notification(self, user_id: int, ntype: str,
                            title: str = "", body: str = "",
                            meta: Optional[dict] = None) -> Optional[dict]:
        """Создать уведомление, если тип разрешён настройками пользователя.
        Возвращает созданную запись либо None (если пользователь отключил тип)."""
        if ntype not in self._NOTIFICATION_TYPES:
            return None
        st = self.get_settings(user_id)
        if not st.get("notifications_enabled", True):
            return None
        per_type_flag = {
            "dossier_ready": "notify_dossier_ready",
            "formation_error": "notify_formation_error",
            "balance_topup": "notify_balance_topup",
            "news": "notify_news",
            "important": "notify_important",
        }[ntype]
        if not st.get(per_type_flag, True):
            return None
        meta = dict(meta or {})
        dedupe_key = str(meta.pop("dedupe_key", "") or "").strip() or None
        nid = uuid.uuid4().hex
        now = int(time.time())
        meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
        with self._write() as c:
            if dedupe_key:
                existing = c.execute(
                    "SELECT id FROM notifications WHERE user_id=? AND dedupe_key=?",
                    (user_id, dedupe_key),
                ).fetchone()
                if existing:
                    return self.get_notification(existing["id"])
            try:
                c.execute(
                    """INSERT INTO notifications
                       (id, user_id, type, title, body, meta_json, dedupe_key, is_read, created_at)
                       VALUES (?,?,?,?,?,?,?,0,?)""",
                    (nid, user_id, ntype, title, body, meta_json, dedupe_key, now),
                )
            except sqlite3.IntegrityError:
                if not dedupe_key:
                    raise
                existing = c.execute(
                    "SELECT id FROM notifications WHERE user_id=? AND dedupe_key=?",
                    (user_id, dedupe_key),
                ).fetchone()
                if existing:
                    return self.get_notification(existing["id"])
                raise
        return self.get_notification(nid)

    def create_terminal_notification(self, order: dict, status: str,
                                     error: str = "") -> Optional[dict]:
        """Create one deterministic terminal notification for the order owner."""
        order_id = str(order["id"])
        recipient = int(order.get("buyer_id") or order.get("user_id"))
        report_type = order.get("report_type", "basic")
        display_id = order.get("display_id") or ("ZS-" + order_id[:8].upper())
        url = "zelscan.html?order=" + order_id
        if status == Status.DONE:
            is_update = bool((order.get("params") or {}).get("refresh", False))
            return self.create_notification(
                recipient, "dossier_ready",
                title="Досье обновлено" if is_update else "Досье готово",
                body=(f"Обновлённое досье {display_id} готово к просмотру."
                      if is_update else f"Досье {display_id} сформировано и готово к просмотру."),
                meta={"order_id": order_id, "display_id": display_id,
                      "report_type": report_type, "is_update": is_update,
                      "url": url, "dedupe_key": f"order:{order_id}:done"},
            )
        if status == Status.ERROR:
            return self.create_notification(
                recipient, "formation_error", title="Ошибка формирования досье",
                body="При формировании отчёта произошла ошибка. Средства не списаны или будут возвращены.",
                meta={"order_id": order_id, "display_id": display_id,
                      "report_type": report_type, "url": url,
                      "dedupe_key": f"order:{order_id}:error"},
            )
        raise ValueError(f"Unsupported terminal status: {status}")

    # ── NEWS (посты продукта) ─────────────────────────────────────────────────

    def _row_to_news(self, row, liked: bool = False) -> dict:
        """Нормализовать строку news_posts в публичный контракт."""
        try:
            tags = json.loads(row["tags_json"] or "[]")
            if not isinstance(tags, list):
                tags = []
        except (ValueError, TypeError):
            tags = []
        keys = set(row.keys())
        return {
            "id": row["id"],
            "author_id": int(row["author_id"]),
            "author_name": ((row["resolved_author_name"] or "")
                            if "resolved_author_name" in keys
                            else ((row["author_name"] or "") if "author_name" in keys else "")),
            "author_avatar": ((row["resolved_author_avatar"] or "")
                              if "resolved_author_avatar" in keys
                              else ((row["author_avatar"] or "") if "author_avatar" in keys else "")),
            "title": row["title"] or "",
            "body": row["body"] or "",
            "tags": [str(t) for t in tags],
            "like_count": int(row["like_count"] or 0),
            "liked": bool(liked),
            "created_at": int(row["created_at"]),
            "updated_at": int(row["updated_at"]),
        }

    def list_news(self, viewer_id: Optional[int] = None, limit: int = 100) -> list:
        """Лента новостей (новые сверху). liked проставляется для viewer_id."""
        limit = max(1, min(int(limit or 100), 200))
        rows = self._conn().execute(
            """SELECT n.*,
                      COALESCE(NULLIF(n.author_name, ''), u.username, '') AS resolved_author_name,
                      COALESCE(NULLIF(n.author_avatar, ''), u.avatar, '') AS resolved_author_avatar
               FROM news_posts AS n
               LEFT JOIN users AS u ON u.user_id=n.author_id
               ORDER BY n.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        liked_ids = set()
        if viewer_id and rows:
            ids = [r["id"] for r in rows]
            placeholders = ",".join("?" for _ in ids)
            lrows = self._conn().execute(
                f"SELECT post_id FROM news_likes WHERE user_id=? AND post_id IN ({placeholders})",
                (viewer_id, *ids),
            ).fetchall()
            liked_ids = {lr["post_id"] for lr in lrows}
        return [self._row_to_news(r, r["id"] in liked_ids) for r in rows]

    def get_news_post(self, post_id: str, viewer_id: Optional[int] = None) -> Optional[dict]:
        row = self._conn().execute(
            """SELECT n.*,
                      COALESCE(NULLIF(n.author_name, ''), u.username, '') AS resolved_author_name,
                      COALESCE(NULLIF(n.author_avatar, ''), u.avatar, '') AS resolved_author_avatar
               FROM news_posts AS n
               LEFT JOIN users AS u ON u.user_id=n.author_id
               WHERE n.id=?""",
            (post_id,),
        ).fetchone()
        if not row:
            return None
        liked = False
        if viewer_id:
            liked = self._conn().execute(
                "SELECT 1 FROM news_likes WHERE post_id=? AND user_id=?", (post_id, viewer_id)
            ).fetchone() is not None
        return self._row_to_news(row, liked)

    def create_news_post(self, author_id: int, title: str, body: str,
                         tags: Optional[list] = None) -> dict:
        pid = uuid.uuid4().hex
        now = int(time.time())
        tags_json = json.dumps([str(t) for t in (tags or [])], ensure_ascii=False)
        with self._write() as c:
            author = c.execute(
                "SELECT username, avatar FROM users WHERE user_id=?", (int(author_id),)
            ).fetchone()
            author_name = (author["username"] or "") if author else ""
            author_avatar = (author["avatar"] or "") if author else ""
            c.execute(
                """INSERT INTO news_posts
                   (id, author_id, author_name, author_avatar, title, body, tags_json,
                    like_count, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,0,?,?)""",
                (pid, int(author_id), author_name, author_avatar, title or "",
                 body or "", tags_json, now, now),
            )
        return self.get_news_post(pid)

    def update_news_post(self, post_id: str, title: str, body: str,
                         tags: Optional[list] = None) -> Optional[dict]:
        now = int(time.time())
        tags_json = json.dumps([str(t) for t in (tags or [])], ensure_ascii=False)
        with self._write() as c:
            cur = c.execute(
                "UPDATE news_posts SET title=?, body=?, tags_json=?, updated_at=? WHERE id=?",
                (title or "", body or "", tags_json, now, post_id),
            )
            if cur.rowcount == 0:
                return None
        return self.get_news_post(post_id)

    def delete_news_post(self, post_id: str) -> bool:
        with self._write() as c:
            cur = c.execute("DELETE FROM news_posts WHERE id=?", (post_id,))
            c.execute("DELETE FROM news_likes WHERE post_id=?", (post_id,))
            return cur.rowcount > 0

    def toggle_news_like(self, post_id: str, user_id: int) -> Optional[dict]:
        """Поставить/снять лайк. Возвращает {'liked','like_count'} или None если поста нет."""
        now = int(time.time())
        with self._write() as c:
            exists = c.execute("SELECT 1 FROM news_posts WHERE id=?", (post_id,)).fetchone()
            if not exists:
                return None
            already = c.execute(
                "SELECT 1 FROM news_likes WHERE post_id=? AND user_id=?", (post_id, user_id)
            ).fetchone()
            if already:
                c.execute("DELETE FROM news_likes WHERE post_id=? AND user_id=?", (post_id, user_id))
                liked = False
            else:
                c.execute(
                    "INSERT OR IGNORE INTO news_likes (post_id, user_id, created_at) VALUES (?,?,?)",
                    (post_id, user_id, now),
                )
                liked = True
            cnt = c.execute(
                "SELECT COUNT(*) AS n FROM news_likes WHERE post_id=?", (post_id,)
            ).fetchone()["n"]
            c.execute("UPDATE news_posts SET like_count=? WHERE id=?", (int(cnt), post_id))
        return {"liked": liked, "like_count": int(cnt)}

    # ── Админ-рассылки уведомлений (broadcast) ────────────────────────────────
    _BROADCAST_SEGMENTS = (
        "all", "buyers", "no_orders", "has_balance", "active_30d",
    )

    def _segment_user_ids(self, segment: str, group: str = "") -> list[int]:
        """Список user_id по сегменту аудитории (забаненные исключаются)."""
        c = self._conn()
        seg = (segment or "all").strip()
        base = "SELECT user_id FROM users WHERE is_banned=0"
        if seg == "all":
            rows = c.execute(base).fetchall()
        elif seg == "buyers":
            rows = c.execute(base + " AND total_orders>0").fetchall()
        elif seg == "no_orders":
            rows = c.execute(base + " AND total_orders=0").fetchall()
        elif seg == "has_balance":
            rows = c.execute(base + " AND credits>0").fetchall()
        elif seg == "active_30d":
            cutoff = int(time.time()) - 30 * 86400
            rows = c.execute(base + " AND last_seen>=?", (cutoff,)).fetchall()
        elif seg == "group":
            rows = c.execute(base + " AND user_group=?", (str(group or "regular"),)).fetchall()
        else:
            rows = []
        return [int(r[0]) for r in rows]

    def segment_sizes(self) -> dict:
        """Размеры каждого сегмента — для показа в админке перед рассылкой."""
        c = self._conn()
        def _count(where: str, args: tuple = ()):
            return int(c.execute(
                "SELECT COUNT(*) FROM users WHERE is_banned=0" + where, args
            ).fetchone()[0])
        cutoff = int(time.time()) - 30 * 86400
        groups = [dict(r) for r in c.execute(
            "SELECT user_group, COUNT(*) cnt FROM users WHERE is_banned=0 "
            "GROUP BY user_group ORDER BY cnt DESC"
        ).fetchall()]
        return {
            "all": _count(""),
            "buyers": _count(" AND total_orders>0"),
            "no_orders": _count(" AND total_orders=0"),
            "has_balance": _count(" AND credits>0"),
            "active_30d": _count(" AND last_seen>=?", (cutoff,)),
            "groups": groups,
        }

    def broadcast_notification(self, ntype: str, title: str, body: str,
                               segment: str = "all", group: str = "",
                               user_id: Optional[int] = None,
                               admin_id: int = 0,
                               meta: Optional[dict] = None) -> dict:
        """Разослать уведомление по сегменту (или одному user_id).

        create_notification уважает настройки получателя, поэтому
        реально доставленных может быть меньше, чем всего в сегменте.
        Возвращает {broadcast_id, targeted, delivered}.
        """
        if ntype not in self._NOTIFICATION_TYPES:
            raise ValueError("Недопустимый тип уведомления")
        title = (title or "").strip()
        body = (body or "").strip()
        if not title and not body:
            raise ValueError("Заголовок или текст обязательны")

        if segment == "user":
            if not user_id:
                raise ValueError("Не указан user_id")
            targets = [int(user_id)]
        else:
            targets = self._segment_user_ids(segment, group)

        bid = "bc_" + uuid.uuid4().hex[:12]
        # Помечаем каждое доставленное уведомление broadcast_id, чтобы при
        # удалении рассылки из админки можно было убрать её и у пользователей.
        notif_meta = dict(meta or {})
        notif_meta["broadcast_id"] = bid

        delivered = 0
        for uid in targets:
            if self.create_notification(uid, ntype, title=title, body=body, meta=notif_meta):
                delivered += 1

        now = int(time.time())
        with self._write() as c:
            c.execute(
                """INSERT INTO admin_broadcasts
                   (id, admin_id, type, title, body, segment, user_group,
                    target_user_id, targeted, delivered, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (bid, int(admin_id or 0), ntype, title, body, segment,
                 str(group or ""), (int(user_id) if user_id else None),
                 len(targets), delivered, now),
            )
        return {"broadcast_id": bid, "targeted": len(targets), "delivered": delivered}

    def list_broadcasts(self, limit: int = 100) -> list[dict]:
        limit = max(1, min(500, int(limit)))
        rows = self._conn().execute(
            "SELECT * FROM admin_broadcasts ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_broadcast(self, bid: str) -> bool:
        """Удалить рассылку из журнала И все доставленные ею пользовательские
        уведомления (связь через meta_json.broadcast_id), чтобы удаление в
        админке отражалось и в личном кабинете пользователя."""
        bid = (bid or "").strip()
        if not bid:
            return False
        with self._write() as c:
            # Сначала убираем уведомления у пользователей, помеченные этим broadcast_id.
            try:
                c.execute(
                    "DELETE FROM notifications "
                    "WHERE json_extract(meta_json, '$.broadcast_id')=?",
                    (bid,),
                )
            except Exception:
                # На случай сборки SQLite без JSON1 — фолбэк по подстроке.
                c.execute(
                    "DELETE FROM notifications WHERE meta_json LIKE ?",
                    ('%"broadcast_id": "' + bid + '"%',),
                )
            cur = c.execute("DELETE FROM admin_broadcasts WHERE id=?", (bid,))
        return cur.rowcount > 0

    def get_notification(self, nid: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT * FROM notifications WHERE id=?", (nid,)
        ).fetchone()
        return self._row_to_notification(row) if row else None

    def _row_to_notification(self, row) -> dict:
        d = dict(row)
        d["is_read"] = bool(d.get("is_read"))
        meta = d.pop("meta_json", None)
        try:
            d["meta"] = json.loads(meta) if meta else None
        except Exception:
            d["meta"] = None
        return d

    def list_notifications(self, user_id: int, limit: int = 50,
                           unread_only: bool = False) -> list[dict]:
        limit = max(1, min(int(limit or 50), 200))
        q = "SELECT * FROM notifications WHERE user_id=?"
        params: list = [user_id]
        if unread_only:
            q += " AND is_read=0"
        q += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = self._conn().execute(q, tuple(params)).fetchall()
        return [self._row_to_notification(r) for r in rows]

    def count_unread_notifications(self, user_id: int) -> int:
        row = self._conn().execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",
            (user_id,),
        ).fetchone()
        return row[0] if row else 0

    def mark_notification_read(self, user_id: int, nid: str,
                               is_read: bool = True) -> bool:
        """Отметить уведомление прочитанным/непрочитанным. Только владелец."""
        with self._write() as c:
            cur = c.execute(
                "UPDATE notifications SET is_read=? WHERE id=? AND user_id=?",
                (int(bool(is_read)), nid, user_id),
            )
        return cur.rowcount > 0

    def mark_all_notifications_read(
        self, user_id: int, *, notification_ids: Optional[list[str]] = None
    ) -> int:
        """Mark only the notifications observed by the client as read.

        Passing IDs prevents a concurrent notification created after the list response
        from being accidentally consumed. An omitted list preserves the legacy contract.
        """
        with self._write() as c:
            if notification_ids is None:
                cur = c.execute(
                    "UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0",
                    (user_id,),
                )
            else:
                ids = list(dict.fromkeys(str(nid) for nid in notification_ids if nid))
                if not ids:
                    return 0
                placeholders = ",".join("?" for _ in ids)
                cur = c.execute(
                    f"UPDATE notifications SET is_read=1 "
                    f"WHERE user_id=? AND is_read=0 AND id IN ({placeholders})",
                    (user_id, *ids),
                )
        return cur.rowcount

    def delete_all_notifications(self, user_id: int) -> int:
        """Удалить все уведомления только указанного владельца."""
        with self._write() as c:
            cur = c.execute(
                "DELETE FROM notifications WHERE user_id=?",
                (user_id,),
            )
        return cur.rowcount

    # ── УДАЛЕНИЕ ДАННЫХ ПОЛЬЗОВАТЕЛЯ ──────────────────────────────────────────

    # Заказы, которые нельзя трогать при удалении (данные ещё формируются).
    _ACTIVE_ORDER_STATUSES = ("paid", "running")

    def has_active_orders(self, user_id: int) -> bool:
        """True if this purchaser has a paid/running order."""
        placeholders = ",".join("?" for _ in self._ACTIVE_ORDER_STATUSES)
        row = self._conn().execute(
            f"SELECT 1 FROM orders WHERE buyer_id=? AND status IN ({placeholders}) LIMIT 1",
            (str(user_id), *self._ACTIVE_ORDER_STATUSES),
        ).fetchone()
        return bool(row)

    def delete_user_data(self, user_id: int) -> dict:
        """Revoke personal UI data without destroying paid reports or audit.

        Orders, result files, dossier history/versions, transactions and promo
        redemptions are retained.  Orders bought by the account are soft-hidden
        and sharing is revoked; ephemeral settings and notifications are removed.
        """
        if self.has_active_orders(user_id):
            return {
                "ok": False,
                "code": "active_order",
                "error": "Дождитесь завершения активного заказа перед удалением данных.",
            }

        deleted = {
            "dossier_versions": 0,
            "dossier_subjects": 0,
            "orders": 0,
            "view_windows": 0,
            "transactions": 0,
            "promo_redemptions": 0,
            "notifications": 0,
            "settings": 0,
            "result_files": 0,
        }
        now = int(time.time())
        with self._write() as c:
            # buyer_id identifies the purchaser; orders.user_id identifies the
            # dossier subject and must never be treated as account ownership.
            c.execute(
                """UPDATE orders
                   SET deleted_at=COALESCE(deleted_at, ?), visibility='private',
                       share_token_hash=NULL, share_token_created_at=NULL, updated_at=?
                   WHERE buyer_id=?""",
                (now, now, str(user_id)),
            )
            cur = c.execute("DELETE FROM notifications WHERE user_id=?", (user_id,))
            deleted["notifications"] = cur.rowcount
            cur = c.execute("DELETE FROM user_settings WHERE user_id=?", (user_id,))
            deleted["settings"] = cur.rowcount
            c.execute(
                """UPDATE users SET username='', avatar='', message_count=0,
                   credits=0, bonus_credits=0 WHERE user_id=?""",
                (user_id,),
            )

        return {"ok": True, "deleted": deleted}

    # ── USERS ─────────────────────────────────────────────────────────────────

    def upsert_user(self, user_id: int, username: str, avatar: str,
                    message_count: int = 0, is_banned: bool = False,
                    username_html: str = "") -> dict:
        """Создать или обновить юзера при входе. Возвращает актуальную запись."""
        now = int(time.time())
        rich_name = username_html if "<" in str(username_html or "") else ""
        with self._write() as c:
            c.execute("""
                INSERT INTO users (user_id, username, username_html, avatar, message_count, is_banned, credits, total_orders, first_seen, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username      = excluded.username,
                    username_html = CASE WHEN excluded.username_html != '' THEN excluded.username_html ELSE users.username_html END,
                    avatar        = excluded.avatar,
                    message_count = excluded.message_count,
                    is_banned     = excluded.is_banned,
                    last_seen     = excluded.last_seen
            """, (user_id, username, rich_name, avatar, message_count, int(is_banned), now, now))
        return self.get_user(user_id)

    def get_user(self, user_id: int) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT * FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        # считаем total_orders из таблицы заказов на лету
        r = self._conn().execute(
            "SELECT COUNT(*) FROM orders WHERE user_id=? AND status IN ('done','running','paid')",
            (user_id,)
        ).fetchone()
        d["total_orders"] = r[0] if r else 0
        return d

    def add_credits(self, user_id: int, amount: float) -> float:
        """Пополнить баланс кредитов. Возвращает новый баланс."""
        with self._write() as c:
            c.execute(
                "UPDATE users SET credits = credits + ? WHERE user_id=?",
                (amount, user_id)
            )
        row = self._conn().execute(
            "SELECT credits FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        return row[0] if row else 0.0

    def deduct_credits(self, user_id: int, amount: float) -> bool:
        """Списать кредиты. Возвращает False если недостаточно средств."""
        with self._write() as c:
            cur = c.execute(
                "UPDATE users SET credits = credits - ? WHERE user_id=? AND credits >= ?",
                (amount, user_id, amount)
            )
        return cur.rowcount > 0

    # ── BONUS (bonus_credits, валюта Б) ──────────────────────────────────────

    def add_bonus(self, user_id: int, amount: float) -> float:
        """Начиcлить бонуcы. Возвращает новый бонуcный баланc."""
        with self._write() as c:
            c.execute(
                "UPDATE users SET bonus_credits = bonus_credits + ? WHERE user_id=?",
                (amount, user_id)
            )
        row = self._conn().execute(
            "SELECT bonus_credits FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        return row[0] if row else 0.0

    def deduct_bonus(self, user_id: int, amount: float) -> bool:
        """Спиcать бонуcы. Возвращает False еcли недоcтаточно."""
        with self._write() as c:
            cur = c.execute(
                "UPDATE users SET bonus_credits = bonus_credits - ? WHERE user_id=? AND bonus_credits >= ?",
                (amount, user_id, amount)
            )
        return cur.rowcount > 0

    def deduct_credits_and_bonus(self, user_id: int, credits: float, bonus: float) -> bool:
        """Атомарно списать рублёвые кредиты и бонусы (частичная оплата).
        Возвращает False, если не хватает хотя бы одной валюты."""
        with self._write() as c:
            cur = c.execute(
                """UPDATE users
                   SET credits = credits - ?, bonus_credits = bonus_credits - ?
                   WHERE user_id = ? AND credits >= ? AND bonus_credits >= ?""",
                (credits, bonus, user_id, credits, bonus),
            )
        return cur.rowcount > 0

    # ── PROMO CODES ──────────────────────────────────────────────────────────

    def create_promo(self, code: str, bonus: float, max_uses: int = 1,
                     per_user: int = 1, expires_at: Optional[int] = None,
                     bonus_type: str = "bonus", value_type: str = "fixed",
                     budget: Optional[float] = None, description: str = "") -> dict:
        """
        Создать промокод (для админки). Возвращает запиcь.
        
        Args:
            code: код промокода (uppercase)
            bonus: значение (фикс. сумма или процент)
            max_uses: тираж (сколько раз можно активировать)
            per_user: лимит на пользователя (обычно 1)
            expires_at: timestamp истечения (None = вечный)
            bonus_type: 'bonus' (бонусный счёт) или 'credits' (рублёвый)
            value_type: 'fixed' (фикс. сумма) или 'percent' (процент)
            budget: суммарный лимит выдачи (None = без лимита)
            description: комментарий админа
        """
        code = code.strip().upper()
        now = int(time.time())
        with self._write() as c:
            c.execute(
                """INSERT INTO promo_codes
                   (code,bonus,bonus_type,value_type,max_uses,used_count,per_user,budget,spent,active,expires_at,created_at,description)
                   VALUES (?,?,?,?,?,0,?,?,0,1,?,?,?)""",
                (code, bonus, bonus_type, value_type, max_uses, per_user, budget, expires_at, now, description)
            )
        return dict(self._conn().execute(
            "SELECT * FROM promo_codes WHERE code=?", (code,)
        ).fetchone())

    def list_promos(self, active_only: bool = True) -> list[dict]:
        q = "active=1" if active_only else "1=1"
        rows = self._conn().execute(
            f"SELECT * FROM promo_codes WHERE {q} ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def toggle_promo(self, code: str, active: bool) -> bool:
        code = code.strip().upper()
        with self._write() as c:
            cur = c.execute(
                "UPDATE promo_codes SET active=? WHERE code=?",
                (int(active), code)
            )
        return cur.rowcount > 0

    def redeem_promo(self, user_id: int, code: str) -> dict:
        """Погаcить промокод. Атомарно проверяет лимиты и начиcляет бонуcы/рубли.
        Возвращает {ok, bonus, balance, bonus_type} либо {error}."""
        code = (code or "").strip().upper()
        if not code:
            return {"error": "Введите промокод"}
        now = int(time.time())
        with self._write() as c:
            row = c.execute(
                "SELECT * FROM promo_codes WHERE code=?", (code,)
            ).fetchone()
            if not row:
                return {"error": "Промокод не найден"}
            promo = dict(row)
            if not promo["active"]:
                return {"error": "Промокод неактивен"}
            if promo["expires_at"] and now > promo["expires_at"]:
                return {"error": "Срок дейcтвия промокода иcтёк"}
            if promo["used_count"] >= promo["max_uses"]:
                return {"error": "Лимит активаций промокода иcчерпан"}
            
            # Проверка бюджета
            if promo["budget"] is not None and promo["spent"] >= promo["budget"]:
                return {"error": "Бюджет промокода исчерпан"}
            
            used_by_user = c.execute(
                "SELECT COUNT(*) FROM promo_redemptions WHERE code=? AND user_id=?",
                (code, user_id)
            ).fetchone()[0]
            if used_by_user >= promo["per_user"]:
                return {"error": "Вы уже активировали этот промокод"}

            # Расчёт суммы начисления
            bonus = float(promo["bonus"])
            if promo.get("bonus_type") == "order":
                # Скидка на заказ — не начисляет баланс, используется через validate_order_promo
                return {"error": "Этот промокод предназначен для скидок на заказ"}
            if promo.get("value_type") == "percent":
                # Процент от текущего баланса (дефолт: 0 если баланс пустой)
                user = self.get_user(user_id)
                current = user.get("credits" if promo.get("bonus_type") == "credits" else "bonus_credits", 0)
                bonus = current * bonus / 100.0
            
            # Проверка бюджета после расчёта суммы
            if promo["budget"] is not None and (promo["spent"] + bonus) > promo["budget"]:
                return {"error": "Недостаточно бюджета промокода"}
            
            c.execute(
                "INSERT INTO promo_redemptions (id,code,user_id,bonus,created_at) VALUES (?,?,?,?,?)",
                ("pr_" + uuid.uuid4().hex[:12], code, user_id, bonus, now)
            )
            c.execute(
                "UPDATE promo_codes SET used_count = used_count + 1, spent = spent + ? WHERE code=?",
                (bonus, code)
            )
            
            # Начисление на нужный баланс
            bonus_type = promo.get("bonus_type", "bonus")
            if bonus_type == "credits":
                c.execute(
                    "UPDATE users SET credits = credits + ? WHERE user_id=?",
                    (bonus, user_id)
                )
                balance = c.execute(
                    "SELECT credits FROM users WHERE user_id=?", (user_id,)
                ).fetchone()[0]
            else:
                c.execute(
                    "UPDATE users SET bonus_credits = bonus_credits + ? WHERE user_id=?",
                    (bonus, user_id)
                )
                balance = c.execute(
                    "SELECT bonus_credits FROM users WHERE user_id=?", (user_id,)
                ).fetchone()[0]
        return {"ok": True, "bonus": bonus, "balance": balance, "bonus_type": bonus_type}

    def validate_order_promo(self, user_id: int, code: str, order_cost: float) -> dict:
        """Проверить промокод типа 'order' и вернуть размер скидки.
        Не списывает промокод — только preview. Возвращает {ok, discount, final_cost, percent} либо {error}."""
        code = (code or "").strip().upper()
        if not code:
            return {"error": "Введите промокод"}
        now = int(time.time())
        row = self._conn().execute(
            "SELECT * FROM promo_codes WHERE code=?", (code,)
        ).fetchone()
        if not row:
            return {"error": "Промокод не найден"}
        promo = dict(row)
        if promo["bonus_type"] != "order":
            return {"error": "Этот промокод не предназначен для скидок на заказ"}
        if not promo["active"]:
            return {"error": "Промокод неактивен"}
        if promo["expires_at"] and now > promo["expires_at"]:
            return {"error": "Срок действия промокода истёк"}
        if promo["used_count"] >= promo["max_uses"]:
            return {"error": "Лимит активаций промокода исчерпан"}
        if promo["budget"] is not None and promo["spent"] >= promo["budget"]:
            return {"error": "Бюджет промокода исчерпан"}
        used_by_user = self._conn().execute(
            "SELECT COUNT(*) FROM promo_redemptions WHERE code=? AND user_id=?",
            (code, user_id)
        ).fetchone()[0]
        if used_by_user >= promo["per_user"]:
            return {"error": "Вы уже активировали этот промокод"}
        # order_value_type_v2: уважаем value_type — 'percent' от суммы заказа,
        # 'fixed' — фиксированная скидка (не больше суммы заказа)
        if promo.get("value_type") == "percent":
            percent = float(promo["bonus"])
            discount = round(order_cost * percent / 100.0, 2)
        else:
            percent = None
            discount = round(min(float(promo["bonus"]), order_cost), 2)
        if promo["budget"] is not None and (promo["spent"] + discount) > promo["budget"]:
            discount = round(promo["budget"] - promo["spent"], 2)
        final_cost = max(order_cost - discount, 0)
        return {"ok": True, "discount": discount, "final_cost": final_cost, "percent": percent, "code": code}

    def redeem_order_promo(self, user_id: int, code: str, discount: float) -> dict:
        """Списать промокод типа 'order' после успешной оплаты заказа.
        Начисляет скидку на баланс как 'bonus' (чтобы не терять деньги из-за скидки).
        Возвращает {ok} либо {error}."""
        code = (code or "").strip().upper()
        if not code:
            return {"error": "Нет промокода"}
        now = int(time.time())
        with self._write() as c:
            row = c.execute(
                "SELECT * FROM promo_codes WHERE code=?", (code,)
            ).fetchone()
            if not row:
                return {"error": "Промокод не найден"}
            promo = dict(row)
            # promo_redeem_revalidate_v2: полная ревалидация в транзакции —
            # между preview и оплатой условия могли измениться
            if not promo["active"]:
                return {"error": "Промокод неактивен"}
            if promo["expires_at"] and now > promo["expires_at"]:
                return {"error": "Срок действия промокода истёк"}
            if promo["used_count"] >= promo["max_uses"]:
                return {"error": "Лимит активаций промокода исчерпан"}
            if promo["budget"] is not None and (promo["spent"] + discount) > promo["budget"]:
                return {"error": "Бюджет промокода исчерпан"}
            used_by_user = c.execute(
                "SELECT COUNT(*) FROM promo_redemptions WHERE code=? AND user_id=?",
                (code, user_id)
            ).fetchone()[0]
            if used_by_user >= promo["per_user"]:
                return {"error": "Вы уже использовали этот промокод"}
            c.execute(
                "INSERT INTO promo_redemptions (id,code,user_id,bonus,created_at) VALUES (?,?,?,?,?)",
                ("pr_" + uuid.uuid4().hex[:12], code, user_id, discount, now)
            )
            c.execute(
                "UPDATE promo_codes SET used_count = used_count + 1, spent = spent + ? WHERE code=?",
                (discount, code)
            )
        return {"ok": True}

    # ── TRANSACTIONS ─────────────────────────────────────────────────────────

    def create_transaction(
        self, user_id: int, kind: str, amount_rub: float, credits: float,
        status: str = "pending", provider: str = "zelenka",
        description: str = "",
    ) -> dict:
        """Создать запись движения баланса и вернуть её."""
        tx_id = "tx_" + uuid.uuid4().hex[:12]
        now = int(time.time())
        with self._write() as c:
            c.execute(
                """INSERT INTO transactions
                   (id,user_id,kind,amount_rub,credits,status,provider,description,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (tx_id, user_id, kind, amount_rub, credits, status,
                 provider, description, now),
            )
        row = self._conn().execute(
            "SELECT * FROM transactions WHERE id=?", (tx_id,)
        ).fetchone()
        return dict(row)

    def get_transactions(self, user_id: int, limit: int = 50, offset: int = 0, kind: Optional[str] = None) -> list:
        rows = self._conn().execute(
            "SELECT * FROM transactions WHERE user_id=? AND (? IS NULL OR kind=?)"
            " ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (user_id, kind, kind, limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_transaction(self, tx_id: str) -> Optional[dict]:
        row = self._conn().execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
        return dict(row) if row else None

    def complete_transaction(self, tx_id: str, credits: float) -> Optional[dict]:
        """pending → completed (однократно). None — не найдена или уже закрыта."""
        with self._write() as c:
            cur = c.execute(
                "UPDATE transactions SET status='completed', credits=? WHERE id=? AND status IN ('pending','failed')",
                (credits, tx_id),
            )
            if cur.rowcount == 0:
                return None
        row = self._conn().execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
        return dict(row) if row else None

    def update_notification_by_dedupe(self, user_id: int, dedupe_key: str,
                                      title: str, body: str,
                                      meta: Optional[dict]) -> bool:
        """Обновить существующее уведомление по dedupe_key. False — не найдено."""
        meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
        with self._write() as c:
            cur = c.execute(
                "UPDATE notifications SET title=?, body=?, meta_json=? WHERE user_id=? AND dedupe_key=?",
                (title, body, meta_json, user_id, dedupe_key),
            )
            return cur.rowcount > 0

    def fail_transaction(self, tx_id: str) -> None:
        with self._write() as c:
            c.execute("UPDATE transactions SET status='failed' WHERE id=? AND status='pending'", (tx_id,))

    def refund_failed_order(self, order_id: str) -> Optional[dict]:
        """Restore this order's linked credit and bonus components exactly once."""
        now = int(time.time())
        refund_id = "tx_refund_" + order_id
        description = "Refund for failed order " + order_id
        with self._write() as c:
            order = c.execute(
                """SELECT id,buyer_id,status,payment_id,refunded_at,
                          charge_credits,charge_bonus
                   FROM orders WHERE id=?""", (order_id,),
            ).fetchone()
            if not order or order["status"] != Status.ERROR or order["refunded_at"]:
                return None
            buyer_id = int(order["buyer_id"] or 0)
            if not buyer_id:
                return None
            credits = float(order["charge_credits"] or 0)
            bonus = float(order["charge_bonus"] or 0)
            # Compatibility for orders created before linked charge columns.
            if not credits and not bonus and "credits" in str(order["payment_id"] or ""):
                charge = c.execute(
                    """SELECT credits FROM transactions
                       WHERE user_id=? AND kind='charge' AND status='completed'
                         AND credits < 0 AND created_at <=
                           (SELECT COALESCE(paid_at,created_at) FROM orders WHERE id=?)
                       ORDER BY created_at DESC LIMIT 1""", (buyer_id, order_id),
                ).fetchone()
                credits = -float(charge["credits"]) if charge else 0
            if not credits and not bonus:
                return None
            cur = c.execute(
                "UPDATE orders SET refunded_at=? WHERE id=? AND status=? AND refunded_at IS NULL",
                (now, order_id, Status.ERROR),
            )
            if cur.rowcount != 1:
                return None
            c.execute(
                "UPDATE users SET credits=credits+?, bonus_credits=bonus_credits+? WHERE user_id=?",
                (credits, bonus, buyer_id),
            )
            c.execute(
                """INSERT INTO transactions
                   (id,user_id,kind,amount_rub,credits,status,provider,description,created_at)
                   VALUES (?,?,?,?,?,'completed','credits',?,?)""",
                (refund_id, buyer_id, "refund", credits + bonus, credits,
                 description, now),
            )
            if bonus:
                c.execute(
                    """INSERT INTO transactions
                       (id,user_id,kind,amount_rub,credits,status,provider,description,created_at)
                       VALUES (?,?,?,?,?,'completed','bonus',?,?)""",
                    ("tx_refund_bonus_" + order_id, buyer_id, "bonus", 0, bonus,
                     description + " bonus", now),
                )
        return dict(self._conn().execute(
            "SELECT * FROM transactions WHERE id=?", (refund_id,)
        ).fetchone())

    def list_transactions(
        self, user_id: int, limit: int = 50, offset: int = 0,
        kind: Optional[str] = None,
    ) -> list[dict]:
        if kind:
            rows = self._conn().execute(
                """SELECT * FROM transactions WHERE user_id=? AND kind=?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (user_id, kind, limit, offset),
            ).fetchall()
        else:
            rows = self._conn().execute(
                """SELECT * FROM transactions WHERE user_id=?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (user_id, limit, offset),
            ).fetchall()
        return [dict(row) for row in rows]

    def count_transactions(self, user_id: int, kind: Optional[str] = None) -> int:
        """Общее кол-во транзакций юзера (с опциональным фильтром по kind)."""
        if kind:
            row = self._conn().execute(
                "SELECT COUNT(*) FROM transactions WHERE user_id=? AND kind=?",
                (user_id, kind),
            ).fetchone()
        else:
            row = self._conn().execute(
                "SELECT COUNT(*) FROM transactions WHERE user_id=?",
                (user_id,),
            ).fetchone()
        return row[0] if row else 0

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def get_current_completed_report(self, buyer_id: int, user_id: int,
                                     report_type: str) -> Optional[dict]:
        """Return the buyer's current completed exact-tier report."""
        row = self._conn().execute(
            """SELECT * FROM orders
               WHERE buyer_id=? AND user_id=? AND report_type=? AND status=?
                 AND deleted_at IS NULL AND result_path IS NOT NULL
               ORDER BY finished_at DESC, created_at DESC, id DESC LIMIT 1""",
            (str(buyer_id), int(user_id), report_type, Status.DONE),
        ).fetchone()
        return self._hydrate(row) if row else None

    def get_owned_current_report(self, buyer_id: int, user_id: int,
                                 report_type: str) -> Optional[dict]:
        """Buyer's own CURRENT-version done report for subject+tier, any visibility.

        Prefers the version flagged is_current_for_owner=1; falls back to the
        latest DONE order when no version row exists. Never returns others' rows.
        """
        row = self._conn().execute(
            """SELECT o.* FROM orders o
               JOIN dossier_versions v ON v.order_id = o.id
               WHERE o.buyer_id=? AND o.user_id=? AND o.report_type=? AND o.status=?
                 AND o.deleted_at IS NULL AND o.result_path IS NOT NULL
                 AND v.owner_user_id=? AND v.is_current_for_owner=1
               ORDER BY o.finished_at DESC, o.created_at DESC, o.id DESC LIMIT 1""",
            (str(buyer_id), int(user_id), report_type, Status.DONE, int(buyer_id)),
        ).fetchone()
        if row is None:
            row = self._conn().execute(
                """SELECT * FROM orders
                   WHERE buyer_id=? AND user_id=? AND report_type=? AND status=?
                     AND deleted_at IS NULL AND result_path IS NOT NULL
                   ORDER BY finished_at DESC, created_at DESC, id DESC LIMIT 1""",
                (str(buyer_id), int(user_id), report_type, Status.DONE),
            ).fetchone()
        return self._hydrate(row) if row else None

    def get_owned_current_report_any(self, buyer_id: int,
                                     user_id: int) -> Optional[dict]:
        """Buyer's own CURRENT-version done report for the subject, any tier.

        Tier-agnostic variant of get_owned_current_report: used to offer
        "current tariff or better" refreshes. Prefers the highest tier among
        current versions; never returns others' rows.
        """
        rows = self._conn().execute(
            """SELECT o.* FROM orders o
               JOIN dossier_versions v ON v.order_id = o.id
               WHERE o.buyer_id=? AND o.user_id=? AND o.status=?
                 AND o.deleted_at IS NULL AND o.result_path IS NOT NULL
                 AND v.owner_user_id=? AND v.is_current_for_owner=1
               ORDER BY CASE o.report_type WHEN 'full' THEN 1 ELSE 0 END DESC,
                        o.finished_at DESC, o.id DESC""",
            (str(buyer_id), int(user_id), Status.DONE, int(buyer_id)),
        ).fetchall()
        row = next((r for r in rows if r["report_type"] == "full"), None)
        row = row or (rows[0] if rows else None)
        if row is not None:
            return self._hydrate(row)
        row = self._conn().execute(
            """SELECT * FROM orders
               WHERE buyer_id=? AND user_id=? AND status=?
                 AND deleted_at IS NULL AND result_path IS NOT NULL
               ORDER BY CASE report_type WHEN 'full' THEN 1 ELSE 0 END DESC,
                        finished_at DESC, created_at DESC, id DESC LIMIT 1""",
            (str(buyer_id), int(user_id), Status.DONE),
        ).fetchone()
        return self._hydrate(row) if row else None

    def get_public_current_report(self, subject_id: int,
                                  report_type: str) -> Optional[dict]:
        """Someone's CURRENT-version PUBLIC done report for subject+tier.

        Only ever returns visibility='public'; private/unlisted are excluded.
        """
        row = self._conn().execute(
            """SELECT o.* FROM orders o
               JOIN dossier_versions v ON v.order_id = o.id
               WHERE o.user_id=? AND o.report_type=? AND o.status=?
                 AND o.deleted_at IS NULL AND o.result_path IS NOT NULL
                 AND o.visibility='public' AND v.is_current_for_owner=1
               ORDER BY o.finished_at DESC, o.created_at DESC, o.id DESC LIMIT 1""",
            (int(subject_id), report_type, Status.DONE),
        ).fetchone()
        if row is None:
            row = self._conn().execute(
                """SELECT * FROM orders
                   WHERE user_id=? AND report_type=? AND status=?
                     AND deleted_at IS NULL AND result_path IS NOT NULL
                     AND visibility='public'
                   ORDER BY finished_at DESC, created_at DESC, id DESC LIMIT 1""",
                (int(subject_id), report_type, Status.DONE),
            ).fetchone()
        return self._hydrate(row) if row else None

    def get_order_by_idempotency(self, buyer_id: int,
                                 idempotency_key: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT * FROM orders WHERE buyer_id=? AND idempotency_key=? LIMIT 1",
            (str(buyer_id), idempotency_key),
        ).fetchone()
        return self._hydrate(row) if row else None

    def purchase_order(
        self, *, user_id: int, buyer_id: int, report_type: str,
        params: dict, username: str = "", username_html: str = "",
        avatar: str = "", visibility: str = "private",
        signature_data: str = "", idempotency_key: str,
        request_hash: str, cost: float, credits_charge: float,
        bonus_charge: float, provider: str,
    ) -> tuple[dict, bool]:
        """Reserve, debit, link charge components, and mark paid atomically."""
        now = int(time.time())
        order_id = uuid.uuid4().hex[:10]
        with self._write() as c:
            replay = c.execute(
                "SELECT * FROM orders WHERE buyer_id=? AND idempotency_key=?",
                (str(buyer_id), idempotency_key),
            ).fetchone()
            if replay:
                if replay["request_hash"] != request_hash:
                    raise ValueError("idempotency_mismatch")
                return self._hydrate(replay), True
            balance = c.execute(
                "SELECT credits,bonus_credits FROM users WHERE user_id=?",
                (buyer_id,),
            ).fetchone()
            if not balance or float(balance["credits"]) < credits_charge or float(balance["bonus_credits"]) < bonus_charge:
                raise ValueError("insufficient_funds")
            c.execute(
                """INSERT INTO orders
                   (id,user_id,username,username_html,avatar,report_type,status,
                    params_json,visibility,signature_data,buyer_id,created_at,
                    display_id,updated_at,idempotency_key,request_hash,
                    charge_credits,charge_bonus,payment_id,paid_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (order_id,user_id,username,username_html,avatar,report_type,
                 Status.PAID,json.dumps(_safe_order_params(params)),visibility,signature_data,
                 str(buyer_id),now,"ZS-"+order_id[:8].upper(),now,
                 idempotency_key,request_hash,credits_charge,bonus_charge,
                 provider,now),
            )
            c.execute(
                "UPDATE users SET credits=credits-?, bonus_credits=bonus_credits-? WHERE user_id=?",
                (credits_charge, bonus_charge, buyer_id),
            )
            description = f"Order {order_id}: report '{report_type}' for user #{user_id}"
            if credits_charge:
                c.execute(
                    """INSERT INTO transactions
                       (id,user_id,kind,amount_rub,credits,status,provider,description,created_at)
                       VALUES (?,?,?,?,?,'completed','credits',?,?)""",
                    ("tx_charge_"+order_id,buyer_id,"charge",cost,-credits_charge,description,now),
                )
            if bonus_charge:
                c.execute(
                    """INSERT INTO transactions
                       (id,user_id,kind,amount_rub,credits,status,provider,description,created_at)
                       VALUES (?,?,?,?,?,'completed','bonus',?,?)""",
                    ("tx_bonus_"+order_id,buyer_id,"bonus",0,-bonus_charge,description,now),
                )
            row = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        return self._hydrate(row), False

    def create_order(
        self,
        user_id: int,
        report_type: str = "basic",
        params: Optional[dict] = None,
        username: str = "",
        username_html: str = "",
        avatar: str = "",
        visibility: str = "private",
        signature_data: str = "",
        buyer_id: str = "",
    ) -> str:
        """Create an order; active refresh uniqueness is enforced by SQLite.

        Passing buyer_id for refresh orders makes the partial unique index guard
        effective at INSERT time, before any balance debit can occur.
        """
        order_id = uuid.uuid4().hex[:10]
        with self._write() as c:
            c.execute(
                """INSERT INTO orders
                   (id, user_id, username, username_html, avatar, report_type, status,
                    params_json, visibility, signature_data, buyer_id, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (order_id, user_id, username, username_html, avatar, report_type,
                 Status.PENDING, json.dumps(_safe_order_params(params)), visibility, signature_data,
                 str(buyer_id or ""), int(time.time())),
            )
            c.execute("UPDATE orders SET display_id=?, updated_at=? WHERE id=?", ("ZS-" + order_id[:8].upper(), int(time.time()), order_id))
        return order_id

    def mark_paid(
        self,
        order_id: str,
        payment_id: str = "stub",
        buyer_id: str = "",
    ) -> bool:
        with self._write() as c:
            cur = c.execute(
                """UPDATE orders SET status=?, payment_id=?, buyer_id=?, paid_at=?
                   WHERE id=? AND status=?""",
                (Status.PAID, payment_id, buyer_id, int(time.time()),
                 order_id, Status.PENDING),
            )
        return cur.rowcount > 0

    def get_order(self, order_id: str) -> Optional[dict]:
        row = self._conn().execute(
            "SELECT * FROM orders WHERE id=?", (order_id,)
        ).fetchone()
        return self._hydrate(row) if row else None

    def record_dossier_view(self, order_id: str, viewer_key: str,
                            window_seconds: int = 3600) -> int:
        """Record one view per pseudonymous viewer during each time window.

        The window row and aggregate counter are updated in one write transaction,
        so concurrent report loads cannot increment the same viewer twice.
        Returns the post-update aggregate count.
        """
        now = int(time.time())
        cutoff = now - window_seconds
        with self._write() as c:
            row = c.execute(
                "SELECT window_started_at FROM dossier_view_windows "
                "WHERE order_id=? AND viewer_key=?",
                (order_id, viewer_key),
            ).fetchone()
            if row is None:
                c.execute(
                    "INSERT INTO dossier_view_windows (order_id, viewer_key, window_started_at) "
                    "VALUES (?, ?, ?)",
                    (order_id, viewer_key, now),
                )
                c.execute("UPDATE orders SET view_count=view_count+1 WHERE id=?", (order_id,))
            elif row["window_started_at"] <= cutoff:
                c.execute(
                    "UPDATE dossier_view_windows SET window_started_at=? "
                    "WHERE order_id=? AND viewer_key=?",
                    (now, order_id, viewer_key),
                )
                c.execute("UPDATE orders SET view_count=view_count+1 WHERE id=?", (order_id,))
            count = c.execute(
                "SELECT view_count FROM orders WHERE id=?", (order_id,)
            ).fetchone()
        return int(count["view_count"]) if count else 0

    def get_next_queued(self) -> Optional[dict]:
        """Самый старый оплаченный заказ."""
        row = self._conn().execute(
            "SELECT * FROM orders WHERE status=? ORDER BY created_at ASC LIMIT 1",
            (Status.PAID,),
        ).fetchone()
        return self._hydrate(row) if row else None

    def mark_running(self, order_id: str) -> None:
        with self._write() as c:
            c.execute(
                "UPDATE orders SET status=?, started_at=? WHERE id=?",
                (Status.RUNNING, int(time.time()), order_id),
            )

    def update_progress(self, order_id: str, stage: str, current: int,
                        total: int, message: str,
                        completed_stages=None) -> None:
        """Persist only forward-moving progress, even with concurrent callbacks."""
        ranks = {name: i for i, name in enumerate(
                 ("profile", "collecting", "metrics", "ai", "saving", "done", "error"))}
        stage = str(stage or "profile")
        current = max(0, int(current or 0))
        total = max(0, int(total or 0))
        with self._write() as c:
            row = c.execute(
                "SELECT status, progress_json FROM orders WHERE id=?", (order_id,)
            ).fetchone()
            # Concurrent analyzer callbacks may arrive after a sibling future has
            # failed and the worker has already made the order terminal.
            if not row or row["status"] not in (Status.PAID, Status.RUNNING):
                return
            previous = {}
            if row["progress_json"]:
                try:
                    previous = json.loads(row["progress_json"])
                except (TypeError, ValueError):
                    previous = {}
            old_stage = str(previous.get("stage") or "profile")
            if ranks.get(stage, -1) < ranks.get(old_stage, -1):
                return
            if stage == old_stage:
                current = max(current, int(previous.get("current") or 0))
            completed = set(previous.get("completed_stages") or [])
            completed.update(str(s) for s in (completed_stages or []) if s)
            prog = json.dumps({"stage": stage, "current": current,
                               "total": total, "message": str(message or ""),
                               "completed_stages": sorted(completed)})
            c.execute("UPDATE orders SET progress_json=? WHERE id=?", (prog, order_id))

    def mark_done(self, order_id: str, result_path: str,
                  collected_message_counts: Optional[dict] = None) -> None:
        """Publish a result and persist exact raw-record collection counts atomically."""
        now = int(time.time())
        counts = dict(collected_message_counts or {})
        collected_total = int(counts.get("total") or 0) if counts else None
        with self._write() as c:
            order = c.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if not order:
                return
            c.execute(
                """UPDATE orders SET status=?, result_path=?, finished_at=?,
                   progress_json=?, collected_message_count=?,
                   collected_message_counts_json=? WHERE id=?""",
                (Status.DONE, result_path, now,
                 json.dumps({"stage": "done", "current": 1, "total": 1,
                             "message": "Досье готово"}),
                 collected_total,
                 json.dumps(counts, ensure_ascii=False) if counts else None,
                 order_id),
            )
            version = c.execute(
                "SELECT subject_id, owner_user_id FROM dossier_versions WHERE order_id=?",
                (order_id,),
            ).fetchone()
            if version:
                c.execute(
                    "UPDATE dossier_versions SET is_current_for_owner=0 "
                    "WHERE subject_id=? AND owner_user_id=? AND order_id!=?",
                    (version["subject_id"], version["owner_user_id"], order_id),
                )
                c.execute(
                    "UPDATE dossier_versions SET result_path=?, is_current_for_owner=1 WHERE order_id=?",
                    (result_path, order_id),
                )
            if (json.loads(order["params_json"] or "{}").get("refresh")):
                c.execute(
                    """UPDATE orders SET deleted_at=?, visibility='private',
                       share_token_hash=NULL, share_token_created_at=NULL, updated_at=?
                       WHERE buyer_id=? AND user_id=? AND report_type=? AND id!=?
                         AND status=? AND deleted_at IS NULL""",
                    (now, now, order["buyer_id"], order["user_id"],
                     order["report_type"], order_id, Status.DONE),
                )

    def mark_error(self, order_id: str, error: str) -> None:
        safe_error = str(redact_sensitive(error))[:2000]
        with self._write() as c:
            c.execute(
                "UPDATE orders SET status=?, error=?, finished_at=? WHERE id=?",
                (Status.ERROR, safe_error, int(time.time()), order_id),
            )

    def mark_replaced(self, user_id: int, buyer_id: str, except_order_id: str) -> list[str]:
        """Скрыть прежние версии после обновления, сохранив аудит и результаты.

        Оплаченные отчёты и их result files являются immutable retention data:
        замена влияет только на видимость, но никогда не удаляет файл или строку.
        """
        now = int(time.time())
        retained_paths: list[str] = []
        with self._write() as c:
            rows = c.execute(
                """SELECT id, result_path FROM orders
                   WHERE user_id=? AND buyer_id=? AND id!=? AND deleted_at IS NULL""",
                (user_id, str(buyer_id), except_order_id),
            ).fetchall()
            for row in rows:
                c.execute(
                    """UPDATE orders SET deleted_at=?, visibility='private',
                       share_token_hash=NULL, share_token_created_at=NULL, updated_at=?
                       WHERE id=?""",
                    (now, now, row["id"]),
                )
                if row["result_path"]:
                    retained_paths.append(row["result_path"])
        return retained_paths

    def list_orders(self, limit: int = 100, status: Optional[str] = None) -> list[dict]:
        if status:
            rows = self._conn().execute(
                "SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = self._conn().execute(
                "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._hydrate(r) for r in rows]

    # ── maintenance ───────────────────────────────────────────────────────────

    def recover_running(self) -> int:
        """Вызывать при старте: running → paid (процесс упал на полпути)."""
        with self._write() as c:
            cur = c.execute(
                "UPDATE orders SET status=?, started_at=NULL WHERE status=?",
                (Status.PAID, Status.RUNNING),
            )
        return cur.rowcount

    def cleanup_old(self) -> int:
        """Expire stale unpaid orders without deleting completed reports.

        Completed and failed orders are valuable audit/history records. Their
        database rows and result files must remain available indefinitely.
        """
        # expire stale pending (> 1h)
        with self._write() as c:
            c.execute(
                "UPDATE orders SET status=? WHERE status=? AND created_at < ?",
                (Status.EXPIRED, Status.PENDING, int(time.time()) - 3600),
            )
        return 0

    def _current_dossiers_sql(self, *, count: bool = False) -> str:
        """Authoritative default My dossiers card set (one current DONE row per key)."""
        select = "COUNT(*)" if count else "o.*"
        order = "" if count else " ORDER BY o.finished_at DESC, o.id DESC"
        return f"""SELECT {select}
                   FROM orders o
                   WHERE o.buyer_id=? AND o.deleted_at IS NULL AND o.status='done'
                     AND NOT EXISTS (
                       SELECT 1 FROM orders newer
                       WHERE newer.buyer_id=o.buyer_id AND newer.user_id=o.user_id
                         AND newer.report_type=o.report_type AND newer.deleted_at IS NULL
                         AND newer.status='done'
                         AND (newer.finished_at > o.finished_at
                              OR (newer.finished_at=o.finished_at AND newer.id > o.id))
                     ){order}"""

    def count_orders_by_buyer(self, buyer_id: int, status: Optional[str] = None) -> int:
        """Count cards returned by get_orders_by_buyer before pagination."""
        if status and status != Status.DONE:
            return 0
        row = self._conn().execute(
            self._current_dossiers_sql(count=True), (str(buyer_id),)
        ).fetchone()
        return row[0] if row else 0

    def get_orders_by_buyer(
        self, buyer_id: int, limit: int = 20, offset: int = 0,
        status: Optional[str] = None,
    ) -> list[dict]:
        """Return current visible cards; expose the latest refresh attempt separately."""
        if status and status != Status.DONE:
            return []
        rows = self._conn().execute(
            self._current_dossiers_sql(), (str(buyer_id),)
        ).fetchall()
        items = []
        for row in rows[offset:offset + limit]:
            item = self._hydrate(row)
            attempt = self._conn().execute(
                """SELECT * FROM orders WHERE buyer_id=? AND user_id=? AND report_type=?
                   AND json_extract(COALESCE(params_json,'{}'), '$.refresh')=1
                   ORDER BY created_at DESC, id DESC LIMIT 1""",
                (str(buyer_id), item["user_id"], item["report_type"]),
            ).fetchone()
            item["latest_refresh_attempt"] = self._hydrate(attempt) if attempt else None
            items.append(item)
        return items

    def get_active_order_by_buyer(self, buyer_id: int) -> Optional[dict]:
        """Return the buyer's single unfinished order, if any."""
        row = self._conn().execute(
            """SELECT * FROM orders WHERE buyer_id=? AND status IN (?,?,?)
               ORDER BY created_at DESC, id DESC LIMIT 1""",
            (str(buyer_id), Status.PENDING, Status.PAID, Status.RUNNING),
        ).fetchone()
        return self._hydrate(row) if row else None

    def get_active_refresh(self, buyer_id: int, user_id: int,
                           report_type: str) -> Optional[dict]:
        row = self._conn().execute(
            """SELECT * FROM orders WHERE buyer_id=? AND user_id=? AND report_type=?
               AND status IN (?,?,?)
               AND json_extract(COALESCE(params_json,'{}'), '$.refresh')=1
               ORDER BY created_at DESC LIMIT 1""",
            (str(buyer_id), user_id, report_type,
             Status.PENDING, Status.PAID, Status.RUNNING),
        ).fetchone()
        return self._hydrate(row) if row else None

    def get_user_stats(self, buyer_id: int) -> dict:
        """Агрегированная статистика заказов юзера."""
        row = self._conn().execute(
            """SELECT
                COUNT(*)                                          AS total,
                SUM(status = 'done')                             AS done,
                SUM(status IN ('paid','running'))                 AS in_progress,
                SUM(status = 'error')                            AS errors,
                MAX(finished_at)                                  AS last_order_at
               FROM orders WHERE buyer_id=? AND deleted_at IS NULL""",
            (str(buyer_id),),
        ).fetchone()
        if not row:
            return {"total": 0, "done": 0, "in_progress": 0, "errors": 0, "last_order_at": None}
        return {
            "total":         row[0] or 0,
            "done":          row[1] or 0,
            "in_progress":   row[2] or 0,
            "errors":        row[3] or 0,
            "last_order_at": row[4],
        }

    def get_visible_dossiers_count(self, buyer_id: int) -> int:
        """Sidebar count: exactly the default My dossiers card set."""
        return self.count_orders_by_buyer(buyer_id)

    def queue_size(self) -> int:
        row = self._conn().execute(
            "SELECT COUNT(*) FROM orders WHERE status=?", (Status.PAID,)
        ).fetchone()
        return row[0] if row else 0

    # ── helpers ───────────────────────────────────────────────────────────────

    def _position(self, order_id: str, status: str, created_at: int) -> int:
        """Позиция в очереди (1 = следующий). 0 если не в очереди."""
        if status != Status.PAID:
            return 0
        row = self._conn().execute(
            """SELECT COUNT(*) FROM orders
               WHERE status=? AND created_at <= ? AND id != ?""",
            (Status.PAID, created_at, order_id),
        ).fetchone()
        return (row[0] if row else 0) + 1

    def _hydrate(self, row: sqlite3.Row) -> dict:
        d = dict(row)
        d["position"] = self._position(d["id"], d["status"], d["created_at"])
        d["progress"] = json.loads(d.pop("progress_json") or "{}")
        d["params"]   = json.loads(d.pop("params_json")   or "{}")
        d["collected_message_counts"] = json.loads(
            d.pop("collected_message_counts_json", None) or "{}"
        )
        return d

    # ── DOSSIER HISTORY (аналитический объект / версии / события / автографы) ──

    def record_dossier_event(
        self,
        *,
        order_id: str,
        subject_user_id: int,
        report_type: str,
        owner_user_id: int,
        result_path: Optional[str] = None,
        visibility: str = "private",
        is_update: bool = False,
        subject_username: str = "",
        subject_username_html: str = "",
        subject_avatar: str = "",
        actor_username: str = "",
        actor_username_html: str = "",
        actor_avatar: str = "",
        signature_image: str = "",
    ) -> dict:
        """Атомарно зафиксировать историю для заказа: найти/создать аналитический
        объект, создать новую версию, записать событие и (при наличии) автограф.

        Правила (решения владельца продукта):
          • Каждая покупка/обновление — своя независимая версия (версии вечны).
          • Актуальная версия — у каждого владельца своя (is_current_for_owner).
          • owners_count инкрементируется только при первом появлении владельца.
          • Тип события: created (первое) / reacquired (объект уже был у другого)
            / updated (тот же владелец обновляет своё досье).
        Возвращает {subject_id, version_id, event_id}.
        """
        now = int(time.time())
        with self._write() as c:
            # 1) якорь аналитического объекта
            row = c.execute(
                "SELECT * FROM dossier_subjects WHERE subject_user_id=? AND report_type=?",
                (subject_user_id, report_type),
            ).fetchone()
            if row:
                subject_id = row["id"]
                subject_existed = True
                c.execute(
                    """UPDATE dossier_subjects
                       SET subject_username_snapshot=?, subject_username_html_snapshot=?,
                           subject_avatar_snapshot=?, updated_at=?
                       WHERE id=?""",
                    (subject_username, subject_username_html, subject_avatar, now, subject_id),
                )
            else:
                subject_id = "ds_" + uuid.uuid4().hex[:12]
                subject_existed = False
                c.execute(
                    """INSERT INTO dossier_subjects
                       (id, subject_user_id, report_type, subject_username_snapshot,
                        subject_username_html_snapshot, subject_avatar_snapshot,
                        owners_count, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,0,?,?)""",
                    (subject_id, subject_user_id, report_type, subject_username,
                     subject_username_html, subject_avatar, now, now),
                )

            # 2) был ли этот владелец у объекта раньше (для owners_count и типа события)
            owner_had_version = c.execute(
                "SELECT 1 FROM dossier_versions WHERE subject_id=? AND owner_user_id=? LIMIT 1",
                (subject_id, owner_user_id),
            ).fetchone() is not None

            # Незавершённая попытка сохраняется в истории, но не публикуется как
            # текущая версия. Переключение выполняет mark_done атомарно с DONE.
            is_current = 1 if result_path else 0
            if is_current:
                c.execute(
                    "UPDATE dossier_versions SET is_current_for_owner=0 WHERE subject_id=? AND owner_user_id=?",
                    (subject_id, owner_user_id),
                )

            version_id = "dv_" + uuid.uuid4().hex[:12]
            c.execute(
                """INSERT INTO dossier_versions
                   (id, subject_id, order_id, owner_user_id, result_path, visibility,
                    is_current_for_owner, created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (version_id, subject_id, order_id, owner_user_id, result_path,
                 visibility, is_current, now),
            )

            # 3) тип события и роль
            if is_update and owner_had_version:
                ev_type, role = "updated", "updater"
            elif not subject_existed:
                ev_type, role = "created", "author"
            else:
                ev_type, role = "reacquired", "owner"

            # инкремент owners_count при первом появлении владельца
            if not owner_had_version:
                c.execute(
                    "UPDATE dossier_subjects SET owners_count = owners_count + 1, updated_at=? WHERE id=?",
                    (now, subject_id),
                )

            event_id = "de_" + uuid.uuid4().hex[:12]
            c.execute(
                """INSERT INTO dossier_events
                   (id, subject_id, version_id, type, actor_user_id, role,
                    actor_username_snapshot, actor_username_html_snapshot,
                    actor_avatar_snapshot, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (event_id, subject_id, version_id, ev_type, owner_user_id, role,
                 actor_username, actor_username_html, actor_avatar, now),
            )

            # 4) автограф (рисованная подпись), immutable
            if signature_image:
                c.execute(
                    """INSERT INTO dossier_autographs
                       (id, event_id, subject_id, author_user_id, signature_image, signed_at)
                       VALUES (?,?,?,?,?,?)""",
                    ("sg_" + uuid.uuid4().hex[:12], event_id, subject_id,
                     owner_user_id, signature_image, now),
                )
        return {"subject_id": subject_id, "version_id": version_id, "event_id": event_id}

    def get_subject_id_for_order(self, order: dict) -> Optional[str]:
        """Найти аналитический объект по заказу (по паре user_id+report_type)."""
        row = self._conn().execute(
            "SELECT id FROM dossier_subjects WHERE subject_user_id=? AND report_type=?",
            (order.get("user_id"), order.get("report_type", "basic")),
        ).fetchone()
        return row["id"] if row else None

    def get_dossier_history(self, subject_id: str) -> Optional[dict]:
        """Сырьё для истории досье: сам объект + события (с версией и автографом).
        Фильтрация приватности (can_open_version) выполняется в server.py."""
        subj = self._conn().execute(
            "SELECT * FROM dossier_subjects WHERE id=?", (subject_id,)
        ).fetchone()
        if not subj:
            return None
        rows = self._conn().execute(
            """SELECT e.*, v.order_id AS v_order_id, v.owner_user_id AS v_owner_id,
                      v.visibility AS v_visibility, v.result_path AS v_result_path,
                      v.is_current_for_owner AS v_is_current,
                      a.signature_image AS a_signature, a.signed_at AS a_signed_at
               FROM dossier_events e
               LEFT JOIN dossier_versions v ON v.id = e.version_id
               LEFT JOIN dossier_autographs a ON a.event_id = e.id
               WHERE e.subject_id=?
               ORDER BY e.created_at ASC""",
            (subject_id,),
        ).fetchall()
        return {"subject": dict(subj), "events": [dict(r) for r in rows]}

    def purge_dossiers_without_history(self) -> int:
        """Deprecated retention-safe compatibility helper.

        Orders without a dossier_subject are not garbage: restored/legacy paid
        reports legitimately have no history rows.  Physical purging previously
        erased those orders and their result files, so this helper is now a no-op.
        """
        return 0

# zelscan-username-html-persistence-v1
