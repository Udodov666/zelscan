from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
import store as store_mod


def verify_store() -> dict:
    with tempfile.TemporaryDirectory() as td:
        st = store_mod.OrderStore(Path(td) / "verify.db")
        ready_order = {"id": "ready-1", "user_id": 9001, "buyer_id": "42", "report_type": "basic", "params": {}}
        ready = st.create_terminal_notification(ready_order, store_mod.Status.DONE)
        ready_again = st.create_terminal_notification(ready_order, store_mod.Status.DONE)
        assert ready and ready["user_id"] == 42
        assert ready["id"] == ready_again["id"]
        assert ready["meta"]["url"] == "zelscan.html?order=ready-1"
        assert st.list_notifications(9001) == []

        error_order = {"id": "error-1", "user_id": 9002, "buyer_id": "43", "report_type": "pro", "params": {}}
        error = st.create_terminal_notification(error_order, store_mod.Status.ERROR, "boom")
        assert error and error["user_id"] == 43 and error["type"] == "formation_error"
        assert error["meta"]["url"] == "zelscan.html?order=error-1"

        st.patch_settings(44, {"notify_important": False})
        assert st.create_notification(44, "important", title="off") is None
        st.patch_settings(44, {"notify_important": True})
        important = st.create_notification(44, "important", title="on", meta={"dedupe_key": "important:1"})
        assert important
        conn = sqlite3.connect(str(Path(td) / "verify.db"))
        assert conn.execute("SELECT notify_important FROM user_settings WHERE user_id=44").fetchone()[0] == 1
        assert conn.execute("SELECT dedupe_key FROM notifications WHERE id=?", (important["id"],)).fetchone()[0] == "important:1"
        conn.close()
        local_conn = getattr(st._local, "conn", None)
        if local_conn:
            local_conn.close()
            st._local.conn = None
        return {"ready": "pass", "error": "pass", "important": "pass",
                "persistence": "pass", "owner_isolation": "pass", "dedupe": "pass"}


def verify_live(db: Path) -> dict:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        owner_missing = conn.execute("""
            SELECT COUNT(*) FROM orders o
            WHERE o.status IN ('done','error') AND o.buyer_id IS NOT NULL AND o.buyer_id<>''
              AND NOT EXISTS (
                SELECT 1 FROM notifications n
                WHERE n.user_id=CAST(o.buyer_id AS INTEGER)
                  AND n.dedupe_key='order:'||o.id||':'||CASE WHEN o.status='done' THEN 'done' ELSE 'error' END
              )
        """).fetchone()[0]
        owner_copies = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id=638074 AND dedupe_key LIKE 'order:%:done'").fetchone()[0]
        misowned_preserved = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id IN (4301528,5254256) AND type='dossier_ready'").fetchone()[0]
        duplicate_keys = conn.execute("SELECT COUNT(*) FROM (SELECT user_id,dedupe_key FROM notifications WHERE dedupe_key IS NOT NULL GROUP BY user_id,dedupe_key HAVING COUNT(*)>1)").fetchone()[0]
        assert integrity == "ok"
        assert owner_missing == 0
        assert duplicate_keys == 0
        return {"integrity": integrity, "owner_missing": owner_missing,
                "owner_terminal_copies": owner_copies,
                "misowned_rows_preserved": misowned_preserved,
                "duplicate_dedupe_keys": duplicate_keys}
    finally:
        conn.close()


if __name__ == "__main__":
    print(json.dumps({"scenarios": verify_store(), "live": verify_live(ROOT / "zelscan.db")}, ensure_ascii=False, sort_keys=True))
