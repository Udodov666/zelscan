import os, re

ROOT = r"C:\Users\domas\claude222\zelscass"
FILES = [
    r"landing\zelscan_analysis.html",
    r"landing\zelscan_activity.html",
    r"landing\zelscan_psychology.html",
    r"landing\zelscan_behavior.html",
    r"landing\assets\css\pages\zelscan_dashboard.css",
    r"landing\assets\dashboard2\css\zelscan_dashboard.dashboard2.css",
    r"landing\assets\css\pages\zelscan_psychology.css",
]

# The mojibake fragments consist of chars in the ranges that came from
# UTF-8 cyrillic bytes decoded as cp1251. We reverse per-fragment:
# take a run of "suspicious" chars, encode cp1251 -> decode utf-8.
# Suspicious = characters that cp1251 can encode AND are the typical mojibake set.

MOJI_RE = re.compile(r"[\u0400-\u045F\u0490\u0491\u2013\u2014\u2019\u201C\u201D\u2026\u00A0\u00AB\u00BB\u2116]+")

def fix_run(run):
    try:
        cand = run.encode("cp1251").decode("utf-8")
        return cand
    except Exception:
        return run  # leave untouched if it doesn't cleanly reverse

def fix_text(text):
    out = []
    i = 0
    changed = 0
    for m in MOJI_RE.finditer(text):
        pass
    # Replace each matched run; only accept if the reversed text yields
    # valid cyrillic and the run itself was reversible.
    def repl(m):
        nonlocal changed
        run = m.group(0)
        fixed = fix_run(run)
        if fixed != run:
            changed += 1
            return fixed
        return run
    new = MOJI_RE.sub(repl, text)
    return new, changed

try:
    import ftfy
    HAS_FTFY = True
except Exception:
    HAS_FTFY = False

print("ftfy available:", HAS_FTFY)
print("="*70)

for rel in FILES:
    p = os.path.join(ROOT, rel)
    with open(p, "r", encoding="utf-8") as fh:
        text = fh.read()
    fixed, changed = fix_text(text)
    # show a few before/after sample fragments
    print("FILE:", rel, "| runs_fixed:", changed)
    # find first few mojibake samples
    samples = MOJI_RE.findall(text)
    shown = 0
    for s in samples:
        if any(c in s for c in "РС"):
            f = fix_run(s)
            if f != s:
                print("   ", repr(s[:30]), "->", repr(f[:30]))
                shown += 1
        if shown >= 4:
            break
    print("-"*70)
