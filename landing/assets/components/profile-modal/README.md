# Profile Modal — изолированный компонент

Самодостаточная модалка профиля (аватар, описание, портфолио, кнопка Telegram).
Не зависит от `lendos/` и от общих `.modal` стилей проекта — всё под неймспейсом `.pm-*`.

## Состав
- `profile-modal.css` — стили (тёмная тема, без внешних зависимостей)
- `profile-modal.html` — разметка модалки
- `profile-modal.js` — логика open/close (без библиотек)
- `images/` — свои копии фото (avatar, preview1–5, telegram)

## Подключение
```html
<link rel="stylesheet" href="assets/components/profile-modal/profile-modal.css">
<!-- вставить содержимое profile-modal.html сюда -->
<script src="assets/components/profile-modal/profile-modal.js"></script>
```

> Пути к картинкам в HTML/CSS относительные (`images/...`). Если вставляешь
> разметку на страницу, лежащую в другой папке, поправь префикс пути к `images/`
> (например `assets/components/profile-modal/images/...`).

## Открытие / закрытие
- Кнопкой-триггером: добавь атрибут `data-pm-open` любому элементу — клик откроет модалку.
- Программно: `ProfileModal.open()`, `ProfileModal.close()`, `ProfileModal.toggle()`.
- Закрывается: крестик, клик по фону, клавиша Esc.
