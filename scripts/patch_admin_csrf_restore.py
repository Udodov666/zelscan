from pathlib import Path

files = [
    Path("landing/_next/static/chunks/1_vz74y2mmigy.js"),
    Path("app/admin_ui/_next/static/chunks/1_vz74y2mmigy.js"),
]
old = 'Fu("/admin/notifications").then(e=>{t(e),d('
new = 'Fu("/admin/access").then(e=>{e.csrf&&(Fa=e.csrf);return Fu("/admin/notifications")}).then(e=>{t(e),d('
for path in files:
    source = path.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"notifications loader not found: {path}")
    source = source.replace(old, new, 1)
    path.write_text(source, encoding="utf-8")
    print(f"patched {path}")
