"""Автономная выгрузка сообщений юзера LZT на движке Zelscan (вне сервиса).

Использование (на сервере, из /opt/zelscan):
    sudo -u zelscan .venv/bin/python scripts/export_user_messages.py pisun 1000 /tmp/pisun_dump.json

Ник → ID через официальный поиск, дальше тот же конвейер, что в full-отчёте:
таймлайн (deep-history, до target сообщений) + темы + стена, параллельно,
3 message-токена + профильный пул. На выходе сырой JSON с сообщениями.
"""
import json
import sys
import time

sys.path.insert(0, "/opt/zelscan/scripts")
sys.path.insert(0, "/opt/zelscan/app")

from lolz_analyzer import LolzAnalyzer  # noqa: E402


def on_progress(stage, current, total, message):
    print(f"[{stage}] {current}/{total or '?'} {message}", file=sys.stderr, flush=True)


def main():
    if len(sys.argv) < 2:
        print("usage: export_user_messages.py <username|id> [target_posts] [out.json]", file=sys.stderr)
        sys.exit(2)
    query = sys.argv[1]
    target = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
    out_path = sys.argv[3] if len(sys.argv) > 3 else f"/tmp/lzt_dump_{query}.json"

    import config
    tokens = config.load_lolz_tokens("messages")
    profile_tokens = config.load_lolz_tokens("profile") or tokens
    if not tokens:
        print("Нет message-токенов", file=sys.stderr)
        sys.exit(1)

    analyzer = LolzAnalyzer(tokens=tokens, on_progress=on_progress, profile_tokens=profile_tokens)

    # ник → id (если передали число — используем как есть)
    if query.isdigit():
        user_id, username = int(query), None
    else:
        found = analyzer.search_users(query.lstrip("/").rstrip("/").split("/")[-1])
        exact = [u for u in found
                 if str(u.get("username", "")).casefold() == query.casefold()
                 or str(u.get("username", "")).casefold() == query.rstrip("/").split("/")[-1].casefold()]
        pick = (exact or found)[:1]
        if not pick:
            print("Пользователь не найден", file=sys.stderr)
            sys.exit(1)
        user_id = int(pick[0]["user_id"])
        username = pick[0].get("username")
    print(f"→ user_id={user_id} ({username})", file=sys.stderr)

    profile = analyzer.fetch_profile(user_id)

    # Тот же конвейер, что в analyze(): параллельный сбор
    import concurrent.futures
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        f_posts = ex.submit(
            analyzer.fetch_timeline, user_id, 120,
            target_posts=target,
            accelerated=True,
            max_elapsed_seconds=600,
            progress_callback=lambda meta: on_progress(
                "fetch_posts", int(meta.get("collected", 0) or 0), 0,
                "сообщений: " + str(int(meta.get("collected", 0) or 0))),
        )
        f_threads = ex.submit(analyzer.fetch_threads, user_id, 15)
        f_wall = ex.submit(analyzer.fetch_wall, user_id, 5)
        posts = f_posts.result()
        threads = f_threads.result()
        wall = f_wall.result()
    elapsed = round(time.time() - t0, 1)

    # Цель не добрана (пул постов закончился раньше) — честно фиксируем
    dump = {
        "exported_at": int(time.time()),
        "user": {
            "user_id": profile.user_id,
            "username": profile.username,
            "is_banned": profile.is_banned,
            "register_date": profile.register_date,
            "message_count": profile.message_count,
        },
        "target_posts": target,
        "collected": {
            "timeline_posts": len(posts),
            "threads": len(threads),
            "wall_posts": len(wall),
            "total": len(posts) + len(threads) + len(wall),
        },
        "elapsed_seconds": elapsed,
        "timeline_posts": [
            {
                "post_id": p.post_id,
                "date": p.create_date,
                "thread_id": p.thread_id,
                "thread_title": p.thread_title,
                "forum_title": p.forum_title,
                "likes": p.like_count,
                "body": p.body,
            }
            for p in posts
        ],
        "threads_created": [
            {
                "thread_id": t.thread_id if hasattr(t, "thread_id") else None,
                "date": t.create_date,
                "title": t.title if hasattr(t, "title") else (t.forum_title or ""),
                "forum_title": t.forum_title,
                "body": t.body,
            }
            for t in threads
        ],
        "wall_posts": [
            {
                "post_id": w.post_id if hasattr(w, "post_id") else None,
                "date": w.create_date,
                "poster_name": w.poster_name,
                "body": w.body,
            }
            for w in wall
        ],
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=1)
    print(f"OK: {len(posts)} постов + {len(threads)} тем + {len(wall)} стены за {elapsed}s → {out_path}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
