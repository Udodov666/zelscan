/* Мои досье — карточки на реальных данных GET /api/my/orders (+ report{} из готового отчёта). */
(() => {
  'use strict';

  const perPage = 9;
  const SAFE_NICK_STYLE_PROPERTIES = ['color', 'background', 'background-color', 'text-shadow', '-webkit-background-clip', '-webkit-text-fill-color'];
  const sortLabels = { newest: 'Сначала новые', oldest: 'Сначала старые', likes: 'По лайкам' };

  const API = () => window.zsAccountApi || '';
  const H = () => typeof window.zsAuthHeaders === 'function'
    ? window.zsAuthHeaders()
    : (() => { const token = localStorage.getItem('lzt_token') || ''; return token ? { Authorization: `Bearer ${token}` } : {}; })();

  let dossiers = [];

  const escape = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const number = (v) => new Intl.NumberFormat('ru-RU').format(Number(v) || 0);
  const initial = (name) => escape(String(name || '?').slice(0, 1).toUpperCase());

  function cleanUsername(value) {
    const parsed = new DOMParser().parseFromString(String(value || ''), 'text/html');
    return (parsed.body.textContent || '').trim();
  }

  function applyForumNicknameStyle(element, usernameHtml) {
    if (!element || !usernameHtml) return;
    const parsed = new DOMParser().parseFromString(usernameHtml, 'text/html');
    const source = parsed.querySelector('.styleUserNickname, [style]');
    if (!source) return;
    SAFE_NICK_STYLE_PROPERTIES.forEach((property) => {
      const value = source.style.getPropertyValue(property).trim();
      if (!value || /url\s*\(|expression\s*\(|@import/i.test(value)) return;
      element.style.setProperty(property, value);
    });
  }

  function normalizeOrder(o) {
    const id = Number(o.user_id || 0);
    const usernameHtml = String(o.username_html || '');
    const name = cleanUsername(usernameHtml || o.username) || ('ID ' + id);
    return {
      id,
      orderId: o.order_id,
      name,
      usernameHtml,
      avatar: o.avatar || '',
      profile: `https://lolz.team/members/${id}/`,
      status: String(o.status || ''),
      reportType: o.report_type === 'full' ? 'full' : 'basic',
      createdAt: Number(o.created_at || 0),
      report: o.report || null,
      likes: Number((o.report && o.report.likes) || 0),
    };
  }

  function currentOnlyDossiers(orders) {
    const current = new Map();
    (Array.isArray(orders) ? orders : []).forEach((order) => {
      if (!order || order.is_archived || order.status === 'archived' || order.status === 'result_unavailable') return;
      const normalized = normalizeOrder(order);
      const key = `${normalized.id}:${normalized.reportType}`;
      const existing = current.get(key);
      if (!existing || normalized.createdAt > existing.createdAt ||
          (normalized.createdAt === existing.createdAt && String(normalized.orderId) > String(existing.orderId))) {
        current.set(key, normalized);
      }
    });
    return [...current.values()];
  }

  function statusState(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'done') return { key: 'ready', label: 'Готово' };
    if (s === 'error' || s === 'expired') return { key: 'error', label: 'Ошибка' };
    return { key: 'working', label: 'В работе' };
  }

  function avatarMarkup(item) {
    if (item.avatar) return `<img src="${escape(item.avatar)}" alt="" referrerpolicy="no-referrer">`;
    return initial(item.name);
  }

  function planMarkup(item) {
    const label = item.reportType === 'full' ? 'Полный AI' : 'Базовый';
    const cls = item.reportType === 'full' ? 'dossier-plan--full' : 'dossier-plan--basic';
    const icon = item.reportType === 'full' ? 'assets/img/gotovo2.png' : 'assets/img/gotovo1.png';
    return `<span class="dossier-plan ${cls}"><img class="dossier-plan-icon" src="${icon}" alt="" aria-hidden="true"><span>${label}</span></span>`;
  }

  function scoreMarkup(item) {
    const rep = item.report;
    if (rep && rep.reputation_score != null) {
      const color = rep.reputation_color ? ` style="color:${escape(rep.reputation_color)}"` : '';
      return `<span class="dossier-score" title="Репутация и споры"><i class="fa-solid fa-gavel" aria-hidden="true"${color}></i><span class="dossier-score-value"${color}><strong>${escape(rep.reputation_score)}</strong><span class="dossier-score-max">/100</span></span></span>`;
    }
    return `<span class="dossier-score dossier-score--empty" title="Репутация появится после готовности отчёта"><i class="fa-solid fa-gavel" aria-hidden="true"></i><span class="dossier-score-value"><strong>—</strong><span class="dossier-score-max">/100</span></span></span>`;
  }

  const statValue = (v) => (v == null ? '—' : number(v));

  function barMarkup(cls, label, value) {
    const has = value != null;
    const pct = has ? Math.max(0, Math.min(100, Number(value) || 0)) : 0;
    const top = has ? `${pct}%` : '—';
    return `<div class="dossier-bar ${cls}"><div class="dossier-bar-top"><strong>${top}</strong></div><div class="dossier-track"><i class="dossier-fill" style="width:${pct}%"></i></div><span>${label}</span></div>`;
  }

  function renderCard(item) {
    const rep = item.report || {};
    const st = statusState(item.status);
    const reportTags = Array.isArray(rep.tags) ? rep.tags.slice(0, 2).map((tag) => String(tag || '').trim()).filter(Boolean) : [];
    const reportTagsMarkup = reportTags.length
      ? `<div class="dossier-tags">${reportTags.map((tag) => `<span class="dossier-tag">${escape(tag)}</span>`).join('')}</div>`
      : '';
    const avatarBlur = item.avatar ? `<img class="dossier-avatar-photoblur" src="${escape(item.avatar)}" alt="" aria-hidden="true" referrerpolicy="no-referrer">` : '';
    return `<article class="dossier-card" tabindex="0" role="link" data-order-id="${escape(item.orderId)}" data-status="${escape(item.status)}" data-name="${escape(item.name.toLowerCase())}" aria-label="Открыть карточку ${escape(item.name)}">
      ${avatarBlur}
      <div class="dossier-card-top">
        <div class="dossier-person">
          <span class="dossier-avatar" aria-hidden="true">${avatarMarkup(item)}</span>
          <div class="dossier-person-copy">
            <div class="dossier-name-row"><span class="dossier-name" data-user-id="${item.id}">${escape(item.name)}</span><a class="dossier-verified dossier-profile-link" href="${escape(item.profile)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть профиль ${escape(item.name)} на Lolzteam"><img src="assets/img/zelenka.svg" alt="" aria-hidden="true"></a></div>
            ${reportTagsMarkup}
          </div>
        </div>
        <div class="dossier-meta">
          <div class="dossier-card-badges"><span class="dossier-report-status dossier-report-status--${st.key}">${st.label}</span>${planMarkup(item)}</div>
          ${scoreMarkup(item)}
        </div>
      </div>
      <div class="dossier-stats">
        <div class="dossier-stat"><strong>${statValue(rep.topics)}</strong><span>Темы</span></div>
        <div class="dossier-stat"><strong>${statValue(rep.messages)}</strong><span>Сообщений</span></div>
        <div class="dossier-stat"><strong>${statValue(rep.likes)}</strong><span>Лайки</span></div>
      </div>
      <div class="dossier-bars">
        ${barMarkup('dossier-bar--confidence', 'Уверенность', item.report ? rep.confidence : null)}
        ${barMarkup('dossier-bar--ego', 'Эго', item.report ? rep.ego : null)}
        ${barMarkup('dossier-bar--conflict', 'Конфликтность', item.report ? rep.conflict : null)}
      </div>
    </article>`;
  }

  function openDossier(item) {
    if (!item) return;
    const st = statusState(item.status);
    if (st.key !== 'ready') {
      try {
        if (window.ZSModals && typeof ZSModals.openOrder === 'function') {
          ZSModals.openOrder({ user_id: item.id, username: item.name, avatar: item.avatar, order_id: item.orderId, status: item.status });
          return;
        }
      } catch (e) { /* fallthrough */ }
    }
    location.href = '/report?order=' + encodeURIComponent(item.orderId);
  }

  function setup() {
    const list = document.getElementById('dossierList');
    const toolbar = document.querySelector('.account-toolbar');
    const empty = document.getElementById('dossierEmpty');
    if (!list || !toolbar) return;

    document.body.classList.add('my-dossiers');
    if (empty) empty.style.display = 'none';

    const pagination = document.createElement('nav');
    pagination.className = 'dossier-pagination';
    pagination.setAttribute('aria-label', 'Пагинация досье');
    list.insertAdjacentElement('afterend', pagination);

    toolbar.innerHTML = `<label class="dossier-lab-search" aria-label="Поиск досье"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4-4"></path></svg><input id="dossierLabSearch" type="search" placeholder="Поиск по нику или ID" autocomplete="off"></label><div class="dossier-lab-controls"><div class="dossier-lab-sort"><button class="dossier-sort-trigger" id="dossierSortTrigger" type="button" aria-haspopup="menu" aria-expanded="false"><span>Сначала новые</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><div class="dossier-sort-menu" id="dossierSortMenu" role="menu"><button class="dossier-sort-option is-active" type="button" role="menuitem" data-sort="newest">Сначала новые</button><button class="dossier-sort-option" type="button" role="menuitem" data-sort="oldest">Сначала старые</button><button class="dossier-sort-option" type="button" role="menuitem" data-sort="likes">По лайкам</button></div></div></div>`;
    toolbar.classList.add('dossier-toolbar--sort-only');

    const search = document.getElementById('dossierLabSearch');
    const sortBox = toolbar.querySelector('.dossier-lab-sort');
    const sortTrigger = document.getElementById('dossierSortTrigger');
    const sortOptions = [...toolbar.querySelectorAll('.dossier-sort-option')];
    let activeSort = 'newest';
    let page = 1;

    const visibleRows = () => {
      const query = search.value.trim().toLowerCase();
      const rows = dossiers.filter((item) => !query || item.name.toLowerCase().includes(query) || String(item.id).includes(query) || String(item.orderId).toLowerCase().includes(query));
      return rows.sort((a, b) => {
        if (activeSort === 'likes') return b.likes - a.likes || b.createdAt - a.createdAt;
        if (activeSort === 'oldest') return a.createdAt - b.createdAt;
        return b.createdAt - a.createdAt;
      });
    };

    const renderPagination = (pageCount) => {
      if (pageCount <= 1) { pagination.innerHTML = ''; return; }
      const pages = Array.from({ length: pageCount }, (_, index) => `<button class="dossier-page-btn${page === index + 1 ? ' is-active' : ''}" type="button" data-page="${index + 1}" aria-label="Страница ${index + 1}" aria-current="${page === index + 1 ? 'page' : 'false'}">${index + 1}</button>`).join('');
      pagination.innerHTML = `<button class="dossier-page-btn" type="button" data-page="prev" aria-label="Предыдущая страница" ${page === 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg></button>${pages}<button class="dossier-page-btn" type="button" data-page="next" aria-label="Следующая страница" ${page === pageCount ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"></path></svg></button>`;
    };

    const render = (resetPage = false) => {
      if (resetPage) page = 1;
      const rows = visibleRows();
      const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
      if (page > pageCount) page = pageCount;
      const visible = rows.slice((page - 1) * perPage, page * perPage);
      if (visible.length) {
        list.innerHTML = visible.map(renderCard).join('');
      } else if (dossiers.length === 0) {
        list.innerHTML = '<div class="dossier-lab-empty dossier-lab-empty--initial"><i class="fa-solid fa-file-lines" aria-hidden="true"></i><h3>У вас пока нет досье</h3><p>Создайте первое досье, чтобы оно появилось здесь.</p><button class="dossier-empty-action" type="button">Создать досье</button></div>';
        const createButton = list.querySelector('.dossier-empty-action');
        if (createButton) createButton.addEventListener('click', () => {
          if (typeof window.openHeaderSearch === 'function') window.openHeaderSearch();
        });
      } else {
        list.innerHTML = '<div class="dossier-lab-empty">По выбранному запросу досье не найдены.</div>';
      }
      list.querySelectorAll('.dossier-name[data-user-id]').forEach((element) => {
        const item = dossiers.find((row) => String(row.id) === element.dataset.userId);
        applyForumNicknameStyle(element, item?.usernameHtml || '');
      });
      renderPagination(pageCount);
    };

    search.addEventListener('input', () => render(true));
    sortTrigger.addEventListener('click', () => {
      const open = sortBox.classList.toggle('is-open');
      sortTrigger.setAttribute('aria-expanded', String(open));
    });
    sortOptions.forEach((option) => option.addEventListener('click', () => {
      activeSort = option.dataset.sort;
      sortOptions.forEach((node) => node.classList.toggle('is-active', node === option));
      sortTrigger.querySelector('span').textContent = sortLabels[activeSort];
      sortBox.classList.remove('is-open');
      sortTrigger.setAttribute('aria-expanded', 'false');
      render(true);
    }));
    document.addEventListener('click', (event) => {
      if (!sortBox.contains(event.target)) { sortBox.classList.remove('is-open'); sortTrigger.setAttribute('aria-expanded', 'false'); }
    });
    pagination.addEventListener('click', (event) => {
      const control = event.target.closest('[data-page]');
      if (!control || control.disabled) return;
      const target = control.dataset.page;
      const pageCount = Math.max(1, Math.ceil(visibleRows().length / perPage));
      page = target === 'prev' ? Math.max(1, page - 1) : target === 'next' ? Math.min(pageCount, page + 1) : Number(target);
      render();
    });

    list.addEventListener('click', (event) => {
      if (event.target.closest('.dossier-profile-link')) return;
      const card = event.target.closest('.dossier-card');
      if (!card) return;
      const item = dossiers.find((row) => String(row.orderId) === card.dataset.orderId);
      openDossier(item);
    });
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.dossier-card');
      if (!card) return;
      event.preventDefault();
      const item = dossiers.find((row) => String(row.orderId) === card.dataset.orderId);
      openDossier(item);
    });

    async function loadOrders() {
      const skeleton = window.ZSSkeleton;
      const startedAt = skeleton ? skeleton.mount(list, skeleton.dossierGrid(6)) : performance.now();
      const settle = (content) => skeleton
        ? skeleton.settle(list, content, startedAt)
        : Promise.resolve().then(() => {
          const html = typeof content === 'function' ? content() : content;
          if (html !== undefined) list.innerHTML = html;
          list.removeAttribute('aria-busy');
        });
      try {
        const r = await fetch(API() + '/api/my/orders?limit=100', {
          headers: H(),
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error('bad response');
        const data = await r.json();
        dossiers = currentOnlyDossiers(data.orders);
        if (empty) empty.style.display = 'none';
        await settle(() => { render(true); return list.innerHTML; });
      } catch (e) {
        pagination.innerHTML = '';
        await settle('<div class="dossier-lab-empty">Не удалось загрузить досье. Проверь backend на локальном API.</div>');
      }
    }

    loadOrders();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();

  window.addEventListener('load', () => {
    const sortTrigger = document.getElementById('dossierSortTrigger');
    const sortMenu = document.querySelector('.dossier-sort-menu');
    if (!sortTrigger || !sortMenu) return;
    const syncSortMenuWidth = () => {
      const width = Math.ceil(sortTrigger.getBoundingClientRect().width);
      sortMenu.style.width = `${width}px`;
      sortMenu.style.minWidth = `${width}px`;
      sortMenu.style.boxSizing = 'border-box';
    };
    syncSortMenuWidth();
    sortTrigger.addEventListener('click', () => requestAnimationFrame(syncSortMenuWidth));
    window.addEventListener('resize', syncSortMenuWidth);
    if ('ResizeObserver' in window) new ResizeObserver(syncSortMenuWidth).observe(sortTrigger);
  });
})();

/* zelscan-dossier-report-tags-v1 */

/* Выбор юзера из хедер-поиска — сразу открываем модалку заказа здесь */
window.pick = function (u) {
  u._selectionSource = 'search';
  // модалка берёт юзера из window.selectedUser (как на дашборде)
  window.selectedUser = u;
  window._lastSelectedUser = u;
  // ZSModals — top-level const в order-modals.js: это глобальная лексическая
  // привязка, а НЕ window.ZSModals. Проверяем через typeof.
  if (typeof ZSModals !== 'undefined' && ZSModals.openOrder) ZSModals.openOrder(u);
};
