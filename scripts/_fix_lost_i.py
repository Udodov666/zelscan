"""Точечно чинит места, где буква 'И' была потеряна как U+0098 при перекодировке."""
import io, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

target = Path(__file__).resolve().parent.parent / "landing" / "zelscan.html"
t = target.read_text(encoding="utf-8-sig")

replacements = {
    "Р\x98СЃС‚РѕСЂРёСЏ": "История",
    "Р‘Р\x98Р›Р›Р\x98РќРћР\u0413РђРњР\x98": "БИЛЛИНГАМИ",
}

changed = 0
for bad, good in replacements.items():
    if bad in t:
        n = t.count(bad)
        t = t.replace(bad, good)
        changed += n
        print(f"replaced {n}x -> {good}")
    else:
        print(f"NOT FOUND: {good} (pattern not present)")

# запишем обратно с BOM
target.write_bytes(b"\xef\xbb\xbf" + t.encode("utf-8"))
print("total replacements:", changed)

# финальная проверка остатков mojibake (исключая латинскую 'С'/'Р' в разметке)
import re
left = re.findall(r'[РС][\u0080-\u04FF]', t)
print("mojibake-like left:", len(left))
