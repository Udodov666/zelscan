from pathlib import Path
import re

FILES = [
    Path("app/admin_ui/_next/static/chunks/1nzrzbxaighkm.js"),
    Path("landing/_next/static/chunks/1_vz74y2mmigy.js"),
]

field_pattern = re.compile(
    r'\(0,en\.jsxs\)\("div",\{className:"space-y-2",children:\['
    r'\(0,en\.jsx\)\(T\w,\{children:"Токен LOLZ"\}\),'
    r'\(0,en\.jsx\)\(T\w,\{value:r,onChange:e=>n\(e\.target\.value\),'
    r'placeholder:"OAuth токен аккаунта",autoComplete:"off"\}\)\]\}\),'
)

for path in FILES:
    source = path.read_text(encoding="utf-8")
    marker = source.find("Токен LOLZ")
    if marker < 0:
        if 'localStorage.getItem("lzt_token")' in source and "OAuth токен аккаунта" not in source:
            print(f"already patched {path}")
            continue
        raise RuntimeError(f"Login marker not found: {path}")
    start = source.rfind("function ", 0, marker)
    end = source.find("function ", marker + 1)
    if start < 0 or end < 0:
        raise RuntimeError(f"Login component bounds not found: {path}")

    block = source[start:end]
    block = block.replace(
        "ea.useState(Fi())",
        'ea.useState(()=>localStorage.getItem("lzt_token")||"")',
    ).replace(
        "ea.useState(Fo())",
        'ea.useState(()=>localStorage.getItem("lzt_token")||"")',
    ).replace(
        'if(n.preventDefault(),!r.trim())return void d("Введите токен LOLZ (OAuth токен пользователя)");',
        'if(n.preventDefault(),!r.trim())return void d("Сначала войдите на основном сайте через Lolzteam");',
    )
    block, count = field_pattern.subn("", block)
    if count != 1:
        raise RuntimeError(f"Expected one token field, replaced {count}: {path}")
    if "Токен LOLZ" in block or "OAuth токен аккаунта" in block:
        raise RuntimeError(f"Token UI remains: {path}")

    path.write_text(source[:start] + block + source[end:], encoding="utf-8")
    print(f"patched {path}")
