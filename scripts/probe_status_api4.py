# -*- coding: utf-8 -*-
"""Проба #4: новые источники юзеров из OpenAPI — search/users, chatbox, threads/recent,
followers темы, /users списком."""
import sys, json, time, urllib.request, urllib.error

sys.path.insert(0, "app")
import config

BASE = "https://api.lolz.team"
TOK = config.load_lolz_tokens("profile")[0]
TOK_MSG = config.load_lolz_tokens("messages")[0]

def call(method, path, body=None, token=None):
    url = BASE + path
    data = None
    headers = {"Authorization": "Bearer " + (token or TOK),
               "Accept": "application/json", "User-Agent": "ZelscanProbe/1.0"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try: b = e.read().decode("utf-8", "replace")[:250]
        except Exception: b = ""
        return e.code, b
    except Exception as e:
        return None, str(e)

# 1) POST /search/users — поиск юзеров по нику
for q in ["прокси", "drainer", "shop"]:
    code, d = call("POST", "/search/users", {"q": q})
    users = (d.get("users") or d.get("data") or []) if isinstance(d, dict) else []
    print(f"== search/users q={q!r} -> {code} | n={len(users)}")
    if users:
        print("   keys:", sorted(users[0].keys()))
        for u in users[:5]:
            print(f"   uid={u.get('user_id')} @{u.get('username')} ct={json.dumps(u.get('custom_title'),ensure_ascii=False)[:60]}")
    else:
        print("   ", str(d)[:200])
    time.sleep(1)

# 2) GET /threads/{id}/followers — «читатели» темы
code, d = call("GET", "/threads?limit=5")
th = (d.get("threads") or d.get("data") or []) if isinstance(d, dict) else []
tid = th[0]["thread_id"] if th else None
if tid:
    code, d = call("GET", f"/threads/{tid}/followers")
    fl = (d.get("followers") or d.get("users") or d.get("data") or []) if isinstance(d, dict) else []
    print(f"== threads/{tid}/followers -> {code} | n={len(fl) if isinstance(fl, list) else '?'}")
    if isinstance(fl, list) and fl:
        print("   keys:", sorted(fl[0].keys()) if isinstance(fl[0], dict) else fl[0])
        for u in fl[:5]:
            if isinstance(u, dict):
                print(f"   uid={u.get('user_id')} @{u.get('username')} ct={json.dumps(u.get('custom_title'),ensure_ascii=False)[:60]}")

# 3) GET /chatbox — лента чатбокса
code, d = call("GET", "/chatbox")
msgs = (d.get("messages") or d.get("data") or []) if isinstance(d, dict) else []
print(f"== /chatbox -> {code} | n={len(msgs) if isinstance(msgs, list) else '?'}")
if isinstance(msgs, list) and msgs:
    print("   keys:", sorted(msgs[0].keys()))
    for m in msgs[:5]:
        u = m.get("user") or {}
        print(f"   uid={m.get('user_id') or u.get('user_id')} @{m.get('username') or u.get('username')}: {(m.get('message') or m.get('message_plain_text') or '')[:60]!r}")

# 4) GET /threads/recent — свежая активность (бампнутые темы)
code, d = call("GET", "/threads/recent?days=2&limit=20")
th2 = (d.get("threads") or d.get("data") or []) if isinstance(d, dict) else []
print(f"== /threads/recent -> {code} | n={len(th2)}")
for t in th2[:5]:
    print(f"   id={t.get('thread_id')} | {(t.get('title') or '')[:50]} | posts={t.get('post_count')} | last_uid={t.get('last_post_user_id')} @{t.get('last_post_username')}")

# 5) GET /users списком
code, d = call("GET", "/users?page=1&limit=10")
us = (d.get("users") or d.get("data") or []) if isinstance(d, dict) else []
print(f"== /users?page=1 -> {code} | n={len(us)}")
if us:
    print("   keys:", sorted(us[0].keys()))
    for u in us[:5]:
        print(f"   uid={u.get('user_id')} @{u.get('username')} msgs={u.get('user_message_count')}")

# 6) GET /users/find?custom_fields[telegram]=... — поиск по TG-полю
code, d = call("GET", "/users/find?username=proxy")
us = (d.get("users") or d.get("data") or []) if isinstance(d, dict) else []
print(f"== /users/find?username=proxy -> {code} | n={len(us)}")
for u in (us or [])[:5]:
    print(f"   uid={u.get('user_id')} @{u.get('username')}")
