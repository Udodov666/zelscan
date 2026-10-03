import os, sys

ROOT = r"C:\Users\domas\claude222\zelscass"

# Marker substrings that indicate cp1251-read-as-utf8 mojibake (cyrillic double-encoding)
# Typical mojibake begins with 'Р' or 'С' followed by another cyrillic/latin-1 char.
MARKERS = ["Рџ", "Рћ", "Рђ", "Р°", "СЃ", "СЂ", "Рµ", "РЅ", "Рѕ", "Р Р", "вЂ"]

def looks_mojibake(text):
    hits = sum(text.count(m) for m in MARKERS)
    return hits

def try_fix(text):
    """The bytes were originally UTF-8, got decoded as cp1251, then re-saved as UTF-8.
    To reverse: encode current text back to cp1251 bytes, decode as UTF-8."""
    try:
        return text.encode("cp1251").decode("utf-8")
    except Exception:
        try:
            return text.encode("latin-1").decode("utf-8")
        except Exception:
            return None

targets = []
for dirpath, dirs, files in os.walk(ROOT):
    # skip backups / next build / node stuff to reduce noise but still report
    for f in files:
        if not (f.endswith(".html") or f.endswith(".js") or f.endswith(".css")):
            continue
        p = os.path.join(dirpath, f)
        try:
            with open(p, "r", encoding="utf-8") as fh:
                text = fh.read()
        except Exception:
            continue
        hits = looks_mojibake(text)
        if hits > 0:
            fixed = try_fix(text)
            ok = fixed is not None
            # sanity: after fix, mojibake markers should drop sharply and real cyrillic appears
            after = looks_mojibake(fixed) if ok else -1
            rel = os.path.relpath(p, ROOT)
            targets.append((rel, hits, ok, after))

targets.sort(key=lambda x: -x[1])
print("FILE | mojibake_hits | fixable | hits_after_fix")
print("-"*70)
for rel, hits, ok, after in targets:
    print(f"{rel} | {hits} | {ok} | {after}")
print("-"*70)
print("TOTAL affected files:", len(targets))
