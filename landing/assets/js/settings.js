/* Zelscan — модалка настроек (реальная интеграция).
 *
 * Источник дизайна: landing/zelscan_settings_modal_test.html.
 * Отличия от прототипа:
 *   - состояние приходит с сервера (GET /api/my/settings), а не из localStorage;
 *   - переключатели используют optimistic update с откатом при ошибке API;
 *   - синхронизация между вкладками через BroadcastChannel (fallback: storage-событие);
 *   - управляет видимостью .bal-pill по настройке show_balance.
 *
 * Публичный API: window.ZSSettings.open(), window.ZSSettings.getState(),
 *                window.ZSSettings.applyBalancePill().
 */
(() => {
  'use strict';
  if (window.ZSSettings) return; // защита от повторной инициализации

  const API = '';
  const token = () => localStorage.getItem('lzt_token') || '';

  // Ключ UI -> поле API (snake_case контракт бэкенда).
  const FIELD_MAP = {
    showBalance:    'show_balance',
    notifications:  'notifications_enabled',
    dossierReady:   'notify_dossier_ready',
    formationError: 'notify_formation_error',
    balanceTopup:   'notify_balance_topup',
    news:           'notify_news',
    important:      'notify_important',
    autoOpen:       'auto_open_dossier',
    rememberTariff: 'remember_tariff',
  };
  const API_TO_UI = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]));

  const DEFAULTS = {
    showBalance: false, notifications: true, dossierReady: true,
    formationError: true, balanceTopup: true, news: true, important: true,
    autoOpen: false, rememberTariff: true,
  };

  // Локальный кэш последних известных настроек (в UI-ключах).
  let state = { ...DEFAULTS };
  let loaded = false;
  let built = false;

  // ── cross-tab sync ────────────────────────────────────────────────────────
  const CH_NAME = 'zelscan_settings';
  let bc = null;
  try { bc = ('BroadcastChannel' in window) ? new BroadcastChannel(CH_NAME) : null; } catch (_) { bc = null; }
  const LS_SYNC_KEY = 'zelscan_settings_sync';

  function broadcast() {
    const payload = { ...state, _ts: Date.now() };
    try { if (bc) bc.postMessage(payload); } catch (_) {}
    try { localStorage.setItem(LS_SYNC_KEY, JSON.stringify(payload)); } catch (_) {}
  }
  function applyIncoming(data) {
    if (!data) return;
    Object.keys(DEFAULTS).forEach(k => { if (k in data) state[k] = !!data[k]; });
    if (built) render();
    applyBalancePill();
  }
  if (bc) bc.onmessage = e => applyIncoming(e.data);
  window.addEventListener('storage', e => {
    if (e.key === LS_SYNC_KEY && e.newValue) {
      try { applyIncoming(JSON.parse(e.newValue)); } catch (_) {}
    }
  });

  // ── API ─────────────────────────────────────────────────────────────────
  function requestOptions(options) {
    const result = Object.assign({ credentials: 'same-origin' }, options || {});
    const headers = Object.assign({}, result.headers || {});
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    result.headers = headers;
    return result;
  }
  async function apiGet() {
    const r = await fetch(API + '/api/my/settings', requestOptions());
    if (!r.ok) throw new Error('GET settings ' + r.status);
    const d = await r.json();
    return d && d.settings ? d.settings : null;
  }
  async function apiPatch(apiField, value) {
    const body = {}; body[apiField] = value;
    const r = await fetch(API + '/api/my/settings', requestOptions({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    if (!r.ok) throw new Error('PATCH settings ' + r.status);
    const d = await r.json();
    return d && d.settings ? d.settings : null;
  }
  function fromApi(apiSettings) {
    const next = { ...DEFAULTS };
    Object.entries(API_TO_UI).forEach(([apiK, uiK]) => {
      if (apiK in apiSettings) next[uiK] = !!apiSettings[apiK];
    });
    return next;
  }

  // ── notice helper (использует общий центр уведомлений, если он есть) ──────
  function toast(msg, kind) {
    try {
      if (window.ZSNotice) {
        if (kind === 'error' && window.ZSNotice.error) return window.ZSNotice.error(msg);
        if (window.ZSNotice.show) return window.ZSNotice.show(msg, kind || 'info');
      }
    } catch (_) {}
    // тихий fallback — не мешаем пользователю
    if (kind === 'error') console.warn('[settings]', msg);
  }

  // ── balance pill visibility ───────────────────────────────────────────────
  function applyBalancePill() {
    document.querySelectorAll('.bal-pill').forEach(p => {
      // show_balance=false прячет pill; account-ui сам решает про наличие юзера,
      // но настройка имеет приоритет на скрытие.
      if (!state.showBalance) {
        p.dataset.zsHidden = '1';
        p.style.display = 'none';
      } else if (p.dataset.zsHidden) {
        delete p.dataset.zsHidden;
        // отдаём управление показом обратно account-ui (сбрасываем инлайн-none)
        p.style.display = '';
      }
    });
    // Решение по видимости баланса принято — снимаем Anti-FOUC маскировку.
    try { document.documentElement.classList.add('zs-bal-ready'); } catch (_) {}
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  const CLOSE_ICON = '<svg viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 0 0-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 1 0-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 1 0 1.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 0 0 1.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 0 0 0-1.09Z" fill="currentColor"/></svg>';

  let els = {};
  let settingsReturn = null;
  let confirmReturn = null;

  function build() {
    if (built) return;

    const settingsBg = document.createElement('div');
    settingsBg.id = 'zsSettingsBg';
    settingsBg.className = 'zs-modal-bg';
    settingsBg.setAttribute('aria-hidden', 'true');
    settingsBg.innerHTML = `
<section id="zsSettingsDialog" class="zs-modal zs-settings-modal" role="dialog" aria-modal="true" aria-labelledby="zsSettingsTitle" tabindex="-1"><div class="zs-modal-inner"><header class="zs-modal-head"><h1 id="zsSettingsTitle" class="zs-modal-title">Настройки</h1><button id="zsCloseSettings" class="zs-modal-x" type="button" aria-label="Закрыть настройки">${CLOSE_ICON}</button></header><div class="zs-modal-body zs-settings-body">
<section class="zs-settings-section"><div class="zs-label">Интерфейс</div><div class="zs-settings-card"><div class="zs-settings-row"><span class="zs-settings-copy">Показывать баланс в шапке</span><button class="zs-sw zs-settings-switch" data-key="showBalance" role="switch" aria-checked="false" aria-label="Показывать баланс в шапке"><i></i></button></div></div></section>
<section class="zs-settings-section"><div class="zs-label">Уведомления</div><div class="zs-settings-card"><div class="zs-settings-row"><span class="zs-settings-copy">Получать уведомления</span><button class="zs-sw zs-settings-switch" data-key="notifications" role="switch" aria-checked="true" aria-label="Получать уведомления"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Досье готово</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="dossierReady" role="switch" aria-checked="true" aria-label="Досье готово"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Ошибка формирования</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="formationError" role="switch" aria-checked="true" aria-label="Ошибка формирования"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Пополнение баланса</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="balanceTopup" role="switch" aria-checked="true" aria-label="Пополнение баланса"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Новости и обновления сервиса</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="news" role="switch" aria-checked="true" aria-label="Новости и обновления сервиса"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Важные уведомления</span><button class="zs-sw zs-settings-switch zs-notification-child" data-key="important" role="switch" aria-checked="true" aria-label="Важные уведомления"><i></i></button></div></div></section>
<section class="zs-settings-section"><div class="zs-label">Формирование досье</div><div class="zs-settings-card"><div class="zs-settings-row"><span class="zs-settings-copy">Открывать готовое досье автоматически</span><button class="zs-sw zs-settings-switch" data-key="autoOpen" role="switch" aria-checked="false" aria-label="Открывать готовое досье автоматически"><i></i></button></div><div class="zs-settings-row"><span class="zs-settings-copy">Запоминать последний тариф</span><button class="zs-sw zs-settings-switch" data-key="rememberTariff" role="switch" aria-checked="true" aria-label="Запоминать последний тариф"><i></i></button></div></div></section>
<section class="zs-settings-section"><button id="zsOpenConfirm" class="zs-settings-danger" type="button">Удалить данные аккаунта</button></section></div></div></section>`;

    const confirmBg = document.createElement('div');
    confirmBg.id = 'zsConfirmBg';
    confirmBg.className = 'zs-modal-bg zs-settings-confirm-bg';
    confirmBg.setAttribute('aria-hidden', 'true');
    confirmBg.innerHTML = `
<section id="zsConfirmDialog" class="zs-settings-confirm" role="dialog" aria-modal="true" aria-labelledby="zsConfirmTitle" tabindex="-1"><div class="zs-settings-confirm-inner"><header class="zs-modal-head"><h2 id="zsConfirmTitle" class="zs-modal-title">Удалить все данные?</h2><button id="zsCloseConfirm" class="zs-modal-x" type="button" aria-label="Закрыть подтверждение">${CLOSE_ICON}</button></header><div class="zs-settings-confirm-copy"><p>Действие необратимо. Досье, заказы, история, настройки и активность в сервисе будут удалены навсегда. Аккаунт Lolzteam не изменится.</p></div><label class="zs-settings-confirm-label" for="zsConfirmInput">Введите «<strong>УДАЛИТЬ</strong>» для подтверждения<input id="zsConfirmInput" class="zs-settings-input" autocomplete="off" spellcheck="false"></label><div class="zs-settings-confirm-actions"><button id="zsCancelConfirm" class="zs-btn" type="button">Отмена</button><button id="zsDeleteData" class="zs-btn zs-settings-delete" type="button" disabled>Удалить данные</button></div></div></section>`;

    document.body.appendChild(settingsBg);
    document.body.appendChild(confirmBg);

    els = {
      settingsBg, confirmBg,
      settingsDialog: settingsBg.querySelector('#zsSettingsDialog'),
      confirmDialog: confirmBg.querySelector('#zsConfirmDialog'),
      confirmInput: confirmBg.querySelector('#zsConfirmInput'),
      deleteData: confirmBg.querySelector('#zsDeleteData'),
    };

    // события
    settingsBg.querySelector('#zsCloseSettings').onclick = closeSettings;
    settingsBg.addEventListener('mousedown', e => { if (e.target === settingsBg) closeSettings(); });
    els.settingsDialog.addEventListener('keydown', e => trap(e, els.settingsDialog));

    settingsBg.querySelectorAll('.zs-settings-switch').forEach(btn => {
      btn.addEventListener('click', () => onToggle(btn));
    });

    settingsBg.querySelector('#zsOpenConfirm').onclick = openConfirm;
    confirmBg.querySelector('#zsCloseConfirm').onclick = closeConfirm;
    confirmBg.querySelector('#zsCancelConfirm').onclick = closeConfirm;
    confirmBg.addEventListener('mousedown', e => { if (e.target === confirmBg) closeConfirm(); });
    els.confirmDialog.addEventListener('keydown', e => trap(e, els.confirmDialog));
    els.confirmInput.addEventListener('input', () => {
      els.deleteData.disabled = els.confirmInput.value !== 'УДАЛИТЬ';
    });
    els.deleteData.onclick = onDeleteData;

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (confirmBg.classList.contains('open')) closeConfirm();
      else if (settingsBg.classList.contains('open')) closeSettings();
    });

    built = true;
    render();
  }

  // ── render ────────────────────────────────────────────────────────────
  function render() {
    if (!built) return;
    els.settingsBg.querySelectorAll('.zs-settings-switch').forEach(b => {
      const on = !!state[b.dataset.key];
      b.classList.toggle('zs-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    els.settingsBg.querySelectorAll('.zs-notification-child').forEach(b => {
      b.disabled = !state.notifications;
      const row = b.closest('.zs-settings-row');
      if (row) row.style.opacity = state.notifications ? '1' : '.42';
    });
  }

  // ── focus trap ──────────────────────────────────────────────────────────
  function focusables(root) {
    return [...root.querySelectorAll('button:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')]
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

  // ── toggle с optimistic update + rollback ─────────────────────────────────
  async function onToggle(btn) {
    if (btn.disabled || btn.classList.contains('is-busy')) return;
    const key = btn.dataset.key;
    const apiField = FIELD_MAP[key];
    const prev = !!state[key];
    const next = !prev;

    // optimistic
    state[key] = next;
    render();
    if (key === 'showBalance') applyBalancePill();
    btn.classList.add('is-busy');

    try {
      const fresh = await apiPatch(apiField, next);
      if (fresh) state = fromApi(fresh);
      render();
      if (key === 'showBalance') applyBalancePill();
      broadcast();
    } catch (err) {
      // rollback
      state[key] = prev;
      render();
      if (key === 'showBalance') applyBalancePill();
      toast('Не удалось сохранить настройку. Попробуйте ещё раз.', 'error');
    } finally {
      btn.classList.remove('is-busy');
    }
  }

  // ── open/close ────────────────────────────────────────────────────────────
  async function open() {
    build();
    settingsReturn = document.activeElement;
    els.settingsBg.classList.add('open');
    els.settingsBg.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => els.settingsBg.querySelector('#zsCloseSettings').focus());

    // подтягиваем актуальные настройки при каждом открытии
    try {
      const apiSettings = await apiGet();
      if (apiSettings) {
        state = fromApi(apiSettings);
        loaded = true;
        render();
        applyBalancePill();
        broadcast();
      }
    } catch (_) {
      toast('Не удалось загрузить настройки', 'error');
    }
  }
  function closeSettings() {
    if (els.confirmBg.classList.contains('open')) return;
    els.settingsBg.classList.remove('open');
    els.settingsBg.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (settingsReturn && settingsReturn.focus) settingsReturn.focus();
  }
  function openConfirm() {
    confirmReturn = document.activeElement;
    els.confirmInput.value = '';
    els.deleteData.disabled = true;
    els.confirmBg.classList.add('open');
    els.confirmBg.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => els.confirmInput.focus());
  }
  function closeConfirm() {
    els.confirmBg.classList.remove('open');
    els.confirmBg.setAttribute('aria-hidden', 'true');
    els.confirmInput.value = '';
    els.deleteData.disabled = true;
    if (confirmReturn && confirmReturn.focus) confirmReturn.focus();
  }

  // Безопасное удаление данных через DELETE /api/my/data.
  // Требует подтверждения фразой «УДАЛИТЬ» (проверяется и на клиенте, и на сервере).
  // Сервер: одна транзакция, идемпотентность, блокировка при активном заказе,
  // сохранение общих данных и чужих досье.
  async function onDeleteData() {
    if (els.confirmInput.value !== 'УДАЛИТЬ') return;
    const t = token();
    if (!t) { toast('Требуется авторизация', 'error'); return; }
    els.deleteData.disabled = true;
    els.deleteData.classList.add('is-busy');
    try {
      const r = await fetch(API + '/api/my/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ confirmation: 'УДАЛИТЬ' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 409) {
          toast(d.error || 'Дождитесь завершения активного заказа.', 'error');
        } else {
          toast(d.error || 'Не удалось удалить данные.', 'error');
        }
        els.deleteData.disabled = els.confirmInput.value !== 'УДАЛИТЬ';
        return;
      }
      // Успех: чистим локальный кэш профиля/настроек и уводим на дашборд.
      try {
        localStorage.removeItem('lzt_user');
        localStorage.removeItem('zelscan_settings_sync');
      } catch (_) {}
      closeConfirm();
      closeSettings();
      toast('Данные удалены', 'success');
      setTimeout(function () { location.href = '/app'; }, 900);
    } catch (err) {
      toast('Сервер недоступен. Попробуйте позже.', 'error');
      els.deleteData.disabled = els.confirmInput.value !== 'УДАЛИТЬ';
    } finally {
      els.deleteData.classList.remove('is-busy');
    }
  }

  // ── init: первичная загрузка настроек для видимости баланса ──────────────
  async function bootstrap() {
    
    try {
      const apiSettings = await apiGet();
      if (apiSettings) {
        state = fromApi(apiSettings);
        loaded = true;
        applyBalancePill();
      }
    } catch (_) { /* не критично на старте */ }
    // Гейт Anti-FOUC снимаем в любом случае: если настройки не загрузились,
    // показом баланса занимается account-ui (render), а не CSS-маска.
    try { document.documentElement.classList.add('zs-bal-ready'); } catch (_) {}
  }

  window.ZSSettings = {
    open,
    getState: () => ({ ...state }),
    isLoaded: () => loaded,
    applyBalancePill,
  };

  // account-ui.js обновляет шапку и повторно показывает .bal-pill при render(u)
  // (в т.ч. после async-загрузки профиля и события zs:profile). Каждый раз заново
  // применяем настройку, чтобы баланс не «возвращался» при выключенном show_balance.
  document.addEventListener('zs:profile', function () {
    if (loaded) applyBalancePill();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
