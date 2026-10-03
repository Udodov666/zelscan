/* Транзакции — стиль «Моих досье»: фильтр-дропдаун + строки-карточки. */
(() => {
  'use strict';

  const API = () => window.zsAccountApi;
  const AUTH = () => window.zsAuthHeaders();
  const filterLabels = { all: 'Все операции', topup: 'Пополнения', charge: 'Списания', refund: 'Возвраты' };

  const rows = document.querySelector('#txRows');
  const empty = document.querySelector('#txEmpty');
  const toolbar = document.querySelector('.account-toolbar');
  const head = document.querySelector('.tx-head');
  if (!rows || !empty) return;

  document.body.classList.add('my-dossiers');

  let items = [];
  let activeFilter = 'all';

  const setHeadVisible = (visible) => { if (head) head.style.display = visible ? '' : 'none'; };

  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (t) => t ? new Date(t * 1000).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const kind = (k) => ({ topup: ['Пополнение', 'plus', '+'], charge: ['Списание', '', '−'], refund: ['Возврат', 'plus', '+'] }[k] || ['Операция', '', '']);
  const state = (s) => ({ completed: ['Выполнено', 'done'], pending: ['Ожидает', 'pending'], failed: ['Ошибка', 'failed'] }[s] || [s, '']);

  function renderEmpty(title, text) {
    rows.innerHTML = `<div class="dossier-lab-empty dossier-lab-empty--initial"><i class="fa-solid fa-receipt" aria-hidden="true"></i><h3>${title}</h3><p>${text}</p></div>`;
  }

  function render() {
    const searchBox = document.getElementById('txSearch');
    const query = (searchBox ? searchBox.value : '').trim().toLowerCase();
    const matches = (t) => !query
      || String(t.description || '').toLowerCase().includes(query)
      || String(t.provider || '').toLowerCase().includes(query)
      || kind(t.kind)[0].toLowerCase().includes(query)
      || String(t.amount_rub || '').includes(query)
      || String(Math.abs(+t.credits || 0)).includes(query)
      || date(t.created_at).toLowerCase().includes(query);
    const visible = items.filter((t) => (activeFilter === 'all' || t.kind === activeFilter) && matches(t));
    setHeadVisible(Boolean(visible.length));
    if (!visible.length) {
      if (items.length) renderEmpty('Ничего не найдено', 'По выбранному запросу операций нет.');
      else renderEmpty('Транзакций пока нет', 'Здесь появятся пополнения и списания.');
      empty.style.display = 'none';
      return;
    }
    rows.innerHTML = visible.map((t) => {
      const [name, cls, sign] = kind(t.kind);
      const [stateLabel, stateCls] = state(t.status);
      const chgVal = Math.abs(+t.credits);
      const chg = chgVal ? sign + chgVal.toLocaleString('ru') + (t.kind === 'topup' ? ' ₽' : ' кр.') : (t.status === 'pending' ? '—' : sign + '0');
      return `<div class="tx-row"><div class="tx-main"><div class="tx-icon ${cls}">${sign || '•'}</div><div><div class="tx-name">${name}</div><div class="tx-desc">${escape(t.description || t.provider)}</div></div></div><div class="tx-cell">${date(t.created_at)}</div><div class="tx-cell tx-amount ${cls}">${chg}</div><div class="tx-cell">${(+t.amount_rub).toLocaleString('ru')} ₽</div><div class="tx-cell"><span class="tx-state ${stateCls}">${stateLabel}</span></div></div>`;
    }).join('');
    empty.style.display = 'none';
  }

  if (toolbar) {
    toolbar.innerHTML = `<label class="dossier-lab-search" aria-label="Поиск операций"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4-4"></path></svg><input id="txSearch" type="search" placeholder="Поиск по операциям" autocomplete="off"></label><div class="dossier-lab-controls"><div class="dossier-lab-sort"><button class="dossier-sort-trigger" id="txFilterTrigger" type="button" aria-haspopup="menu" aria-expanded="false"><span>Все операции</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg></button><div class="dossier-sort-menu" id="txFilterMenu" role="menu"><button class="dossier-sort-option is-active" type="button" role="menuitem" data-tx-filter="all">Все операции</button><button class="dossier-sort-option" type="button" role="menuitem" data-tx-filter="topup">Пополнения</button><button class="dossier-sort-option" type="button" role="menuitem" data-tx-filter="charge">Списания</button><button class="dossier-sort-option" type="button" role="menuitem" data-tx-filter="refund">Возвраты</button></div></div></div>`;
    toolbar.classList.add('dossier-toolbar--sort-only');

    const search = document.getElementById('txSearch');
    search.addEventListener('input', () => render());
    const sortBox = toolbar.querySelector('.dossier-lab-sort');
    const trigger = document.getElementById('txFilterTrigger');
    const options = [...toolbar.querySelectorAll('[data-tx-filter]')];
    trigger.addEventListener('click', () => {
      const open = sortBox.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', String(open));
    });
    options.forEach((option) => option.addEventListener('click', () => {
      activeFilter = option.dataset.txFilter;
      options.forEach((node) => node.classList.toggle('is-active', node === option));
      trigger.querySelector('span').textContent = filterLabels[activeFilter];
      sortBox.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      render();
    }));
    document.addEventListener('click', (event) => {
      if (!sortBox.contains(event.target)) { sortBox.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }
    });
  }

  (async () => {
    const skeleton = window.ZSSkeleton;
    const startedAt = skeleton ? skeleton.mount(rows, skeleton.txTable(8)) : performance.now();
    const settle = (content) => skeleton
      ? skeleton.settle(rows, content, startedAt)
      : Promise.resolve().then(() => {
        const html = typeof content === 'function' ? content() : content;
        if (html !== undefined) rows.innerHTML = html;
        rows.removeAttribute('aria-busy');
      });
    try {
      const [r] = await Promise.all([
        fetch(`${API()}/api/my/transactions?limit=100`, { headers: AUTH(), credentials: 'same-origin' }),
        fetch(`${API()}/api/my/profile`, { headers: AUTH(), credentials: 'same-origin' }),
      ]);
      if (!r.ok) throw new Error();
      items = (await r.json()).transactions || [];
      await settle(() => { render(); return rows.innerHTML; });
    } catch {
      setHeadVisible(false);
      await settle('<div class="dossier-lab-empty">Не удалось загрузить транзакции. Проверь backend на локальном API.</div>');
    }
  })();
})();
