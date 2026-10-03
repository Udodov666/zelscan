# -*- coding: utf-8 -*-
"""Проба API: статусы юзеров, читатели темы, свежие темы, поиск по ключевым словам."""
import sys, json, urllib.request, urllib.error, ssl

sys.path.insert(0, "app")
import config

BASE = "https://api.lolz.team"
TOK = config.load_lolz_tokens("profile")[0]
TOK_MSG = config.load_lolz_tokens("messages")[0]

def call(method, path, body=None, token=None, timeout=30):
    url = BASE + path
    data = None
    headers = {"Authorization": "Bearer " + (token or TOK),
               "Accept": "application/json",
               "User-Agent": "ZelscanProbe/1.0"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")[:400]
        except Exception:
            body = ""
        return e.code, body
    except Exception as e:
        return None, str(e)

def jprint(tag, code, d, keys_only=False, max_len=1500):
    print("=" * 10, tag, "->", code)
    if keys_only and isinstance(d, dict):
        print("keys:", sorted(d.keys()))
    else:
        s = json.dumps(d, ensure_ascii=False, indent=1)
        print(s[:max_len])
    print()

TEST_UID = 6266214
TEST_THREAD = None  # найдём ниже

# --- 1. Профиль юзера: есть ли status / signature ---
code, d = call("GET", f"/users/{TEST_UID}")
if isinstance(d, dict):
    user = d.get("user", d)
    print("== /users/{id} ->", code, "| top keys:", sorted(d.keys()))
    print("user keys:", sorted(user.keys()) if isinstance(user, dict) else type(user))
    for k in ("status", "signature", "signature_html", "about", "custom_title", "location"):
        if isinstance(user, dict) and k in user:
            print(f"  {k!r}:", json.dumps(user[k], ensure_ascii=False)[:300])
else:
    jprint("users", code, d)

# --- 2. Список форумов (для навигации к свежим темам) ---
code, d = call("GET", "/forums")
if isinstance(d, dict):
    forums = d.get("forums", d.get("data", []))
    print("== /forums ->", code, "| count:", len(forums) if isinstance(forums, list) else "?")
    if isinstance(forums, list):
        for f in forums[:8]:
            print("  id=", f.get("forum_id"), "|", f.get("title"), "| threads:", f.get("thread_count"))
else:
    jprint("forums", code, d)

# --- 3. Свежие темы: варианты роутов ---
for path in ["/threads?limit=5", "/threads?page=1", "/forums/threads?limit=5"]:
    code, d = call("GET", path)
    if isinstance(d, dict) and ("threads" in d or "data" in d):
        items = d.get("threads") or d.get("data") or []
        print("== GET", path, "->", code, "| items:", len(items))
        for t in items[:3]:
            print("  id=", t.get("thread_id"), "|", (t.get("title") or "")[:60], "| forum:", t.get("forum_id"), "|", t.get("post_date"))
        if items:
            TEST_THREAD = items[0].get("thread_id")
        break
    else:
        print("== GET", path, "->", code, str(d)[:150])

print("TEST_THREAD =", TEST_THREAD)

# --- 4. Читатели темы: пробы роутов ---
if TEST_THREAD:
    for path in [f"/threads/{TEST_THREAD}/readers",
                 f"/threads/{TEST_THREAD}/viewers",
                 f"/threads/{TEST_THREAD}/reads",
                 f"/threads/{TEST_THREAD}/latest-readers"]:
        code, d = call("GET", path)
        print("== GET", path, "->", code, str(d)[:200])

    # инфо о самой теме + посты темы (юзеры, которые там пишут)
    code, d = call("GET", f"/threads/{TEST_THREAD}")
    if isinstance(d, dict):
        t = d.get("thread", d)
        print("== /threads/{id} ->", code, "| keys:", sorted(t.keys())[:30])
    code, d = call("GET", f"/threads/{TEST_THREAD}/posts?limit=5")
    if isinstance(d, dict):
        posts = d.get("posts", d.get("data", []))
        print("== /threads/{id}/posts ->", code, "| posts:", len(posts) if isinstance(posts, list) else "?")
        if isinstance(posts, list) and posts:
            print("  post keys:", sorted(posts[0].keys()))
            u = posts[0].get("user") or {}
            print("  user keys:", sorted(u.keys()) if isinstance(u, dict) else u)
            print("  user status:", json.dumps(u.get("status"), ensure_ascii=False)[:200] if isinstance(u, dict) else None)

# --- 5. Поиск по ключевым словам (messages-токен: пул /search/posts) ---
for body in [{"query": "прокси", "limit": 5},
             {"keywords": "прокси", "limit": 5}]:
    code, d = call("POST", "/search/posts", body, token=TOK_MSG)
    if isinstance(d, dict) and d.get("data") is not None:
        items = d["data"]
        print("== POST /search/posts", body, "->", code, "| items:", len(items))
        if items:
            print("  keys:", sorted(items[0].keys()))
            it = items[0]
            msg = (it.get("message_plain_text") or it.get("message") or "")[:150]
            print("  sample:", msg.replace(chr(10), " "))
        break
    else:
        print("== POST /search/posts", body, "->", code, str(d)[:200])

# --- 6. Глобальная лента постов профиля (еще один источник живых юзеров) ---
code, d = call("GET", "/profile-posts?limit=5")
if isinstance(d, dict):
    pp = d.get("profile_posts", d.get("data", []))
    print("== /profile-posts (global feed) ->", code, "| items:", len(pp) if isinstance(pp, list) else "?")
    if isinstance(pp, list) and pp:
        print("  keys:", sorted(pp[0].keys()))
else:
    jprint("profile-posts", code, d)
