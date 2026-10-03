from pathlib import Path

for path in [Path("app/admin_ui/index.html"), Path("landing/admin/index.html")]:
    source = path.read_text(encoding="utf-8")
    form_start = source.find('<form class="space-y-5">')
    marker = source.find("Токен LOLZ", form_start)
    group_start = source.rfind('<div class="space-y-2">', form_start, marker)
    group_end = source.find("</div>", marker) + len("</div>")
    if min(form_start, marker, group_start) < 0 or group_end < len("</div>"):
        raise RuntimeError(f"Login token field not found: {path}")
    path.write_text(source[:group_start] + source[group_end:], encoding="utf-8")
    print(f"patched {path}")
