/* Zelscan — центр уведомлений (колокольчик в шапке).
 *
 * Показывает серверную историю уведомлений (таблица notifications) —
 * НЕ заменяет тосты zs-notice, а дополняет их постоянным списком.
 *
 * Бэкенд (готов):
 *   GET  /api/my/notifications?limit=&unread=1 -> {notifications:[...], unread:N}
 *   PATCH /api/my/notifications/<id> {is_read:true}
 *   POST  /api/my/notifications/read-all
 *   DELETE /api/my/notifications
 *
 * Публичный API: window.ZSNotifications.toggle(), .open(), .close(),
 *                .refreshUnread(), .bump() (оптимистично +1 к бейджу).
 */
(() => {
  'use strict';
  if (window.ZSNotifications) return;

  const API = (window.ZELSCAN_API_BASE || window.API_BASE || '').replace(/\/$/, '');
  const token = () => localStorage.getItem('lzt_token') || '';

  function requestOptions(options) {
    const result = Object.assign({ credentials: 'same-origin' }, options || {});
    const headers = Object.assign({}, result.headers || {});
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    result.headers = headers;
    return result;
  }

  // Тип уведомления -> модификатор тона (совпадает с zs-notice) + иконка.
  const TONE = {
    dossier_ready:  'success',
    formation_error:'error',
    balance_topup:  'info',
    news:           'info',
    important:      'warning',
  };
  const ICON = {
    // success — галочка в круге
    success: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="m6.5 10 2.4 2.4 4.6-4.8"/></svg>',
    // error — крестик в круге
    error:   '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="m7.3 7.3 5.4 5.4M12.7 7.3l-5.4 5.4"/></svg>',
    // info — колокол / инфо
    info:    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="M10 9v4M10 6.6v.2"/></svg>',
    warning: '<svg viewBox="0 0 20 20"><path d="M10 3 2.5 16h15z"/><path d="M10 8.5v3M10 13.6v.2"/></svg>',
  };

  let built = false;
  let unread = 0;
  let loading = false;
  let els = {};
  let triggerReturn = null;
  let pollTimer = null;

  // ── cross-tab sync счётчика ───────────────────────────────────────────────
  const CH_NAME = 'zelscan_notifications';
  let bc = null;
  try { bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null; } catch (_) { bc = null; }
  const LS_SYNC_KEY = 'zelscan_notifications_unread';

  function broadcastUnread() {
    const payload = { unread: unread, _ts: Date.now() };
    try { if (bc) bc.postMessage(payload); } catch (_) {}
    try { localStorage.setItem(LS_SYNC_KEY, JSON.stringify(payload)); } catch (_) {}
  }
  function applyIncomingUnread(data) {
    if (!data || typeof data.unread !== 'number') return;
    setUnread(data.unread, /*silent*/ true);
  }
  if (bc) bc.onmessage = e => applyIncomingUnread(e.data);
  window.addEventListener('storage', e => {
    if (e.key === LS_SYNC_KEY && e.newValue) {
      try { applyIncomingUnread(JSON.parse(e.newValue)); } catch (_) {}
    }
  });

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeRelativeUrl(value) {
    if (typeof value !== 'string' || !value || value.startsWith('\\')) return '';
    try {
      const u = new URL(value, location.href);
      if (!/^https?:$/.test(u.protocol)) return '';
      if (u.origin === location.origin) return u.href;
      // Уведомления могут вести только на ожидаемые внешние страницы форума/оплаты.
      if (u.protocol === 'https:' && /(^|\.)(?:lolz\.live|lolz\.team|lzt\.market)$/i.test(u.hostname)) return u.href;
      return '';
    } catch (_) { return ''; }
  }
  function relTime(ts) {
    if (!ts) return '';
    const sec = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
    if (sec < 60) return 'только что';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ч назад`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} дн назад`;
    try { return new Date(Number(ts) * 1000).toLocaleDateString('ru'); } catch (_) { return ''; }
  }

  // ── API ─────────────────────────────────────────────────────────────────
  async function apiList(limit) {
    const r = await fetch(API + '/api/my/notifications?limit=' + (limit || 30), requestOptions());
    if (!r.ok) throw new Error('GET notifications ' + r.status);
    return r.json();
  }
  async function apiUnread() {
    // Лёгкий запрос: берём 1 запись, но нам нужно только поле unread.
    const r = await fetch(API + '/api/my/notifications?limit=1', requestOptions());
    if (!r.ok) throw new Error('unread ' + r.status);
    const d = await r.json();
    return Number(d && d.unread) || 0;
  }
  async function apiReadAll(ids) {
    const r = await fetch(API + '/api/my/notifications/read-all', requestOptions({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids }),
    }));
    if (!r.ok) throw new Error('read-all ' + r.status);
    return r.json();
  }
  async function apiDeleteAll() {
    const r = await fetch(API + '/api/my/notifications', requestOptions({ method: 'DELETE' }));
    if (!r.ok) throw new Error('DELETE notifications ' + r.status);
    return r.json();
  }

  // ── бейдж ──────────────────────────────────────────────────────────────
  let initGuard = false;
  function setUnread(n, silent) {
    unread = Math.max(0, Number(n) || 0);
    if (built) {
      const badge = els.badge, dot = els.badgeDot, trigger = els.trigger;
      // Снимаем inline-маскировку (transform:scale(0)/opacity:0 на бейдже,
      // background:transparent на триггере), проставленную в BELL_HTML для
      // подавления FOUC до того, как догрузится notifications-center.css.
      // Снимаем один раз — ровно перед тем, как CSS начнёт управлять состоянием.
      if (!initGuard) {
        if (dot && dot.style && dot.style.transform) { dot.style.transform = ''; dot.style.opacity = ''; dot.style.filter = ''; dot.style.transition = ''; }
        if (trigger && trigger.style && trigger.style.background) { trigger.style.background = ''; trigger.style.border = ''; trigger.style.color = ''; trigger.style.transition = ''; }
        initGuard = true;
      }
      if (dot) dot.textContent = unread > 99 ? '99+' : String(unread);
      if (badge) badge.setAttribute('data-open', unread > 0 ? 'true' : 'false');
    }
    if (!silent) broadcastUnread();
  }

  async function refreshUnread() {
    try { setUnread(await apiUnread()); } catch (_) {}
  }

  // Оптимистично +1 (например, когда показан тост о готовности/ошибке).
  function bump(delta) {
    setUnread(unread + (typeof delta === 'number' ? delta : 1));
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  function ensureTrigger(trigger) {
    // Колокольчик монтируется account-ui.js поздно и может быть заменён вместе с шапкой.
    trigger = trigger || document.querySelector('[data-zs-noti-trigger]');
    if (!trigger) return null;
    els.trigger = trigger;
    els.badge = trigger.querySelector('.t-badge');
    els.badgeDot = trigger.querySelector('.t-badge-dot');
    return trigger;
  }

  // Один делегированный capture-обработчик переживает позднюю вставку/замену шапки.
  // stopPropagation не даёт bubble outside-click закрыть popover тем же событием.
  if (!window.__zsNotiDelegated) {
    window.__zsNotiDelegated = true;
    document.addEventListener('click', function (e) {
      const trigger = e.target && e.target.closest && e.target.closest('[data-zs-noti-trigger]');
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      ensureTrigger(trigger);
      toggle();
    }, true);
  }

  function build() {
    if (built) { ensureTrigger(); return; }
    ensureTrigger();

    const pop = document.createElement('div');
    pop.id = 'zsNotiPop';
    pop.className = 'zs-noti-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Уведомления');
    pop.setAttribute('aria-hidden', 'true');
    pop.innerHTML =
      '<div class="zs-noti-head">' +
        '<h2 class="zs-noti-title">Уведомления</h2>' +
        '<button type="button" class="zs-noti-deleteall" hidden>Удалить все</button>' +
      '</div>' +
      '<div class="zs-noti-loading" hidden>Загрузка…</div>' +
      '<div class="zs-noti-empty" hidden>Пока нет уведомлений</div>' +
      '<div class="zs-noti-list" role="list"></div>';

    document.body.appendChild(pop);

    els.pop = pop;
    els.list = pop.querySelector('.zs-noti-list');
    els.empty = pop.querySelector('.zs-noti-empty');
    els.loadingEl = pop.querySelector('.zs-noti-loading');
    els.deleteAll = pop.querySelector('.zs-noti-deleteall');

    els.deleteAll.addEventListener('click', onDeleteAll);
    els.pop.addEventListener('keydown', e => trap(e, els.pop));

    // клик вне и Escape
    document.addEventListener('click', function (e) {
      if (!els.pop.classList.contains('open')) return;
      if (els.pop.contains(e.target)) return;
      if (els.trigger && els.trigger.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.pop.classList.contains('open')) { close(); if (els.trigger) els.trigger.focus(); }
    });

    built = true;
    setUnread(unread, true); // синхронизируем бейдж после build
  }

  function focusables(root) {
    return [...root.querySelectorAll('button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
      .filter(el => el.offsetParent !== null);
  }
  function trap(e, root) {
    if (e.key !== 'Tab') return;
    const f = focusables(root);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function position() {
    if (!els.trigger || !els.pop) return;
    const r = els.trigger.getBoundingClientRect();
    const w = els.pop.offsetWidth || 340;
    // popover под колокольчиком, раскрывается ВЛЕВО: привязываем правый край
    // popover к правому краю триггера, но не даём уйти за левый край экрана.
    const h = els.pop.offsetHeight || 320, gap = 9, margin = 12;
    let left = Math.max(margin, Math.min(window.innerWidth - w - margin, r.right - w));
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - 12 && r.top - h - gap > 12) top = Math.max(margin, r.top - h - gap);
    els.pop.style.left = Math.round(left) + 'px';
    els.pop.style.top = Math.round(top) + 'px';
  }

  // ── рендер списка ────────────────────────────────────────────────────────
  function renderLoading() {
    els.loadingEl.hidden = false;
    els.empty.hidden = true;
    els.list.hidden = true;
    els.deleteAll.hidden = true;
  }

  function renderEmpty(message) {
    els.loadingEl.hidden = true;
    els.list.innerHTML = '';
    els.list.hidden = true;
    els.empty.textContent = message || 'Пока нет уведомлений';
    els.empty.hidden = false;
    els.deleteAll.hidden = true;
  }

  function renderError(message) {
    renderEmpty(message || 'Не удалось загрузить уведомления');
  }

  function renderList(items) {
    if (!items || !items.length) {
      renderEmpty();
      return;
    }
    els.loadingEl.hidden = true;
    els.empty.hidden = true;
    els.list.hidden = false;
    els.list.innerHTML = '';
    els.deleteAll.hidden = false;
    items.forEach(function (n) {
      const tone = TONE[n.type] || 'info';
      const item = document.createElement('div');
      item.className = 'zs-noti-item zs-noti-item--' + tone + (n.is_read ? '' : ' is-unread');
      item.setAttribute('role', 'listitem');

      const targetUrl = safeRelativeUrl(n.meta && n.meta.url);
      if (targetUrl) item.classList.add('is-clickable');

      item.innerHTML =
        '<span class="zs-noti-ic">' + (ICON[tone] || ICON.info) + '</span>' +
        '<div class="zs-noti-body">' +
          '<div class="zs-noti-item-title">' +
            '<span class="zs-noti-item-title-text">' + esc(n.title || 'Уведомление') + '</span>' +
            '<span class="zs-noti-time">' + esc(relTime(n.created_at)) + '</span>' +
          '</div>' +
          (n.body ? '<p class="zs-noti-text">' + esc(n.body) + '</p>' : '') +
        '</div>';

      item.addEventListener('click', function () {
        if (!targetUrl) return;
        const parsed = new URL(targetUrl);
        if (parsed.origin !== location.origin) window.open(parsed.href, '_blank', 'noopener,noreferrer');
        else location.assign(parsed.href);
      });

      els.list.appendChild(item);
    });
  }

  async function onDeleteAll() {
    if (!els.list.children.length || els.deleteAll.disabled) return;
    els.deleteAll.disabled = true;
    try {
      await apiDeleteAll();
      renderEmpty();
      setUnread(0);
    } catch (_) {
      renderError('Не удалось удалить уведомления');
    } finally {
      els.deleteAll.disabled = false;
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    renderLoading();
    try {
      const d = await apiList(30);
      const items = d.notifications || [];
      const unreadIds = items.filter(n => !n.is_read && n.id).map(n => n.id);
      renderList(items);
      if (unreadIds.length) {
        items.forEach(n => { if (unreadIds.indexOf(n.id) !== -1) n.is_read = true; });
        els.list.querySelectorAll('.is-unread').forEach(el => el.classList.remove('is-unread'));
        setUnread(Math.max(0, (Number(d.unread) || 0) - unreadIds.length));
        try {
          const result = await apiReadAll(unreadIds);
          setUnread(Number(result && result.unread) || 0);
        } catch (_) {
          refreshUnread();
        }
      } else {
        setUnread(Number(d.unread) || 0);
      }
    } catch (_) {
      renderError();
    } finally {
      loading = false;
    }
  }

  // ── open/close ────────────────────────────────────────────────────────────
  function open() {
    build();
    triggerReturn = document.activeElement;
    position();
    els.pop.classList.add('open');
    els.pop.setAttribute('aria-hidden', 'false');
    window.ZSPopovers && ZSPopovers.open('noti', close);
    if (els.trigger) els.trigger.setAttribute('aria-expanded', 'true');
    load();
    requestAnimationFrame(function () {
      const first = focusables(els.pop)[0];
      if (first) first.focus();
    });
  }
  function close() {
    if (!built) return;
    window.ZSPopovers && ZSPopovers.close('noti');
    els.pop.classList.remove('open');
    els.pop.setAttribute('aria-hidden', 'true');
    if (els.trigger) els.trigger.setAttribute('aria-expanded', 'false');
    if (triggerReturn && triggerReturn.focus) triggerReturn.focus();
  }
  function toggle() {
    build();
    if (els.pop.classList.contains('open')) close();
    else open();
  }

  window.addEventListener('resize', function () { if (built && els.pop.classList.contains('open')) position(); });
  window.addEventListener('scroll', function () { if (built && els.pop.classList.contains('open')) position(); }, { capture: true, passive: true });

  // ── init ─────────────────────────────────────────────────────────────────
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(refreshUnread, 45000); // мягкий опрос бейджа
  }
  function bootstrap() {
    build();
    refreshUnread();
    startPolling();
  }

  window.ZSNotifications = {
    toggle, open, close, refreshUnread, bump,
    getUnread: () => unread,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
