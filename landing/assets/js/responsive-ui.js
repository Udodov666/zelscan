/* Shared responsive behavior. No API or report-data logic lives here. */
(() => {
  const header = document.querySelector('.header');
  if (!header) return;

  document.querySelectorAll('.tile:has(.tile-card)').forEach((tile) => {
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      if (!matchMedia('(max-width:640px)').matches) return;
      const open = !tile.classList.contains('is-expanded');
      document.querySelectorAll('.tile.is-expanded').forEach((item) => {
        item.classList.remove('is-expanded');
        item.setAttribute('aria-expanded', 'false');
      });
      tile.classList.toggle('is-expanded', open);
      tile.setAttribute('aria-expanded', String(open));
    };
    tile.addEventListener('click', toggle);
    tile.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
    });
  });

  // Тап вне плиток закрывает раскрытую плитку (иначе панель висит до тапа
  // по другой плитке). Тапы по плиткам пропускаем — у них свой toggle,
  // и bubbling до document не должен тут же закрыть только что открытую.
  document.addEventListener('click', (event) => {
    if (!matchMedia('(max-width:640px)').matches) return;
    if (event.target.closest && event.target.closest('.tile')) return;
    document.querySelectorAll('.tile.is-expanded').forEach((item) => {
      item.classList.remove('is-expanded');
      item.setAttribute('aria-expanded', 'false');
    });
  });

  const fitTileLabel = (label) => {
    if (!matchMedia('(max-width:640px)').matches || label.clientWidth <= 0) {
      label.style.removeProperty('font-size');
      label.style.removeProperty('letter-spacing');
      return;
    }
    label.style.fontSize = '12.5px';
    label.style.letterSpacing = '-0.01em';
    let size = 12.5;
    while (label.scrollWidth > label.clientWidth + 0.5 && size > 8.5) {
      size -= 0.25;
      label.style.fontSize = `${size}px`;
    }
    if (label.scrollWidth > label.clientWidth + 0.5) label.style.letterSpacing = '-0.04em';
  };

  const fitAllTileLabels = () => {
    document.querySelectorAll('.tile .lab,.tile-lab').forEach(fitTileLabel);
  };
  let fitFrame = 0;
  const scheduleTileFit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitAllTileLabels);
  };
  const tileResizeObserver = new ResizeObserver(scheduleTileFit);
  document.querySelectorAll('.tiles,.tile,.tile .tl,.tile-tl').forEach((node) => tileResizeObserver.observe(node));
  new MutationObserver(scheduleTileFit).observe(document.body, {subtree:true, childList:true, characterData:true});
  addEventListener('resize', scheduleTileFit, {passive:true});
  if (document.fonts?.ready) document.fonts.ready.then(scheduleTileFit);
  scheduleTileFit();

  const activeTab = document.querySelector('.tabs .tab.active');
  if (activeTab) requestAnimationFrame(() => activeTab.scrollIntoView({block:'nearest', inline:'center'}));
})();

/* Mobile bottom tab bar: app-style navigation, shown instead of the sidebar
   on <=900px. Icons and labels mirror the sidebar-lab.js menu — the same
   Font Awesome solid glyphs the desktop sidebar (variant 1) uses. */
(() => {
  const fa = {
    home: 'fa-solid fa-house',
    dossiers: 'fa-solid fa-database',
    globe: 'fa-solid fa-earth-europe',
    receipt: 'fa-solid fa-receipt',
    news: 'fa-solid fa-newspaper',
  };
  const items = [
    { href: '/app', icon: fa.home, label: 'Главная' },
    { href: '/dossiers', icon: fa.dossiers, label: 'Мои досье' },
    { href: '/explore', icon: fa.globe, label: 'Общие' },
    { href: '/billing', icon: fa.receipt, label: 'Транзакции' },
    { href: '/updates', icon: fa.news, label: 'Новости' },
  ];
  const current = (location.pathname.split('/').pop() || '').toLowerCase();
  const nav = document.createElement('nav');
  nav.className = 'zs-tabbar';
  nav.setAttribute('aria-label', 'Основная навигация');
  nav.innerHTML = items.map((item) => {
    const active = item.href.split('/').pop().toLowerCase() === current;
    return `<a class="tb-item${active ? ' active' : ''}" href="${item.href}"${active ? ' aria-current="page"' : ''}><i class="${item.icon}" aria-hidden="true"></i><span>${item.label}</span></a>`;
  }).join('');
  document.body.appendChild(nav);
})();

/* Header search: the existing .search box is the input. Typing shows a
   dropdown of results; clicking a result opens dossier creation for that user. */
(() => {
  const header = document.querySelector('.header');
  if (!header) return;
  const box = header.querySelector('.search');
  if (!box) return;
  const input = box.querySelector('.search-input');
  const drop = box.querySelector('.search-drop');
  if (!input || !drop) return;

  /* Mobile (<=640px): the search collapses into a circle icon; tapping it
     expands the search over the whole header until closed. */
  const mobileViewport = matchMedia('(max-width:640px)');
  const searchOpen = () => header.classList.contains('zs-search-open');
  const closeSearch = () => {
    header.classList.remove('zs-search-open');
    drop.hidden = true;
    input.value = '';
    input.blur();
  };
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'zs-search-close';
  closeBtn.setAttribute('aria-label', 'Закрыть поиск');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  box.appendChild(closeBtn);
  box.addEventListener('click', (event) => {
    if (!mobileViewport.matches || searchOpen() || event.target.closest('.search-drop')) return;
    header.classList.add('zs-search-open');
    requestAnimationFrame(() => input.focus());
  });
  closeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    closeSearch();
  });
  /* On phones the search lives on the right, next to the avatar (like the
     reference header); on wider screens it returns next to the logo. */
  const hLeft = header.querySelector('.h-left');
  const hRight = header.querySelector('.h-right');
  const placeSearch = () => {
    if (mobileViewport.matches && hRight) hRight.insertBefore(box, hRight.firstChild);
    else if (!mobileViewport.matches && hLeft) hLeft.insertBefore(box, hLeft.children[1] || null);
  };
  placeSearch();
  const onViewportChange = () => {
    if (!mobileViewport.matches && searchOpen()) closeSearch();
    placeSearch();
  };
  if (mobileViewport.addEventListener) mobileViewport.addEventListener('change', onViewportChange);
  else mobileViewport.addListener(onViewportChange);
  let placeTimer = null;
  addEventListener('resize', () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(onViewportChange, 120);
  }, { passive: true });

  const API = '';
  const authHeaders = () => {
    const t = localStorage.getItem('lzt_token');
    return t ? { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' }
             : { 'Content-Type': 'application/json' };
  };
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const MIN_DISCOVERY_MESSAGE_COUNT = 10;
  const profileMessageCount = u => {
    const count = Number(u && (u.message_count ?? u.user_message_count));
    return Number.isFinite(count) ? count : 0;
  };
  const discoveryUsers = users => (users || []).filter(u => profileMessageCount(u) >= MIN_DISCOVERY_MESSAGE_COUNT);

  const render = (users) => {
    if (!users || !users.length) { drop.hidden = true; drop.innerHTML = ''; return; }
    drop.innerHTML = users.map((u, index) => {
      const letter = (u.username ? u.username[0] : '?').toUpperCase();
      const av = u.avatar
        ? `<div class="sd-av"><img src="${esc(u.avatar)}" alt="" onerror="this.parentNode.innerHTML='${letter}'"></div>`
        : `<div class="sd-av">${letter}</div>`;
      return `<li class="sd-item" role="option" data-uid="${u.user_id}" data-name="${esc(u.username)}" data-avatar="${esc(u.avatar || '')}" data-message-count="${profileMessageCount(u)}">`
        + av
        + `<div class="sd-info"><div class="sd-name">${window.ZSNickname.sanitizeUser(u)}${u.is_banned ? '<span class="sd-ban">бан</span>' : ''}</div>`
        + `<div class="sd-meta"><svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M256 448c141.4 0 256-93.1 256-208S397.4 32 256 32S0 125.1 0 240c0 45.1 17.7 86.8 47.7 120.9c-1.9 24.5-11.4 46.3-21.4 62.9c-5.5 9.2-11.1 16.6-15.2 21.6c-2.1 2.5-3.7 4.4-4.9 5.7c-.6 .6-1 1.1-1.3 1.4l-.3 .3c0 0 0 0 0 0c0 0 0 0 0 0s0 0 0 0s0 0 0 0c-4.6 4.6-5.9 11.4-3.4 17.4c2.5 6 8.3 9.9 14.8 9.9c28.7 0 57.6-8.9 81.6-19.3c22.9-10 42.4-21.9 54.3-30.6c31.8 11.5 67 17.9 104.1 17.9zM128 208a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm128 0a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm96 32a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>${Number(u.message_count || 0).toLocaleString('ru')}<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"/></svg>${Number(u.sympathy_count || 0).toLocaleString('ru')}</div></div>`
        + `</li>`;
    }).join('');
    drop.querySelectorAll('.sd-item').forEach((item, index) => { const user = users[index]; item._zsUser = user; item._zsNicknameHtml = window.ZSNickname.sanitizeUser(user); });
    drop.hidden = false;
  };

  const chooseUser = (u) => {
    closeSearch();
    u._selectionSource = 'search';
    if (typeof window.pick === 'function') { window.pick(u, 'search'); return; }
    try { sessionStorage.setItem('zs_pick', JSON.stringify(u)); } catch (_) {}
    location.href = '/app';
  };

  let topTimer = null, topSeq = 0;
  const loadTop = () => {
    const seq = ++topSeq;
    clearTimeout(timer);
    if (topTimer) clearTimeout(topTimer);
    drop.innerHTML = '<li class="sd-msg zs-shimmer">Ищем популярных…</li>'; drop.hidden = false;
    topTimer = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/search/top`, { headers: authHeaders() });
        const d = await r.json();
        if (seq !== topSeq) return;
        if (!r.ok) { drop.innerHTML = `<li class="sd-msg">${esc(d.error || 'Ошибка')}</li>`; drop.hidden = false; return; }
        render(discoveryUsers(d.users));
      } catch { if (seq === topSeq) { drop.innerHTML = '<li class="sd-msg">Сервер недоступен (локальный API)</li>'; drop.hidden = false; } }
    }, 250);
  };

  let timer = null;
  const search = (q) => {
    q = (q || '').trim();
    clearTimeout(timer);
    topSeq++;
    if (topTimer) clearTimeout(topTimer);
    if (!q) { render(null); return; }
    drop.innerHTML = '<li class="sd-msg zs-shimmer">Поиск…</li>'; drop.hidden = false;
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
        const d = await r.json();
        if (!r.ok) { drop.innerHTML = `<li class="sd-msg">${esc(d.error || 'Ошибка')}</li>`; drop.hidden = false; return; }
        render(discoveryUsers(d.users));
      } catch { drop.innerHTML = '<li class="sd-msg">Сервер недоступен (локальный API)</li>'; drop.hidden = false; }
    }, 300);
  };

  input.addEventListener('input', () => search(input.value));

  /* Кнопки «Новое досье» / «Изменить» открывают поиск прямо в хедре
     текущей страницы — без редиректа на дашборд. */
  window.openHeaderSearch = function (prefill) {
    const h = document.querySelector('.header');
    const b = h && h.querySelector('.search');
    const i = b && b.querySelector('.search-input');
    if (!i) return false;
    if (window.matchMedia('(max-width:640px)').matches && h) h.classList.add('zs-search-open');
    if (prefill) { i.value = prefill; }
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.focus();
    try { i.setSelectionRange(i.value.length, i.value.length); } catch (_e) {}
    return true;
  };

  input.addEventListener('focus', () => {
    clearTimeout(timer);
    if (input.value.trim()) search(input.value);
    else loadTop();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = drop.querySelector('.sd-item');
      if (first) first.click();
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });
  drop.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.sd-item');
    if (!li || li.dataset.zsChosen) return;
    e.preventDefault();
    li.dataset.zsChosen = '1';
    const selected = li._zsUser || {};
    const usernameHtml = li._zsNicknameHtml || window.ZSNickname.sanitizeUser(selected);
    const username = window.ZSNickname.text(usernameHtml) || String(selected.username || '').trim();
    chooseUser({ ...selected, user_id: +li.dataset.uid, username: username, username_html: usernameHtml, avatar: selected.avatar || li.dataset.avatar, message_count: Number(li.dataset.messageCount) || 0 });
  });
  document.addEventListener('click', (e) => {
    if (box.contains(e.target)) return;
    drop.hidden = true;
    if (searchOpen()) closeSearch();
  });
})();

/* Sidebar: highlight the item matching the current page (no false "Дашборд"). */
(() => {
  const nav = document.querySelector('.sb-nav');
  if (!nav) return;
  const cur = (location.pathname.split('/').pop() || '').toLowerCase();
  nav.querySelectorAll('.sb-item').forEach((it) => {
    it.classList.remove('active');
    const href = it.getAttribute('href');
    if (href) {
      const base = href.split('/').pop().toLowerCase();
      if (base === cur) it.classList.add('active');
    }
  });
})();

/* Tabs scroll affordance: fade the clipped edge so extra tabs are discoverable. */
(() => {
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  const update = () => {
    const max = tabs.scrollWidth - tabs.clientWidth;
    tabs.classList.toggle('zs-more-left', tabs.scrollLeft > 4);
    tabs.classList.toggle('zs-more-right', tabs.scrollLeft < max - 4);
  };
  tabs.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  new ResizeObserver(update).observe(tabs);
  update();
})();


/* zelscan-responsive-forum-nickname-render-v1 */
function forumNicknameText(user) {
  const username = String(user?.username || '');
  if (!username.includes('<')) return username;
  const template = document.createElement('template');
  template.innerHTML = username;
  return template.content.textContent.trim() || username.replace(/<[^>]*>/g, '');
}

function forumNicknameMarkup(user) {
  const escape = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fallback = escape(forumNicknameText(user));
  const source = String(user?.username_html || user?.username || '').trim();
  if (!source.includes('<')) return fallback;

  const template = document.createElement('template');
  template.innerHTML = source;
  const nickname = template.content.querySelector('span');
  if (!nickname || !nickname.textContent.trim()) return fallback;

  const safeProperties = [
    'color', 'background', '-webkit-background-clip',
    '-webkit-text-fill-color', 'text-shadow', 'font-weight',
    'font-style', 'text-decoration'
  ];
  const style = safeProperties.map((property) => {
    const value = nickname.style.getPropertyValue(property).trim();
    if (!value || /(?:url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding)/i.test(value)) return '';
    return `${property}:${value}`;
  }).filter(Boolean).join(';');

  const text = escape(nickname.textContent.trim());
  return style ? `<span style="${escape(style)}">${text}</span>` : text;
}

/* ── Единый менеджер поповеров: одновременно открыт максимум один ── */
window.ZSPopovers={
  _current:null,
  open(id,closeFn){if(this._current&&this._current.id!==id){try{this._current.close()}catch(_e){}}this._current={id,close:closeFn}},
  close(id){if(this._current&&(!id||this._current.id===id))this._current=null}
};
