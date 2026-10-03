from __future__ import annotations

import argparse
import json
import sqlite3
import time
import uuid
from pathlib import Path


def migrate(db_path: Path) -> dict:
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    counts = {"dedupe_column_added": 0, "important_column_added": 0,
              "dedupe_backfilled": 0, "owner_copies_inserted": 0}
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("BEGIN IMMEDIATE")
        ncols = {r[1] for r in conn.execute("PRAGMA table_info(notifications)")}
        if "dedupe_key" not in ncols:
            conn.execute("ALTER TABLE notifications ADD COLUMN dedupe_key TEXT")
            counts["dedupe_column_added"] = 1
        scols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)")}
        if "notify_important" not in scols:
            conn.execute("ALTER TABLE user_settings ADD COLUMN notify_important INTEGER NOT NULL DEFAULT 1")
            counts["important_column_added"] = 1

        rows = conn.execute("SELECT id,user_id,type,meta_json,dedupe_key FROM notifications").fetchall()
        for row in rows:
            if row["dedupe_key"]:
                continue
            try:
                meta = json.loads(row["meta_json"] or "{}")
            except (TypeError, ValueError):
                meta = {}
            key = str(meta.get("dedupe_key") or "").strip()
            order_id = str(meta.get("order_id") or "").strip()
            if not key and order_id and row["type"] in ("dossier_ready", "formation_error"):
                terminal = "done" if row["type"] == "dossier_ready" else "error"
                key = f"order:{order_id}:{terminal}"
            if key:
                duplicate = conn.execute(
                    "SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key=? AND id<>?",
                    (row["user_id"], key, row["id"]),
                ).fetchone()
                if not duplicate:
                    conn.execute("UPDATE notifications SET dedupe_key=? WHERE id=?", (key, row["id"]))
                    counts["dedupe_backfilled"] += 1

        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe ON notifications(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL")

        orders = conn.execute("SELECT * FROM orders WHERE status IN ('done','error') AND buyer_id IS NOT NULL AND buyer_id<>''").fetchall()
        for order in orders:
            owner = int(order["buyer_id"])
            terminal = "done" if order["status"] == "done" else "error"
            ntype = "dossier_ready" if terminal == "done" else "formation_error"
            key = f"order:{order['id']}:{terminal}"
            if conn.execute("SELECT 1 FROM notifications WHERE user_id=? AND dedupe_key=?", (owner, key)).fetchone():
                continue
            display_id = order["display_id"] or ("ZS-" + order["id"][:8].upper())
            try:
                params = json.loads(order["params_json"] or "{}")
            except (TypeError, ValueError):
                params = {}
            is_update = bool(params.get("refresh", False))
            if terminal == "done":
                title = "Досье обновлено" if is_update else "Досье готово"
                body = (f"Обновлённое досье {display_id} готово к просмотру." if is_update
                        else f"Досье {display_id} сформировано и готово к просмотру.")
            else:
                title = "Ошибка формирования досье"
                body = "При формировании отчёта произошла ошибка. Средства не списаны или будут возвращены."
            meta = {"order_id": order["id"], "display_id": display_id,
                    "report_type": order["report_type"],
                    "url": "zelscan.html?order=" + order["id"]}
            if terminal == "done":
                meta["is_update"] = is_update
            conn.execute(
                "INSERT INTO notifications(id,user_id,type,title,body,meta_json,dedupe_key,is_read,created_at) VALUES(?,?,?,?,?,?,?,0,?)",
                (uuid.uuid4().hex, owner, ntype, title, body,
                 json.dumps(meta, ensure_ascii=False), key,
                 int(order["finished_at"] or time.time())),
            )
            counts["owner_copies_inserted"] += 1
        conn.commit()
        return counts
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("db", type=Path)
    args = parser.parse_args()
    print(json.dumps(migrate(args.db), ensure_ascii=False, sort_keys=True))
