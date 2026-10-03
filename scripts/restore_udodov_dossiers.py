import json
import os
import re
import sqlite3
import uuid

BUYER_ID = "638074"

with open("AI_TEXT_AUDIT_SAFE_EXPORT.json", encoding="utf-8") as fh:
    export = json.load(fh)

reports = {
    int(report["sanitized_full_json"]["user_id"]): report["sanitized_full_json"]
    for report in export.get("reports", [])
    if isinstance(report.get("sanitized_full_json"), dict)
    and report["sanitized_full_json"].get("user_id")
}

conn = sqlite3.connect("zelscan.db")
transactions = conn.execute(
    """SELECT description, MAX(created_at)
       FROM transactions
       WHERE user_id=? AND description LIKE 'Отчёт %'
       GROUP BY description""",
    (int(BUYER_ID),),
).fetchall()
restored = []

for description, created_at in transactions:
    match = re.search(r"Отчёт '([^']+)' по пользователю #(\d+)", description)
    if not match:
        continue
    report_type, raw_user_id = match.groups()
    user_id = int(raw_user_id)
    data = reports.get(user_id)
    result_path = os.path.abspath(f"cache/dossier_{user_id}_{report_type}.json")

    if not os.path.exists(result_path) and data:
        with open(result_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    if not os.path.exists(result_path):
        continue

    existing = conn.execute(
        """SELECT id FROM orders
           WHERE user_id=? AND report_type=? AND buyer_id=? AND deleted_at IS NULL""",
        (user_id, report_type, BUYER_ID),
    ).fetchone()
    if existing:
        continue

    card = data.get("card", {}) if data else {}
    finished_at = int((data or {}).get("generated_at") or created_at)
    order_id = "restored_" + uuid.uuid4().hex[:10]
    conn.execute(
        """INSERT INTO orders
           (id,user_id,username,avatar,report_type,status,result_path,buyer_id,
            created_at,paid_at,started_at,finished_at,visibility,display_id,
            updated_at,username_html)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            order_id, user_id, card.get("username", str(user_id)),
            card.get("avatar", ""), report_type, "done", result_path, BUYER_ID,
            created_at, created_at, created_at, finished_at, "private",
            "ZS-" + uuid.uuid4().hex[:8].upper(), finished_at, "",
        ),
    )
    restored.append((user_id, report_type, order_id))

conn.commit()
count = conn.execute(
    "SELECT COUNT(*) FROM orders WHERE buyer_id=? AND deleted_at IS NULL",
    (BUYER_ID,),
).fetchone()[0]
print("RESTORED", restored)
print("COUNT", count)
