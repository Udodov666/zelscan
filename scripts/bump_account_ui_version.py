"""Bump the manual cache-buster on account-ui.js across all landing pages.

Why: front_server.py defines _ASSET_URL_RE for auto-versioning but never calls
.sub() — auto-versioning is inactive in this build, so account-ui.js is pinned
at a fixed ?v=NN. The current account-ui.js already contains the cookie-session
fallback (zelscan-cookie-session-fallback-v1) that renders the header account on
/dossiers, /explore, /billing, /updates via /api/auth/session, but browsers keep
loading the stale cached file until the version changes. Bumping forces a refetch.
"""
import glob
import re

NEW = "account-ui.js?v=31"
PAT = re.compile(r"account-ui\.js\?v=\d+")

total = 0
files = 0
for f in glob.glob("landing/*.html"):
    s = open(f, encoding="utf-8", errors="ignore").read()
    n = len(PAT.findall(s))
    if not n:
        continue
    open(f, "w", encoding="utf-8", errors="ignore").write(PAT.sub(NEW, s))
    total += n
    files += 1
    print(f"bumped {f} ({n})")

print(f"FILES={files} REPLACEMENTS={total}")
