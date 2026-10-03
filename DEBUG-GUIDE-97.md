# DEBUG-GUIDE-97: РЕШЕНО 2026-10-03

## Статус: ПОЛНОСТЬЮ РЕШЕНО И ЗАДЕПЛОЕНО (локалка + прод)

### Корневая причина (было две, обе связаны со сменой полей API LolzTeam)

API `POST /search/posts` **полностью сменил имена полей** в items:

| Было (старый API) | Стало (новый API) |
|---|---|
| `post_body` | `message` |
| `post_create_date` | `post_date` |
| `poster_user_id` | `user_id` |
| `post_like_count` | `likes` |
| `post_comment_count` | `comment_count` |
| `post_is_first_post` | `is_first_post` |

Из-за этого:
1. `add_posts()` фильтр `poster_user_id` → None → TypeError → **0 постов**
   (фикс: фолбэк `user_id` — оставлен)
2. `UserPost.from_api` читал `post_body`/`post_create_date` → посты собирались,
   но **без текстов и дат**
3. `item_timestamp()` не находил дату → `window_oldest=None` →
   `source_exhausted=True` после **первого окна** → сбор останавливался на 97

### Фикс (в lolz_analyzer.py)

- `UserPost.from_api`: читает ОБА формата — `post_body`/`message`,
  `post_create_date`/`post_date`, `post_like_count`/`likes` и т.д.
- `item_timestamp`: в список полей даты добавлен `post_date`
- `fetch_timeline`: `per_page` 20 → **100** (мелкие страницы + дубли курсора
  сжигали бюджет страниц)
- Инструментация: `drop_stats` (content_type/wrong_user/duplicate) и `page_log`
  в `timeline_fetch_meta` — видно, где что отбрасывается

### Результат проверки (юзер 6266214, max_pages=2, target 700)

- До: 97 постов, окон: 1, exhausted: True, посты без текстов
- После: **191 пост** (187 с текстами), окон: 2, pages: 4, exhausted: **False**,
  даты и лайки заполнены

### Если симптомы вернутся

1. Проба API: POST `/search/posts` `{"user_id": N, "limit": 5, "data_limit": 5}`
   → распечатать ключи первого item. Если снова сменились имена — добавить
   фолбэк в `UserPost.from_api` и `item_timestamp` (список полей даты).
2. Телеметрия: `timeline_fetch_meta["drop_stats"]` и `["page_log"]` показывают,
   где теряются посты (content_type / wrong_user / duplicate по страницам).
3. Дубликаты между страницами окна (~50%) — особенность API, не баг:
   окна продолжаются по `before` и добирают новое.

### Прод

Фикс задеплоен: `/opt/zelscan/scripts/lolz_analyzer.py` + рестарт
`zelscan-backend` 2026-10-03. Не откатывать на старую версию.
