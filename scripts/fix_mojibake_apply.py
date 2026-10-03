import os, re, shutil, datetime

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

# Runs of characters that resulted from UTF-8 cyrillic bytes decoded as cp1251.
# Includes cyrillic block, ё/Ё variants, and common punctuation that cp1251 maps
# from UTF-8 multibyte sequences (—, –, ’, “, ”, …, №, «, », nbsp).
MOJI_RE = re.compile(
    r"[\u0400-\u045F\u0490\u0491\u0401\u0451"
    r"\u2013\u2014\u2018\u2019\u201C\u201D\u201E\u2026\u00A0\u00AB\u00BB\u2116\u2122]+"
)

def fix_run(run):
    try:
        return run.encode("cp1251").decode("utf-8")
    except Exception:
        return run  # not cleanly reversible -> leave as-is

def repl(m):
    run = m.group(0)
    return fix_run(run)

stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
total_files = 0
for rel in FILES:
    p = os.path.join(ROOT, rel)
    with open(p, "r", encoding="utf-8") as fh:
        text = fh.read()
    new = MOJI_RE.sub(repl, text)
    if new == text:
        print("NO CHANGE:", rel)
        continue
    # backup
    bak = p + ".before_mojibake_fix_" + stamp
    shutil.copy2(p, bak)
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write(new)
    total_files += 1
    print("FIXED:", rel, "| backup:", os.path.basename(bak))

print("="*60)
print("Files fixed:", total_files)

# Verify: re-scan for leftover mojibake markers
MARKERS = ["Рџ","Рћ","Рђ","Р°","СЃ","СЂ","Рµ","РЅ","Рѕ","вЂ"]
print("--- leftover check ---")
for rel in FILES:
    p = os.path.join(ROOT, rel)
    with open(p, "r", encoding="utf-8") as fh:
        t = fh.read()
    left = sum(t.count(x) for x in MARKERS)
    print(f"{rel}: leftover_markers={left}")
