import io, re, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
t = (Path(__file__).resolve().parent.parent / "landing" / "zelscan.html").read_text(encoding="utf-8-sig")
for m in re.finditer(r'[РС][\u0080-\u04FF]', t):
    i = m.start()
    print(repr(t[max(0,i-40):i+40]))
    print("---")
