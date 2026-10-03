"""Retention-safe repair for legacy failed refresh attempts.

Dry-run is the default. Applying changes always creates and verifies a timestamped
SQLite online backup first. No orders, versions, events, transactions, or result
files are deleted.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path

ACTIVE = ("pending_payment", "paid", "running")


def _connect(db_path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    target = f"file:{db_path}?mode=ro" if readonly else str(db_path)
    conn = sqlite3.connect(target, uri=readonly, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def backup_database(db_path: Path) -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = db_path.with_name(
        f"{db_path.stem}.pre-failed-refresh-repair-{stamp}.backup{db_path.suffix or '.db'}"
    )
    counter = 1
    while backup.exists():
        backup = db_path.with_name(
            f"{db_path.stem}.pre-failed-refresh-repair-{stamp}-{counter}.backup{db_path.suffix or '.db'}"
        )
        counter += 1
    source = _connect(db_path)
    destination = sqlite3.connect(str(backup), timeout=30)
    try:
        source.backup(destination)
        check = destination.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError(f"backup integrity_check failed: {check}")
    except Exception:
        destination.close()
        source.close()
        backup.unlink(missing_ok=True)
        raise
    destination.close()
    source.close()
    return backup


def _is_refresh(raw: str | None) -> bool:
    try:
        return bool(json.loads(raw or "{}").get("refresh"))
    except (TypeError, ValueError):
        return False


def plan_repairs(conn: sqlite3.Connection) -> list[dict]:
    errors = conn.execute(
        "SELECT * FROM orders WHERE status='error' ORDER BY created_at, id"
    ).fetchall()
    plan = []
    for failed in errors:
        if not _is_refresh(failed["params_json"]):
            continue
        previous = conn.execute(
            """SELECT * FROM orders
               WHERE buyer_id=? AND user_id=? AND report_type=? AND status='done'
                 AND result_path IS NOT NULL AND result_path<>''
                 AND (created_at < ? OR (created_at=? AND id<?))
               ORDER BY COALESCE(finished_at,created_at) DESC, created_at DESC, id DESC
               LIMIT 1""",
            (failed["buyer_id"], failed["user_id"], failed["report_type"],
             failed["created_at"], failed["created_at"], failed["id"]),
        ).fetchone()
        if not previous:
            continue
        failed_version = conn.execute(
            "SELECT id,subject_id,owner_user_id,is_current_for_owner FROM dossier_versions WHERE order_id=?",
            (failed["id"],),
        ).fetchone()
        previous_version = conn.execute(
            "SELECT id,subject_id,owner_user_id,is_current_for_owner FROM dossier_versions WHERE order_id=?",
            (previous["id"],),
        ).fetchone()
        needs_change = bool(
            previous["deleted_at"] is not None
            or (failed_version and failed_version["is_current_for_owner"])
            or (previous_version and not previous_version["is_current_for_owner"])
        )
        plan.append({
            "failed_order_id": failed["id"],
            "previous_order_id": previous["id"],
            "buyer_id": failed["buyer_id"],
            "subject_user_id": failed["user_id"],
            "report_type": failed["report_type"],
            "needs_change": needs_change,
            "named_target": failed["id"] == "b9ed0f7d74" or str(failed["username"] or "").lower() == "root_duck",
        })
    return plan


def repair(db_path: Path, *, apply: bool = False) -> dict:
    db_path = db_path.resolve()
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    readonly = not apply
    conn = _connect(db_path, readonly=readonly)
    try:
        plan = plan_repairs(conn)
    finally:
        conn.close()
    result = {
        "db": str(db_path), "dry_run": not apply, "backup": None,
        "candidates": len(plan), "changes_needed": sum(p["needs_change"] for p in plan),
        "repairs": plan,
    }
    if not apply or not any(p["needs_change"] for p in plan):
        return result

    backup = backup_database(db_path)
    result["backup"] = str(backup)
    conn = _connect(db_path)
    try:
        conn.execute("BEGIN IMMEDIATE")
        changed = 0
        for item in plan:
            if not item["needs_change"]:
                continue
            failed_id = item["failed_order_id"]
            previous_id = item["previous_order_id"]
            previous = conn.execute("SELECT * FROM orders WHERE id=?", (previous_id,)).fetchone()
            failed_version = conn.execute(
                "SELECT subject_id,owner_user_id FROM dossier_versions WHERE order_id=?", (failed_id,)
            ).fetchone()
            previous_version = conn.execute(
                "SELECT subject_id,owner_user_id FROM dossier_versions WHERE order_id=?", (previous_id,)
            ).fetchone()
            scope = previous_version or failed_version
            if scope:
                conn.execute(
                    "UPDATE dossier_versions SET is_current_for_owner=0 WHERE subject_id=? AND owner_user_id=?",
                    (scope["subject_id"], scope["owner_user_id"]),
                )
                if previous_version:
                    conn.execute(
                        "UPDATE dossier_versions SET result_path=?, visibility=?, is_current_for_owner=1 WHERE order_id=?",
                        (previous["result_path"], previous["visibility"], previous_id),
                    )
            conn.execute(
                "UPDATE orders SET deleted_at=NULL, updated_at=COALESCE(updated_at,finished_at,created_at) WHERE id=?",
                (previous_id,),
            )
            changed += 1
        conn.commit()
        result["applied"] = changed
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path("zelscan.db"))
    parser.add_argument("--apply", action="store_true", help="apply after creating a verified backup")
    args = parser.parse_args()
    print(json.dumps(repair(args.db, apply=args.apply), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
