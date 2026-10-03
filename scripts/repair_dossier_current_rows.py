"""One-time, retention-safe repair for current dossier cards.

Creates a SQLite online backup before changing data. It never deletes orders,
versions, events, autographs, transactions, or result files.
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import time
from pathlib import Path


def backup_database(db_path: Path) -> Path:
    stamp = time.strftime('%Y%m%d-%H%M%S')
    backup = db_path.with_name(f'{db_path.stem}.pre-dossier-repair-{stamp}{db_path.suffix}')
    source = sqlite3.connect(str(db_path))
    destination = sqlite3.connect(str(backup))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    return backup


def repair(db_path: Path) -> dict:
    backup = backup_database(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('BEGIN IMMEDIATE')
        synced = conn.execute(
            """UPDATE dossier_versions
               SET result_path=(SELECT o.result_path FROM orders o WHERE o.id=dossier_versions.order_id)
               WHERE EXISTS (
                 SELECT 1 FROM orders o
                 WHERE o.id=dossier_versions.order_id
                   AND o.result_path IS NOT NULL
                   AND (dossier_versions.result_path IS NULL OR dossier_versions.result_path != o.result_path)
               )"""
        ).rowcount
        versions = conn.execute(
            """SELECT v.id
               FROM dossier_versions v
               JOIN (
                 SELECT v2.subject_id, v2.owner_user_id, MAX(v2.created_at) AS newest_created
                 FROM dossier_versions v2
                 GROUP BY v2.subject_id, v2.owner_user_id
               ) newest ON newest.subject_id=v.subject_id
                       AND newest.owner_user_id=v.owner_user_id
                       AND newest.newest_created=v.created_at
               JOIN (
                 SELECT subject_id, owner_user_id, created_at, MAX(id) AS newest_id
                 FROM dossier_versions
                 GROUP BY subject_id, owner_user_id, created_at
               ) tie ON tie.subject_id=v.subject_id
                    AND tie.owner_user_id=v.owner_user_id
                    AND tie.created_at=v.created_at
                    AND tie.newest_id=v.id"""
        ).fetchall()
        current_ids = [row['id'] for row in versions]
        conn.execute('UPDATE dossier_versions SET is_current_for_owner=0')
        if current_ids:
            conn.executemany('UPDATE dossier_versions SET is_current_for_owner=1 WHERE id=?', [(value,) for value in current_ids])
        conn.execute('COMMIT')
        return {'backup': str(backup), 'synced_result_paths': synced, 'current_versions': len(current_ids)}
    except Exception:
        conn.execute('ROLLBACK')
        raise
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='zelscan.db')
    args = parser.parse_args()
    result = repair(Path(args.db).resolve())
    print(result)
