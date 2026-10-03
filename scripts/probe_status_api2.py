# -*- coding: utf-8 -*-
"""Проба #2: user_title у юзеров из живой темы, поиск по q, фильтры /threads."""
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

# --- 1. Посты живой темы -> юзеры -> их user_title ---
code, d = call("GET", "/threads?limit=10")
threads = (d.get("threads") or d.get("data") or []) if isinstance(d, dict) else []
print("fresh threads:", [(t.get("thread_id"), (t.get("title") or "")[:40]) for t in threads[:5]])
# возьмём «горячую» тему с живым обсуждением (свежую и не раздачу)
target = None
for t in threads:
    if t.get("thread_id", 0) > 10_000_000 and t.get("post_count", 0) != 0:
        target = t["thread_id"]; break
print("target thread:", target)

uids = []
if target:
    code, d = call("GET", f"/threads/{target}/posts?limit=20")
    posts = (d.get("posts") or d.get("data") or []) if isinstance(d, dict) else []
    print("posts:", code, len(posts))
    if posts:
        print("post keys:", sorted(posts[0].keys()))
        for p in posts:
            u = p.get("user") or {}
            uid = p.get("user_id") or u.get("user_id")
            if uid: uids.append((uid, u.get("username") or p.get("username")))
    print("users from posts:", uids[:10])

    # --- 2. Профили: user_title / custom_title ---
    for uid, uname in uids[:5]:
        code, d = call("GET", f"/users/{uid}")
        if isinstance(d, dict):
            u = d.get("user", {})
            print(f"-- uid={uid} @{u.get('username')}: "
                  f"user_title={json.dumps(u.get('user_title'), ensure_ascii=False)[:160]} | "
                  f"custom_title={json.dumps(u.get('custom_title'), ensure_ascii=False)[:80]} | "
                  f"fields={json.dumps(u.get('fields'), ensure_ascii=False)[:120]}")
        else:
            print("  uid", uid, "->", code, str(d)[:120])
        time.sleep(0.3)

# --- 3. Поиск по q (messages-токен, 30/мин) ---
for q in ["crypto drainer", "AEZAKMI"]:
    code, d = call("POST", "/search/posts", {"q": q, "limit": 5}, token=TOK_MSG)
    if isinstance(d, dict):
        items = d.get("data") or []
        print(f"== search q={q!r} -> {code} | items: {len(items)} | total: {d.get('data_total')}")
        for it in items[:3]:
            txt = (it.get("message_plain_text") or it.get("message") or "").replace("\n", " ")[:120]
            print(f"   uid={it.get('user_id')} @{it.get('username')}: {txt}")
    else:
        print("== search q=%r ->" % q, code, str(d)[:150])

# --- 4. /threads с фильтрами: новые темы + привязка к форуму ---
for path in ["/threads?limit=5&forum_id=77", "/threads?limit=5&creator_user_id=6266214"]:
    code, d = call("GET", path)
    th = (d.get("threads") or d.get("data") or []) if isinstance(d, dict) else []
    print("== GET", path, "->", code, "| n:", len(th),
          "| first:", th[0].get("thread_id") if th else None, (th[0].get("title") or "")[:40] if th else "")
