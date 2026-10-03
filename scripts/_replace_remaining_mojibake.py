import re
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "landing" / "zelscan.html"
t = p.read_text(encoding="utf-8-sig")
pattern = re.compile(r'(<text[^>]*text-anchor="middle">)([^<]*[\x80-\x9f][^<]*)(</text>)')
matches = list(pattern.finditer(t))
if len(matches) != 1:
    raise SystemExit(f"expected 1 damaged SVG label, found {len(matches)}")
t = pattern.sub(lambda m: m.group(1) + "БИЛЛИНОГАМИ" + m.group(3), t, count=1)
p.write_bytes(b"\xef\xbb\xbf" + t.encode("utf-8"))
print("replaced damaged SVG label with БИЛЛИНОГАМИ")
print("control chars left:", len(re.findall(r"[\x80-\x9f]", t)))
print("known mojibake left:", len(re.findall(r"(?:Р[\x80-\x9fА-Яа-я]|С[Ѐ-ӿ])", t)))
