# -*- coding: utf-8 -*-
"""
status_scanner v2 — массовый сбор юзеров LZT и проверка статусов/подписей на рекламу.

Источники юзеров (все проверены живьём 2026-10-04):
  1. GET /threads?limit=&page=      — лента свежих тем
  2. GET /threads/recent?days=N     — ID самых активных (бампнутых) тем
  3. GET /posts?thread_id=&limit=   — посты темы (signature_plain_text уже в посте!)
  4. POST /search/posts {"q": kw}   — поиск по сообщениям (находит рекламодателя напрямую)
  5. POST /search/users {"q": kw}   — поиск по нику (в ответе custom_title + ban + ban_reason,
                                      проверка статуса вообще без похода в профиль)
  НЕ работает: /threads/{id}/readers (404), /users списком (403), /chatbox (пусто/403).

Проверка: signature_plain_text (из поста) + custom_title (из GET /users/{id}).
Запуск:
  python scripts/status_scanner.py --threads 2 --recent 20 \
      --search "crypto drainer" --name-search "прокси,drainer,shop" --out scan.json
"""
import sys, json, re, time, argparse, urllib.request, urllib.error

sys.path.insert(0, "app")
import config

BASE = "https://api.lolz.team"

DEFAULT_PATTERNS = [
    r"t\.me/\w+", r"(?:https?://)?\w+\.(?:com|net|org|shop|io|me|ru|xyz|top|cc|to)\b",
    r"дрейнер|drainer", r"прокси|proxy", r"дампы|dumps", r"\b(?:cc|cvv|сс)\b", r"обход|жиза",
    r"магазин", r"продажа", r"заказ", r"скидк", r"промокод", r"гарант", r"от \d+[р₽$]",
]

class Scanner:
    def __init__(self):
        self.tok_profile = config.load_lolz_tokens("profile")[0]
        self.tok_msg = config.load_lolz_tokens("messages")[0]
        self.req_count = {"get": 0, "search": 0}

    def call(self, method, path, body=None, token=None, retries=2):
        url = BASE + path
        data = None
        headers = {"Authorization": "Bearer " + (token or self.tok_profile),
                   "Accept": "application/json", "User-Agent": "ZelscanStatusScanner/2.0"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    self.req_count["get" if method == "GET" else "search"] += 1
                    return json.loads(r.read().decode("utf-8", "replace"))
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    retry_after = float(e.headers.get("Retry-After") or 5)
                    print(f"  [429] пауза {retry_after}s ({path})")
                    time.sleep(retry_after + 0.5)
                    continue
                return {"_error": e.code, "_body": e.read().decode("utf-8", "replace")[:200]}
            except Exception as e:
                if attempt < retries:
                    time.sleep(1.5)
                    continue
                return {"_error": None, "_body": str(e)}
        return {"_error": 429, "_body": "rate limit after retries"}

    # ---- источники тем ----
    def fresh_threads(self, pages=1, limit=50):
        out = []
        for page in range(1, pages + 1):
            d = self.call("GET", f"/threads?limit={limit}&page={page}")
            th = d.get("threads") or d.get("data") or []
            out.extend(th)
            if len(th) < limit:
                break
            time.sleep(0.25)
        return out

    def recent_thread_ids(self, days=2, limit=20):
        d = self.call("GET", f"/threads/recent?days={days}&limit={limit}&data_limit=20")
        th = d.get("threads") or d.get("data") or []
        return [t.get("thread_id") for t in th if t.get("thread_id")]

    def thread_posts(self, thread_id, limit=20):
        d = self.call("GET", f"/posts?thread_id={thread_id}&limit={limit}")
        return d.get("posts") or d.get("data") or []

    # ---- поиск ----
    def search_posts(self, q, limit=20):
        d = self.call("POST", "/search/posts", {"q": q, "limit": limit}, token=self.tok_msg)
        return d.get("data") or []

    def search_users(self, q):
        d = self.call("POST", "/search/users", {"q": q})
        return d.get("users") or d.get("data") or []

    def user(self, uid):
        d = self.call("GET", f"/users/{uid}")
        return (d.get("user") or {}) if isinstance(d, dict) else {}

    # ---- пайплайн ----
    def scan(self, thread_pages=1, thread_limit=50, post_limit=20, recent=0,
             search_terms=None, name_terms=None, uid_limit=300, patterns=None):
        pats = [re.compile(p, re.I) for p in (patterns or DEFAULT_PATTERNS)]
        seen = {}   # uid -> info dict
        t0 = time.time()

        def add(uid, username, source, signature=""):
            if uid and uid not in seen:
                seen[uid] = {"username": username, "signature": (signature or "").strip(),
                             "source": source}

        # 1) темы (свежие + бампнутые) -> посты -> юзеры с подписями
        threads = self.fresh_threads(pages=thread_pages, limit=thread_limit)
        if recent:
            rids = self.recent_thread_ids(days=2, limit=recent)
            have = {t.get("thread_id") for t in threads}
            threads = threads + [{"thread_id": r} for r in rids if r not in have]
        print(f"[+] тем к обходу: {len(threads)} (свежих {thread_pages * thread_limit} + recent {recent})")
        for t in threads:
            for p in self.thread_posts(t["thread_id"], limit=post_limit):
                add(p.get("user_id"), p.get("username"), f"thread:{t['thread_id']}",
                    p.get("signature_plain_text") or p.get("signature"))
            time.sleep(0.25)
        print(f"[+] юзеров из тем: {len(seen)}")

        # 2) поиск по сообщениям — рекламодатели напрямую
        for q in (search_terms or []):
            for it in self.search_posts(q):
                add(it.get("user_id"), it.get("username"), f"search:{q}",
                    it.get("signature") or it.get("signature_plain_text"))
            print(f"[+] search {q!r}: всего юзеров {len(seen)}")
            time.sleep(2.5)

        # 3) поиск по нику — ответ уже содержит custom_title/ban (профиль не нужен)
        namesearch_direct = 0
        for kw in (name_terms or []):
            for u in self.search_users(kw):
                uid = u.get("user_id")
                if not uid:
                    continue
                name = u.get("username") or ""
                if uid in seen:
                    seen[uid]["custom_title"] = (u.get("custom_title") or "").strip()
                    seen[uid]["is_banned"] = u.get("ban", u.get("is_banned"))
                    continue
                info = {"username": name, "signature": "", "source": f"name:{kw}",
                        "custom_title": (u.get("custom_title") or "").strip(),
                        "is_banned": u.get("ban", u.get("is_banned"))}
                seen[uid] = info
                namesearch_direct += 1
            time.sleep(1)
        print(f"[+] из поиска по нику: +{namesearch_direct} (всего {len(seen)})")

        # 4) профили -> custom_title для тех, у кого ещё нет
        need_profile = [u for u in seen.values() if "custom_title" not in u]
        checked = 0
        for info in need_profile[:uid_limit]:
            u = self.user(info.get("_uid"))
            # uid отдельно — seen ключ это uid
            checked += 1
            time.sleep(0.25)
        # проще: по uid
        pending = [(uid, info) for uid, info in seen.items() if "custom_title" not in info]
        for i, (uid, info) in enumerate(pending[:uid_limit]):
            u = self.user(uid)
            info["custom_title"] = (u.get("custom_title") or "").strip()
            info["user_title"] = (u.get("user_title") or "").strip()
            info["is_banned"] = u.get("is_banned", info.get("is_banned"))
            if (i + 1) % 50 == 0:
                print(f"    профили {i + 1}/{min(len(pending), uid_limit)}")
            time.sleep(0.25)
        checked = min(len(pending), uid_limit)

        # 5) фильтр рекламы
        results = []
        for uid, info in seen.items():
            haystack = " ".join([info.get("username") or "", info.get("signature") or "",
                                 info.get("custom_title") or ""])
            info["ad_matches"] = sorted({m.pattern for m in pats if m.search(haystack)})
            info["is_ad"] = bool(info["ad_matches"])
            info["_uid"] = uid
            results.append(info)

        flagged = [r for r in results if r["is_ad"]]
        meta = {
            "elapsed_s": round(time.time() - t0, 1),
            "requests": self.req_count,
            "users_seen": len(seen), "profiles_checked": checked,
            "flagged": len(flagged),
        }
        return {"meta": meta, "flagged": flagged, "all": results}


def main():
    ap = argparse.ArgumentParser(description="LZT status/ad scanner v2")
    ap.add_argument("--threads", type=int, default=1, help="страниц свежих тем (по 50)")
    ap.add_argument("--thread-limit", type=int, default=50)
    ap.add_argument("--post-limit", type=int, default=20)
    ap.add_argument("--recent", type=int, default=0, help="взять N бампнутых тем из /threads/recent")
    ap.add_argument("--search", default="", help="поисковые слова (сообщения), через запятую")
    ap.add_argument("--name-search", default="", help="куски ников для /search/users, через запятую")
    ap.add_argument("--uid-limit", type=int, default=300, help="макс. профилей к проверке")
    ap.add_argument("--keywords", default="", help="доп. regex-паттерны через запятую")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    patterns = DEFAULT_PATTERNS + [k.strip() for k in args.keywords.split(",") if k.strip()]
    terms = [s.strip() for s in args.search.split(",") if s.strip()]
    nterms = [s.strip() for s in args.name_search.split(",") if s.strip()]
    sc = Scanner()
    report = sc.scan(thread_pages=args.threads, thread_limit=args.thread_limit,
                     post_limit=args.post_limit, recent=args.recent,
                     search_terms=terms, name_terms=nterms,
                     uid_limit=args.uid_limit, patterns=patterns)
    print(json.dumps(report["meta"], ensure_ascii=False, indent=1))
    for r in report["flagged"]:
        print(f"[AD] @{r['username']} ({r['source']}): ct={r.get('custom_title','')[:70]!r} "
              f"sig={r['signature'][:50]!r} matches={r['ad_matches'][:3]}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        print("saved ->", args.out)


if __name__ == "__main__":
    main()
