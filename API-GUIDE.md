# LolzTeam API — полный гайд по работе и тестированию
(хэндофф от сессии 2026-10-03; всё проверено живыми запросами)

## Эндпоинты, которые использует Zelscan

| Эндпоинт | Метод | Что отдаёт | Пул токенов |
|---|---|---|---|
| `/search/posts` | POST | таймлайн юзера: посты+темы смешанно | messages (ротация) |
| `/threads?creator_user_id=N&limit=&page=` | GET | созданные юзером темы | profile |
| `/users/{id}/profile-posts?limit=&page=` | GET | стена профиля (массив `profile_posts`) | profile |
| `/users/{id}` | GET | публичный профиль | profile |

Base: `https://api.lolz.team`. Авторизация: `Authorization: Bearer <token>`.

## Рейт-лимиты

- POST `/search/posts`: **30/мин на токен** (сервис держит резерв 2 от X-RateLimit-Remaining)
- GET: **300/мин на токен**
- Публичный `/api/search` (лендинг/приложение): 30/мин на IP (защита самого Zelscan)

## ПОЛЯ ITEMS — API v2 (переименованы в техработы 2026-10)

### /search/posts (item)
| Было | Стало |
|---|---|
| `post_body` | `message` (+ `message_plain_text`, `message_html`) |
| `post_create_date` | `post_date` |
| `poster_user_id` | `user_id` |
| `post_like_count` | `likes` |
| `post_comment_count` | `comment_count` |
| `post_is_first_post` | `is_first_post` |

Новое: `username_html`, `avatar_url`, `view_url`, `thread` (объект темы), `signature_html`, `is_ignored`, `node_id`, `position`.

### /threads (тред)
| Было | Стало |
|---|---|
| `thread_create_date` | `post_date` |
| `thread_view_count` | `view_count` |
| `thread_post_count` | `post_count` |
| `thread_is_sticky` | `sticky` |
| `thread_is_closed` | `discussion_open` (ИНВЕРТИРОВАНО) |
| `first_post.post_like_count` | `first_post_likes` |
| тело: `first_post.post_body` | `first_post.message` |

Новое: `username_html`, `avatar_url`, `view_url`, `tags`, `review_score`/`review_total_count` (рейтинг сделок), `last_post_username`, `title_en`, `creator_user`. Ответ лежит в ключе **`threads`** (не `data`), есть `threads_total`, `creator_user`.

### Стена (/profile-posts)
Ответ в ключе **`profile_posts`** (+ `totalProfilePosts`, `links`). Item: `profile_post_id`, поля автора и тела — проверять по факту; `WallPost.from_api` поддерживает оба формата.

### ГЛАВНОЕ ПРАВИЛО
При любом «пустом» сборе — сначала сделать пробу API на 5 items и
распечатать ключи: `sorted(item.keys())`. Если имена сменились — добавить
фолбэк в `UserPost.from_api` / `Thread.from_api` / `WallPost.from_api`
(они уже написаны с поддержкой обоих форматов — просто расширить словарь
соответствий) и в `item_timestamp` (список полей даты).

## Поведение /search/posts (важно!)

- Окно = POST `{"user_id": N, "limit": 100, "data_limit": 100}` (+ `"before": ts` для истории)
- Ответ: `data` (items), `data_total` (размер ОКНА, не юзера!), `links.next`
- **Стрим смешанный**: `content_type: post/thread` — фильтровать
- **Окно ограничено ~200 записей на юзера** — глубже история только через `before` = `min(post_date) - 1`
- `links.next` — пагинация внутри окна; ходить нужно тем же методом/хостом, что и создал окно (анализатор использует GET на full URL из links.next — работает)
- После исчерпания окна → новое окно с `before`, и так до target или пустого окна
- 429 → пауза строго по `Retry-After`
- Курсор окна привязан к токену, который его создал (cursor affinity)

## Телеметрия и отладка

`analyzer.timeline_fetch_meta` после прогона содержит:
- `drop_stats` — сколько отброшено (content_type / wrong_user / duplicate)
- `page_log` — добавлено постов на каждой странице
- `result_pages_fetched`, `windows_scanned`, `last_window_total`, `source_exhausted`
- `rate_limit_observations`, `drop_stats` — вся телеметрия пишется в досье

Если собралось меньше, чем в окне: смотреть drop_stats → content_type/wrong_user/duplicate.

## Тестирование — готовые сниппеты

### Проба полей (первое действие при «пустом сборе»)
```python
import sys, json, urllib.request
sys.path.insert(0, "app")
import config
tok = config.load_lolz_tokens("messages")[0]
req = urllib.request.Request("https://api.lolz.team/search/posts",
    data=json.dumps({"user_id": N, "limit": 5, "data_limit": 5}).encode(),
    headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
d = json.load(urllib.request.urlopen(req, timeout=30))
print(sorted(d["data"][0].keys()))  # текущие имена полей
```

### Прогон сборщика с телеметрией
```python
import sys
sys.path.insert(0, "scripts"); sys.path.insert(0, "app")
import config
from lolz_analyzer import LolzAnalyzer
a = LolzAnalyzer(tokens=config.load_lolz_tokens("messages"))
posts = a.fetch_timeline(6266214, max_pages=2, target_posts=700,
                         accelerated=True, max_elapsed_seconds=120)
m = a.timeline_fetch_meta
print(len(posts), m.get("drop_stats"), m.get("result_pages_fetched"),
      m.get("source_exhausted"))
```
(тестовый юзер 6266214; после правок — `rm -rf scripts/__pycache__`)

### Проверка тредов/стены
```python
a.fetch_threads(6266214, max_pages=1)   # .title/.body/.create_date заполнены?
a.fetch_wall(6266214, max_pages=1)      # .body/.create_date заполнены?
```

### Тест заказа без форума
POST `http://localhost:5050/api/orders/manual` (Bearer = сессия юзера):
`{"username": "...", "texts": ["..."], "report_type": "full", "visibility": "public"}`
— собирает досье офлайн (0 запросов к форуму).

## Архитектура Zelscan (локальная версия)

- `app/server.py` — Flask backend (:5050), гейт `/api/*` (публичные: oauth/config, auth/session, search, local/setup*, captcha, health)
- `app/front_server.py` — frontend (:8080); `/` → `/app`; гейт сетапа только при маркере `.zelscan_local` (гитхаб-сборка)
- `app/worker.py` — очередь заказов (1 воркер), пишет результат в `cache/results/{order_id}.json`
- `scripts/lolz_analyzer.py` — ядро (LolzAnalyzer, _build_dossier офлайн)
- `scripts/ai_interpreter.py` — AI-слой (Aki.io / OpenRouter; gpt-oss-120b)
- `landing/lendos/{setup.html, about/, css/, js/, images/}` — визард, /about
- Токены: `secrets/{messages,profile,search}/*.txt` или легаси `.lolz_token*`
- OAuth: файлы `.lolz_oauth_client_id` / `.lolz_oauth_redirect_uri` (или env)
- Админка: `/admin` — в локалке без пароля (LOCAL_OPEN_ADMIN=1 в config)

## Правка полей — как фиксить (пошагово)

1. Проба полей (сниппет выше) → новые имена
2. `UserPost.from_api` / `Thread.from_api` / `WallPost.from_api`:
   `p.get("старое") or p.get("новое") or 0` — паттерн двойного формата
3. `item_timestamp` в fetch_timeline: добавить новое имя поля даты
4. Прогон сборщика → drop_stats должен показать реальные дропы (треды ок)
5. `rm -rf scripts/__pycache__` перед повторным тестом
6. Тест заказа: `report?order={display_id}` → посты с текстами, даты, лайки

## История фиксов 2026-10 (см. DEBUG-GUIDE-97.md, git log Udodov666/zelscan)

- posts: poster_user_id → user_id (0 постов)
- posts/threads/wall: полный переход на новые имена (97/пустые посты/нет окон)
- per_page 20 → 100 (10 страниц × 20 сжигали бюджет, окна обрывались)
- Инструментация drop_stats/page_log в fetch_meta
