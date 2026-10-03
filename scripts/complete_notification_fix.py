from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if text.count(old) != count:
        raise RuntimeError(f"{path}: expected {count} matches, found {text.count(old)}")
    p.write_text(text.replace(old, new), encoding="utf-8")


# store runtime schema, settings contract, durable dedupe, centralized terminal events
replace("app/store.py", '''                "notify_news": "INTEGER NOT NULL DEFAULT 1",
                "auto_open_dossier": "INTEGER NOT NULL DEFAULT 0",''', '''                "notify_news": "INTEGER NOT NULL DEFAULT 1",
                "notify_important": "INTEGER NOT NULL DEFAULT 1",
                "auto_open_dossier": "INTEGER NOT NULL DEFAULT 0",''')
replace("app/store.py", '''            if scols:  # таблица уже была — доводим схему
                for name, decl in settings_migrations.items():
                    if name not in scols:
                        self._conn().execute(f"ALTER TABLE user_settings ADD COLUMN {name} {decl}")
            self._conn().commit()''', '''            if scols:  # таблица уже была — доводим схему
                for name, decl in settings_migrations.items():
                    if name not in scols:
                        self._conn().execute(f"ALTER TABLE user_settings ADD COLUMN {name} {decl}")
            ncols = {r[1] for r in self._conn().execute("PRAGMA table_info(notifications)")}
            if "dedupe_key" not in ncols:
                self._conn().execute("ALTER TABLE notifications ADD COLUMN dedupe_key TEXT")
            self._conn().execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe "
                "ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL"
            )
            self._conn().commit()''')
replace("app/store.py", '''        "notify_news": True,
        "auto_open_dossier": False,''', '''        "notify_news": True,
        "notify_important": True,
        "auto_open_dossier": False,''')
replace("app/store.py", '''        "notify_formation_error", "notify_balance_topup", "notify_news",
        "auto_open_dossier", "remember_tariff",''', '''        "notify_formation_error", "notify_balance_topup", "notify_news",
        "notify_important", "auto_open_dossier", "remember_tariff",''')
replace("app/store.py", '''                notify_formation_error, notify_balance_topup, notify_news,
                auto_open_dossier, remember_tariff, last_tariff, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, int(d["show_balance"]), int(d["notifications_enabled"]),
             int(d["notify_dossier_ready"]), int(d["notify_formation_error"]),
             int(d["notify_balance_topup"]), int(d["notify_news"]),
             int(d["auto_open_dossier"]), int(d["remember_tariff"]),
             d["last_tariff"], now, now),''', '''                notify_formation_error, notify_balance_topup, notify_news, notify_important,
                auto_open_dossier, remember_tariff, last_tariff, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user_id, int(d["show_balance"]), int(d["notifications_enabled"]),
             int(d["notify_dossier_ready"]), int(d["notify_formation_error"]),
             int(d["notify_balance_topup"]), int(d["notify_news"]), int(d["notify_important"]),
             int(d["auto_open_dossier"]), int(d["remember_tariff"]),
             d["last_tariff"], now, now),''')
replace("app/store.py", '''    _NOTIFICATION_TYPES = ("dossier_ready", "formation_error", "balance_topup", "news")''', '''    _NOTIFICATION_TYPES = ("dossier_ready", "formation_error", "balance_topup", "news", "important")''')
replace("app/store.py", '''            "news": "notify_news",
        }[ntype]''', '''            "news": "notify_news",
            "important": "notify_important",
        }[ntype]''')
replace("app/store.py", '''        dedupe_key = str(meta.get("dedupe_key") or "").strip()
        nid = uuid.uuid4().hex''', '''        dedupe_key = str(meta.pop("dedupe_key", "") or "").strip() or None
        nid = uuid.uuid4().hex''')
replace("app/store.py", '''            if dedupe_key:
                rows = c.execute(
                    "SELECT id, meta_json FROM notifications WHERE user_id=? AND type=?",
                    (user_id, ntype),
                ).fetchall()
                for row in rows:
                    try:
                        existing_meta = json.loads(row["meta_json"] or "{}")
                    except (TypeError, ValueError):
                        existing_meta = {}
                    if existing_meta.get("dedupe_key") == dedupe_key:
                        return self.get_notification(row["id"])
            c.execute(
                """INSERT INTO notifications
                   (id, user_id, type, title, body, meta_json, is_read, created_at)
                   VALUES (?,?,?,?,?,?,0,?)""",
                (nid, user_id, ntype, title, body, meta_json, now),
            )
        return self.get_notification(nid)''', '''            if dedupe_key:
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
        raise ValueError(f"Unsupported terminal status: {status}")''')

# worker delegates all terminal notification behavior to store
start = '''            # Уведомление создаётся только после записи результата и mark_done.'''
end = '''            except Exception:\n                logger.exception("Не удалось создать уведомление dossier_ready для %s", order_id)'''
p = ROOT / "app/worker.py"
t = p.read_text(encoding="utf-8")
a, b = t.index(start), t.index(end) + len(end)
t = t[:a] + '''            try:\n                self._store.create_terminal_notification(order, Status.DONE)\n            except Exception:\n                logger.exception("Не удалось создать terminal-уведомление для %s", order_id)''' + t[b:]
old = '''            # Уведомление об ошибке формирования (уважает настройки пользователя)
            try:
                self._store.create_notification(
                    user_id,
                    "formation_error",
                    title="Ошибка формирования досье",
                    body="При формировании отчёта произошла ошибка. Средства не списаны или будут возвращены.",
                    meta={"order_id": order_id, "report_type": report_type},
                )
            except Exception:
                logger.exception("Не удалось создать уведомление formation_error для %s", order_id)'''
new = '''            try:
                self._store.create_terminal_notification(order, Status.ERROR, str(e))
            except Exception:
                logger.exception("Не удалось создать terminal-уведомление для %s", order_id)'''
if old not in t:
    raise RuntimeError("worker error notification block not found")
p.write_text(t.replace(old, new), encoding="utf-8")

# settings frontends
for path in ("landing/assets/js/settings.js", "landing/assets/dashboard2/js/settings.dashboard2.js"):
    replace(path, "    news:           'notify_news',\n", "    news:           'notify_news',\n    important:      'notify_important',\n")
    replace(path, "    formationError: true, balanceTopup: true, news: true,\n", "    formationError: true, balanceTopup: true, news: true, important: true,\n")
    replace(path, '''<div class="zs-settings-row"><span class="zs-settings-copy">Новости и обновления сервиса</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="news" role="switch" aria-checked="true" aria-label="Новости и обновления сервиса"><i></i></button></div></div></section>''', '''<div class="zs-settings-row"><span class="zs-settings-copy">Новости и обновления сервиса</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="news" role="switch" aria-checked="true" aria-label="Новости и обновления сервиса"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Важные уведомления</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="important" role="switch" aria-checked="true" aria-label="Важные уведомления"><i></i></button></div></div></section>''')

# notification frontends: important tone and safe relative URL click
for path in ("landing/assets/js/zs-notifications.js", "landing/assets/dashboard2/js/zs-notifications.dashboard2.js"):
    replace(path, "    news:           'info',\n", "    news:           'info',\n    important:      'warning',\n")
    replace(path, '''  function relTime(ts) {''', '''  function safeRelativeUrl(value) {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('\\\\')) return '';
    try {
      const u = new URL(value, location.href);
      if (u.origin !== location.origin || !/^(?:[A-Za-z0-9._~-]+\\/)*[A-Za-z0-9._~-]+(?:\\?[^#]*)?(?:#.*)?$/.test(value)) return '';
      return value;
    } catch (_) { return ''; }
  }
  function relTime(ts) {''')
    replace(path, '''      const dossierOrder = n.meta && n.meta.order_id;
      if (dossierOrder && n.type === 'dossier_ready') item.classList.add('is-clickable');''', '''      const targetUrl = safeRelativeUrl(n.meta && n.meta.url);
      if (targetUrl) item.classList.add('is-clickable');''')
    replace(path, '''        if (dossierOrder && n.type === 'dossier_ready') {
          location.href = 'zelscan.html?order=' + encodeURIComponent(dossierOrder);
        }''', '''        if (targetUrl) location.href = targetUrl;''')

# terminal UI must refresh authoritative API count, not bump locally
p = ROOT / "landing/assets/dashboard2/js/order-modals.dashboard2.js"
t = p.read_text(encoding="utf-8")
t = t.replace("window.ZSNotifications.bump()", "window.ZSNotifications.refreshUnread()")
t = t.replace("window.ZSNotifications.bump(1)", "window.ZSNotifications.refreshUnread()")
p.write_text(t, encoding="utf-8")

# tests
p = ROOT / "tests/test_settings_notifications.py"
t = p.read_text(encoding="utf-8")
t = t.replace('''        assert s["remember_tariff"] is True''', '''        assert s["remember_tariff"] is True
        assert s["notify_important"] is True''')
t += '''\n\ndef test_important_and_terminal_owner_dedupe():
    st, path = _fresh_store()
    try:
        st.patch_settings(42, {"notify_important": False})
        assert st.create_notification(42, "important", title="x") is None
        st.patch_settings(42, {"notify_important": True})
        assert st.create_notification(42, "important", title="x") is not None
        order = {"id": "abc123", "user_id": 999, "buyer_id": "42", "report_type": "basic", "params": {}}
        first = st.create_terminal_notification(order, store_mod.Status.DONE)
        second = st.create_terminal_notification(order, store_mod.Status.DONE)
        assert first["id"] == second["id"]
        assert len([n for n in st.list_notifications(42) if n["type"] == "dossier_ready"]) == 1
        assert st.list_notifications(999) == []
        assert first["meta"]["url"] == "zelscan.html?order=abc123"
    finally:
        _cleanup(st, path)
'''
p.write_text(t, encoding="utf-8")

print("notification code patch complete")
