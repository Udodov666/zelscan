import io, re, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
t = (Path(__file__).resolve().parent.parent / "landing" / "zelscan.html").read_text(encoding="utf-8-sig")
# Найти любые оставшиеся mojibake-последовательности (Р/С + не-ASCII)
hits = re.findall(r'.{0,15}[РС][\u0080-\u04FF].{0,15}', t)
print("=== remaining mojibake contexts ===", len(hits))
for h in hits[:20]:
    print(repr(h))
