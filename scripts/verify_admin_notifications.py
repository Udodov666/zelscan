from pathlib import Path

files = [
    Path("landing/_next/static/chunks/1_vz74y2mmigy.js"),
    Path("app/admin_ui/_next/static/chunks/1nzrzbxaighkm.js"),
]
checks = {
    "navigation": 'id:"notifications",label:"Уведомления"',
    "api": "/admin/notifications",
    "history": "История рассылок",
    "route": 'notifications"===',
}
for path in files:
    source = path.read_text(encoding="utf-8")
    result = {name: marker in source for name, marker in checks.items()}
    print(path, result)
    if not all(result.values()):
        raise SystemExit(f"Incomplete notifications UI in {path}")
