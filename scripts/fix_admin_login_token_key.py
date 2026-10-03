"""Fix admin-login form to read the OAuth token from the correct localStorage
key. The earlier patch initialised the login form state from `lzt_token`, but
the app actually stores the Lolzteam OAuth token under `zelscan_admin_token`
(see `Fn="zelscan_admin_token"; Fo()=>localStorage.getItem(Fn)`). Because
`lzt_token` is always null, the form aborted with
"Сначала войдите на основном сайте через Lolzteam" before contacting the server.

We replace the wrong initialiser with `Fo()` (the canonical getter) so the form
uses the real token. Idempotent + creates a .bak once.
"""
from pathlib import Path
import shutil
import time

import re

# Per-chunk minified getter for the OAuth token. Both store it under
# `zelscan_admin_token`, but the minified getter fn name differs per bundle.
FILES = [
    Path("app/admin_ui/_next/static/chunks/1nzrzbxaighkm.js"),
    Path("landing/_next/static/chunks/1_vz74y2mmigy.js"),
]

WRONG = 'ea.useState(()=>localStorage.getItem("lzt_token")||"")'

def canonical_getter(src: str) -> str:
    """Find the minified fn that does `return localStorage.getItem(<VAR>)||""`
    where <VAR> holds "zelscan_admin_token". Returns e.g. 'Fi' or 'Fo'."""
    m = re.search(r'(\w+)="zelscan_admin_token"', src)
    if not m:
        raise RuntimeError("zelscan_admin_token var not found")
    var = m.group(1)
    m2 = re.search(r'function (\w+)\(\)\{return localStorage\.getItem\(' + re.escape(var) + r'\)\|\|""\}', src)
    if not m2:
        raise RuntimeError("getter fn for zelscan_admin_token not found")
    return m2.group(1)

for path in FILES:
    if not path.exists():
        print(f"skip (missing): {path}")
        continue
    src = path.read_text(encoding="utf-8")
    getter = canonical_getter(src)
    RIGHT = f'ea.useState(()=>{getter}())'
    if WRONG not in src:
        if RIGHT in src:
            print(f"already fixed: {path} (getter {getter})")
        else:
            print(f"marker not found (check manually): {path}")
        continue
    count = src.count(WRONG)
    if count != 1:
        raise RuntimeError(f"expected exactly 1 occurrence, found {count} in {path}")
    bak = path.with_suffix(path.suffix + f".bak_{time.strftime('%Y%m%d_%H%M%S')}")
    shutil.copy2(path, bak)
    path.write_text(src.replace(WRONG, RIGHT), encoding="utf-8")
    print(f"patched {path} -> getter {getter}() (backup: {bak.name})")
