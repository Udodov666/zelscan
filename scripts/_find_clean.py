import io, re, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
base = Path(__file__).resolve().parent.parent / "landing"
# Ищем чистую (не битую) копию среди бэкапов
for name in sorted(base.glob("zelscan.html.before_*")):
    try:
        t = name.read_text(encoding="utf-8-sig")
    except Exception:
        continue
    if "Р‘РѕР»СЊС€" in t:  # битая копия
        continue
    if "История" in t or "Стиль" in t:
        print("CLEAN FILE:", name.name)
        for m in re.findall(r'.{0,25}История.{0,10}', t)[:3]:
            print("  HIST:", repr(m))
        for m in re.findall(r'anchor="middle">([^<]+)</text>', t)[:6]:
            print("  SVGTEXT:", repr(m))
        break
