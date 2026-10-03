/* ZSModals — унифицированные модалки Zelscan (v4) */
const ZSModals = (function () {
  let cur = null;        // current modal root
  let bonusOn = false;
  let selTid = 'basic';  // selected tariff id
  let tariffLock = null; // 'pro' | null — залочен ли тариф при «Обновить досье»
  let refreshMode = false; // это обновление существующего досье
  let refreshSourceId = null; // order_id исходного досье для refresh
  let progTimer = null;
  let pollTimer = null;
  let pollTimeout = null;
  let topupState = null;
  let topupPollTimer = null;
  let topupTimerInt = null;
  let expandedTid = null;
  let miniEl = null;       // свёрнутый мини-виджет прогресса
  let minimized = false;   // модалка свёрнута в фон?
  let topupResume = null;  // вернуться в заказ после пополнения
  let pendingOrder = null; // {user, opts} — заказ, отложенный до пополнения
  let orderOpts = {};
  let preflightSeq = 0;
  let preflightOwned = null;

  /* ── Настройки пользователя (тариф/автооткрытие) ──────────────────────────
     Читаем из window.ZSSettings (модуль settings.js), если он загружен и
     подтянул серверные настройки. Всё — с безопасными фолбэками. */
  function _zsSettings() {
    try { return (window.ZSSettings && window.ZSSettings.getState) ? window.ZSSettings.getState() : null; }
    catch (_) { return null; }
  }
  function _rememberedTariff() {
    const s = _zsSettings();
    if (!s || s.rememberTariff === false) return null;
    // last_tariff в API-контракте; settings.js хранит только булевы флаги в state,
    // поэтому дополнительно смотрим localStorage-зеркало, если оно есть.
    let lt = null;
    try {
      const raw = localStorage.getItem('zelscan_settings_sync');
      if (raw) { const d = JSON.parse(raw); if (d && (d.last_tariff === 'basic' || d.last_tariff === 'pro')) lt = d.last_tariff; }
    } catch (_) {}
    return lt;
  }
  function _persistLastTariff(id) {
    if (id !== 'basic' && id !== 'pro') return;
    const s = _zsSettings();
    if (!s || s.rememberTariff === false) return; // не запоминаем, если выключено
    try {
      const t = localStorage.getItem('lzt_token') || '';
      if (!t) return;
      fetch(API + '/api/my/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify({ last_tariff: id }),
      }).catch(function () {});
      // зеркалим для быстрого чтения на этой и других вкладках
      let d = {};
      try { d = JSON.parse(localStorage.getItem('zelscan_settings_sync') || '{}') || {}; } catch (_) {}
      d.last_tariff = id; d._ts = Date.now();
      localStorage.setItem('zelscan_settings_sync', JSON.stringify(d));
    } catch (_) {}
  }
  function _autoOpenEnabled() {
    const s = _zsSettings();
    return !!(s && s.autoOpen === true);
  }
  // Помечаем текущую вкладку как инициатора конкретного заказа (tab-scoped).
  function _markOrderInitiator(orderId) {
    try { if (orderId) sessionStorage.setItem('zs_order_initiator_' + orderId, '1'); } catch (_) {}
  }
  function _isOrderInitiator(orderId) {
    try { return !!orderId && sessionStorage.getItem('zs_order_initiator_' + orderId) === '1'; }
    catch (_) { return false; }
  }

  /* ── экран подписи (шаг 2) ── */
  let sigState = null;   // {strokes,dataURL,len} — сохранённая подпись
  let agreeOn = false;   // чекбокс согласия
  let promoVal = '';     // значение поля промокода (сохраняется между перерисовками)
  let visSel = 'private'; // доступ к досье: private / unlisted / public
  let pads = {};         // инстансы пэдов: b / d
  let padUiReady = false;
  const SIG_HOSTS = { b: 'zsHostB', d: 'zsHostD' };

  const VIS_OPTS = [
    { id: 'private',  t: 'Только я',  ic: 'v_lock' },
    { id: 'unlisted', t: 'По ссылке', ic: 'v_link' },
    { id: 'public',   t: 'Для всех',  ic: 'v_globe' },
  ];

  const TARIFFS = {
    basic: { name: 'Базовый', price: 0, oldPrice: 9, idx: 0,
      features: ['Разделы: обзор, активность, поведение','Ключевые метрики общения','Топ тем по просмотрам и реакций','Круг общения и карта тем'] },
    pro: { name: 'Полный', price: 0, oldPrice: 19, idx: 1,
      features: ['Все 5 разделов отчёта','ИИ-портрет: психология и анализ','Психологический возраст','Тёмная триада и Big Five','Индекс доверия','Признание ошибок и эмпатия'] },
  };

  /* ─── helpers ─── */
  function el(tag, cls, html) { const e=document.createElement(tag); if(cls)e.className=cls; if(html)e.innerHTML=html; return e; }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function safeHttpUrl(value, allowedOrigins) {
    try {
      const u = new URL(String(value || ''), location.href);
      if (!/^https?:$/.test(u.protocol)) return '';
      if (allowedOrigins && allowedOrigins.length && allowedOrigins.indexOf(u.origin) < 0) return '';
      return u.href;
    } catch (_) { return ''; }
  }
  function safeInternalUrl(value) {
    const href = safeHttpUrl(value, [location.origin]);
    return href || '';
  }
  function safeAvatarUrl(value) { return safeHttpUrl(value); }

  function qs(root, sel) { return root ? root.querySelector(sel) : null; }

  function svg(name) {
    const m = {
      x: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 00-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 10-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 101.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 001.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 000-1.09z" fill="currentColor"/></svg>',
      check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M8.25 14.94l-4.5-4.5 1.06-1.06 3.44 3.44 8.69-8.69 1.06 1.06-9.75 9.75z" fill="currentColor"/></svg>',
      check_g: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" fill="#2BAD72"><path d="M15 3C8.37 3 3 8.37 3 15s5.37 12 12 12 12-5.37 12-12S21.63 3 15 3zm-1.5 17.25l-6-6 1.76-1.76 4.24 4.24 8.24-8.24 1.76 1.76-10 10z"/></svg>',
      close: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M4.05 3.16a.66.66 0 10-.89.98l4.5 4.08-4.5 4.1a.66.66 0 00.89.97l4.5-4.09 4.5 4.09a.66.66 0 00.89-.97l-4.5-4.1 4.5-4.08a.66.66 0 10-.89-.98L8.55 7.23 4.05 3.16z" fill="currentColor"/></svg>',
      b_shield: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 2L3 5.09V9.6c0 4.49 2.88 8.66 7 10 4.12-1.34 7-5.51 7-10V5.09L10 2zM14.5 9.25h-9v-1.5h9v1.5z" fill="currentColor"/></svg>',
      b_bolt: '<svg viewBox="0 0 20 20" fill="none"><path d="M11 1L4 11h5l-1 8 8-10h-5l1-8z" fill="currentColor"/></svg>',
      b_list: '<svg viewBox="0 0 20 20" fill="none"><path d="M6 4h10v1.5H6V4zM6 9h10v1.5H6V9zM6 14h7v1.5H6V14zM3 4h1.5v1.5H3V4zM3 9h1.5v1.5H3V9zM3 14h1.5v1.5H3V14z" fill="currentColor"/></svg>',
      b_cards: '<svg viewBox="0 0 20 20" fill="none"><path d="M2 4h16v2H2V4zM2 7h16v8H2V7z" fill="currentColor"/></svg>',
      star: '<svg viewBox="0 0 20 20" fill="none"><path d="M10 2l2.09 6.26H18.5l-5.09 3.72 2.09 6.26L10 14.68 4.5 18.24l2.09-6.26L1.5 8.26h6.41L10 2z" fill="currentColor"/></svg>',
      ok: '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" fill="#2BAD72"/><path d="M7 10l2 2 4-4" stroke="#161a1a" stroke-width="1.5" stroke-linecap="round"/></svg>',
      warn: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#F52121" opacity=".2"/><path d="M8 4.5v4M8 11v.5" stroke="#F52121" stroke-width="1.3" stroke-linecap="round"/></svg>',
      v_lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M144 144l0 48 160 0 0-48c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192l0-48C80 64.5 144.5 0 224 0s144 64.5 144 144l0 48 16 0c35.3 0 64 28.7 64 64l0 192c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 256c0-35.3 28.7-64 64-64l16 0z"/></svg>',
      v_link: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" fill="currentColor" aria-hidden="true"><path d="M579.8 267.7c56.5-56.5 56.5-148 0-204.5c-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-14.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8.6c31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0c-27.9-27.9-31.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0L579.8 267.7zM60.2 244.3c-56.5 56.5-56.5 148 0 204.5c50 50 128.8 56.5 186.3 15.4l1.6-1.1c14.4-10.3 17.7-30.3 7.4-44.6s-30.3-17.7-44.6-7.4l-1.6 1.1c-32.1 22.9-76 19.3-103.8-8.6C74 372 74 321 105.5 289.5L217.7 177.2c31.5-31.5 82.5-31.5 114 0c27.9 27.9 31.5 71.8 8.6 103.9l-1.1 1.6c-10.3 14.4-6.9 34.4 7.4 44.6s34.4 6.9 44.6-7.4l1.1-1.6C433.5 260.8 427 182 377 132c-56.5-56.5-148-56.5-204.5 0L60.2 244.3z"/></svg>',
      v_globe: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M266.3 48.3L232.5 73.6c-5.4 4-8.5 10.4-8.5 17.1l0 9.1c0 6.8 5.5 12.3 12.3 12.3c2.4 0 4.8-.7 6.8-2.1l41.8-27.9c2-1.3 4.4-2.1 6.8-2.1l1 0c6.2 0 11.3 5.1 11.3 11.3c0 3-1.2 5.9-3.3 8l-19.9 19.9c-5.8 5.8-12.9 10.2-20.7 12.8l-26.5 8.8c-5.8 1.9-9.6 7.3-9.6 13.4c0 3.7-1.5 7.3-4.1 10l-17.9 17.9c-6.4 6.4-9.9 15-9.9 24l0 4.3c0 16.4 13.6 29.7 29.9 29.7c11 0 21.2-6.2 26.1-16l4-8.1c2.4-4.8 7.4-7.9 12.8-7.9c4.5 0 8.7 2.1 11.4 5.7l16.3 21.7c2.1 2.9 5.5 4.5 9.1 4.5c8.4 0 13.9-8.9 10.1-16.4l-1.1-2.3c-3.5-7 0-15.5 7.5-18l21.2-7.1c7.6-2.5 12.7-9.6 12.7-17.6c0-10.3 8.3-18.6 18.6-18.6l29.4 0c8.8 0 16 7.2 16 16s-7.2 16-16 16l-20.7 0c-7.2 0-14.2 2.9-19.3 8l-4.7 4.7c-2.1 2.1-3.3 5-3.3 8c0 6.2 5.1 11.3 11.3 11.3l11.3 0c6 0 11.8 2.4 16 6.6l6.5 6.5c1.8 1.8 2.8 4.3 2.8 6.8s-1 5-2.8 6.8l-7.5 7.5C386 262 384 266.9 384 272s2 10 5.7 13.7L408 304c10.2 10.2 24.1 16 38.6 16l7.3 0c6.5-20.2 10-41.7 10-64c0-111.4-87.6-202.4-197.7-207.7zm172 307.9c-3.7-2.6-8.2-4.1-13-4.1c-6 0-11.8-2.4-16-6.6L396 332c-7.7-7.7-18-12-28.9-12c-9.7 0-19.2-3.5-26.6-9.8L314 287.4c-11.6-9.9-26.4-15.4-41.7-15.4l-20.9 0c-12.6 0-25 3.7-35.5 10.7L188.5 301c-17.8 11.9-28.5 31.9-28.5 53.3l0 3.2c0 17 6.7 33.3 18.7 45.3l16 16c8.5 8.5 20 13.3 32 13.3l21.3 0c13.3 0 24 10.7 24 24c0 2.5 .4 5 1.1 7.3c71.3-5.8 132.5-47.6 165.2-107.2zM0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM187.3 100.7c-6.2-6.2-16.4-6.2-22.6 0l-32 32c-6.2 6.2-6.2 16.4 0 22.6s16.4 6.2 22.6 0l32-32c6.2-6.2 6.2-16.4 0-22.6z"/></svg>',
    };
    return m[name] || '';
  }

  function number(n) { return Number(n || 0).toLocaleString('ru-RU'); }
  function _pluralAdv(n) { return (n%10===1 && n%100!==11) ? 'преимущество'
    : ([2,3,4].includes(n%10) && !(n%100>=12 && n%100<=14)) ? 'преимущества' : 'преимуществ'; }

  function escText(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function safeAvatar(v){return window.ZSDashboard2.safeUrl(v);}

  /* дата формирования существующего досье (UNIX seconds → рус.) */
  function fmtExistingDate(stamp) {
    const n = Number(stamp);
    if (!stamp || isNaN(n)) return 'дата неизвестна';
    return new Date(n * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  /* тариф существующего досье → человекочитаемо */
  function reportTypeLabel(rt) {
    if (rt === 'full' || rt === 'pro') return 'Полный AI';
    if (rt === 'basic') return 'Базовый';
    return rt || 'Базовый';
  }
  /* видимость существующего досье → человекочитаемо */
  function visibilityLabel(v) {
    if (v === 'private') return '«Приватное»';
    if (v === 'unlisted') return '«По ссылке»';
    if (v === 'public') return '«Общее»';
    return v ? ('«' + v + '»') : '—';
  }
  /* имя субъекта досье для модалки выбора (с форумным стилем ника) */
  function subjectName(u) {
    if (!u) return '';
    return u.username_html || u.username || u.nickname || u.id || '';
  }

  function safeRichNickname(value) {
    const raw = String(value == null ? '' : value);
    if (raw.indexOf('<') < 0) return escText(raw);
    const doc = document.implementation.createHTMLDocument('nickname');
    const host = doc.createElement('div');
    host.innerHTML = raw;
    const nodes = Array.from(host.childNodes);
    if (!nodes.length || nodes.some(function (node) { return node.nodeType !== 1 || node.tagName !== 'SPAN'; })) return escText(host.textContent || raw);

    const allowedStyles = new Set(['color', 'background', 'background-image', 'background-clip', '-webkit-background-clip', '-webkit-text-fill-color', 'text-shadow']);
    const allowedIconClasses = new Set(['GreatestUsernameIcon', 'groupUsernameIcon']);
    const blocked = /(?:url\s*\(|expression\s*\(|@import|javascript\s*:|\bvar\s*\(|\bposition\s*:|behavior\s*:|-moz-binding)/i;
    const output = document.createElement('div');
    for (const source of nodes) {
      if (source.children.length) return escText(host.textContent || raw);
      const classes = Array.from(source.classList);
      const isIcon = classes.length > 0 && classes.every(function (name) { return allowedIconClasses.has(name); });
      const allowedAttributeCount = (source.hasAttribute('style') ? 1 : 0) + (source.hasAttribute('class') ? 1 : 0);
      if (source.attributes.length !== allowedAttributeCount) return escText(host.textContent || raw);
      if (isIcon) {
        if (source.hasAttribute('style') || source.textContent) return escText(host.textContent || raw);
        const icon = document.createElement('span');
        icon.className = classes.join(' ');
        output.appendChild(icon);
        continue;
      }
      if (classes.some(function (name) { return name !== 'styleUserNickname'; })) return escText(host.textContent || raw);
      const safe = document.createElement('span');
      if (classes.length) safe.className = 'styleUserNickname';
      const style = source.getAttribute('style') || '';
      for (const declaration of style.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 1) continue;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const cssValue = declaration.slice(colon + 1).trim();
        if (!allowedStyles.has(property) || !cssValue || blocked.test(cssValue)) continue;
        if ((property === 'background' || property === 'background-image') && !/^(?:linear-gradient|radial-gradient)\(/i.test(cssValue)) continue;
        if ((property === 'background-clip' || property === '-webkit-background-clip') && cssValue.toLowerCase() !== 'text') continue;
        if (property === '-webkit-text-fill-color' && !/^(?:transparent|#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(cssValue)) continue;
        safe.style.setProperty(property, cssValue);
      }
      safe.textContent = source.textContent || '';
      output.appendChild(safe);
    }
    return output.innerHTML;
  }

  /* ─── частичная оплата бонусами: списываем до цены, остаток рублями ─── */
  function calcPay(user, price) {
    const bal = Math.floor(Number((user && user.bonus) || 0)) || 0;
    const spend = Math.min(bal, price);
    const use = bonusOn && bal > 0;
    const bonusUse = use ? spend : 0;
    return { bal: bal, spend: spend, use: use, bonusUse: bonusUse, remain: price - bonusUse };
  }

  /* число у тумблера: выкл — «69 (110) Б», вкл — «69 Б»; скобки = общий баланс, только если он больше спишемого */
  function bonusVal(pay) {
    const main = pay.use
      ? pay.bonusUse
      : pay.spend + (pay.spend < pay.bal ? `<span class="bal">(${pay.bal})</span>` : '');
    return `${main}<span class="bbadge">Б</span>`;
  }

  /* ─── render ─── */
  function lowMessageWarning(u) {
    const count = Number(u && (u.message_count != null ? u.message_count : u.user_message_count));
    if (!u || u._selectionSource !== 'direct' || !Number.isFinite(count) || count >= 10) return '';
    return `<div class="zs-low-message-warning" role="status">
      <span class="zs-low-message-warning-ic">${svg('warn')}</span>
      <div><strong>В профиле зафиксировано меньше 10 сообщений</strong>
      <p>Счётчик профиля не учитывает сообщения из оффтопа. Но в отчёте Zelscan анализируются доступные сообщения во всех разделах, включая оффтоп.</p></div>
    </div>`;
  }

  function userRow(u) {
    const avUrl=safeAvatar(u.avatar);
    const av = avUrl ? `<img src="${escText(avUrl)}" alt="">` : escText((u.nickname ? u.nickname[0].toUpperCase() : '?'));
    return `<div class="zs-user"><div class="zs-user-in">
      <div class="zs-m-row">
        <div class="zs-av">${av}</div>
        <div class="zs-m-txt">
          <div class="zs-m-name">${window.ZSNickname.fromUser(u)}</div>
          <div class="zs-m-sub zs-user-stats"><svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M256 448c141.4 0 256-93.1 256-208S397.4 32 256 32S0 125.1 0 240c0 45.1 17.7 86.8 47.7 120.9c-1.9 24.5-11.4 46.3-21.4 62.9c-5.5 9.2-11.1 16.6-15.2 21.6c-2.1 2.5-3.7 4.4-4.9 5.7c-.6 .6-1 1.1-1.3 1.4l-.3 .3c-4.6 4.6-5.9 11.4-3.4 17.4c2.5 6 8.3 9.9 14.8 9.9c28.7 0 57.6-8.9 81.6-19.3c22.9-10 42.4-21.9 54.3-30.6c31.8 11.5 67 17.9 104.1 17.9z"/></svg>${Number(u.message_count ?? u.user_message_count ?? 0).toLocaleString('ru')}<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"/></svg>${Number(u.sympathy_count ?? u.user_like_count ?? 0).toLocaleString('ru')}</div>
        </div>
      </div>
      <button class="zs-ghost" data-zs-call="ZSModals.close()">Изменить</button>
    </div></div>`;
  }

  function tariffCard(id, t, on, solo) {
    const active = on ? 'on' : '';
    const clsBtn = `${active}${solo ? ' solo' : ''}`;
    const featIcons = [svg('b_shield'), svg('b_bolt'), svg('b_list'), svg('b_cards'), svg('star'), svg('b_shield'), svg('b_bolt'), svg('b_list'), svg('b_cards'), svg('star')];
    const features = t.features.map((f, i) => {
      const cls = '';
      return `<div class="zs-f ${cls}"><span class="ic">${featIcons[i] || svg('b_cards')}</span>${f}</div>`;
    }).join('');
    const hasExtra = false;
    const extra = hasExtra ? `<div class="zs-t-expand" data-zs-call="event.stopPropagation();ZSModals._toggleFeatures('${id}')"><span>${svg('b_list')} ${_pluralAdv(t.features.length - 4)}</span><i>›</i></div>` : '';
    const icon = `<div class="zs-t-ic tariff-3d-icon"><img src="assets/dashboard2/img/gotovo${id === 'pro' ? 2 : 1}.png" alt="" aria-hidden="true"></div>`;
    return `<button class="zs-t ${clsBtn} ts-${id}" data-tid="${id}" data-zs-call="event.stopPropagation();ZSModals._pickTariff('${id}')">
      <div class="zs-glow"></div>
      <div class="zs-t-head">
        ${icon}
        ${t.idx === 1 ? `<span class="zs-pill green">${solo ? 'Текущее' : 'Хит'}</span>` : ''}
      </div>
      <div class="zs-t-name">${t.name}</div>
      <div class="zs-t-price"><span class="n">${number(t.price)}</span><span class="c">₽</span><s style="color:rgba(255,255,255,.38);font-size:14px;margin-left:8px">${number(t.oldPrice)} ₽</s></div>
      <div class="zs-t-sep"></div>
      <div class="zs-t-list-wrap">
        ${hasExtra ? `<div class="zs-t-list-coll"><div class="zs-t-list">${features}</div></div>` : `<div class="zs-t-list">${features}</div>`}
        ${extra}
      </div>
    </button>`;
  }

  function bonusBlock(user, price) {
    const pay = calcPay(user, price);
    return `<div class="zs-bonus-wrap">
      <div class="zs-bonus${bonusOn && pay.use ? ' on' : ''}">
        <div class="r">
          <div class="k">Списать бонусы</div>
          <div class="zs-act">
            <span class="zs-bonus-val">${bonusVal(pay)}</span>
            <div class="zs-sw sm${bonusOn ? ' zs-on' : ''}" data-zs-call="ZSModals._toggleBonus()"><i></i></div>
          </div>
        </div>
        <div class="line"></div>
        <div class="tot">
          <div class="k2">Итого</div>
          <div class="v2"><span class="n">${number(pay.remain)}</span><span class="c">₽</span></div>
        </div>
      </div>
    </div>`;
  }

  /* ─── create modal shell ─── */
  function makeModal(title, bodyHtml) {
    const bg = el('div', 'zs-modal-bg');
    bg.innerHTML = `<div class="zs-modal">
      <div class="zs-modal-inner">
        <div class="zs-modal-head">
          <div class="zs-modal-title">${title}</div>
          <button class="zs-modal-x" data-zs-call="ZSModals.close()">${svg('x')}</button>
        </div>
        <div class="zs-modal-body">${bodyHtml}</div>
      </div>
    </div>`;
    bg.addEventListener('click', function (e) { if (e.target === this) ZSModals.close(); });
    document.body.appendChild(bg);
    requestAnimationFrame(function () { bg.classList.add('open'); });
    return bg;
  }

  function updateOrderTotal() {
    const bonusEl = qs(cur, '.zs-bonus');
    if (!bonusEl) return;
    const user = window.selectedUser || window._lastSelectedUser;
    const t = TARIFFS[selTid];
    const pay = calcPay(user, t.price);
    bonusEl.querySelector('.zs-bonus-val').innerHTML = bonusVal(pay);
    bonusEl.querySelector('.v2 .n').textContent = number(pay.remain);
    const c = bonusEl.querySelector('.v2 .c');
    if (c) c.textContent = '₽';
    bonusEl.classList.toggle('on', pay.use);
  }

  function visBlock() {
    return `<div class="zs-group">
      <div class="zs-lab-row"><span class="zs-label">Доступ к досье <span class="zs-help">?<span class="zs-tip">Кто сможет открыть готовое досье. «Только я» — видно только вам. «По ссылке» — откроют все, у кого есть ссылка. «Для всех» — досье появится в публичном разделе.</span></span></span></div>
      <div class="zs-vis" id="visPills">
        <div class="zs-vis-ind" id="visInd"></div>
        ${VIS_OPTS.map(function (o) {
          return `<button type="button" data-vid="${o.id}" class="${o.id === visSel ? 'on' : ''}" data-zs-call="ZSModals._setVis('${o.id}')">${svg(o.ic)}<span>${o.t}</span></button>`;
        }).join('')}
      </div>
    </div>`;
  }

  /* ─── order screen (шаг 1: пользователь + доступ + тариф) ─── */
  let srcMode = 'auto';
  function _setSource(m) {
    srcMode = m;
    const user2 = window.selectedUser || window._lastSelectedUser;
    if (cur) {
      const bodyEl = qs(cur, '.zs-modal-body');
      if (bodyEl) {
        bodyEl.innerHTML = m === 'manual' ? renderManualForm(user2) : renderOrder(user2);
        _visInd(true); // вернуть индикатор «Доступ к досье» после перерисовки
      }
    }
  }
  function srcPills() {
    return `<div class="zs-group">
      <div class="zs-lab-row"><span class="zs-label">Источник данных</span></div>
      <div class="zs-vis" id="srcPills">
        <button type="button" class="${srcMode === 'auto' ? 'on' : ''}" data-zs-call="ZSModals._setSource('auto')">Автосбор (API)</button>
        <button type="button" class="${srcMode === 'manual' ? 'on' : ''}" data-zs-call="ZSModals._setSource('manual')">Ручной ввод</button>
      </div>
    </div>`;
  }
  function _escLocal(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function renderManualForm(user) {
    const u = user || {};
    return `<div class="zs-modal-top">
      <div class="zs-group">
        ${srcPills()}
        <div style="font-size:12.5px;color:var(--fg-muted);margin-top:8px">Вы вводите данные сами — форум не запрашивается ни разу. По одному сообщению в строке.</div>
      </div>
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Пользователь</span></div>
        <input id="manNick" type="text" placeholder="Ник" value="${_escLocal(u.username || '')}"
          style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:inherit;outline:0">
        <input id="manAvatar" type="text" placeholder="Ссылка на аватарку (необязательно)" value="${_escLocal(u.avatar || '')}"
          style="width:100%;margin-top:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:inherit;outline:0">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">
          <input id="manMsgs" type="number" placeholder="Сообщений" value="${_escLocal(u.message_count || '')}"
            style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:inherit;outline:0">
          <input id="manLikes" type="number" placeholder="Лайков" value="${_escLocal(u.like_count || '')}"
            style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:inherit;outline:0">
          <input id="manThreads" type="number" placeholder="Тем" value="${_escLocal(u.threads || '')}"
            style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:inherit;outline:0">
        </div>
      </div>
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Сообщения (по одному в строке)</span></div>
        <textarea id="manTexts" rows="8" placeholder="Первое сообщение&#10;Второе сообщение&#10;..." 
          style="width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;color:var(--fg);padding:11px 13px;font:13px 'JetBrains Mono',monospace;outline:0;resize:vertical"></textarea>
      </div>
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Тариф</span></div>
        <div class="zs-tariffs">
          ${Object.keys(TARIFFS).map(function (k) { return tariffCard(k, TARIFFS[k], k === selTid, false); }).join('')}
        </div>
      </div>
      ${visBlock()}
    </div>
    <div class="zs-actions" id="orderActions">
      <button class="zs-btn light" data-zs-call="ZSModals._submitManual()">Создать досье · 0 ₽</button>
    </div>`;
  }
  function _submitManual() {
    const API = window.__ZS_API__ || '';
    const body = {
      username: (qs(cur, '#manNick') || {}).value || '',
      avatar: (qs(cur, '#manAvatar') || {}).value || '',
      message_count: Number((qs(cur, '#manMsgs') || {}).value) || 0,
      like_count: Number((qs(cur, '#manLikes') || {}).value) || 0,
      threads: Number((qs(cur, '#manThreads') || {}).value) || 0,
      texts: (((qs(cur, '#manTexts') || {}).value || '').split('\n') || []).map(function (s) { return s.trim(); }).filter(Boolean),
      report_type: selTid === 'pro' ? 'full' : 'basic',
      visibility: visSel,
      ai: true,
    };
    if (!body.username.trim()) { if (window.ZSNotice) ZSNotice.show({ type: 'error', title: 'Введите ник' }); return; }
    if (!body.texts.length) { if (window.ZSNotice) ZSNotice.show({ type: 'error', title: 'Вставьте хотя бы одно сообщение' }); return; }
    const headers = { 'Content-Type': 'application/json' };
    try { const t = localStorage.getItem('lzt_token') || ''; if (t) headers.Authorization = 'Bearer ' + t; } catch (e) {}
    fetch(API + '/api/orders/manual', { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { if (window.ZSNotice) ZSNotice.show({ type: 'error', title: res.d.error || 'Ошибка создания' }); return; }
        ZSModals.close();
        location.href = '/report?order=' + res.d.order_id;
      })
      .catch(function () { if (window.ZSNotice) ZSNotice.show({ type: 'error', title: 'Сервер недоступен' }); });
  }

  function renderOrder(user) {
    const ids = tariffLock ? [tariffLock] : Object.keys(TARIFFS);
    const solo = !!tariffLock;
    const tarr = ids.map(function (k) { return tariffCard(k, TARIFFS[k], k === selTid, solo); }).join('');
    return `<div class="zs-modal-top">
      ${lowMessageWarning(user)}
      ${srcPills()}
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Пользователь</span></div>
        ${userRow(user)}
      </div>
      ${visBlock()}
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Тариф</span></div>
        <div class="zs-tariffs">${tarr}</div>
      </div>
    </div>
    <div class="zs-actions" id="orderActions">
      <button class="zs-btn light" data-zs-call="ZSModals._nextStep()">Далее</button>
    </div>`;
  }

  /* ─── signature screen (шаг 2: подпись + промокод + согласие + итого) ─── */

  /* Открыть Пользовательское соглашение (оверлей из sidebar-lab.dashboard2.js) */
  function _openTos(e) {
    if (e && e.preventDefault) e.preventDefault();
    const ov = document.getElementById('zsTosOverlay');
    if (!ov) { if (window.ZSNotice) ZSNotice.show({ type: 'info', title: 'Пользовательское соглашение', message: 'Документ будет опубликован отдельно.' }); return; }
    ov.classList.add('-open');
    ov.setAttribute('aria-hidden', 'false');
    const dlg = ov.querySelector('.zs-modal');
    if (dlg) dlg.focus();
  }

  /* ─── Cloudflare Turnstile (капча на создание заказа) ─── */
  let _capCfg = null;
  let _capWidgetId = null;
  // промокод-скидка на заказ: {code, discount, cost} (preview прошёл)
  let _orderPromo = null;
  function _orderPromoDiscount() {
    if (!_orderPromo || _orderPromo.on === false) return 0;
    const t = TARIFFS[selTid];
    if (!t || _orderPromo.cost !== t.price) return 0;
    return _orderPromo.discount || 0;
  }
  /* Airbnb-стиль: баннер активной скидки с тумблером вкл/выкл */
  function _renderPromoBanner() {
    const msg = cur && qs(cur, '#promoMsg');
    if (!msg) return;
    if (!_orderPromo) { msg.innerHTML = ''; return; }
    const off = _orderPromo.on === false;
    const amount = _orderPromo.percent ? ('−' + _orderPromo.percent + '%') : ('−' + _orderPromo.discount + ' ₽');
    msg.className = 'zs-promo-msg show zs-banner';
    msg.innerHTML = '<div class="zs-promo-banner">'
      + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="#34D399"/></svg>'
      + '<span class="tx"><span class="g">' + amount + '</span> <span class="lt">по промокоду</span></span>'
      + '<label class="zs-psw"><input type="checkbox" ' + (off ? '' : 'checked') + ' onchange="ZSModals._toggleOrderPromo(this.checked)">'
      + '<span class="tr"><span class="th"></span></span></label></div>';
  }
  function _toggleOrderPromo(on) {
    if (!_orderPromo) return;
    _orderPromo.on = on;
    const user2 = window.selectedUser || window._lastSelectedUser;
    if (cur && qs(cur, '.zs-sig') && user2) {
      const bodyEl = qs(cur, '.zs-modal-body');
      if (bodyEl) {
        bodyEl.innerHTML = renderSigScreen(user2);
        const inp2 = qs(cur, '#promoInp');
        if (inp2) inp2.value = promoVal;
        _visInd(true);
      }
    } else { _renderPromoBanner(); }
  }
  function _capFetchCfg() {
    if (_capCfg) return Promise.resolve(_capCfg);
    const API = window.__ZS_API__ || '';
    return fetch(API + '/api/captcha/config')
      .then(function (r) { return r.json(); })
      .then(function (cfg) { _capCfg = cfg; return cfg; })
      .catch(function () { return { enabled: false, sitekey: '' }; });
  }
  function _capLoadScript() {
    return new Promise(function (resolve) {
      if (window.turnstile) return resolve();
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }
  /* ── диалог капчи: открывается на важном действии ── */
  let _capPending = null;
  let _capOverlay = null;
  function _ensureCapDialog() {
    if (_capOverlay && document.contains(_capOverlay)) return;
    _capOverlay = document.createElement('div');
    _capOverlay.id = 'zsCapOverlay';
    _capOverlay.innerHTML = '<div class="zs-cap-dlg" role="dialog" aria-modal="true">'
      + '<div class="zs-cap-t">Подтвердите действие</div>'
      + '<div class="zs-cap-s">Подтвердите, что вы не робот — это займёт секунду</div>'
      + '<div id="zsCapHost"></div>'
      + '<button class="zs-cap-x" type="button" aria-label="Закрыть">✕</button>'
      + '</div>';
    document.body.appendChild(_capOverlay);
    _capOverlay.querySelector('.zs-cap-x').addEventListener('click', function(){ _capCancel(); });
    _capOverlay.addEventListener('click', function(e){ if (e.target === _capOverlay) _capCancel(); });
  }
  function _capShowDialog(cfg) {
    _ensureCapDialog();
    _capOverlay.classList.add('-open');
    _capLoadScript().then(function () {
      if (!window.turnstile) { _capFail('Turnstile недоступен'); return; }
      const host = document.getElementById('zsCapHost');
      host.innerHTML = '';
      if (_capWidgetId !== null) { try { window.turnstile.remove(_capWidgetId); } catch (_e) {} _capWidgetId = null; }
      const w = host.getBoundingClientRect().width;
      try {
        _capWidgetId = window.turnstile.render(host, {
          sitekey: cfg.sitekey, theme: 'dark', size: w >= 300 ? 'flexible' : 'normal',
          callback: function (token) { _capSolved(token); },
          'error-callback': function () { _capFail('Ошибка капчи — попробуйте ещё раз'); },
        });
      } catch (_e) { _capFail('Ошибка капчи — попробуйте ещё раз'); }
    });
  }
  function _capSolved(token) {
    const fn = _capPending; _capPending = null;
    setTimeout(function () { _capCloseDialog(); if (fn) fn(token); }, 450);
  }
  function _capFail(text) {
    const e = _capOverlay && _capOverlay.querySelector('.zs-cap-err');
    if (e) { e.textContent = text; e.classList.remove('hidden'); }
  }
  function _capCloseDialog() {
    if (_capOverlay) _capOverlay.classList.remove('-open');
  }
  function _capCancel() {
    _capPending = null;
    _capCloseDialog();
  }
  function _captchaThenAction(fn) {
    _capFetchCfg().then(function (cfg) {
      if (!cfg || !cfg.enabled) { fn(''); return; }
      _capPending = fn;
      _capShowDialog(cfg);
    });
  }

  function renderSigScreen(user) {
    setTimeout(function(){ _renderPromoBanner(); }, 0);
    let profile = null;
    try { profile = JSON.parse(localStorage.getItem('lzt_user') || 'null'); } catch (e) {}
    const credits = Math.max(0, Math.floor(Number(
      user && user.credits != null ? user.credits : (profile && profile.credits)
    ) || 0));
    const bonus = Math.max(0, Math.floor(Number(
      user && user.bonus != null ? user.bonus :
      (user && user.bonus_credits != null ? user.bonus_credits :
      (profile && (profile.bonus != null ? profile.bonus : profile.bonus_credits)))
    ) || 0));
    const paymentUser = Object.assign({}, user, { credits: credits, bonus: bonus, bonus_credits: bonus });
    const hasBonus = bonus > 0;
    if (!hasBonus) bonusOn = false;
    const price = Math.max(TARIFFS[selTid].price - _orderPromoDiscount(), 0);
    const pay = calcPay(paymentUser, price);
    const bonusApplied = bonusOn ? Math.min(bonus, price) : 0;
    const rubNeeded = Math.max(0, price - bonusApplied);
    const deficit = Math.max(0, rubNeeded - credits);
    const notEnough = deficit > 0;
    const sigHtml = sigState
      ? `<div class="zs-sig-prev">
          <img src="${sigState.dataURL}" alt="подпись">
          <div class="zs-sig-txt">
            <span class="zs-sig-ok">${svg('ok')} Подпись сохранена</span>
            <button class="zs-sig-edit" data-zs-call="ZSModals._openPad()">Изменить</button>
          </div>
        </div>`
      : `<button class="zs-sig-place" data-zs-call="ZSModals._openPad()">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
          <span>Добавить подпись</span>
        </button>`;
    const bonusRow = hasBonus
      ? `<div class="r">
          <div class="k">Списать бонусы</div>
          <div class="zs-act">
            <span class="zs-bonus-val">${bonusVal(pay)}</span>
            <div class="zs-sw sm${bonusOn ? ' zs-on' : ''}" data-zs-call="ZSModals._toggleBonus()"><i></i></div>
          </div>
        </div>
        <div class="line"></div>`
      : `<div class="line"></div>`;
    return `<div class="zs-modal-top">
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Промокод</span></div>
        <div class="zs-promo-row">
          <input class="zs-promo-inp" id="promoInp" type="text" placeholder="Введите промокод" autocomplete="off" value="${promoVal}">
          <button class="zs-ghost" data-zs-call="ZSModals._applyPromo()">Применить</button>
        </div>
        <div class="zs-promo-msg" id="promoMsg"></div>
      </div>
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Подпись</span></div>
        <div class="zs-sig">${sigHtml}</div>
      </div>
      <div class="zs-group zs-gap-lg">
        <div class="zs-bonus-wrap">
          <div class="zs-bonus${bonusOn && hasBonus ? ' on' : ''}">
            ${bonusRow}
            <div class="tot">
              <div class="k2">Итого</div>
              <div class="v2"><span class="n">${number(pay.remain)}</span><span class="c">₽</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="zs-group zs-agree-group">
        <div class="zs-agree${agreeOn ? ' on' : ''}" id="agreeBox" role="checkbox" aria-checked="${agreeOn}" tabindex="0" data-zs-call="ZSModals._toggleAgree()">
          <div class="zs-agree-box">${svg('check')}</div>
          <div class="zs-agree-txt">Я согласен с <a href="#" style="color:#34D399;text-decoration:none;transition:color .15s" onmouseover="this.style.color='#5CEEB4'" onmouseout="this.style.color='#34D399'" onclick="event.preventDefault();event.stopPropagation();ZSModals._openTos(event)">условиями оплаты</a> и <a href="#" style="color:#34D399;text-decoration:none;transition:color .15s" onmouseover="this.style.color='#5CEEB4'" onmouseout="this.style.color='#34D399'" onclick="event.preventDefault();event.stopPropagation();ZSModals._openTos(event)">правилами сервиса</a></div>
        </div>
      </div>
    </div>
    <div class="zs-c-nav">
      <button class="zs-btn zs-c-back" data-zs-call="ZSModals._backStep()">Назад</button>
      ${notEnough
        ? `<button class="zs-btn light" data-zs-call="ZSModals._topupDeficit()">Пополнить на ${number(deficit)} ₽</button>`
        : `<button class="zs-btn light" data-zs-call="ZSModals._startOrder()">Начать сбор</button>`}
    </div>
    ${notEnough
      ? `<div class="zs-err" id="balErr" style="margin-top:8px">${svg('warn')} <span>Недостаточно средств: не хватает ${number(deficit)} ₽</span></div>`
      : ''}
    <div class="zs-err hidden" id="sigErr" style="margin-top:8px">${svg('warn')} <span>Оставьте подпись и примите условия</span></div>`;
  }

  /* ─── progress screen (sProg из order-modal-v4.html) ─── */
  function renderProgress(totalSec) {
    return `<div class="zs-stat">
      <div class="zs-stat-ic" id="statIc">
        <svg class="zs-ring" viewBox="0 0 68 68">
          <circle class="track" cx="34" cy="34" r="31" fill="none" stroke-width="3"/>
          <circle class="fill" id="progRing" cx="34" cy="34" r="31" fill="none" stroke-width="3" stroke-dasharray="194.8" stroke-dashoffset="194.8"/>
        </svg>
        <span class="zs-pct" id="progPct">0%</span>
        <svg class="zs-check" viewBox="0 0 30 30" fill="none"><path d="M8 15.4l4.3 4.2 9.7-10" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="zs-stat-txt">
        <div class="zs-stat-lab" id="progLab">Создаём заказ</div>
        <div class="zs-stat-big" id="progStage">Профиль</div>
      </div>
    </div>
    <div class="zs-card" id="progCards"></div>
    <div class="zs-row2">
      <button class="zs-btn" type="button" id="progBtn" data-zs-call="ZSModals._minimize()">Свернуть в фон</button>
    </div>`;
  }

  /* ─── done screen ─── */
  function renderDone(orderId) {
    return `<div class="zs-stat">
      <div class="zs-stat-ic ok">
        <svg class="zs-check" viewBox="0 0 30 30"><path d="M15 3C8.37 3 3 8.37 3 15s5.37 12 12 12 12-5.37 12-12S21.63 3 15 3zm-1.5 17.25l-6-6 1.76-1.76 4.24 4.24 8.24-8.24 1.76 1.76-10 10z" fill="#fff"/></svg>
      </div>
      <div class="zs-stat-txt">
        <div class="zs-stat-lab">Заказ готов</div>
        <div class="zs-stat-big">Досье собрано</div>
      </div>
    </div>
    <div class="zs-actions">
      <button class="zs-btn light" data-zs-call="ZSModals._viewDossier('${orderId}')">Посмотреть досье</button>
      <button class="zs-btn" data-zs-call="ZSModals.close()">Закрыть</button>
    </div>`;
  }

  /* ─── topup payment screen ─── */
  function renderTopupForm() {
    return `<div class="zs-modal-top">
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Способ пополнения</span></div>
        <div class="zs-methods">
          <div class="zs-m-top">
            <div class="zs-m-sel active" data-zs-call="ZSModals._pickMethod('lolz')">
              <div class="zs-m-row">
                <div class="zs-m-ic"><img src="/logolzt.svg" alt="" style="width:26px;height:26px;display:block"></div>
                <div class="zs-m-txt"><div class="zs-m-name">Lolzteam</div><div class="zs-m-sub">Мгновенное пополнение</div></div>
              </div>
            </div>
          </div>
          <div class="zs-m-bot">
            <div class="zs-m-sel disabled" style="cursor:default">
              <div class="zs-m-row">
                <div class="zs-m-ic crypto"><img src="/logo-4crypto.svg" alt="" style="width:26px;height:26px;display:block"></div>
                <div class="zs-m-txt"><div class="zs-m-name">Криптовалюта</div><div class="zs-m-sub">Скоро</div></div>
              </div>
              <div class="zs-soon">Скоро</div>
            </div>
          </div>
        </div>
      </div>
      <div class="zs-group">
        <div class="zs-lab-row"><span class="zs-label">Сумма пополнения</span></div>
        <div class="zs-amount-wrap">
          <div class="zs-amount"><div class="zs-amount-in"><span class="zs-cur">₽</span><span class="zs-num" contenteditable="true" id="topupAmount" role="textbox" inputmode="numeric" oninput="ZSModals._onAmountInput(this)" onkeydown="ZSModals._onAmountKeydown(event)">100</span></div></div>
        </div>
      </div>
    </div>
    <div class="zs-actions">
      <div class="zs-err hidden" id="topupErr">${svg('warn')} Введите сумму от 10 ₽</div>
      <button class="zs-btn light" data-zs-call="ZSModals._submitTopup()">Пополнить</button>
      <div class="zs-terms">Пополняя счёт, вы соглашаетесь с <a href="#" onclick="ZSModals._openTos(event)">условиями сервиса</a></div>
    </div>`;
  }

  /* ─── topup waiting screen ─── */
  function renderTopupWait() {
    const intent = topupState && topupState.intent ? topupState.intent : null;
    const creating = !(intent && intent.url);
    return `<div class="zs-stat" style="margin-bottom:8px">
      <div class="zs-stat-ic wait">
        <svg viewBox="0 0 42 42" fill="none" style="transform:rotate(-10deg)">
          <circle cx="21" cy="21" r="15.75" fill="url(#clockg)"/>
          <path d="M21 15.5v6.1l4.2 2.4" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
          <defs><radialGradient id="clockg" cx=".5" cy="-.007" r="1.007"><stop offset=".169" stop-color="#3A3C41"/><stop offset=".912" stop-color="#282A2D"/></radialGradient></defs>
        </svg>
      </div>
      <div class="zs-stat-txt">
        <div class="zs-stat-lab">${creating ? 'Подготовка платежа' : 'Счёт истечёт через'}</div>
        ${creating
          ? `<div class="zs-stat-big zs-topup-creating shimmer">Создаём счёт…</div>`
          : `<div class="zs-stat-big" id="topupTimer">10:00</div>`}
      </div>
    </div>
    <div class="zs-transfer-card">
      <div class="zs-tf-row"><div class="zs-tf-k">Сумма</div><div class="zs-tf-v">${number(topupState ? topupState.amount : 0)} ₽</div></div>
      <div class="zs-tf-sep"></div>
      <div class="zs-tf-row"><div class="zs-tf-k">Способ</div><div class="zs-tf-v">Lolz Market</div></div>
    </div>
    <div class="zs-actions zs-pay-actions">
      ${creating
        ? `<button class="zs-btn zs-wait" type="button" disabled><span class="shimmer">Подготовка платежа…</span></button>`
        : `<button class="zs-btn light" onclick="ZSModals._openInvoice()">Оплатить</button>`}
      <div class="zs-err hidden" id="topupPollErr">${svg('warn')} <span></span></div>
      <button class="zs-btn danger" data-zs-call="ZSModals._cancelTopup()">Отменить</button>
    </div>`;
  }

  /* ─── topup success screen ─── */
  function renderTopupDone() {
    return `<div class="zs-stat">
      <div class="zs-stat-ic ok">
        <svg class="zs-check" viewBox="0 0 30 30"><path d="M15 3C8.37 3 3 8.37 3 15s5.37 12 12 12 12-5.37 12-12S21.63 3 15 3zm-1.5 17.25l-6-6 1.76-1.76 4.24 4.24 8.24-8.24 1.76 1.76-10 10z" fill="#fff"/></svg>
      </div>
      <div class="zs-stat-txt">
        <div class="zs-stat-lab">Пополнение</div>
        <div class="zs-stat-big zs-topup-done-title">Счёт пополнен</div>
      </div>
    </div>
<div class="zs-actions">
      <button class="zs-btn light" data-zs-call="ZSModals._topupDone()">${topupResume ? 'Продолжить заказ' : 'Готово'}</button>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════════════════ */

  function runOrderPreflight(user) {
    const seq = ++preflightSeq;
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const API = window.ZSDashboard2.apiBase;
    const userId = user && (user.user_id || user.id);
    if (!userId) return;
    fetch(API + '/api/orders/existing?user_id=' + encodeURIComponent(userId), {
      headers: { 'Authorization': 'Bearer ' + token },
    })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (seq !== preflightSeq || !cur) return;
      const existing = data && data.owned;
      if (!existing || !existing.order_id) return;
      preflightOwned = existing;
      refreshMode = true;
      refreshSourceId = existing.order_id;
      orderOpts.refresh = true;
      orderOpts.source_order_id = existing.order_id;
      const ownedType = existing.report_type === 'full' || existing.report_type === 'pro' ? 'pro' : 'basic';
      tariffLock = ownedType === 'pro' ? 'pro' : null;
      selTid = ownedType;
      const bodyEl = qs(cur, '.zs-modal-body');
      if (bodyEl) bodyEl.innerHTML = renderOrder(user);
      _visInd(true);
    })
    .catch(function () {});
  }

  function openOrder(user, opts) {
    _orderPromo = null;
    _capWidgetId = null;
    ZSModals.close();
    bonusOn = false;
    opts = opts || {};
    orderOpts = Object.assign({}, opts);
    if (!user) return;
    if (opts.source) user._selectionSource = opts.source;
    tariffLock = opts.tariff === 'pro' ? 'pro' : null;
    refreshMode = !!opts.refresh;
    refreshSourceId = (opts && opts.source_order_id) || null;
    selTid = tariffLock || _rememberedTariff() || 'basic';
    sigState = null;
    agreeOn = false;
    promoVal = '';
    visSel = 'private';
    if (user.bonus == null) {
      var b = Number(window.__zsBonus) || 0;
      if (!b) {
        try { var lp = JSON.parse(localStorage.getItem('lzt_user') || 'null'); b = (lp && Number(lp.bonus_credits)) || 0; } catch (e) {}
      }
      user.bonus = b;
    }
    _closePad();
    const bg = makeModal('Собрать досье', renderOrder(user));
    cur = bg;
    _visInd(true);
    runOrderPreflight(user);
  }

  function renderAccountPromo() {
    return `<div class="zs-modal-top zs-account-promo">
      <div class="zs-group">
        <label class="zs-label" for="zsAccountPromoCode">Промокод</label>
        <input class="zs-account-promo-input" id="zsAccountPromoCode" type="text" placeholder="Промокод" autocomplete="off" spellcheck="false">
        <div class="zs-err zs-account-promo-message" id="zsAccountPromoMessage" role="alert" hidden></div>
      </div>
      <div class="zs-actions"><button class="zs-btn light" id="zsAccountPromoSubmit" type="button">Активировать</button></div>
    </div>`;
  }

  function accountPromoHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const token = localStorage.getItem('lzt_token') || '';
      if (token) headers.Authorization = 'Bearer ' + token;
    } catch (_) {}
    return headers;
  }

  function openAccountPromo(trigger) {
    ZSModals.close();
    const bg = makeModal('Промокод', renderAccountPromo());
    cur = bg;
    cur._zsReturnFocus = trigger && trigger.nodeType === 1 ? trigger : document.activeElement;
    const input = qs(cur, '#zsAccountPromoCode');
    const submit = qs(cur, '#zsAccountPromoSubmit');
    if (input) input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); _redeemAccountPromo(); }
    });
    if (submit) submit.addEventListener('click', _redeemAccountPromo);
    setTimeout(function () { if (input) input.focus(); }, 60);
  }

  function _redeemAccountPromo() {
    if (!cur || cur._zsPromoSubmitting) return;
    const input = qs(cur, '#zsAccountPromoCode');
    const message = qs(cur, '#zsAccountPromoMessage');
    const code = input ? input.value.trim() : '';
    if (!code) {
      if (message) { message.hidden = false; message.textContent = 'Введите промокод'; }
      return;
    }
    _captchaThenAction(function (capToken) { _redeemAccountPromoDo(code, capToken); });
  }

  async function _redeemAccountPromoDo(code, capToken) {
    if (!cur || cur._zsPromoSubmitting) return;
    const submit = qs(cur, '#zsAccountPromoSubmit');
    const message = qs(cur, '#zsAccountPromoMessage');
    const showError = function (text) { if (message) { message.hidden = false; message.textContent = text; } };
    cur._zsPromoSubmitting = true;
    if (submit) submit.disabled = true;
    if (message) { message.hidden = true; message.textContent = ''; }
    try {
      const headers = accountPromoHeaders();
      headers['X-Turnstile-Token'] = capToken || '';
      const response = await fetch(API + '/api/my/redeem-promo', {
        method: 'POST', headers: headers, credentials: 'same-origin', body: JSON.stringify({ code: code })
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (response.status === 401) throw new Error('Сессия истекла. Войдите снова.');
      if (!response.ok) throw new Error(data.error || data.message || 'Не удалось активировать промокод');
      const profileResponse = await fetch(API + '/api/my/profile', { headers: accountPromoHeaders(), credentials: 'same-origin' });
      if (profileResponse.status === 401) throw new Error('Сессия истекла. Войдите снова.');
      if (!profileResponse.ok) throw new Error('Не удалось обновить профиль');
      const profile = await profileResponse.json();
      try { localStorage.setItem('lzt_user', JSON.stringify(profile)); } catch (_) {}
      if (typeof window.zsRenderAccount === 'function') window.zsRenderAccount(profile);
      document.dispatchEvent(new CustomEvent('zs:profile', { detail: profile }));
      ZSModals.close();
      const credited = Number(data.bonus != null ? data.bonus : (data.credited != null ? data.credited : data.amount));
      const notice = {
        type: 'success',
        title: 'Промокод активирован',
        detail: Number.isFinite(credited) && credited > 0 ? ('+' + credited + ' Б зачислено на бонусный счёт') : 'Баланс обновлён'
      };
      if (window.ZSNotice && typeof window.ZSNotice.show === 'function') window.ZSNotice.show(notice);
      else if (typeof window.zsNotify === 'function') window.zsNotify(notice);
    } catch (error) {
      showError(error && error.message ? error.message : 'Сервер недоступен. Попробуйте ещё раз.');
    } finally {
      if (cur) cur._zsPromoSubmitting = false;
      if (submit) submit.disabled = false;
    }
  }

  function openTopup(amount) {
    ZSModals.close();
    topupState = { method: 'lolz', amount: amount || 100, intent: null };
    const bg = makeModal('Пополнение счёта', renderTopupForm());
    cur = bg;
    const inp = qs(cur, '#topupAmount');
    if (inp) { inp.textContent = amount || 100; }
  }

  function close() {
    preflightSeq++;
    preflightOwned = null;
    if (progTimer) { clearInterval(progTimer); progTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
    if (topupPollTimer) { clearInterval(topupPollTimer); topupPollTimer = null; }
    if (topupTimerInt) { clearInterval(topupTimerInt); topupTimerInt = null; }
    removeMini();
    minimized = false;
    _closePad();
    if (cur) {
      cur.classList.remove('open');
      cur.classList.remove('zs-min');
      var c = cur;
      setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 300);
      cur = null;
      const returnFocus = c._zsReturnFocus;
      if (returnFocus && typeof returnFocus.focus === 'function') setTimeout(function () { returnFocus.focus(); }, 0);
      window.dispatchEvent(new CustomEvent('zs:order-closed'));
    }
  }

  /* ─── internal (exposed for onclick) ─── */

  function _pickTariff(id) {
    if (!TARIFFS[id]) return;
    if (tariffLock && id !== tariffLock) return;
    selTid = id;
    // Запоминаем последний тариф на сервере, если включена настройка.
    _persistLastTariff(id);
    if (!cur) return;
    const btns = qs(cur, '.zs-tariffs');
    if (!btns) return;
    Array.from(btns.children).forEach(function (b) {
      b.classList.toggle('on', b.dataset.tid === id);
      const wrap = b.querySelector('.zs-t-list-wrap');
      if (wrap && b.dataset.tid !== id) wrap.classList.remove('expanded');
    });
    expandedTid = null;
    // если мы на экране подписи — перерисовать
    if (qs(cur, '.zs-sig')) {
      const user = window.selectedUser || window._lastSelectedUser;
      const inp = qs(cur, '#promoInp');
      if (inp) promoVal = inp.value;
      const bodyEl = qs(cur, '.zs-modal-body');
      if (bodyEl) bodyEl.innerHTML = renderSigScreen(user);
      const inp2 = qs(cur, '#promoInp');
      if (inp2) inp2.value = promoVal;
    } else {
      // экран 1 — обновить бонус-блок напрямую
      const bonusEl = qs(cur, '.zs-bonus');
      if (bonusEl) {
        const t = TARIFFS[id];
        const pay = calcPay(user, t.price);
        bonusEl.querySelector('.r .k').textContent = `Списать бонусы`;
        bonusEl.querySelector('.zs-bonus-val').innerHTML = bonusVal(pay);
        bonusEl.querySelector('.v2 .n').textContent = number(pay.remain);
        const c0 = bonusEl.querySelector('.v2 .c');
        if (c0) c0.textContent = '₽';
      }
    }
  }

  function _toggleBonus() {
    bonusOn = !bonusOn;
    // если мы на экране подписи — перерисовать
    if (cur && qs(cur, '.zs-sig')) {
      const user = window.selectedUser || window._lastSelectedUser;
      const inp = qs(cur, '#promoInp');
      if (inp) promoVal = inp.value;
      const bodyEl = qs(cur, '.zs-modal-body');
      if (bodyEl) bodyEl.innerHTML = renderSigScreen(user);
      const inp2 = qs(cur, '#promoInp');
      if (inp2) inp2.value = promoVal;
      _visInd(true);
    } else {
      updateOrderTotal();
    }
  }

  function _toggleFeatures(id) {
    expandedTid = expandedTid === id ? null : id;
    if (!cur) return;
    Array.from(qs(cur, '.zs-tariffs').children).forEach(function (b) {
      const wrap = b.querySelector('.zs-t-list-wrap');
      if (!wrap) return;
      if (b.dataset.tid === expandedTid) {
        wrap.classList.add('expanded');
        const btn = wrap.querySelector('.zs-t-expand');
        if (btn) btn.querySelector('i').textContent = '×';
      } else {
        wrap.classList.remove('expanded');
        const btn = wrap.querySelector('.zs-t-expand');
        if (btn) btn.querySelector('i').textContent = '›';
      }
    });
  }

  /* ─── доступ к досье (pills) ─── */
  function _visInd(instant) {
    const wrap = qs(cur, '#visPills');
    const ind = qs(cur, '#visInd');
    if (!wrap || !ind) return;
    const btns = wrap.querySelectorAll('button');
    const idx = VIS_OPTS.findIndex(function (o) { return o.id === visSel; });
    const btn = btns[idx < 0 ? 0 : idx];
    if (!btn) return;
    if (instant) ind.style.transition = 'none';
    ind.style.left = btn.offsetLeft + 'px';
    ind.style.width = btn.offsetWidth + 'px';
    if (instant) requestAnimationFrame(function () { ind.style.transition = ''; });
  }

  function _setVis(id) {
    if (!cur || visSel === id) return;
    visSel = id;
    const wrap = qs(cur, '#visPills');
    if (wrap) {
      wrap.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.vid === id); });
      _visInd(false);
    }
  }

  /* ─── экраны (шаг 1 → шаг 2) ─── */
  function _nextStep() {
    if (!cur) return;
    const bodyEl = qs(cur, '.zs-modal-body');
    if (!bodyEl) return;
    const user = window.selectedUser || window._lastSelectedUser;
    bodyEl.innerHTML = renderSigScreen(user);
    const inp = qs(cur, '#promoInp');
    if (inp) inp.value = promoVal;
    _visInd(true);
  }

  /* «умная кнопка»: оплата бонусами, но их не хватает — сразу открываем
     пополнение на недостающую сумму и после успеха возвращаемся в заказ. */
  function _topupDeficit() {
    if (!cur) return;
    const user = window.selectedUser || window._lastSelectedUser;
    if (!user) { alert('Выберите пользователя'); return; }
    const price = TARIFFS[selTid].price;
    let profile = null;
    try { profile = JSON.parse(localStorage.getItem('lzt_user') || 'null'); } catch (e) {}
    const credits = Math.max(0, Math.floor(Number(
      user.credits != null ? user.credits : (profile && profile.credits)
    ) || 0));
    const bonus = Math.max(0, Math.floor(Number(
      user.bonus != null ? user.bonus :
      (user.bonus_credits != null ? user.bonus_credits : (profile && profile.bonus_credits))
    ) || 0));
    const bonusApplied = bonusOn ? Math.min(bonus, price) : 0;
    const deficit = Math.max(0, price - bonusApplied - credits);
    if (deficit <= 0) { _startOrder(); return; }
    // после пополнения — вернуться и оформить заказ с тем же тарифом
    pendingOrder = { user: user, opts: { tariff: selTid, refresh: refreshMode || undefined, source_order_id: refreshSourceId || undefined } };
    topupResume = function () {
      const po = pendingOrder;
      topupResume = null;
      pendingOrder = null;
      ZSModals.close();
      if (!po) return;
      const u = Object.assign({}, po.user);
      const bb = Number(window.__zsBonus);
      if (!isNaN(bb)) u.bonus = bb;
      else { try { const lp = JSON.parse(localStorage.getItem('lzt_user') || 'null'); if (lp && lp.bonus_credits) u.bonus = Number(lp.bonus_credits); } catch (e) {} }
      const opts = po.opts || {};
      if (!opts.tariff) opts.tariff = selTid;
      openOrder(u, opts);
    };
    openTopup(Math.max(deficit, 10));
  }

  function _backStep() {
    if (!cur) return;
    const bodyEl = qs(cur, '.zs-modal-body');
    if (!bodyEl) return;
    const user = window.selectedUser || window._lastSelectedUser;
    const inp = qs(cur, '#promoInp');
    if (inp) promoVal = inp.value;
    bodyEl.innerHTML = renderOrder(user);
    _visInd(true);
  }

  /* ─── промокод ─── */
  function _applyPromo() {
    if (!cur) return;
    const inp = qs(cur, '#promoInp');
    if (!inp) return;
    const code = inp.value.trim();
    promoVal = inp.value;
    const msg = qs(cur, '#promoMsg');
    if (!msg) return;
    if (!code) { _orderPromo = null; msg.textContent = ''; msg.className = 'zs-promo-msg'; return; }
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const API = window.ZSDashboard2.apiBase;
    // капча поверх, затем применение промокода с токеном
    _captchaThenAction(function (capToken) { _applyPromoDo(code, capToken, msg); });
  }
  function _applyPromoDo(code, capToken, msg) {
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const API = window.ZSDashboard2.apiBase;
    msg.textContent = 'Применяем…';
    msg.className = 'zs-promo-msg show';
    // сначала пробуем как скидку на заказ (preview ничего не списывает)
    fetch(API + '/api/orders/promo-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ code: code, report_type: selTid === 'pro' ? 'full' : 'basic' }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        // one_order_promo_v1: скидка на заказ может быть только одна —
        // если уже применён другой скидочный промокод, новый не применяем
        if (_orderPromo && _orderPromo.on !== false && _orderPromo.code !== code.toUpperCase()) {
          msg.textContent = 'Уже применена скидка ' + _orderPromo.code + ' — отключите её тумблером, чтобы применить другую';
          msg.className = 'zs-promo-msg show err';
          return;
        }
        _orderPromo = { code: code.toUpperCase(), discount: Number(res.data.discount) || 0, percent: Number(res.data.percent) || null, cost: TARIFFS[selTid].price, on: true };
        const user2 = window.selectedUser || window._lastSelectedUser;
        if (qs(cur, '.zs-sig') && user2) {
          const bodyEl = qs(cur, '.zs-modal-body');
          if (bodyEl) {
            bodyEl.innerHTML = renderSigScreen(user2);
            const inp2 = qs(cur, '#promoInp');
            if (inp2) inp2.value = promoVal;
            _visInd(true);
          }
        }
        return;
      }
      // не скидочный — пробуем как бонус-промокод
      _applyBonusPromo(code, capToken, token, API, msg);
    })
    .catch(function () { _applyBonusPromo(code, capToken, token, API, msg); });
    return;
  }
  function _applyBonusPromo(code, capToken, token, API, msg) {
fetch(API + '/api/my/redeem-promo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Turnstile-Token': capToken },
      body: JSON.stringify({ code: code }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (!res.ok) throw new Error(res.data.error || 'Промокод не найден');
      const got = Number(res.data.bonus) || 0;
      const user = window.selectedUser || window._lastSelectedUser;
      if (user) user.bonus = (user.bonus || 0) + got;
      window.__zsBonus = (Number(window.__zsBonus) || 0) + got;
      msg.textContent = 'Промокод применён: +' + got + ' Б';
      msg.className = 'zs-promo-msg show';
      // если бонусов раньше не было — перерисовать шаг, чтобы показать бонус-блок
      const user2 = window.selectedUser || window._lastSelectedUser;
      if (qs(cur, '.zs-sig') && user2 && !bonusOn) {
        const bodyEl = qs(cur, '.zs-modal-body');
        if (bodyEl) {
          bodyEl.innerHTML = renderSigScreen(user2);
          const inp2 = qs(cur, '#promoInp');
          if (inp2) inp2.value = promoVal;
          _visInd(true);
        }
      }
    })
    .catch(function (err) {
      msg.textContent = err.message || 'Сервер недоступен';
      msg.className = 'zs-promo-msg show err';
    });

  }

  /* ─── чекбокс согласия ─── */
  function _toggleAgree() {
    agreeOn = !agreeOn;
    if (!cur) return;
    const box = qs(cur, '#agreeBox');
    if (box) { box.classList.toggle('on', agreeOn); box.setAttribute('aria-checked', agreeOn); }
  }

  /* ─── пэд подписи ─── */
  function effectiveVariant() {
    return window.innerWidth <= 720 ? 'd' : 'b';
  }

  function ensurePadUi() {
    if (padUiReady) return;
    padUiReady = true;
    const ov = el('div', 'zs-overlay');
    ov.id = 'zsOverlay';
    ov.innerHTML = `<div class="zs-pad-card">
        <div class="zs-pad-head">
          <div class="zs-pad-title">Подпись</div>
          <button class="zs-pad-x" data-x="b" type="button" data-zs-call="ZSModals._cancelPad('b')">${svg('x')}</button>
        </div>
        <div class="zs-pad hidden" id="zsHostB"></div>
      </div>`;
    ov.addEventListener('click', function (e) { if (e.target === this) ZSModals._cancelPad('b'); });
    document.body.appendChild(ov);

    const sc = el('div', 'zs-scrim');
    sc.id = 'zsScrim';
    sc.addEventListener('click', function () { ZSModals._closePad(); });
    document.body.appendChild(sc);

    const sh = el('div', 'zs-sheet');
    sh.innerHTML = `<div class="zs-sheet-card">
        <div class="zs-grab"></div>
        <div class="zs-pad-head">
          <div class="zs-pad-title">Подпись</div>
          <button class="zs-pad-x" data-x="d" type="button" data-zs-call="ZSModals._cancelPad('d')">${svg('x')}</button>
        </div>
        <div class="zs-pad hidden" id="zsHostD"></div>
      </div>`;
    document.body.appendChild(sh);
  }

  function buildPad(hostId, opts) {
    const host = document.getElementById(hostId);
    host.classList.remove('hidden');
    host.innerHTML =
      '<div class="zs-pad-cv">' +
        '<canvas></canvas>' +
        '<button class="zs-pad-clear" type="button" title="Очистить"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg></button>' +
        '<div class="zs-pad-err hidden">Подпись слишком маленькая — напишите её целиком</div>' +
      '</div>' +
      '<div class="zs-pad-tools">' +
        '<div class="zs-brush-row">' +
          '<button class="zs-brush" data-w="1.5" type="button"><i style="width:4px;height:4px"></i></button>' +
          '<button class="zs-brush on" data-w="2.5" type="button"><i style="width:7px;height:7px"></i></button>' +
          '<button class="zs-brush" data-w="4" type="button"><i style="width:10px;height:10px"></i></button>' +
        '</div>' +
        '<div class="zs-pad-actions">' +
          '<button class="zs-b zs-b-ghost zs-cancel" type="button">Отмена</button>' +
          '<button class="zs-b zs-b-primary zs-done" type="button">Готово</button>' +
        '</div>' +
      '</div>' +
      '<div class="zs-confirm hidden">' +
        '<span>Подпись не будет сохранена</span>' +
        '<div class="c-actions">' +
          '<button class="c-no" type="button">Всё равно закрыть</button>' +
          '<button class="c-yes" type="button">Продолжить редактирование</button>' +
        '</div>' +
      '</div>';
    const canvas = host.querySelector('canvas');
    const wrap = host.querySelector('.zs-pad-cv');
    const ctx = canvas.getContext('2d');
    const doneBtn = host.querySelector('.zs-done');
    const clearBtn = host.querySelector('.zs-pad-clear');
    const cancelBtn = host.querySelector('.zs-cancel');
    const errEl = host.querySelector('.zs-pad-err');
    const confirmEl = host.querySelector('.zs-confirm');

    const pad = {
      strokes: [], cur: null, drawing: false, w: 2.5, raf: false, confirmShown: false,

      resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
      },

      draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#EBEBEB';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of this.strokes) {
          const pts = s.pts;
          ctx.lineWidth = s.w;
          ctx.beginPath();
          if (pts.length === 1) {
            ctx.fillStyle = '#EBEBEB';
            ctx.arc(pts[0].x, pts[0].y, s.w, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
          }
          ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          ctx.stroke();
        }
      },

      paintedLen() {
        let sum = 0;
        for (const s of this.strokes) {
          if (s.pts.length === 1) { sum += s.w * 2; continue; }
          for (let i = 1; i < s.pts.length; i++) sum += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
        }
        return sum;
      },

      valid() { return this.strokes.length > 0 && this.paintedLen() >= 50; },

      export() { return JSON.parse(JSON.stringify(this.strokes)); },

      getTrimmed() {
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const s of this.strokes) for (const p of s.pts) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        if (maxX === -1e9) return '';
        const padX = 8;
        minX = Math.max(0, Math.floor(minX - padX)); minY = Math.max(0, Math.floor(minY - padX));
        maxX = Math.ceil(maxX + padX); maxY = Math.ceil(maxY + padX);
        const W = maxX - minX, H = maxY - minY, dpr = window.devicePixelRatio || 1;
        const c = document.createElement('canvas');
        c.width = W * dpr; c.height = H * dpr;
        const x = c.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.strokeStyle = '#EBEBEB'; x.lineCap = 'round'; x.lineJoin = 'round';
        x.translate(-minX, -minY);
        for (const s of this.strokes) {
          const pts = s.pts; x.lineWidth = s.w; x.beginPath();
          if (pts.length === 1) { x.fillStyle = '#EBEBEB'; x.arc(pts[0].x, pts[0].y, s.w, 0, Math.PI * 2); x.fill(); continue; }
          x.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) x.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
          x.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
          x.stroke();
        }
        return c.toDataURL('image/png');
      },

      updateButtons() {
        doneBtn.disabled = !this.strokes.length;
        clearBtn.classList.toggle('visible', !!this.strokes.length);
      },

      clear() {
        this.strokes = [];
        this.resetConfirm();
        errEl.classList.add('hidden');
        this.draw();
        this.updateButtons();
      },

      load(s) {
        this.strokes = s ? s.slice() : [];
        this.resetConfirm();
        errEl.classList.add('hidden');
        this.draw();
        this.updateButtons();
      },

      showConfirm() { confirmEl.classList.remove('hidden'); this.confirmShown = true; },
      resetConfirm() { confirmEl.classList.add('hidden'); this.confirmShown = false; },

      shake() {
        wrap.classList.add('shake');
        errEl.classList.remove('hidden');
        setTimeout(() => wrap.classList.remove('shake'), 350);
      }
    };

    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pad.drawing = true;
      pad.cur = { pts: [{ x: e.offsetX, y: e.offsetY }], w: pad.w };
      pad.strokes.push(pad.cur);
      errEl.classList.add('hidden');
      pad.updateButtons();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!pad.drawing) return;
      pad.cur.pts.push({ x: e.offsetX, y: e.offsetY });
      if (!pad.raf) { pad.raf = true; requestAnimationFrame(function () { pad.raf = false; pad.draw(); }); }
    });
    function endStroke() { if (!pad.drawing) return; pad.drawing = false; pad.updateButtons(); }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    host.querySelectorAll('.zs-brush').forEach(function (b) {
      b.addEventListener('click', function () {
        host.querySelectorAll('.zs-brush').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        pad.w = parseFloat(b.dataset.w);
      });
    });

    clearBtn.addEventListener('click', function () { pad.clear(); });
    doneBtn.addEventListener('click', function () {
      if (!pad.valid()) { pad.shake(); return; }
      sigState = { strokes: pad.export(), dataURL: pad.getTrimmed(), len: pad.paintedLen() };
      _closePad();
      _renderSigSaved();
    });
    cancelBtn.addEventListener('click', function () {
      if (opts && opts.confirmOnCancel && pad.strokes.length && !pad.confirmShown) { pad.showConfirm(); return; }
      _closePad();
    });
    confirmEl.querySelector('.c-yes').addEventListener('click', function () { pad.resetConfirm(); });
    confirmEl.querySelector('.c-no').addEventListener('click', function () { _closePad(); });

    return pad;
  }

  function ensurePad(id, opts) {
    if (!pads[id]) pads[id] = buildPad(id, opts);
    return pads[id];
  }

  function _openPad() {
    ensurePadUi();
    const v = effectiveVariant();
    const id = SIG_HOSTS[v];
    const opts = v === 'b' ? { confirmOnCancel: true } : {};
    const p = ensurePad(id, opts);
    p.load(sigState ? sigState.strokes : []);
    requestAnimationFrame(function () { p.resize(); });
    if (v === 'b') {
      document.getElementById('zsOverlay').classList.add('show');
      if (cur) cur.inert = true;
    } else {
      document.getElementById('zsScrim').classList.add('show');
      document.getElementById('zsSheet').classList.add('show');
    }
  }

  function _closePad() {
    const ov = document.getElementById('zsOverlay');
    const sc = document.getElementById('zsScrim');
    const sh = document.getElementById('zsSheet');
    if (ov) ov.classList.remove('show');
    if (sc) sc.classList.remove('show');
    if (sh) sh.classList.remove('show');
    if (cur) cur.inert = false;
    Object.keys(pads).forEach(function (k) { pads[k].resetConfirm(); });
  }

  function _cancelPad(v) {
    const id = SIG_HOSTS[v];
    const p = id ? pads[id] : null;
    if (p && p.strokes.length && v === 'b' && !p.confirmShown) { p.showConfirm(); return; }
    _closePad();
  }

  function _renderSigSaved() {
    if (!cur) return;
    const bodyEl = qs(cur, '.zs-modal-body');
    if (!bodyEl) return;
    const user = window.selectedUser || window._lastSelectedUser;
    const inp = qs(cur, '#promoInp');
    if (inp) promoVal = inp.value;
    bodyEl.innerHTML = renderSigScreen(user);
    const inp2 = qs(cur, '#promoInp');
    if (inp2) inp2.value = promoVal;
    _visInd(true);
  }

  function _startOrder() {
    if (!cur) return;
    _captchaThenAction(_startOrderDo);
  }
  function _startOrderDo(token) {
    if (!cur) return;
    if (!sigState || !agreeOn) {
      const sigWrap = qs(cur, '.zs-sig');
      const errEl = qs(cur, '#sigErr');
      if (sigWrap) sigWrap.classList.add('shake');
      if (errEl) errEl.classList.remove('hidden');
      setTimeout(function () { if (sigWrap) sigWrap.classList.remove('shake'); }, 350);
      setTimeout(function () { if (errEl) errEl.classList.add('hidden'); }, 2600);
      return;
    }
    const user = window.selectedUser || window._lastSelectedUser;
    if (!user) { alert('Выберите пользователя'); return; }
    const t = TARIFFS[selTid];
    const bodyEl = qs(cur, '.zs-modal-body');
    if (!bodyEl) return;
    progSetTitle('Собираем досье');
    bodyEl.innerHTML = renderProgress(30);
    progBegin(user, selTid === 'pro');

    // POST /api/orders
    const payload = { user_id: user.user_id || user.id, username: user.username || '', username_html: user.username_html || '', avatar: user.avatar || '', report_type: selTid === 'pro' ? 'full' : 'basic', currency: 'rub', use_bonus: bonusOn && Number(user.bonus) > 0, visibility: visSel, signature_data: sigState ? sigState.dataURL : '', promo_code: (_orderPromo && _orderPromo.on !== false && _orderPromo.code) || '' };
    // обновление существующего досье: без известного source_order_id уходим в
    // обычную покупку — сервер вернёт 409 existing_report_choice_required
    if (refreshMode && refreshSourceId) { payload.refresh = true; payload.source_order_id = refreshSourceId; }
    const API = window.ZSDashboard2.apiBase;
    const purchaseKey = 'zs-' + String(payload.user_id) + '-' + payload.report_type + '-' + (refreshMode ? 'refresh-' : 'create-') + Date.now() + '-' + Math.random().toString(36).slice(2);
    fetch(API + '/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Idempotency-Key': purchaseKey, 'X-Turnstile-Token': token },
      body: JSON.stringify(payload),
    })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function (res) {
      if (!res.ok) {
        const code = res.data.code || (res.data.error && res.data.error.code);
        if (res.status === 409 && code === 'existing_report_choice_required') {
          _showExistingChoice(res.data, {
            payload: payload,
            user: user,
            token: token,
            API: API,
            purchaseKey: purchaseKey,
          });
          return null;
        }
        const err = new Error((typeof res.data.error === 'string' && res.data.error) || (res.data.error && res.data.error.message) || 'Ошибка создания заказа');
        err.data = res.data;
        throw err;
      }
      return res;
    })
    .then(function (res) {
      if (!res) return;
      if (!res.ok) throw new Error((typeof res.data.error === 'string' && res.data.error) || (res.data.error && res.data.error.message) || 'Ошибка создания заказа');
      const orderId = res.data.id || res.data.order_id;
      _markOrderInitiator(orderId); // автооткрытие сработает только в этой вкладке
      if (window.ZSNotice) ZSNotice.show({ type: 'info', title: refreshMode ? 'Досье обновляется' : 'Досье формируется', message: refreshMode ? 'Новые публичные данные и анализ будут сохранены.' : 'Мы начали сбор публичных данных. Статус появится в разделе «Мои досье».' });
      pollOrder(API, token, orderId, user);
    })
    .catch(function (err) {
      const msg = err.message || '';
      const failure = orderFailure(msg);
      if (window.ZSNotice) {
        ZSNotice.show({ type: failure.type, title: failure.title === 'Что-то пошло не так' ? 'Не удалось создать досье' : failure.title, message: failure.title === 'Что-то пошло не так' ? 'Попробуйте повторить действие. Если ошибка не исчезнет, обратитесь в поддержку.' : failure.message, duration: 0 });
      }
      // не хватает средств — отправляем в пополнение, после оплаты возврат в заказ
      if (/недоста/ig.test(msg)) {
        pendingOrder = { user: user, opts: { tariff: selTid, refresh: refreshMode || undefined, source_order_id: refreshSourceId || undefined } };
        const fm = msg.match(/(\d+)\s*₽/);
        const deficit = fm ? parseInt(fm[1], 10) : t.price;
        topupResume = function () {
          const po = pendingOrder;
          topupResume = null;
          pendingOrder = null;
          ZSModals.close();
          if (!po) return;
          // свежий баланс бонусов после пополнения
          const u = Object.assign({}, po.user);
          const bb = Number(window.__zsBonus);
          if (!isNaN(bb)) u.bonus = bb;
          else {
            try { const lp = JSON.parse(localStorage.getItem('lzt_user') || 'null'); if (lp && lp.bonus_credits) u.bonus = Number(lp.bonus_credits); } catch (e) {}
          }
          const opts = po.opts || {};
          if (!opts.tariff) opts.tariff = selTid;
          openOrder(u, opts);
        };
        openTopup(Math.max(deficit, 10));
        return;
      }
      progSetTitle('Собрать досье');
      bodyEl.innerHTML = renderSigScreen(user);
      const errEl = qs(cur, '#sigErr');
      if (errEl) {
        errEl.querySelector('span').textContent = msg;
        errEl.classList.remove('hidden');
      }
      const inp = qs(cur, '#promoInp');
      if (inp) inp.value = promoVal;
    });
  }

  function _showExistingChoice(data, ctx) {
    existingChoiceCtx = { data: data, payload: ctx.payload, user: ctx.user, token: ctx.token, API: ctx.API, purchaseKey: ctx.purchaseKey };
    const existing = (data && data.existing_report) || {};
    const actions = (data && data.actions) || {};
    const isOwned = data && data.choice_type === 'owned';
    const name = subjectName(ctx.user);
    const dateStr = fmtExistingDate(existing.finished_at);
    const tariff = reportTypeLabel(existing.report_type);
    const choiceRows = function (rows) {
      // простые строки: ключ слева, значение справа, без панели и фона
      return `<div class="zs-choice">` + rows.map(function (r) {
        return `<div class="zs-choice-row"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`;
      }).join('') + `</div>`;
    };
    let bodyHtml, title;
    if (isOwned) {
      title = 'У вас уже есть это досье';
      const curTier = existing.report_type || 'basic';
      const tierLabel = function (t) { return (t === 'full' || t === 'pro') ? 'Полный AI' : 'Базовый'; };
      // «текущий тариф или лучше»: список доступных тарифов обновления
      const tiers = (actions.refresh && Array.isArray(actions.refresh.tiers) && actions.refresh.tiers.length)
        ? actions.refresh.tiers
        : [{ type: curTier, cost: (actions.refresh && actions.refresh.cost != null) ? actions.refresh.cost : (TARIFFS[selTid] ? TARIFFS[selTid].price : 0) }];
      const curTierInfo = tiers.filter(function (t) { return (t.type === 'full' || t.type === 'pro') === (curTier === 'full'); })[0] || tiers[0];
      const upTierInfo = tiers.filter(function (t) { return t !== curTierInfo; })[0];
      const curBtnLabel = upTierInfo
        ? ('Обновить · ' + tierLabel(curTierInfo.type) + ' за ' + number(curTierInfo.cost) + ' ₽')
        : ('Обновить за ' + number(curTierInfo.cost) + ' ₽');
      const vis = visibilityLabel(existing.visibility);
      bodyHtml = `<div class="zs-modal-top">
        ${choiceRows([
          ['Пользователь', name],
          ['Тариф', tariff],
          ['Сформировано', dateStr],
          ['Доступ', vis],
        ])}
        <p class="zs-choice-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Обновление запускает новый платный сбор публичных данных и AI-анализ, а результат перезапишет ваше досье.</span></p>
        <div class="zs-row2">
          <button class="zs-btn light" id="zsChoiceOpen">Открыть досье</button>
          <button class="zs-btn" id="zsChoiceRefresh" data-tier="${curTierInfo.type === 'pro' ? 'pro' : curTierInfo.type}">${curBtnLabel}</button>
        </div>
        ${upTierInfo ? `<button class="zs-btn" id="zsChoiceUpgrade" data-tier="${upTierInfo.type === 'pro' ? 'pro' : upTierInfo.type}">Обновить · ${tierLabel(upTierInfo.type)} за ${number(upTierInfo.cost)} ₽</button>` : ''}
      </div>`;
    } else {
      title = 'Досье уже есть в «Общих»';
      const cost = (actions.create_own && actions.create_own.cost != null) ? actions.create_own.cost : (TARIFFS[selTid] ? TARIFFS[selTid].price : 0);
      bodyHtml = `<div class="zs-modal-top">
        ${choiceRows([
          ['Пользователь', name],
          ['Тариф', tariff],
          ['Сформировано', dateStr],
        ])}
        <p class="zs-choice-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Создание своего досье запускает независимый новый анализ — это отдельный платный заказ.</span></p>
        <div class="zs-row2">
          <button class="zs-btn light" id="zsChoiceOpen">Открыть общее</button>
          <button class="zs-btn" id="zsChoiceCreateOwn">Создать своё за ${number(cost)} ₽</button>
        </div>
      </div>`;
    }
    // если открыт прогресс-экран — вернём заголовок к нейтральному
    progSetTitle('Собрать досье');
    close();
    cur = makeModal(title, bodyHtml);
    const openBtn = qs(cur, '#zsChoiceOpen');
    if (openBtn) openBtn.addEventListener('click', function () { _openExisting(); });
    const refreshBtn = qs(cur, '#zsChoiceRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { _confirmRefresh(refreshBtn, refreshBtn.dataset.tier); });
    const upgradeBtn = qs(cur, '#zsChoiceUpgrade');
    if (upgradeBtn) upgradeBtn.addEventListener('click', function () { _confirmRefresh(upgradeBtn, upgradeBtn.dataset.tier); });
    const createOwnBtn = qs(cur, '#zsChoiceCreateOwn');
    if (createOwnBtn) createOwnBtn.addEventListener('click', function () { _confirmCreateOwn(createOwnBtn); });
  }

  function _openExisting() {
    const ctx = existingChoiceCtx;
    if (!ctx) return;
    const existing = (ctx.data && ctx.data.existing_report) || {};
    const openUrl = safeInternalUrl(existing.open_url || ('zelscan.html?order=' + encodeURIComponent(existing.order_id || '')));
    if (openUrl) window.location.assign(openUrl); // навигация, без POST и без списания
  }

  // повторный платный POST для выбранного действия (refresh / create_own)
  function _rePostChoice(extraBody, keySuffix, btn) {
    const ctx = existingChoiceCtx;
    if (!ctx) return;
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    const user = ctx.user;
    const body = Object.assign({}, ctx.payload, extraBody);
    refreshMode = !!extraBody.refresh;
    // переходим к прогресс-экрану как в основном сценарии
    const bodyEl = qs(cur, '.zs-modal-body');
    if (bodyEl) { progSetTitle('Собираем досье'); bodyEl.innerHTML = renderProgress(30); progBegin(user, selTid === 'pro'); }
    fetch(ctx.API + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ctx.token, 'Idempotency-Key': ctx.purchaseKey + keySuffix },
      body: JSON.stringify(body),
    })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function (res) {
      if (!res.ok) {
        const err = new Error((typeof res.data.error === 'string' && res.data.error) || (res.data.error && res.data.error.message) || 'Ошибка создания заказа');
        err.data = res.data;
        throw err;
      }
      // успешный путь — как у основного создания
      const orderId = res.data.id || res.data.order_id;
      activeOrderId = orderId;
      activeOrderUser = user;
      activeOrderFull = selTid === 'pro';
      persistActiveOrder();
      _markOrderInitiator(orderId);
      if (window.ZSNotice) ZSNotice.show({ type: 'info', title: refreshMode ? 'Досье обновляется' : 'Досье формируется', message: refreshMode ? 'Новые публичные данные и анализ будут сохранены.' : 'Мы начали сбор публичных данных. Статус появится в разделе «Мои досье».' });
      pollOrder(ctx.API, ctx.token, orderId, user);
    })
    .catch(function (err) {
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
      const msg = err.message || '';
      const failure = orderFailure(msg);
      if (window.ZSNotice) {
        ZSNotice.show({ type: failure.type, title: failure.title === 'Что-то пошло не так' ? 'Не удалось создать досье' : failure.title, message: failure.title === 'Что-то пошло не так' ? 'Попробуйте повторить действие. Если ошибка не исчезнет, обратитесь в поддержку.' : failure.message, duration: 0 });
      }
    });
  }

  function _confirmRefresh(btn, tier) {
    const ctx = existingChoiceCtx;
    if (!ctx) return;
    const existing = (ctx.data && ctx.data.existing_report) || {};
    const extra = { refresh: true, source_order_id: existing.order_id };
    // «текущий тариф или лучше»: тариф кнопки определяет target отчёта
    if (tier) extra.report_type = (tier === 'pro') ? 'full' : tier;
    _rePostChoice(extra, '-refresh-' + (tier || 'cur'), btn);
  }

  function _confirmCreateOwn(btn) {
    if (!existingChoiceCtx) return;
    _rePostChoice({ create_own: true }, '-createown', btn);
  }

  /* ─── topup flow ─── */

  /* STAGES для экрана сбора (как в order-modal-v4.html, но total из данных юзера) */
  let curStages = [];
  let completedStages = new Set();
  function progStagesFor(user, isFull) {
    const u = user || {};
    const s = [
      { k: 'profile',       l: 'Профиль',   total: 0 },
      { k: 'fetch_posts',   l: 'Сообщения', total: Number(u.message_count) || 0 },
      { k: 'fetch_threads', l: 'Темы',      total: Number(u.thread_count) || Number(u.topics_count) || 0 },
      { k: 'fetch_wall',    l: 'Стена',     total: Number(u.wall_count) || 0 },
      { k: 'metrics',       l: 'Метрики',   total: 0 }
    ];
    if (isFull) s.push({ k: 'ai', l: 'AI-анализ', total: 3 });
    return s;
  }
  const PROG_CIRC = 194.8;
  let progStartedAt = null; // время начала сбора (для честного «Собрано за …»)
  let cb_after_finish = null;

  function progStageIcon(state) {
    if (state === 'done') return '<i class="fa-solid fa-check" aria-hidden="true"></i>';
    if (state === 'error') return '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
    if (state === 'active') return '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>';
    return '<i class="fa-regular fa-circle" aria-hidden="true"></i>';
  }
  function progRenderStages(idx, cnt) {
    const cards = qs(cur, '#progCards');
    if (!cards) return;
    const html = [];
    curStages.forEach(function (s, i) {
      const isDone = completedStages.has(s.k) || i < idx;
      const st = isDone ? 'done' : i === idx ? 'active' : 'pending';
      const v = s.total && i === idx && Number(cnt) > 0 ? number(cnt) + ' / ' + number(s.total) : '';
      if (i) html.push('<div class="zs-card-sep"></div>');
      html.push(`<div class="zs-card-row ${st}"><div class="zs-card-k"><span class="dot">${progStageIcon(st)}</span><span class="zs-card-lab${st === 'active' ? ' shimmer' : ''}">${s.l}</span></div><div class="zs-card-v">${v}</div></div>`);
    });
    cards.innerHTML = html.join('');
  }
  function progSetPct(p) {
    const pctEl = qs(cur, '#progPct');
    const ring = qs(cur, '#progRing');
    if (pctEl) pctEl.textContent = Math.round(p) + '%';
    if (ring) ring.style.strokeDashoffset = PROG_CIRC * (1 - p / 100);
    miniSetPct(p);
  }
  function progSetTitle(t) {
    const title = qs(cur, '.zs-modal-title');
    if (title) {
      title.textContent = t;
      title.classList.remove('shimmer');
    }
  }
  /* «2 мин 14 сек» из реального времени сбора, а не заглушка */
  function progElapsedText() {
    if (!progStartedAt) return '';
    const sec = Math.max(1, Math.round((Date.now() - progStartedAt) / 1000));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m > 0 ? m + ' мин ' + s + ' сек' : s + ' сек';
  }
  function progFinish() {
    if (progTimer) { clearInterval(progTimer); progTimer = null; }
    progSetPct(100);
    progRenderStages(curStages.length, 0);
    const statIc = qs(cur, '#statIc');
    if (statIc) statIc.classList.add('ok');
    const stageEl = qs(cur, '#progStage');
    if (stageEl) { stageEl.classList.remove('shimmer'); stageEl.textContent = 'Полное досье готово'; }
    const labEl = qs(cur, '#progLab');
    const elapsed = progElapsedText();
    if (labEl) labEl.textContent = elapsed ? 'Собрано за ' + elapsed : 'Готово';
    progSetTitle('Досье собрано');
    const btn = qs(cur, '#progBtn');
    if (btn) {
      btn.className = 'zs-btn light';
      btn.textContent = 'Перейти в отчёт';
      btn.onclick = function () { if (typeof cb_after_finish === 'function') cb_after_finish(); };
    }
    // если свёрнут в фон — показать «готово» и авто-развернуть
    if (minimized) {
      miniDone();
      setTimeout(function () { if (minimized) _restore(); }, 1000);
    }
  }
  function progStart(user, cb, isFull) {
    progBegin(user, isFull);
    cb_after_finish = cb || null;
    let idx = 0, sub = 0, per = 100 / curStages.length;
    setTimeout(function () {
      progTimer = setInterval(function () {
        const s = curStages[idx];
        const stageEl2 = qs(cur, '#progStage');
        if (stageEl2) stageEl2.textContent = s.l;
        const labEl2 = qs(cur, '#progLab');
        if (labEl2) labEl2.textContent = 'Собираем данные';
        if (s.total) {
          sub += Math.max(1, Math.floor(s.total / 22));
          if (sub >= s.total) sub = s.total;
          progSetPct(idx * per + (sub / s.total) * per);
          progRenderStages(idx, sub);
          if (sub >= s.total) { idx++; sub = 0; }
        } else {
          progSetPct((idx + 1) * per);
          progRenderStages(idx, 0);
          idx++;
        }
        if (idx >= curStages.length) progFinish();
      }, 130);
    }, 450);
  }

  function progBegin(user, isFull) {
    cb_after_finish = null;
    progStartedAt = Date.now();
    completedStages = new Set();
    curStages = progStagesFor(user, isFull !== false);
    progSetTitle('Собираем досье');
    const statIc = qs(cur, '#statIc');
    if (statIc) statIc.classList.remove('ok');
    const stageEl = qs(cur, '#progStage');
    if (stageEl) { stageEl.classList.add('shimmer'); stageEl.textContent = 'Профиль'; }
    const labEl = qs(cur, '#progLab');
    if (labEl) labEl.textContent = 'Создаём заказ';
    const btn = qs(cur, '#progBtn');
    if (btn) { btn.className = 'zs-btn'; btn.textContent = 'Свернуть в фон'; btn.onclick = function () { ZSModals._minimize(); }; }
    progSetPct(0);
    progRenderStages(-1, 0);
  }

  /* ── реальный прогресс по данным бэка (поллинг) ── */
  function _applyProg(stage, current, total, message, completed) {
    (completed || []).forEach(function (s) { completedStages.add(String(s)); });
    const stageMap = { collecting: 'fetch_posts', saving: 'metrics', done: 'metrics' };
    const displayStage = stageMap[stage] || stage;
    const idx = curStages.findIndex(function (s) { return s.k === displayStage; });
    const stageEl = qs(cur, '#progStage');
    // шиммер на названии стадии живёт, пока сбор не завершён
    if (stageEl) { stageEl.classList.add('shimmer'); stageEl.textContent = (idx >= 0 ? curStages[idx].l : 'Собираем досье'); }
    const labEl = qs(cur, '#progLab');
    if (labEl) labEl.textContent = message || 'Собираем данные';
    miniSetStage(message || 'Собираем данные', (idx >= 0 ? curStages[idx].l : 'Собираем досье'));
    if (idx < 0) return;
    const s = curStages[idx];
    if (s.total) {
      progRenderStages(idx, current || 0);
      progSetPct((idx + (current || 0) / Math.max(total || 1, 1)) / curStages.length * 100);
    } else {
      progRenderStages(idx, 0);
      progSetPct((idx + 1) / curStages.length * 100);
    }
  }

  function orderFailure(raw) {
    const text = String(raw || '').toLowerCase();
    if (/already|уже.*(созда|формир|очеред)|duplicate/.test(text)) return { type: 'info', title: 'Досье уже формируется', message: 'Не нужно создавать заказ повторно — мы сообщим, когда всё будет готово.', retry: false };
    if (/balance|credit|fund|баланс|средств|кредит|недоста|не хватает|пополн/.test(text)) return { type: 'error', title: 'Недостаточно средств', message: 'На балансе не хватает средств для создания досье. Пополните баланс и попробуйте снова.', retry: false };
    if (/forum|lolz|lzt|profile|post|thread|wall|форум|профил|сообщен|тем|стен/.test(text)) return { type: 'error', title: 'Не удалось получить данные форума', message: 'Часть публичных данных сейчас недоступна. Повторите создание досье чуть позже.', retry: false };
    if (/ai|model|firework|timeout|timed out|ответ.*ии/.test(text)) return { type: 'error', title: 'ИИ-сервис не ответил', message: 'Не удалось завершить анализ сейчас. Повторите попытку позднее.', retry: false };
    return { type: 'error', title: 'Что-то пошло не так', message: 'Мы не смогли выполнить действие. Повторите попытку через несколько секунд.', retry: true };
  }

  function progFail(raw, orderId) {
    if (progTimer) { clearInterval(progTimer); progTimer = null; }
    const failure = orderFailure(raw);
    const labEl = qs(cur, '#progLab');
    if (labEl) labEl.textContent = failure.message;
    const stageEl = qs(cur, '#progStage');
    if (stageEl) { stageEl.classList.remove('shimmer'); stageEl.textContent = 'Не удалось собрать'; }
    progSetTitle('Ошибка');
    miniSetStage(failure.message, 'Не удалось собрать');
    if (miniEl) miniEl.classList.add('err');
    if (window.ZSNotice) {
      const action = failure.retry && orderId ? { label: 'Повторить', onClick: function () { _viewDossier(orderId); } } : null;
      ZSNotice.show({ type: failure.type, title: failure.title, message: failure.message, action: action, duration: 0 });
    }
    const btn = qs(cur, '#progBtn');
    if (btn) {
      btn.className = 'zs-btn light';
      btn.textContent = 'Закрыть';
      btn.onclick = function () { ZSModals.close(); };
    }
  }

  function pollOrder(API, token, orderId) {
    pollTimer = setInterval(function () {
      fetch(API + '/api/orders/' + orderId, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || d.error) return;
          if (d.status === 'done') {
            clearInterval(pollTimer); pollTimer = null;
            if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
            // Автооткрытие: только если включена настройка И это вкладка-инициатор заказа.
            cb_after_finish = function () { _viewDossier(orderId); };
            if (window.ZSNotice) ZSNotice.show({ type: 'success', title: refreshMode ? 'Досье обновлено' : 'Досье готово', message: refreshMode ? 'Новые публичные данные и анализ сохранены.' : 'Анализ завершён. Можно открыть полный отчёт.', action: { label: 'Открыть досье', onClick: function () { _viewDossier(orderId); } } });
            // Сервер создал уведомление dossier_ready — сразу растим бейдж колокольчика.
            try { if (window.ZSNotifications && window.ZSNotifications.bump) window.ZSNotifications.refreshUnread(); } catch (_) {}
            progFinish();
          } else if (d.status === 'error') {
            clearInterval(pollTimer); pollTimer = null;
            if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
            // Сервер создал уведомление formation_error — сразу растим бейдж.
            try { if (window.ZSNotifications && window.ZSNotifications.bump) window.ZSNotifications.refreshUnread(); } catch (_) {}
            progFail(d.error, orderId);
          } else if (d.progress && d.progress.stage) {
            _applyProg(d.progress.stage, d.progress.current || 0, d.progress.total || 1,
                       d.progress.message || '', d.progress.completed_stages || []);
          }
        })
        .catch(function () {});
    }, 1500);
    // страховка от бесконечного поллинга
    pollTimeout = setTimeout(function () {
      clearInterval(pollTimer); pollTimer = null;
      pollTimeout = null;
      const b = qs(cur, '#progBtn');
      if (b && b.textContent === 'Свернуть в фон') {
        progFail('Превышено время ожидания. Проверьте статус в «Мои досье».');
      }
    }, 10 * 60 * 1000);
  }

  function _closeProg() { ZSModals.close(); }

  /* ─── сворачивание сбора в фон (мини-виджет) ─── */
  function miniSetPct(p) {
    if (!miniEl) return;
    const pct = qs(miniEl, '.zs-mini-pct');
    const ring = qs(miniEl, '.zs-mini-ring');
    if (pct) pct.textContent = Math.round(p) + '%';
    if (ring) {
      const C = 138.23;
      const arc = C * (p / 100);
      ring.style.strokeDasharray = arc + ' ' + (C - arc);
      ring.style.strokeDashoffset = 0;
    }
  }
  function miniSetStage(lab, stage) {
    if (!miniEl) return;
    const l = qs(miniEl, '.zs-mini-lab');
    const s = qs(miniEl, '.zs-mini-stage');
    if (l) l.textContent = lab || 'Собираем досье';
    if (s) s.textContent = stage || '';
  }
  function miniDone() {
    if (!miniEl) return;
    miniEl.classList.add('ok');
    miniSetPct(100);
    miniSetStage('Досье готово', 'Открыть');
  }
  function showMini() {
    removeMini();
    minimized = true;
    miniEl = el('div', 'zs-mini');
    miniEl.innerHTML = `<div class="zs-mini-ic">
        <svg class="zs-mini-ring-svg" viewBox="0 0 52 52" fill="none">
          <circle class="zs-mini-ring-bg" cx="26" cy="26" r="22" stroke-width="5"/>
          <circle class="zs-mini-ring" cx="26" cy="26" r="22" stroke-width="5" stroke-dasharray="0 138.23" stroke-dashoffset="0"/>
        </svg>
        <span class="zs-mini-pct">0%</span>
        <svg class="zs-mini-check" viewBox="0 0 30 30" fill="none"><path d="M8 15.4l4.3 4.2 9.7-10" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="zs-mini-txt">
        <div class="zs-mini-lab">Собираем досье</div>
        <div class="zs-mini-stage">Профиль</div>
      </div>`;
    miniEl.addEventListener('click', _restore);
    document.body.appendChild(miniEl);
    requestAnimationFrame(function () { miniEl.classList.add('on'); });
  }
  function removeMini() {
    if (miniEl) { miniEl.remove(); miniEl = null; }
  }
  function _minimize() {
    if (!cur) return;
    cur.classList.add('zs-min');
    showMini();
    const lab = qs(cur, '#progLab');
    const stage = qs(cur, '#progStage');
    miniSetStage(lab ? lab.textContent : '', stage ? stage.textContent : '');
    const pctEl = qs(cur, '#progPct');
    const pct = pctEl ? parseInt(pctEl.textContent, 10) || 0 : 0;
    miniSetPct(pct);
  }
  function _restore() {
    removeMini();
    minimized = false;
    if (cur) cur.classList.remove('zs-min');
  }

  /* legacy simulateProgress (оставлен на случай старых вызовов) */
  function simulateProgress(user, cb) {
    progStart(user, cb);
  }

  function showDone(orderId) {
    if (!cur) return;
    const bodyEl = qs(cur, '.zs-modal-body');
    if (!bodyEl) return;
    bodyEl.innerHTML = renderDone(orderId);
  }

  function _viewDossier(orderId) {
    window.location.href = 'zelscan.html?order=' + orderId;
  }

  /* ─── topup flow ─── */

  function _pickMethod(method) {
    // only lolz for now
  }

  function _onAmountInput(inp) {
    const raw = inp.textContent.replace(/[^0-9]/g, '');
    if (inp.textContent !== raw) inp.textContent = raw;
    const err = qs(cur, '#topupErr');
    if (err) {
      var num = parseInt(raw, 10);
      err.classList.toggle('hidden', num >= 10 || raw === '');
    }
  }

  function _submitTopup() {
    const inp = qs(cur, '#topupAmount');
    if (!inp) return;
    const raw = inp.textContent.replace(/[^0-9]/g, '');
    const amount = parseInt(raw, 10);
    if (!amount || amount < 10) {
      const err = qs(cur, '#topupErr');
      if (err) err.classList.remove('hidden');
      return;
    }
    _captchaThenAction(function (capToken) { _topupIntentDo(amount, capToken); });
  }

  function _topupIntentDo(amount, capToken) {
    topupState.amount = amount;
    topupState.intent = null;
    const bodyEl = qs(cur, '.zs-modal-body');
    if (bodyEl) bodyEl.innerHTML = renderTopupWait();
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const API = window.__ZS_API__ || '';
    fetch(API + '/api/my/topup-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Turnstile-Token': capToken },
      body: JSON.stringify({ amount: amount }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (!cur) return;
      if (!res.ok || !res.data || !res.data.ok) {
        const e2 = qs(cur, '#topupPollErr');
        if (e2) { e2.querySelector('span').textContent = (res.data && res.data.error) || 'Не удалось создать счёт'; e2.classList.remove('hidden'); }
        return;
      }
      topupState.intent = { invoice_id: res.data.invoice_id, url: res.data.url, tx_id: res.data.tx_id, expires_at: res.data.expires_at || 0 };
      const bodyEl2 = qs(cur, '.zs-modal-body');
      if (bodyEl2) bodyEl2.innerHTML = renderTopupWait();
      _startTopupTimer();
      startTopupPoll(res.data.invoice_id);
    })
    .catch(function () {
      if (!cur) return;
      const e2 = qs(cur, '#topupPollErr');
      if (e2) { e2.querySelector('span').textContent = 'Сервер недоступен'; e2.classList.remove('hidden'); }
    });
  }

  function _openInvoice() {
    const url = safeHttpUrl(topupState && topupState.intent && topupState.intent.url);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  function _startTopupTimer() {
    if (topupTimerInt) { clearInterval(topupTimerInt); topupTimerInt = null; }
    const tick = function () {
      const el = document.getElementById('topupTimer');
      if (!el) { if (topupTimerInt) { clearInterval(topupTimerInt); topupTimerInt = null; } return; }
      const exp = topupState && topupState.intent ? (topupState.intent.expires_at || 0) : 0;
      const left = exp ? Math.max(0, Math.round(exp - Date.now() / 1000)) : 600;
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      el.textContent = mm + ':' + ss;
      if (left <= 0 && topupTimerInt) { clearInterval(topupTimerInt); topupTimerInt = null; }
    };
    tick();
    topupTimerInt = setInterval(tick, 1000);
  }

  function startTopupPoll(intentId) {
    if (topupPollTimer) clearInterval(topupPollTimer);
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    let attempts = 0;
    topupPollTimer = setInterval(function () {
      attempts++;
      const txId = topupState && topupState.intent ? (topupState.intent.tx_id || '') : '';
      fetch('/api/my/topup-status?invoice_id=' + encodeURIComponent(intentId) + '&tx_id=' + encodeURIComponent(txId), {
        headers: { 'Authorization': 'Bearer ' + token },
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'completed') {
          clearInterval(topupPollTimer);
          topupPollTimer = null;
          const pct = qs(cur, '#topupPct');
          if (pct) pct.textContent = '100%';
          // тост об успешном пополнении
          if (data.just_credited) {
            window.ZSNotice && window.ZSNotice.show({
              type: 'success',
              title: 'Баланс пополнен',
              detail: '+' + (topupState ? topupState.amount : '') + ' ₽ зачислены на счёт'
            });
          }
          // обновить профиль/баланс в интерфейсе
          fetch((window.__ZS_API__ || (window.ZSDashboard2 && window.ZSDashboard2.apiBase) || '') + '/api/my/profile', { headers: { 'Authorization': 'Bearer ' + token } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (u) {
              if (u && u.user_id) {
                localStorage.setItem('lzt_user', JSON.stringify(u));
                document.dispatchEvent(new CustomEvent('zs:profile', { detail: u }));
              }
            })
            .catch(function () {});
          setTimeout(function () {
            if (!cur) return;
            const bodyEl2 = qs(cur, '.zs-modal-body');
            if (bodyEl2) bodyEl2.innerHTML = renderTopupDone();
          }, 500);
        } else if (data.status === 'failed') {
          clearInterval(topupPollTimer);
          topupPollTimer = null;
          const err = qs(cur, '#topupPollErr');
          if (err) { err.querySelector('span').textContent = (data && data.error) || 'Платёж не завершён'; err.classList.remove('hidden'); }
        }
        // update spinner anyway
        const pct = qs(cur, '#topupPct');
        const ring = qs(cur, '#topupRing');
        if (pct) {
          const pp = Math.min(95, 5 + attempts * 3);
          pct.textContent = pp + '%';
          if (ring) {
            const circ = 175.93;
            const off = circ - (pp / 100) * circ;
            ring.setAttribute('stroke-dashoffset', off);
          }
        }
      })
      .catch(function () { /* ignore poll errors */ });
    }, 3000);
  }

  function _cancelTopup() {
    if (topupPollTimer) { clearInterval(topupPollTimer); topupPollTimer = null; }
    if (topupTimerInt) { clearInterval(topupTimerInt); topupTimerInt = null; }
    const txId = topupState && topupState.tx_id ? String(topupState.tx_id) : '';
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const API = window.ZSDashboard2.apiBase;
    topupResume = null;
    pendingOrder = null;
    if (!txId || !token) {
      topupState = null;
      ZSModals.close();
      return;
    }
    fetch(API + '/api/my/topup-cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ tx_id: txId }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function () {
        try { if (window.ZSNotifications && window.ZSNotifications.refreshUnread) window.ZSNotifications.refreshUnread(); } catch (_) {}
      })
      .catch(function () {})
      .finally(function () {
        topupState = null;
        ZSModals.close();
      });
  }

  function _topupDone() {
    if (topupResume) { const r = topupResume; topupResume = null; r(); }
    else ZSModals.close();
  }

  function _onAmountKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); return; }
  }

  return {
    openOrder: openOrder,
    openTopup: openTopup,
    openAccountPromo: openAccountPromo,
    close: close,
    _openTos: _openTos,
    _toggleOrderPromo: _toggleOrderPromo,
    _pickTariff: _pickTariff,
    _toggleBonus: _toggleBonus,
    _toggleFeatures: _toggleFeatures,
    _startOrder: _startOrder,
    _topupDeficit: _topupDeficit,
    _minimize: _minimize,
    _restore: _restore,
    _viewDossier: _viewDossier,
    _pickMethod: _pickMethod,
    _onAmountInput: _onAmountInput,
    _onAmountKeydown: _onAmountKeydown,
    _submitTopup: _submitTopup,
    _openInvoice: _openInvoice,
    _cancelTopup: _cancelTopup,
    _topupDone: _topupDone,
    _nextStep: _nextStep,
    _setSource: _setSource,
    _submitManual: _submitManual,
    _backStep: _backStep,
    _applyPromo: _applyPromo,
    _toggleAgree: _toggleAgree,
    _setVis: _setVis,
    _openPad: _openPad,
    _closePad: _closePad,
    _cancelPad: _cancelPad,
  };
})();
// ZSModals is a top-level lexical binding; expose the same instance for modules
// that intentionally integrate through window (for example account-ui).
window.ZSModals = ZSModals;
/* zelscan-order-modal-username-html-v1 */


/* Dashboard2: CSP-friendly delegated actions for generated modal markup. */
document.addEventListener('click', function(event){
  const node=event.target.closest('[data-zs-call]'); if(!node) return;
  const call=(node.getAttribute('data-zs-call')||'').replace(/&quot;/g,'"').trim();
  if(call.startsWith('event.stopPropagation();')) event.stopPropagation();
  const clean=call.replace(/^event\.stopPropagation\(\);?/,'');
  let m=clean.match(/^ZSModals\.([A-Za-z0-9_]+)\((?:'([^']*)')?\)$/);
  if(m && typeof ZSModals[m[1]]==='function'){ event.preventDefault(); ZSModals[m[1]](m[2]); return; }
  if(/^alert\(/.test(clean)){ event.preventDefault(); if(window.ZSNotice) ZSNotice.show({type:'info',title:'Пользовательское соглашение',message:'Документ будет опубликован отдельно.'}); }
});
