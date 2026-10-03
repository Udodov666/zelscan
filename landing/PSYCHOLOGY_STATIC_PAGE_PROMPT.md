# План: статическая тестовая страница «Психология» (1:1 дубль, один файл)

> Задача для исполняющего ИИ. Создать **один самодостаточный HTML-файл**
> `landing/zelscan_psychology_static.html` — точную 1:1 копию страницы
> «Психология» отчёта Zelscan, работающую без бэкенда на мок-данных.
> Все стили и скрипты — инлайн внутри этого файла, внешними остаются только
> CDN (Google Fonts, Font Awesome). Локальных ссылок на файлы проекта быть
> не должно.

---

## 1. Источники (что копировать)

| Что | Файл | Примечание |
|---|---|---|
| Каркас страницы | `landing/zelscan_psychology.html` | вся разметка: boot-скелет, header, sidebar, hero, tiles, tabs, metrics |
| Стили страницы | `landing/assets/css/pages/zelscan_psychology.css` (v7) | основной CSS метрик |
| Общие стили | `landing/assets/css/report-hero.css?v=1`, `report-shared.css?v=7`, `account-ui.css?v=28`, `responsive.css?v=15`, `menu-v8.css?v=8`, `sidebar-lab.css`, `order-modals.css?v=61`, `zs-notice.css?v=1`, `header-logo.css?v=1`, `loading.css?v=4` | инлайнить в том же порядке, в котором они подключены в исходнике |
| Логика метрик | `landing/assets/js/pages/zelscan_psychology.2.js` (239 строк) | вся отрисовка колец/орбит/графиков |
| Табы | `landing/assets/js/pages/zelscan_psychology.1.js` | переключение active у табов |
| Хелперы + zsLoad | `landing/assets/js/zs-loader-menu-clean.js` (строка ~411) | взять ТОЛЬКО определения хелперов, которыми пользуется psychology.2.js: `_el`, `_clamp`, `_esc` и других, найденных grep'ом по `_`-функциям; сам загрузчик (fetch к API) НЕ переносить |
| Эталон мок-данных | `cache/results/c318a12f9d.json` | реальный отчёт karandawww; значения в разделе 4 |

Порядок CSS-инлайна = порядок `<link>` в исходнике (строки 7–14):
`zelscan_psychology.css` → `report-hero.css` → `account-ui.css` → `responsive.css` → `report-shared.css` → (Font Awesome CDN, остаётся ссылкой) → `menu-v8.css` → `sidebar-lab.css` → `order-modals.css` → `zs-notice.css` → `header-logo.css` → `loading.css`.

Порядок JS-инлайна = порядок `<script>` (строки 198–207), но:
- `zs-loader-menu-clean.js` → заменить на мини-заглушку (раздел 3);
- `order-modals.js`, `account-ui.js`, `responsive-ui.js`, `sidebar-lab.js`, `zs-notice.js`, `header-logo.js`, `zs-skeleton.js` — не переносить: на статике нет аккаунта/модалок; их визуальные эффекты (сайдбар, баланс) достигаются статичной разметкой.

## 2. Структура целевого файла

```
zelscan_psychology_static.html
├── <script> boot-скелет (копия 1:1 со строки 1 исходника)
├── <style> анти-мигание сайдбара (копия строки 2)
├── <head>: meta UTF-8, viewport, Google Fonts Inter (CDN-ссылка),
│          Font Awesome 6.7.2 (CDN-ссылка), <style> весь CSS инлайн
├── <body>: копия разметки zelscan_psychology.html целиком
│   ├── .zsk-boot скелет загрузки
│   ├── .frame > header (лого, поиск, bal-pill скрыт style="display:none",
│   │                    аватар-заглушка без авторизации)
│   ├── aside.sidebar (навигация; ссылки можно оставить — файл лежит в landing/)
│   ├── main.main:
│   │   ├── .report-h («Отчет» + дата-заглушка)
│   │   ├── section.hero: hero-ava/-tags/-name/-meta/-desc + .tiles (4 плитки)
│   │   ├── nav.tabs (Обзор/Активность/Поведение/Психология active/Анализ)
│   │   └── .metrics — все 5 карточек 1:1:
│   │       ├── #confidence-card (afull) «Уверенность в себе» — кольцо + орбита,
│   │       │   состояния CF_STATES: растерян→сомневается→думает→спокоен→уверен→категоричен
│   │       ├── #admit-card «Признание ошибок»
│   │       ├── #empathy-card «Эмпатия» (emp-svg)
│   │       ├── #ego-card «Эго»
│   │       └── #conflict-card «Конфликтность» (conf-chart)
├── <script> хелперы (_el/_clamp/_esc) + заглушка zsLoad + MOCK
├── <script> содержимое zelscan_psychology.1.js
└── <script> содержимое zelscan_psychology.2.js
```

Локальные картинки, встречающиеся в разметке (`text.svg`, `plus.svg`), встроить
как `data:image/svg+xml;base64,...` — чтобы файл не зависел от соседних файлов.

## 3. Замена zsLoad (главное отличие от продакшена)

Вместо загрузчика с fetch вставить в начало скриптового блока:

```js
function zsLoad(renderFn) {
  // статическая страница: рендерим сразу на эталонных мок-данных
  renderFn(MOCK_REPORT);
}
```

`MOCK_REPORT` — константа из раздела 4. Ничего асинхронного: boot-скелет
уходит по таймауту как в оригинале (`zs-boot-done` через 6 c, классы уже
вешает инлайн-скрипт из строки 1).

## 4. Мок-данные (эталон — реальный отчёт c318a12f9d, karandawww)

```json
{
  "card": {
    "user_id": 638074,
    "username": "karandawww",
    "avatar": "",
    "tenure": "На форуме 3 года"
  },
  "verdict": { "summary": "Пишет по делу, редко эмоционален; в спор не лезет, но может ответить резко." },
  "portrait": {
    "confidence": {
      "score": 40, "certain": 38, "hedging": 56,
      "verdict": "Балансирует между уверенностью и осторожностью — 40% уверенных формулировок"
    },
    "ego":   { "score": 0.42, "per_100": 0.42, "verdict": "Почти без «я» — пишет о вещах, а не о себе" },
    "conflict": {
      "score": 2, "avg_tox": 0.04, "max_tox": 4, "high_tox_count": 0, "toxic_pct": 0,
      "verdict": "ровный в среднем — но если задеть, может зацепить", "examples": []
    },
    "emotion": { "positive_pct": 5, "negative_pct": 1, "toxic_pct": 2, "neutral_pct": 92,
      "verdict": "Пишет по делу — 92% сообщений выдержаны в нейтральном тоне" }
  },
  "admit_mistakes": {
    "count": 1, "total_posts": 700, "ratio": 0.14,
    "examples": [{ "body": "я проебал его", "matched_pattern": "проебал" }],
    "verdict": "Редко признаёт ошибки (1 за 700 постов) — упрямый"
  },
  "empathy": {
    "count": 4, "total_posts": 700, "ratio": 0.57,
    "examples": ["ну бывает когда пальцы опережают мысли", "соболезную браток", "ахаха жесть"],
    "verdict": "бывает поддержит (4) — эмпатия в меру"
  },
  "raw_stats": { "posts_fetched": 700 },
  "style": { "set": null }
}
```

Поля, которые читает `zelscan_psychology.2.js`: `d.portrait.confidence{score,certain,hedging}`,
`d.portrait.ego.per_100`, `d.portrait.conflict`, `d.portrait.emotion`,
`d.admit_mistakes{count,total_posts,examples}`, `d.empathy{count,total_posts,examples}`,
`d.raw_stats.posts_fetched`, `d.style.set`, `d.card`, `d.verdict`.

## 5. Обязательные требования

1. **1:1 дизайн.** Никаких «улучшений»: те же цвета, радиусы, тени, шрифтовые
   размеры, анимации, hover-поведения плиток (tile-ghost → tile-card),
   состояния кольца уверенности, орбита-аватар, графики эмпатии/конфликтности.
   Тёмная тема, Inter, отступы — пиксель в пиксель из CSS-исходников.
2. **Один файл.** После сборки в файле не должно остаться `href="assets/` и
   `src="assets/` (проверить grep'ом). Допустимы только CDN-ссылки Google Fonts
   и Font Awesome.
3. **Кодировка UTF-8.** В исходном HTML есть mojibake-фрагменты — в новом файле
   весь русский текст пишется чисто. Известные места:
   - подзаголовок #conflict-card: правильно «Спокойствие под давлением»
     (в исходнике битое «РЎРїРѕРєРѕР№СЃС‚РІРёРµ под давлением»);
   - пункт сайдбара: «История» (битое «РРёСЃС‚ория»);
   - tile «Нейтральных смс», вторая строка: «Стиль — деловой, конкретный…»
     (битое «РЎС‚иль»).
4. **Никаких фейковых статичных метрик.** Если какого-то поля в моке нет —
   показывать честное «недостаточно данных», не подставлять красивые цифры
   (принцип проекта, см. фикс «Отношение по статусу»).
5. **Табы** остаются некликабельными на статике, кроме визуального active
   («Психология»); href других табов можно оставить на реальные страницы landing/.
6. **Заголовок страницы** `<title>` — «zelscan · Психология (static test)»,
   чтобы отличать от продакшн-вкладки.

## 6. Резерв под будущую карточку (не входит в 1:1)

После сборки 1:1 добавить в конец `.metrics` закомментированный слот:

```html
<!-- СЛОТ: «Психологический возраст» — будущая карточка.
     Дизайн-плейграунд: большая цифра «≈NN лет», слово-состояние
     («моложе своих лет»/«старше»/«соответствует»), 2–3 строки «откуда цифра».
     Стиль — как у соседних acard (mc-h/mc-title/mc-sub). Не раскомментировать
     до появления данных ai.psychologist.parsed.psychological_age. -->
```

## 7. Чек-лист приёмки

- [ ] Файл `landing/zelscan_psychology_static.html` открывается напрямую
      (`file://`) и через `http://localhost:8000/zelscan_psychology_static.html`
      без ошибок в консоли (допустимы только сетевые 404 CDN при отсутствии сети).
- [ ] `grep -c 'assets/' zelscan_psychology_static.html` → 0.
- [ ] Рендерятся все 5 карточек с числами из мока: Уверенность 40
      (состояние «сомневается», кольцо на 40%), Признание ошибок (1/700),
      Эмпатия (4 поддержки, 3 примера), Эго (0.42), Конфликтность (2).
- [ ] Плитки hero: Конфликтность 2%, Токсичность 2%, Нейтральные 92%, Эмпатия;
      hover раскрывает tile-card с «Откуда цифра».
- [ ] Кольцо уверенности анимируется, орбита вращается с корректной скоростью
      для score=40 (CF_STATES: интервал 20–40 → «сомневается», spd:8).
- [ ] Тёмная тема, Inter, иконки Font Awesome на месте; вёрстка не сыплется на
      1440px и в мобильном брейкпоинте из responsive.css.
- [ ] Кириллица без кракозябр (см. п.5.3).
- [ ] Страница не делает никаких fetch/XHR к API.
