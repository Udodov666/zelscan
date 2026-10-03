# -*- coding: utf-8 -*-
"""
status_scanner — массовый сбор юзеров LZT и проверка их статусов/подписей на рекламу.

Источники юзеров (без ручного поиска тем):
  1. GET /threads?limit=&page=      — лента свежих тем форума
  2. GET /posts?thread_id=&limit=   — посты темы (подпись автора уже в посте)
  3. POST /search/posts {"q": kw}   — поиск по ключевым словам (находит рекламодателей напрямую)

Проверка:
  - signature_plain_text — прямо из поста (0 лишних запросов)
  - custom_title         — из GET /users/{id} (статус в профиле, там реклама типа
                           "CRYPTO DRAINER #1 — AEZAKMIPARTNERS.COM")

Запуск:
  python scripts/status_scanner.py --threads 10 --search "drainer,прокси" --out scan.json
"""
import sys, json, re, time, argparse, urllib.request, urllib.error

sys.path.insert(0, "app")
import config

BASE = "https://api.lolz.team"

# Дефолтные рекламные паттерны (ссылки/магазины/клише) — можно расширить --keywords
DEFAULT_PATTERNS = [
    r"t\.me/\w+", r"(?:https?://)?\w+\.(?:com|net|org|shop|io|me|ru|xyz|top|cc|to)\b",
    r"дрейнер|drainer", r"прокси|proxy", r"дампы|dumps", r"сс|cvv", r"обход|жиза",
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
                   "Accept": "application/json", "User-Agent": "ZelscanStatusScanner/1.0"}
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

    def fresh_threads(self, pages=1, limit=50):
        out = []
        for page in range(1, pages + 1):
            d = self.call("GET", f"/threads?limit={limit}&page={page}")
            th = d.get("threads") or d.get("data") or []
            out.extend(th)
            if len(th) < limit:
                break
        return out

    def thread_posts(self, thread_id, limit=20):
        d = self.call("GET", f"/posts?thread_id={thread_id}&limit={limit}")
        return d.get("posts") or d.get("data") or []

    def search(self, q, limit=20):
        d = self.call("POST", "/search/posts", {"q": q, "limit": limit}, token=self.tok_msg)
        return d.get("data") or []

    def user(self, uid):
        d = self.call("GET", f"/users/{uid}")
        return (d.get("user") or {}) if isinstance(d, dict) else {}

    def scan(self, thread_pages=1, thread_limit=50, post_limit=20,
             search_terms=None, uid_limit=120, patterns=None):
        pats = [re.compile(p, re.I) for p in (patterns or DEFAULT_PATTERNS)]
        seen_uids = {}   # uid -> {username, source, signature}
        t0 = time.time()

        # 1) свежие темы -> посты -> юзеры + подписи
        threads = self.fresh_threads(pages=thread_pages, limit=thread_limit)
        print(f"[+] свежих тем: {len(threads)}")
        for t in threads:
            tid = t.get("thread_id")
            posts = self.thread_posts(tid, limit=post_limit)
            for p in posts:
                uid = p.get("user_id")
                if not uid or uid in seen_uids:
                    continue
                seen_uids[uid] = {
                    "username": p.get("username"),
                    "signature": (p.get("signature_plain_text") or "").strip(),
                    "source": f"thread:{tid}",
                }
            time.sleep(0.25)  # держимся ниже 300/мин на GET
        print(f"[+] юзеров из тем: {len(seen_uids)}")

        # 2) поиск по ключевым словам -> рекламодатели напрямую
        for q in (search_terms or []):
            items = self.search(q)
            hits = 0
            for it in items:
                uid = it.get("user_id")
                if not uid:
                    continue
                if uid not in seen_uids:
                    seen_uids[uid] = {
                        "username": it.get("username"),
                        "signature": (it.get("signature") or it.get("signature_plain_text") or "").strip(),
                        "source": f"search:{q}",
                    }
                hits += 1
            print(f"[+] search {q!r}: {hits} items")
            time.sleep(2.5)  # 30/мин на search-токен

        # 3) профили -> custom_title (статус с рекламой)
        results = []
        checked = 0
        for uid, info in seen_uids.items():
            if checked >= uid_limit:
                break
            u = self.user(uid)
            checked += 1
            info["custom_title"] = (u.get("custom_title") or "").strip()
            info["user_title"] = (u.get("user_title") or "").strip()
            info["is_banned"] = u.get("is_banned")
            haystack = " ".join([info.get("signature") or "", info["custom_title"],
                                 info.get("username") or ""])
            info["ad_matches"] = sorted({m.pattern for m in pats if m.search(haystack)})
            info["is_ad"] = bool(info["ad_matches"])
            results.append(info)
            if checked % 20 == 0:
                print(f"    профили {checked}/{min(len(seen_uids), uid_limit)}")
            time.sleep(0.25)

        flagged = [r for r in results if r["is_ad"]]
        meta = {
            "elapsed_s": round(time.time() - t0, 1),
            "requests": self.req_count,
            "users_seen": len(seen_uids), "profiles_checked": checked,
            "flagged": len(flagged),
        }
        return {"meta": meta, "flagged": flagged, "all": results}


def main():
    ap = argparse.ArgumentParser(description="LZT status/ad scanner")
    ap.add_argument("--threads", type=int, default=1, help="страниц свежих тем (по 50)")
    ap.add_argument("--thread-limit", type=int, default=50, help="тем на страницу")
    ap.add_argument("--post-limit", type=int, default=20, help="постов на тему")
    ap.add_argument("--search", default="", help="поисковые слова через запятую")
    ap.add_argument("--uid-limit", type=int, default=120, help="макс. профилей к проверке")
    ap.add_argument("--keywords", default="", help="доп. regex-паттерны через запятую")
    ap.add_argument("--out", default="", help="файл для JSON-отчёта")
    args = ap.parse_args()

    patterns = DEFAULT_PATTERNS + [k.strip() for k in args.keywords.split(",") if k.strip()]
    terms = [s.strip() for s in args.search.split(",") if s.strip()]
    sc = Scanner()
    report = sc.scan(thread_pages=args.threads, thread_limit=args.thread_limit,
                     post_limit=args.post_limit, search_terms=terms,
                     uid_limit=args.uid_limit, patterns=patterns)
    print(json.dumps(report["meta"], ensure_ascii=False, indent=1))
    for r in report["flagged"]:
        print(f"[AD] @{r['username']} (uid {r.get('source')}): "
              f"custom_title={r['custom_title'][:80]!r} sig={r['signature'][:60]!r} "
              f"matches={r['ad_matches'][:3]}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)
        print("saved ->", args.out)


if __name__ == "__main__":
    main()
