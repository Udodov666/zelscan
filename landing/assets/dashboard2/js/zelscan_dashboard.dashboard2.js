const API = window.ZSDashboard2.apiBase;

function authHeaders() {
  const t = localStorage.getItem('lzt_token');
  return t ? { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' }
           : { 'Content-Type': 'application/json' };
}

function apiFetch(path, opts = {}) { return window.ZSDashboard2.apiFetch(path, opts); }

// OAuth launcher is provided by oauth-open.dashboard2.js.
function closeModal() {
  document.getElementById('modalBg').classList.remove('open');
  document.getElementById('modalInp').value = '';
  document.getElementById('modalErr').classList.remove('on');
  document.getElementById('modalConfirm').disabled = false;
}

async function submitToken() {
  const token = document.getElementById('modalInp').value.trim();
  if (!token) return;
  const btn = document.getElementById('modalConfirm');
  const err = document.getElementById('modalErr');
  btn.disabled = true;
  btn.textContent = 'Проверяем...';
  err.classList.remove('on');
  let data;
  try {
    const r = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    data = await r.json();
    if (!r.ok) { err.textContent = data.error || 'Токен недействителен'; err.classList.add('on'); btn.disabled = false; btn.textContent = 'Войти'; return; }
  } catch {
    err.textContent = 'Сервер недоступен (локальный API)';
    err.classList.add('on');
    btn.disabled = false;
    btn.textContent = 'Войти';
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Войти';
  setUser(data, token);
  closeModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

async function applyToken(token) {
  try {
    const r = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { logout(); return; }
    const u = await r.json();
    setUser(u, token);
  } catch { /* сервер недоступен — позже */ }
}

function setUser(u, token) {
  const wasLoggedIn = !!localStorage.getItem('lzt_token');
  localStorage.setItem('lzt_token',   token);
  localStorage.setItem('lzt_user',    JSON.stringify(u));
  localStorage.setItem('lzt_user_ts', String(Date.now()));

  renderUser(u);
  loadRecentOrders();
  syncBonusUI(u);
  document.dispatchEvent(new CustomEvent('zs:profile', { detail: u }));
  if (typeof window.zsRenderAccount === 'function') window.zsRenderAccount(u);
  if (!wasLoggedIn && window.ZSNotice) ZSNotice.show({ type: 'success', title: 'Вы вошли в аккаунт', message: 'Аккаунт подключён, данные профиля синхронизированы.' });
}

function renderUser(u) {
  hideSidebarSkeleton();
  const letter = (forumDashboardNicknameText(u)[0] || '?').toUpperCase();
  const avHtml = safeAvatarUrl(u.avatar)
    ? `<img src="${esc(safeAvatarUrl(u.avatar))}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.textContent='${letter}'">`
    : letter;

  // header pill
  document.getElementById('accAv').innerHTML = avHtml;
  // account-ui owns #accNm and applies the safe rich nickname renderer.
  document.getElementById('accPill').style.display = '';
  document.getElementById('btnLogin').style.display = 'none';

  // sidebar
  document.getElementById('sbAv').innerHTML = safeAvatarUrl(u.avatar)
    ? `<img src="${esc(safeAvatarUrl(u.avatar))}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.textContent='${letter}'">`
    : letter;
  const plainUsername = forumDashboardNicknameText(u);
  const sbNick = plainUsername.length > 10 ? plainUsername.slice(0, 10) + '..' : plainUsername;
  document.getElementById('sbName').textContent = sbNick;
  const credits = u.credits != null ? `${u.credits} кредитов` : `#${u.user_id}`;
  document.getElementById('sbSub').textContent  = credits;
  document.getElementById('sbMenu').style.display = '';
}

async function refreshBalance() {
  try {
    const r = await apiFetch('/api/my/profile');
    if (!r.ok) return;
    const u = await r.json();
    localStorage.setItem('lzt_user', JSON.stringify(u));
    const sb = document.getElementById('sbSub');
    if (sb) sb.textContent = `${u.credits} кредитов`;
    syncBonusUI(u);
  } catch { /* фоновая перепроверка */ }
}

// Бонуcный переключатель ₽/Б: виден только при наличии бонуcов.
function syncBonusUI(u) {
  const bal = Number((u && u.bonus_credits) || 0);
  window.__zsHasBonus = bal > 0;
  window.__zsBonus = bal;
}
document.addEventListener('zs:profile', e => syncBonusUI(e.detail || {}));

// Cookie-сессия — источник правды. oauth_callback.js после логина УДАЛЯЕТ lzt_token
// из localStorage (переход на cookie-сессию), поэтому legacy initAuth ниже больше не
// видит токен и не рендерил шапку/сайдбар до F5 (кнопка «Войти» залипала).
// Здесь синхронно перерисовываем UI по профилю из cookie-сессии, который account-ui
// уже забирает через /api/my/profile и рассылает событиями zs:auth-ok / zs:profile.
(function bindCookieSessionUI(){
  let painted=false;
  function paint(u){
    if(!u||!u.user_id)return;
    painted=true;
    try{renderUser(u);}catch(_){}
    try{syncBonusUI(u);}catch(_){}
    loadRecentOrders();
  }
  document.addEventListener('zs:auth-ok',e=>{const u=e&&e.detail&&(e.detail.user||e.detail.session);paint(u);});
  document.addEventListener('zs:profile',e=>{paint(e&&e.detail);});
  // Если сессия уже была разрешена guard-ом до подписки — подхватываем сразу.
  try{
    const g=window.ZSAuthGuard;
    if(g&&g.isAuthenticated&&g.isAuthenticated()){const s=g.getSession&&g.getSession();if(s)paint(s);}
  }catch(_){}
})();

async function loadRecentOrders() {
  try {
    const r = await apiFetch('/api/my/orders?limit=11&status=done');
    if (!r.ok) { renderRecentCards([]); return; }
    const d = await r.json();
    renderRecentCards(d.orders || []);
  } catch { renderRecentCards([]); }
}

// Лента «Недавние досье» живёт в assets/js/pages/zelscan_dashboard_recent.js.
// Здесь только передаём ей заказы текущего пользователя (вкладка «Мои»).
function renderRecentCards(orders) {
  const rail = window.ZSRecentRail;
  if (rail && typeof rail.setMine === 'function') { rail.setMine(orders || []); return; }
  // если скрипт ленты ещё не загрузился — повторим позже
  setTimeout(() => {
    const r2 = window.ZSRecentRail;
    if (r2 && typeof r2.setMine === 'function') r2.setMine(orders || []);
  }, 400);
}

function logout(reason) {
  const hadSession = !!localStorage.getItem('lzt_token');
  hideSidebarSkeleton();
  localStorage.removeItem('lzt_token');
  localStorage.removeItem('lzt_user');
  document.getElementById('accPill').style.display  = 'none';
  document.getElementById('btnLogin').style.display = '';
  document.getElementById('sbName').textContent = '—';
  document.getElementById('sbSub').textContent  = 'не авторизован';
  document.getElementById('sbAv').innerHTML     = '';
  document.getElementById('sbMenu').style.display = 'none';
  if (hadSession && window.ZSNotice) ZSNotice.show(reason === 'expired'
    ? { type: 'warning', title: 'Нужно войти снова', message: 'Сессия Lolzteam завершена. Войдите, чтобы продолжить работу с досье.' }
    : { type: 'info', title: 'Выход выполнен', message: 'Вы можете войти снова в любой момент.' });
}

// ── Skeleton helpers ──────────────────────────────────────────────────────────
function showSidebarSkeleton() {
  document.getElementById('sbSk').style.display = 'flex';
  document.getElementById('sbAv').style.display = 'none';
  document.querySelector('#sbUser .who').style.display = 'none';
}

function hideSidebarSkeleton() {
  document.getElementById('sbSk').style.display = 'none';
  document.getElementById('sbAv').style.display = '';
  document.querySelector('#sbUser .who').style.display = '';
}

// ── init: восстановить сессию из localStorage ─────────────────────────────────
(async function initAuth() {
  const bootDone = () => {
    if (window.ZSSkeleton && typeof window.ZSSkeleton.bootDone === 'function') {
      window.ZSSkeleton.bootDone();
      return;
    }
    const root = document.documentElement;
    root.classList.add('zs-boot-done');
    root.classList.remove('zs-boot');
    const boot = document.getElementById('zskBoot');
    if (boot) setTimeout(() => boot.remove(), 240);
  };
  const token    = localStorage.getItem('lzt_token');
  const cached   = localStorage.getItem('lzt_user');
  const cachedAt = parseInt(localStorage.getItem('lzt_user_ts') || '0', 10);

  if (!token) {
    renderRecentCards([]);
    bootDone();
    return;
  }

  if (cached) {
    // Кэш есть — рендерим синхронно, без задержки
    try { renderUser(JSON.parse(cached)); } catch { hideSidebarSkeleton(); }
    try { syncBonusUI(JSON.parse(cached)); } catch {}
    loadRecentOrders();

    if (Date.now() - cachedAt < 5 * 60 * 1000) { bootDone(); return; }

    // Кэш устарел — фоновая перепроверка.
    // Logout ТОЛЬКО на явный 401. Любая другая ошибка (сервер лежит, 500) — кэш остаётся.
    try {
      const r = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.status === 401) { logout('expired'); bootDone(); return; }
      if (!r.ok) { bootDone(); return; }
      const u = await r.json();
      setUser(u, token);
    } catch { /* сервер недоступен — кэш живёт */ }
    bootDone();
    return;
  }

  // Кэша нет — первый вход или storage очищен. Один запрос к серверу.
  showSidebarSkeleton();
  try {
    const r = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) { logout('expired'); renderRecentCards([]); bootDone(); return; }
    if (!r.ok) { hideSidebarSkeleton(); renderRecentCards([]); bootDone(); return; }
    const u = await r.json();
    setUser(u, token); // → renderUser + loadRecentOrders
  } catch { hideSidebarSkeleton(); renderRecentCards([]); }
  bootDone();
})();

/* Пришли из оверлея поиска с выбранным юзером → сразу выбрать в дашборде */
(function(){
  try {
    const raw = sessionStorage.getItem('zs_pick');
    if (!raw) return;
    sessionStorage.removeItem('zs_pick');
    const u = JSON.parse(raw);
    const go = () => { if (typeof window.pick === 'function') window.pick(u); };
    setTimeout(go, 80);
  } catch(_) {}
})();

// ── поиск ─────────────────────────────────────────────────────────────────────
const sInput   = document.getElementById('sInput'); sInput.classList.add('ph');
const dd       = document.getElementById('dd');
const selChip  = document.getElementById('selChip');
const selAv    = document.getElementById('selAv');
const selName  = document.getElementById('selName');
const selUid   = document.getElementById('selUid');
const tariffRow= null; // removed — tariff selection in ZSModals modal // removed
const dashProg = document.getElementById('dashProg');
const pTitle   = document.getElementById('pTitle');
const pSub     = document.getElementById('pSub');
const pStages  = document.getElementById('pStages');
const pFill    = document.getElementById('pFill');
const dashErr  = document.getElementById('dashErr');
const errTxt   = document.getElementById('errTxt');
const searchWrap = document.getElementById('searchWrap');

let sel = null, timer = null, busy = false, searchSeq = 0;
const MIN_DISCOVERY_MESSAGE_COUNT = 10;

function searchRows(count = 4) {
  return Array.from({ length: count }, () => '<li class="dd-item zs-search-skeleton" aria-hidden="true"><div class="dd-av sk"></div><div><div class="sk-line sk" style="width:132px"></div><div class="sk-line sk" style="width:88px;margin-top:8px"></div></div></li>').join('');
}

function showSearchRows() {
  dd.innerHTML = searchRows(4);
  positionDd();
  dd.classList.add('open');
}

function profileMessageCount(user) {
  const count = Number(user && (user.message_count ?? user.user_message_count));
  return Number.isFinite(count) ? count : 0;
}

function discoveryUsers(users) {
  return (users || []).filter(user => profileMessageCount(user) >= MIN_DISCOVERY_MESSAGE_COUNT);
}

// Выносим дропдаун в body — иначе backdrop-filter не работает внутри isolation:isolate (.dash)
document.body.appendChild(dd);

function positionDd() {
  const r = searchWrap.getBoundingClientRect();
  dd.style.top   = (r.bottom + 6) + 'px';
  dd.style.left  = r.left + 'px';
  dd.style.width = r.width + 'px';
}

function focusSearch() { sInput.focus(); sInput.scrollIntoView({behavior:'smooth',block:'center'}); }

// ── debounce ─────────────────────────────────────────────
sInput.addEventListener('input', () => {
  if (sInput.textContent.length > 256) {
    sInput.textContent = sInput.textContent.slice(0, 256);
    const r = document.createRange();
    const sel = window.getSelection();
    r.selectNodeContents(sInput);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  const empty = !sInput.textContent.trim();
  if (empty) sInput.innerHTML = '';
  sInput.classList.toggle('ph', empty);
  const q = sInput.textContent.trim();
  clearTimeout(timer);
  topSeq++;
  closeDd();
  if (!q) return;
  timer = setTimeout(() => search(q), 300);
});
sInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); onBtn(); }
  if (e.key === 'Escape') closeDd();
});
sInput.addEventListener('paste', e => {
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, t.slice(0, 256));
});
sInput.addEventListener('focus', () => {
  if (!sInput.textContent.trim()) showTopDd();
});
sInput.addEventListener('drop', e => e.preventDefault());
sInput.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('click', e => {
  if (!searchWrap.contains(e.target) && !dd.contains(e.target)) closeDd();
});

function showNotice(options) {
  if (window.ZSNotice && typeof window.ZSNotice.show === 'function') window.ZSNotice.show(options);
}

async function search(q) {
  const seq = ++searchSeq;
  showSearchRows();
  try {
    const r = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const d = await r.json().catch(() => ({}));
    if (seq !== searchSeq) return;
    if (!r.ok) {
      showDd([{_msg: 'Поиск временно недоступен'}]);
      showNotice({ type: 'warning', title: 'Поиск временно недоступен', message: 'Подождите несколько секунд и попробуйте ещё раз.' });
      return;
    }
    const users = d.users || [];
    showDd(users);
    if (!users.length) showNotice({ type: 'info', title: 'Пользователь не найден', message: 'Попробуйте другой никнейм или ID Lolzteam.' });
  } catch {
    if (seq !== searchSeq) return;
    showDd([{_msg:'Поиск временно недоступен'}]);
    showNotice({ type: 'warning', title: 'Поиск временно недоступен', message: 'Подождите несколько секунд и попробуйте ещё раз.' });
  }
}

function showDd(users) {
  dd.innerHTML = '';
  if (!users.length || users[0]?._msg) {
    const li = document.createElement('li');
    const msg = users[0]?._msg || 'Не найдено';
    li.className = 'dd-msg' + (/^(Поиск|Ищем)/.test(msg) ? ' zs-shimmer' : '');
    li.textContent = msg;
    dd.appendChild(li);
  } else {
    users.forEach(u => {
      const li = document.createElement('li');
      li.className = 'dd-item';
      const letter = (forumDashboardNicknameText(u)[0]||'?').toUpperCase();
      li.innerHTML = `
        <div class="dd-av">${u.avatar
          ? `<img src="${esc(safeAvatarUrl(u.avatar))}" alt="" onerror="this.parentNode.innerHTML='${letter}'">`
          : letter}</div>
        <div>
          <div class="dd-name">${window.ZSNickname.sanitizeUser(u)}${u.is_banned?'<span class="dd-ban">бан</span>':''}</div>
          <div class="dd-meta"><svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M256 448c141.4 0 256-93.1 256-208S397.4 32 256 32S0 125.1 0 240c0 45.1 17.7 86.8 47.7 120.9c-1.9 24.5-11.4 46.3-21.4 62.9c-5.5 9.2-11.1 16.6-15.2 21.6c-2.1 2.5-3.7 4.4-4.9 5.7c-.6 .6-1 1.1-1.3 1.4l-.3 .3c0 0 0 0 0 0c0 0 0 0 0 0s0 0 0 0s0 0 0 0c-4.6 4.6-5.9 11.4-3.4 17.4c2.5 6 8.3 9.9 14.8 9.9c28.7 0 57.6-8.9 81.6-19.3c22.9-10 42.4-21.9 54.3-30.6c31.8 11.5 67 17.9 104.1 17.9zM128 208a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm128 0a32 32 0 1 1 0 64 32 32 0 1 1 0-64zm96 32a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>${profileMessageCount(u).toLocaleString('ru')}<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"/></svg>${Number(u.sympathy_count ?? 0).toLocaleString('ru')}</div>
        </div>`;
      li.addEventListener('click', () => pick(u));
      dd.appendChild(li);
    });
  }
  positionDd();
  dd.classList.add('open');
}

function closeDd() { dd.classList.remove('open'); dd.innerHTML = ''; }

let topSeq = 0;
async function showTopDd() {
  const seq = ++topSeq;
  showSearchRows();
  try {
    const r = await apiFetch('/api/search/top');
    const d = await r.json();
    if (seq !== topSeq) return;
    if (!r.ok) { showDd([{ _msg: d.error || 'Ошибка' }]); return; }
    showDd(discoveryUsers(d.users));
  } catch { if (seq === topSeq) showDd([{ _msg: 'Сервер недоступен (локальный API)' }]); }
}

function pick(u, source = 'search') {
  u = window.ZSNickname.prepareUser(u);
  u._selectionSource = source;
  sel = u;
  window.selectedUser = u;
  closeDd();
  sInput.textContent = ''; sInput.classList.add('ph');
  searchWrap.style.display = 'none';

  const letter = (forumDashboardNicknameText(u)[0]||'?').toUpperCase();
  selAv.innerHTML = safeAvatarUrl(u.avatar)
    ? `<img src="${esc(safeAvatarUrl(u.avatar))}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9px" onerror="this.parentNode.textContent='${letter}'">`
    : letter;
  selName.innerHTML = window.ZSNickname.sanitizeUser(u);
  selUid.textContent  = '#' + u.user_id;
  selChip.classList.add('on');

  ZSModals.openOrder(u);
}

function clearSel(options = {}) {
  sel = null;
  window.selectedUser = null;
  selChip.classList.remove('on');
  searchWrap.style.display = '';
  sInput.textContent = ''; sInput.classList.add('ph');
  if (!options.preserveError) hideErr();
  sInput.focus();
}

// ── кнопка ───────────────────────────────────────────────
async function onBtn() {
  if (busy) return;

  if (sel) { ZSModals.openOrder(sel); return; }

  const q = sInput.textContent.trim();
  if (!q) return;
  try {
    const r = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    if (!r.ok || !d.users?.length) { showErr('Пользователь не найден'); return; }
    if (d.users.length === 1) pick(d.users[0], 'direct');
    else showDd(discoveryUsers(d.users));
  } catch { showErr('Сервер недоступен (локальный API)'); }
}

// ── создать заказ ─────────────────────────────────────────
const STAGES = [
  {k:'profile',       l:'Профиль'},
  {k:'fetch_posts',   l:'Сообщения'},
  {k:'fetch_threads', l:'Темы'},
  {k:'fetch_wall',    l:'Стена'},
  {k:'metrics',       l:'Метрики'},
  {k:'done',          l:'Готово'},
];

async function startOrder(u) {
  // Единственная точка покупки — модалка: она обрабатывает существующий отчёт,
  // явное платное обновление и Idempotency-Key без повторного списания.
  if (window.ZSModals && typeof window.ZSModals.openOrder === 'function') {
    window.selectedUser = u;
    window._lastSelectedUser = u;
    window.ZSModals.openOrder(u, { tariff: 'basic' });
    return;
  }
  fail('Модуль оформления заказа не загружен');
}

async function pollOrder(orderId) {
  const st = {}; STAGES.forEach(s => st[s.k] = 'pending');

  await new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await apiFetch(`/api/orders/${orderId}`);
        if (!r.ok) { reject(new Error(`HTTP ${r.status}`)); return; }
        const o = await r.json();

        if (o.status === 'queued' || o.status === 'paid') {
          pTitle.textContent = 'В очереди...';
          pSub.textContent   = o.position > 1 ? `Позиция #${o.position}` : 'Скоро начнётся...';
        } else if (o.status === 'running') {
          const p = o.progress || {};
          pTitle.textContent = p.message || 'Анализируем...';
          pSub.textContent   = p.total > 0 ? `${p.current}/${p.total}` : '';
          renderStages(st, p.stage);
        } else if (o.status === 'done') {
          STAGES.forEach(s => st[s.k] = 'done');
          renderStages(st, 'done');
          pFill.style.width = '100%';
          pTitle.textContent = 'Готово! Открываем отчёт...';
          pSub.textContent = '';
          setTimeout(() => {
            window.location.href = `http://127.0.0.1:8000/zelscan.html?order=${orderId}`;
          }, 600);
          resolve(); return;
        } else if (o.status === 'error') {
          reject(new Error(o.error || 'Ошибка анализа')); return;
        }
        setTimeout(tick, 1000);
      } catch(e) { reject(e); }
    };
    tick();
  });
}

function renderStages(st, cur) {
  const idx = STAGES.findIndex(s => s.k === cur);
  STAGES.forEach((s, i) => {
    if (cur === 'done')  st[s.k] = 'done';
    else if (i < idx)   st[s.k] = 'done';
    else if (i === idx) st[s.k] = 'active';
    else                st[s.k] = 'pending';
  });
  pStages.innerHTML = STAGES.map(s => {
    const v = st[s.k];
    return `<div class="p-s ${v}">
      <div class="p-s-ic">${v==='done'?'✓':v==='active'?'●':'·'}</div>
      <div class="p-s-lbl">${s.l}</div>
    </div>`;
  }).join('');
  const done = Object.values(st).filter(v => v==='done').length;
  pFill.style.width = (done/STAGES.length*100)+'%';
}

function fail(msg) {
  busy = false;
  dashProg.classList.remove('on');
  clearSel({ preserveError: true });
  showErr(msg||'Ошибка');
}

function showErr(m) { errTxt.textContent = m; dashErr.classList.add('on'); }
function hideErr()  { dashErr.classList.remove('on'); }

function safeAvatarUrl(value) { return window.ZSDashboard2.safeUrl(value); }

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── поиск из шапки других страниц: ?query= → модалка заказа ──
(function () {
  const sp = new URLSearchParams(location.search);
  const q = sp.get('query') || sp.get('q') || '';
  if (!q) return;
  const url = new URL(location.href);
  url.searchParams.delete('query'); url.searchParams.delete('q');
  history.replaceState({}, '', url);
  setTimeout(async () => {
    try {
      const r = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (r.ok && d.users && d.users.length) {
        if (d.users.length === 1) pick(d.users[0], 'direct');
        else showDd(discoveryUsers(d.users));
      } else {
        showErr('Пользователь не найден');
      }
    } catch {
      showErr('Сервер недоступен (локальный API)');
    }
  }, 60);
})();

// A selected user is only relevant while the order flow is open.
window.addEventListener('zs:order-closed', function () {
  sel = null;
  window.selectedUser = null;
  if (selChip) selChip.classList.remove('on');
  if (searchWrap) searchWrap.style.display = '';
  if (sInput) { sInput.textContent = ''; sInput.classList.add('ph'); }
});

/* zelscan-dashboard-forum-nickname-render-v1 */
function forumDashboardNicknameText(user) {
  const username = String(user?.username || '');
  if (!username.includes('<')) return username;
  const template = document.createElement('template');
  template.innerHTML = username;
  return template.content.textContent.trim() || username.replace(/<[^>]*>/g, '');
}

function forumDashboardNicknameMarkup(user) {
  const fallback = esc(forumDashboardNicknameText(user));
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

  const text = esc(nickname.textContent.trim());
  return style ? `<span style="${esc(style)}">${text}</span>` : text;
}

// Dashboard2 CSP-friendly static controls.
document.addEventListener('click', (event) => {
 const action=event.target.closest('[data-action]')?.dataset.action;
 if(action==='focus-search') focusSearch(); else if(action==='open-oauth') openOAuth(); else if(action==='clear-selection') clearSel();
 else if(action==='close-login') closeModal(); else if(action==='submit-token') submitToken();
 if(event.target===document.getElementById('modalBg')) closeModal();
});

/* ?search_focus=1: подставить ник из модалки заказа в поиск и сфокусировать */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('search_focus') !== '1') return;
  const prefill = sessionStorage.getItem('zs_search_prefill') || '';
  sessionStorage.removeItem('zs_search_prefill');
  history.replaceState(null, '', 'zelscan_dashboard.html');
  setTimeout(() => {
    if (prefill) {
      sInput.textContent = prefill;
      sInput.classList.remove('ph');
      sInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    focusSearch();
    try {
      const r = document.createRange(); r.selectNodeContents(sInput);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch (_e) {}
  }, 350);
})();
