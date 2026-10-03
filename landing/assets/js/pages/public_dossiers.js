/* Общие досье — карточки как в «Моих досье» на данных GET /api/public/dossiers. */
(() => {
  'use strict';

  const perPage = 9;
  const API = () => window.zsAccountApi || '';
  const SAFE_NICK_STYLE_PROPERTIES = ['color', 'background', 'background-color', 'text-shadow', '-webkit-background-clip', '-webkit-text-fill-color'];
  const sortLabels = { new: 'Сначала новые', popular: 'Популярные', alphabet: 'По алфавиту' };

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

  function normalizeDossier(o) {
    const id = Number(o.user_id || 0);
    const usernameHtml = String(o.username_html || '');
    const name = cleanUsername(usernameHtml || o.username) || ('ID ' + id);
    return {
      id,
      displayId: o.display_id,
      name,
      usernameHtml,
      avatar: o.avatar || '',
      profile: `https://lolz.team/members/${id}/`,
      reportType: o.report_type === 'full' ? 'full' : 'basic',
      createdAt: Number(o.finished_at || o.created_at || 0),
      report: o.report || null,
    };
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
    return `<span class="dossier-score dossier-score--empty" title="Репутация и споры"><i class="fa-solid fa-gavel" aria-hidden="true"></i><span class="dossier-score-value"><strong>—</strong><span class="dossier-score-max">/100</span></span></span>`;
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
    const reportTags = Array.isArray(rep.tags) ? rep.tags.slice(0, 2).map((tag) => String(tag || '').trim()).filter(Boolean) : [];
    const reportTagsMarkup = reportTags.length
      ? `<div class="dossier-tags">${reportTags.map((tag) => `<span class="dossier-tag">${escape(tag)}</span>`).join('')}</div>`
      : '';
    const avatarBlur = item.avatar ? `<img class="dossier-avatar-photoblur" src="${escape(item.avatar)}" alt="" aria-hidden="true" referrerpolicy="no-referrer">` : '';
    return `<article class="dossier-card" tabindex="0" role="link" data-display-id="${escape(item.displayId)}" data-name="${escape(item.name.toLowerCase())}" aria-label="Открыть досье ${escape(item.name)}">
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
          <div class="dossier-card-badges"><span class="dossier-report-status dossier-report-status--ready">Готово</span>${planMarkup(item)}</div>
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
    location.href = '/report?public=' + encodeURIComponent(item.displayId);
  }

  function setup() {
    const list = document.getElementById('dossierList');
    const toolbar = document.querySelector('.account-toolbar');
    const empty = document.getElementById('publicEmpty');
    if (!list || !toolbar) return;

    document.body.classList.add('my-dossiers');

    const pagination = document.createElement('nav');
    pagination.className = 'dossier-pagination';
    pagination.setAttribute('aria-label', 'Пагинация досье');
    list.insertAdjacentElement('afterend', pagination);

    toolbar.innerHTML = `<label class="dossier-lab-search" aria-label="Поиск досье"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4-4"></path></svg><input id="publicLabSearch" type="search" placeholder="Поиск по нику или ID" autocomplete="off"></label><div class="dossier-lab-controls"><div class="dossier-lab-sort"><button class="dossier-sort-trigger" id="publicSortTrigger" type="button" aria-haspopup="menu" aria-expanded="false"><span>Сначала новые</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><div class="dossier-sort-menu" id="publicSortMenu" role="menu"><button class="dossier-sort-option is-active" type="button" role="menuitem" data-sort="new">Сначала новые</button><button class="dossier-sort-option" type="button" role="menuitem" data-sort="popular">Популярные</button><button class="dossier-sort-option" type="button" role="menuitem" data-sort="alphabet">По алфавиту</button></div></div></div>`;
    toolbar.classList.add('dossier-toolbar--sort-only');

    const search = document.getElementById('publicLabSearch');
    const sortBox = toolbar.querySelector('.dossier-lab-sort');
    const sortTrigger = document.getElementById('publicSortTrigger');
    const sortOptions = [...toolbar.querySelectorAll('.dossier-sort-option')];
    let activeSort = 'new';
    let page = 1;
    let loading = false;
    let requestVersion = 0;
    let firstLoad = true;

    const renderPagination = (pageCount) => {
      if (pageCount <= 1) { pagination.innerHTML = ''; return; }
      const pages = Array.from({ length: pageCount }, (_, index) => `<button class="dossier-page-btn${page === index + 1 ? ' is-active' : ''}" type="button" data-page="${index + 1}" aria-label="Страница ${index + 1}" aria-current="${page === index + 1 ? 'page' : 'false'}">${index + 1}</button>`).join('');
      pagination.innerHTML = `<button class="dossier-page-btn" type="button" data-page="prev" aria-label="Предыдущая страница" ${page === 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"></path></svg></button>${pages}<button class="dossier-page-btn" type="button" data-page="next" aria-label="Следующая страница" ${page === pageCount ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"></path></svg></button>`;
    };

    const render = () => {
      const pageCount = Math.max(1, Math.ceil(dossiers.length / perPage));
      if (page > pageCount) page = pageCount;
      const visible = dossiers.slice((page - 1) * perPage, page * perPage);
      if (visible.length) {
        list.innerHTML = visible.map(renderCard).join('');
      } else if (dossiers.length === 0) {
        list.innerHTML = `<div class="dossier-lab-empty dossier-lab-empty--initial"><i class="fa-solid fa-file-lines" aria-hidden="true"></i><h3>Публичных досье пока нет</h3><p>Первое опубликованное досье появится здесь.</p></div>`;
      } else {
        list.innerHTML = '<div class="dossier-lab-empty">По выбранному запросу досье не найдены.</div>';
      }
      list.querySelectorAll('.dossier-name[data-user-id]').forEach((element) => {
        const item = dossiers.find((row) => String(row.id) === element.dataset.userId);
        applyForumNicknameStyle(element, item?.usernameHtml || '');
      });
      renderPagination(pageCount);
    };

    async function fetchChunk(offset) {
      const q = encodeURIComponent(search.value.trim());
      const r = await fetch(`${API()}/api/public/dossiers?limit=60&offset=${offset}&sort=${activeSort}&q=${q}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Не удалось загрузить');
      return data;
    }

    async function load() {
      const version = ++requestVersion;
      const skeleton = window.ZSSkeleton;
      const startedAt = skeleton ? skeleton.mount(list, skeleton.dossierGrid(firstLoad ? 6 : 3)) : performance.now();
      const settle = (content) => skeleton
        ? skeleton.settle(list, content, startedAt, { minMs: firstLoad ? 350 : 120 })
        : Promise.resolve().then(() => {
          const html = typeof content === 'function' ? content() : content;
          if (html !== undefined) list.innerHTML = html;
          list.removeAttribute('aria-busy');
        });
      loading = true;
      pagination.innerHTML = '';
      try {
        let all = [];
        let offset = 0;
        for (let hop = 0; hop < 10; hop++) {
          const data = await fetchChunk(offset);
          if (version !== requestVersion) return;
          all = all.concat(data.dossiers || []);
          offset = all.length;
          if (!data.has_more) break;
          if (skeleton) list.insertAdjacentHTML('beforeend', skeleton.dossierGrid(3));
        }
        if (version !== requestVersion) return;
        dossiers = all.map(normalizeDossier);
        page = 1;
        await settle(() => { render(); return list.innerHTML; });
      } catch (e) {
        if (version !== requestVersion) return;
        dossiers = [];
        await settle(`<div class="dossier-lab-empty">${escape(e.message || 'Не удалось загрузить досье. Проверь backend на локальном API.')}</div>`);
      } finally {
        if (version === requestVersion) {
          loading = false;
          firstLoad = false;
        }
      }
    }

    let timer;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 240); });
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
      load();
    }));
    document.addEventListener('click', (event) => {
      if (!sortBox.contains(event.target)) { sortBox.classList.remove('is-open'); sortTrigger.setAttribute('aria-expanded', 'false'); }
    });
    pagination.addEventListener('click', (event) => {
      const control = event.target.closest('[data-page]');
      if (!control || control.disabled) return;
      const target = control.dataset.page;
      const pageCount = Math.max(1, Math.ceil(dossiers.length / perPage));
      page = target === 'prev' ? Math.max(1, page - 1) : target === 'next' ? Math.min(pageCount, page + 1) : Number(target);
      render();
    });

    list.addEventListener('click', (event) => {
      if (event.target.closest('.dossier-profile-link')) return;
      const card = event.target.closest('.dossier-card');
      if (!card) return;
      openDossier(dossiers.find((row) => String(row.displayId) === card.dataset.displayId));
    });
    list.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.dossier-card');
      if (!card) return;
      event.preventDefault();
      openDossier(dossiers.find((row) => String(row.displayId) === card.dataset.displayId));
    });

    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();

  window.addEventListener('load', () => {
    const sortTrigger = document.getElementById('publicSortTrigger');
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
