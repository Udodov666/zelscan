# -*- coding: utf-8 -*-
"""Миграция дублей/версий досье (план §15).

Что делает:
  1. Резервная копия zelscan.db -> zelscan.pre-dossier-version-migration-<ts>.db
     (только при --apply; делается через sqlite backup API, WAL-безопасно).
  2. Находит дубли по (владелец, пользователь досье, тариф) среди готовых
     заказов: status='done', deleted_at IS NULL, result_path IS NOT NULL.
  3. Выбирает текущую успешную версию: сначала строку с
     is_current_for_owner=1, иначе последнюю по finished_at/created_at.
  4. Старые версии остаётся в истории: им проставляется
     is_current_for_owner=0. JSON-файлы не удаляются и не перезаписываются.
  5. Находит заказы, чей результат побайтово/структурно идентичен кешу
     cache/dossier_{user_id}_{report_type}.json -> список возможных
     некорректных списаний (выдача кеша вместо нового анализа).
  6. Отдельно помечает заказ b62653a5bc.

По умолчанию — DRY-RUN (ничего не пишет). Для записи: --apply.
Отчёт сохраняется в logs/dossier_migration_report_<ts>.json.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "zelscan.db")
CACHE_DIR = os.path.join(ROOT, "cache")
LOG_DIR = os.path.join(ROOT, "logs")
MARKED_ORDER = "b62653a5bc"
# Волатильные поля, которые не участвуют в сравнении с кешем
VOLATILE_KEYS = {"generated_at"}


def backup_db(db_path: str) -> str:
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = os.path.join(ROOT, f"zelscan.pre-dossier-version-migration-{ts}.db")
    src = sqlite3.connect(db_path)
    out = sqlite3.connect(dst)
    with out:
        src.backup(out)
    out.close()
    src.close()
    return dst


def fetch_dup_groups(c: sqlite3.Cursor) -> list[dict]:
    rows = c.execute(
        """
        SELECT v.owner_user_id        AS owner,
               v.subject_id           AS subject,
               o.report_type          AS report_type,
               COUNT(*)               AS n
        FROM dossier_versions v
        JOIN orders o ON o.id = v.order_id
        WHERE o.status='done' AND o.deleted_at IS NULL
          AND o.result_path IS NOT NULL
        GROUP BY v.owner_user_id, v.subject_id, o.report_type
        HAVING n > 1
        ORDER BY v.owner_user_id, v.subject_id, o.report_type
        """
    ).fetchall()
    groups = []
    for r in rows:
        detail = c.execute(
            """
            SELECT v.id AS version_id, v.order_id, v.is_current_for_owner,
                   v.result_path, v.created_at,
                   o.finished_at, o.created_at AS order_created_at,
                   o.visibility, o.deleted_at, o.status
            FROM dossier_versions v
            JOIN orders o ON o.id = v.order_id
            WHERE v.owner_user_id=? AND v.subject_id=? AND o.report_type=?
              AND o.status='done' AND o.deleted_at IS NULL
              AND o.result_path IS NOT NULL
            ORDER BY o.finished_at DESC, o.created_at DESC, v.id DESC
            """,
            (r["owner"], r["subject"], r["report_type"]),
        ).fetchall()
        groups.append({
            "owner": r["owner"],
            "subject": r["subject"],
            "report_type": r["report_type"],
            "versions": [dict(x) for x in detail],
        })
    return groups


def pick_current(versions: list[dict]) -> dict:
    """Текущая версия: помеченная is_current_for_owner=1, иначе последняя."""
    flagged = [v for v in versions if v["is_current_for_owner"]]
    if len(flagged) == 1:
        return flagged[0]
    if flagged:
        # несколько флагов — берём последнюю из них, остальные снимем
        return max(flagged, key=lambda v: (v["finished_at"] or 0,
                                           v["order_created_at"] or 0,
                                           v["version_id"]))
    return versions[0]  # отсортировано по finished_at DESC


def normalize_dossier(obj) -> str:
    if isinstance(obj, dict):
        return json.dumps(
            {k: v for k, v in obj.items() if k not in VOLATILE_KEYS},
            sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        )
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def find_cache_identical(c: sqlite3.Cursor) -> list[dict]:
    """Заказы, чей результат идентичен кеш-файлу -> возможные некорректные списания."""
    suspected = []
    rows = c.execute(
        """
        SELECT id, user_id, report_type, result_path, finished_at, buyer_id,
               charge_credits, charge_bonus
        FROM orders
        WHERE status='done' AND deleted_at IS NULL AND result_path IS NOT NULL
        ORDER BY finished_at DESC
        """
    ).fetchall()
    cache_cache: dict[str, str] = {}
    for r in rows:
        cache_file = os.path.join(CACHE_DIR, f"dossier_{r['user_id']}_{r['report_type']}.json")
        if not os.path.exists(cache_file) or not os.path.exists(r["result_path"]):
            continue
        try:
            if cache_file not in cache_cache:
                with open(cache_file, encoding="utf-8") as f:
                    cache_cache[cache_file] = normalize_dossier(json.load(f))
            with open(r["result_path"], encoding="utf-8") as f:
                order_norm = normalize_dossier(json.load(f))
        except (OSError, ValueError):
            continue
        if order_norm == cache_cache[cache_file]:
            suspected.append({
                "order_id": r["id"],
                "user_id": r["user_id"],
                "report_type": r["report_type"],
                "result_path": r["result_path"],
                "cache_file": os.path.relpath(cache_file, ROOT),
                "finished_at": r["finished_at"],
                "buyer_id": r["buyer_id"],
                "charge_credits": r["charge_credits"],
                "charge_bonus": r["charge_bonus"],
            })
    return suspected


def run(apply: bool) -> int:
    if not os.path.exists(DB_PATH):
        print(f"БД не найдена: {DB_PATH}")
        return 1
    report: dict = {"ts": int(time.time()), "mode": "apply" if apply else "dry-run",
                    "backup": None, "dup_groups": [], "cache_identical": [],
                    "marked_order": None, "changes": []}

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # ── 1. Дубли по (владелец, субъект, тариф) ────────────────────────────
    groups = fetch_dup_groups(c)
    report["dup_groups"] = groups
    print(f"Групп дублей (владелец+субъект+тариф): {len(groups)}")
    for g in groups:
        current = pick_current(g["versions"])
        print(f"  owner={g['owner']} subject={g['subject']} {g['report_type']}: "
              f"{len(g['versions'])} версий, current -> {current['order_id']}")
        if apply:
            with conn:
                # старые версии остаются в истории, флаг текущей снимаем
                cur = c.execute(
                    "UPDATE dossier_versions SET is_current_for_owner=0 "
                    "WHERE subject_id=? AND owner_user_id=? AND order_id!=?",
                    (g["subject"], g["owner"], current["order_id"]),
                )
                # целевая версия гарантированно текущая
                c.execute(
                    "UPDATE dossier_versions SET is_current_for_owner=1 "
                    "WHERE order_id=?",
                    (current["order_id"],),
                )
            report["changes"].append({
                "action": "set_current_version",
                "owner": g["owner"], "subject": g["subject"],
                "report_type": g["report_type"],
                "current_order_id": current["order_id"],
                "demoted_versions": [v["order_id"] for v in g["versions"]
                                     if v["order_id"] != current["order_id"]],
                "rows_demoted": cur.rowcount,
            })

    # ── 2. Заказы, идентичные кешу (возможные некорректные списания) ─────
    suspected = find_cache_identical(c)
    report["cache_identical"] = suspected
    print(f"Заказов с результатом, идентичным кешу: {len(suspected)}")
    for s in suspected:
        print(f"  {s['order_id']} user={s['user_id']} {s['report_type']} "
              f"credits={s['charge_credits']} bonus={s['charge_bonus']}")

    # ── 3. Отдельная отметка b62653a5bc ──────────────────────────────────
    row = c.execute(
        "SELECT id, user_id, report_type, status, result_path, finished_at, "
        "buyer_id, charge_credits, charge_bonus, refunded_at "
        "FROM orders WHERE id LIKE ?",
        (f"%{MARKED_ORDER}%",),
    ).fetchone()
    if row:
        row = dict(row)
        row["note"] = ("Помечен планом §15 как возможное некорректное списание; "
                       "требует ручного решения по возврату, автоматически не трогаем.")
        report["marked_order"] = row
        print(f"Помеченный заказ {MARKED_ORDER}: status={row['status']} "
              f"credits={row['charge_credits']} bonus={row['charge_bonus']} "
              f"refunded_at={row['refunded_at']}")
    else:
        print(f"Заказ {MARKED_ORDER} в БД не найден")

    conn.close()

    # ── 4. Резервная копия и сохранение отчёта ───────────────────────────
    if apply:
        report["backup"] = os.path.relpath(backup_db(DB_PATH), ROOT)
        print(f"Резервная копия: {report['backup']}")

    os.makedirs(LOG_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    report_path = os.path.join(LOG_DIR, f"dossier_migration_report_{ts}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"Отчёт: {os.path.relpath(report_path, ROOT)}")
    print(f"Режим: {report['mode']} {'— изменения записаны' if apply else '— ничего не изменено (dry-run)'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="записать изменения (по умолчанию dry-run)")
    args = parser.parse_args()
    return run(apply=args.apply)


if __name__ == "__main__":
    sys.exit(main())
