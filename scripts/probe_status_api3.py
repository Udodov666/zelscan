# -*- coding: utf-8 -*-
"""Проба #3: роут постов темы, ключи search-item, user_title рекламодателей."""
import sys, json, time, urllib.request, urllib.error

sys.path.insert(0, "app")
import config

BASE = "https://api.lolz.team"
TOK = config.load_lolz_tokens("profile")[0]
TOK_MSG = config.load_lolz_tokens("messages")[0]

def call(method, path, body=None, token=None, timeout=30):
    url = BASE + path
    data = None
    headers = {"Authorization": "Bearer " + (token or TOK),
               "Accept": "application/json", "User-Agent": "ZelscanProbe/1.0"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try: b = e.read().decode("utf-8", "replace")[:300]
        except Exception: b = ""
        return e.code, b
    except Exception as e:
        return None, str(e)

# --- 1. Роут постов темы ---
for path in ["/posts?thread_id=10359176&limit=5",
             "/threads/10359176/posts?page=1",
             "/threads/10359176?posts=1"]:
    code, d = call("GET", path)
    if isinstance(d, dict) and (d.get("posts") or d.get("data")):
        posts = d.get("posts") or d.get("data")
        print("== GET", path, "->", code, "| posts:", len(posts))
        print("   post keys:", sorted(posts[0].keys()))
        u = posts[0].get("user") or {}
        print("   user keys:", sorted(u.keys()) if isinstance(u, dict) else None)
        break
    print("== GET", path, "->", code, str(d)[:120])

# --- 2. Ключи search-item + текст ---
code, d = call("POST", "/search/posts", {"q": "AEZAKMI", "limit": 3}, token=TOK_MSG)
if isinstance(d, dict):
    items = d.get("data") or []
    print("== search keys:", sorted(items[0].keys()) if items else None)
    for it in items[:3]:
        print(json.dumps({k: (str(v)[:100] if not isinstance(v, (dict, list)) else "…")
                          for k, v in it.items()}, ensure_ascii=False, indent=1)[:1200])

# --- 3. user_title рекламодателей ---
for uid in [10648518, 5463764, 6266214]:
    code, d = call("GET", f"/users/{uid}")
    if isinstance(d, dict):
        u = d.get("user", {})
        print(f"== uid={uid} @{u.get('username')}: "
              f"user_title={json.dumps(u.get('user_title'), ensure_ascii=False)[:250]} | "
              f"custom_title={json.dumps(u.get('custom_title'), ensure_ascii=False)[:100]}")
        # fields — что там
        f = u.get("fields")
        if f: print("   fields:", json.dumps(f, ensure_ascii=False)[:300])
        print("   links:", json.dumps(u.get("links"), ensure_ascii=False)[:200])
    else:
        print("== uid", uid, "->", code, str(d)[:120])
    time.sleep(0.3)
