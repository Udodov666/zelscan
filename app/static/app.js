/* =========================================================
   LOLZ // DOSSIER v7 — Multi-page Dashboard
   ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ── DOM refs ──────────────────────────────────────────────
const form           = $('#searchForm');
const searchInput    = $('#userSearchInput');
const searchDropdown = $('#searchDropdown');
const selectedUserEl = $('#selectedUser');
const selectedAvatarEl = $('#selectedAvatar');
const selectedUsernameEl = $('#selectedUsername');
const selectedUidEl  = $('#selectedUid');
const clearUserBtn   = $('#clearUser');
const analyzeBtn     = $('#analyzeBtn');
const timelinePages  = $('#timelinePages');
const threadPages    = $('#threadPages');
const refreshFlag    = $('#refreshFlag');

const loadingSection  = $('#loadingSection');
const loadingTitle    = $('#loadingTitle');
const loadingSubtitle = $('#loadingSubtitle');
const loadingBar      = $('#loadingBar');
const errorSection    = $('#errorSection');
const errorText       = $('#errorText');
const dossierApp      = $('#dossierApp');

let CURRENT_DOSSIER = null;
let selectedUser    = null;   // {user_id, username, avatar, message_count, is_banned}
let searchTimer     = null;
let pendingPurchase = null;
let existingOrder = null;
let existingOrderSeq = 0;

async function preflightExistingOrder(user) {
  const seq = ++existingOrderSeq;
  existingOrder = null;
  if (!user?.user_id) return null;
  try {
    const token = window.zsToken || localStorage.getItem('lzt_token') || '';
    const res = await fetch('/api/orders/existing?user_id=' + encodeURIComponent(user.user_id), {
      credentials: 'same-origin',
      headers: token ? { 'Authorization': 'Bearer ' + token } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (seq !== existingOrderSeq) return null;
    existingOrder = data?.owned || null;
    const basicRadio = $('input[name="reportType"][value="basic"]');
    if (existingOrder?.order_id && ['full', 'pro'].includes(existingOrder.report_type)) {
      const fullRadio = $('input[name="reportType"][value="full"]');
      if (fullRadio) fullRadio.checked = true;
      if (basicRadio) basicRadio.disabled = true;
    } else if (basicRadio) {
      basicRadio.disabled = false;
    }
    return existingOrder;
  } catch (_) {
    return null;
  }
}

function purchaseKey(body) {
  const fingerprint = JSON.stringify(body);
  if (pendingPurchase?.fingerprint === fingerprint) return pendingPurchase.key;
  const key = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  pendingPurchase = {fingerprint, key};
  return key;
}

// ── Hint UIDs ─────────────────────────────────────────────
$$('code[data-uid]').forEach(el => {
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    searchInput.value = el.dataset.uid;
    triggerSearch(el.dataset.uid);
  });
});

// ── Search with debounce ───────────────────────────────────
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearTimeout(searchTimer);
  if (!q) { closeDropdown(); return; }
  searchTimer = setTimeout(() => triggerSearch(q), 300);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDropdown();
});

document.addEventListener('click', (e) => {
  if (!$('#searchWrap').contains(e.target)) closeDropdown();
});

async function triggerSearch(q) {
  searchDropdown.innerHTML = '<li class="dropdown-loading">Поиск...</li>';
  searchDropdown.classList.remove('hidden');
  try {
    const res  = await fetch('/api/search?q=' + encodeURIComponent(q));
    const data = await res.json();
    if (!res.ok) { showDropdownMsg(data.error || 'Ошибка поиска'); return; }
    renderDropdown(data.users || []);
  } catch (_) {
    showDropdownMsg('Ошибка сети');
  }
}

function renderDropdown(users) {
  users = (users || []).filter(u => Number(u.message_count ?? u.user_message_count ?? 0) >= 10);
  if (!users.length) {
    showDropdownMsg('Пользователи не найдены');
    return;
  }
  searchDropdown.innerHTML = users.map((u, idx) => {
    const letter = (u.username[0] || '?').toUpperCase();
    const avatarHTML = u.avatar
      ? `<img class="dd-avatar" src="${escapeHtml(u.avatar)}" alt=""
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        + `<span class="dd-avatar-letter" style="display:none">${escapeHtml(letter)}</span>`
      : `<span class="dd-avatar-letter">${escapeHtml(letter)}</span>`;
    const bannedBadge = u.is_banned ? `<span class="dd-banned">БАН</span>` : '';
    return `<li class="dropdown-item" data-idx="${idx}">
      <div class="dd-avatar-wrap">${avatarHTML}</div>
      <div class="dd-info">
        <div class="dd-name">${forumUsernameMarkup(u)} ${bannedBadge}</div>
        <div class="dd-meta">#${u.user_id} · ${u.message_count.toLocaleString('ru')} сообщений</div>
      </div>
    </li>`;
  }).join('');

  searchDropdown.querySelectorAll('.dropdown-item').forEach((li, idx) => {
    li.addEventListener('click', () => selectUser(users[idx]));
  });
}

function showDropdownMsg(msg) {
  searchDropdown.innerHTML = `<li class="dropdown-empty">${escapeHtml(msg)}</li>`;
  searchDropdown.classList.remove('hidden');
}

function closeDropdown() {
  searchDropdown.classList.add('hidden');
  searchDropdown.innerHTML = '';
}

function selectUser(u) {
  selectedUser = u;
  selectedAvatarEl.src = u.avatar || '';
  selectedAvatarEl.style.display = u.avatar ? 'block' : 'none';
  selectedUsernameEl.innerHTML = forumUsernameMarkup(u);
  selectedUidEl.textContent = '#' + u.user_id;
  selectedUserEl.classList.remove('hidden');
  // скрываем поле ввода и очищаем дропдаун
  $('#searchWrap .input-row').style.display = 'none';
  searchInput.value = '';
  closeDropdown();
  preflightExistingOrder(u);
}

clearUserBtn.addEventListener('click', () => {
  selectedUser = null;
  existingOrder = null;
  existingOrderSeq++;
  selectedUserEl.classList.add('hidden');
  $('#searchWrap .input-row').style.display = '';
  searchInput.value = '';
  searchInput.focus();
});

// ── Form submit ────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  let user = selectedUser;

  if (!user) {
    const q = searchInput.value.trim();
    if (!q) { showError('Введи ник или ID пользователя.'); return; }
    // попробуем разрезолвить напрямую
    analyzeBtn.disabled = true;
    analyzeBtn.querySelector('.btn-text').textContent = 'Поиск...';
    try {
      const res  = await fetch('/api/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      if (!res.ok || !data.users?.length) {
        showError('Пользователь не найден. Выбери из списка.');
        return;
      }
      if (data.users.length === 1) {
        user = data.users[0];
      } else {
        renderDropdown(data.users);
        return;
      }
    } catch (_) {
      showError('Ошибка поиска. Попробуй ещё раз.');
      return;
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.querySelector('.btn-text').textContent = 'Анализировать';
    }
  }

  const owned = await preflightExistingOrder(user);
  const reportType = owned?.order_id && ['full', 'pro'].includes(owned.report_type)
    ? 'full'
    : ($('input[name="reportType"]:checked')?.value || 'basic');
  await runAnalysis(user, reportType);
});

async function runAnalysis(user, reportType, purchaseBody = null) {
  hideError();
  hideDossier();
  showLoading();

  try {
    const body = purchaseBody || {
      user_id:        user.user_id,
      username:       user.username,
      avatar:         user.avatar || '',
      report_type:    reportType,
      timeline_pages: parseInt(timelinePages.value),
      thread_pages:   parseInt(threadPages.value),
      refresh:        Boolean(existingOrder?.order_id || refreshFlag.checked),
      ...(existingOrder?.order_id ? {source_order_id: existingOrder.order_id} : {}),
    };

    const queueRes = await fetch('/api/orders', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': purchaseKey(body),
      },
      body: JSON.stringify(body),
    });
    const task = await queueRes.json().catch(() => ({}));
    if (!queueRes.ok) {
      if (task.code === 'existing_report_choice_required' && task.existing_report?.open_url) {
        hideLoading();
        showExistingChoiceModal(task, user, reportType, body);
        return;
      }
      throw new Error(task.error || `HTTP ${queueRes.status}`);
    }
    await finishPurchase(task, user, reportType);
  } catch (err) {
    hideLoading();
    showError(err.message || 'Неизвестная ошибка');
  }
}

async function finishPurchase(task, user, reportType) {
  const result = await pollOrderProgress(task.order_id);
  if (!result) throw new Error('Нет результата от сервера');
  if (result.error) throw new Error(result.error);

  hideLoading();
  renderDossier(result, user, reportType);
  showDossier();
}

// ── §8: брендированное окно выбора вместо window.confirm ──────
function zsTariffLabel(type) {
  return type === 'full' ? 'Полный AI' : 'Базовый';
}

function zsVisibilityLabel(v) {
  return {private: 'Личный', unlisted: 'По ссылке', public: 'Публичный'}[v] || v;
}

function zsFmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
}

let zsChoiceCtx = null; // {bg, onEscape}

function closeZsModal() {
  if (!zsChoiceCtx) return;
  document.removeEventListener('keydown', zsChoiceCtx.onEscape, true);
  zsChoiceCtx.bg.remove();
  zsChoiceCtx = null;
}

function showExistingChoiceModal(task, user, reportType, baseBody) {
  closeZsModal();

  const existing = task.existing_report || {};
  const actions  = task.actions || {};
  const isOwned  = task.choice_type === 'owned';
  const cost     = isOwned
    ? (actions.refresh?.cost   ?? null)
    : (actions.create_own?.cost ?? null);
  const costStr  = cost != null ? ` за ${cost} ₽` : '';

  const rows = [
    ['Пользователь', `#${existing.user_id ?? user.user_id} · ${escapeHtml(user.username)}`],
    ['Тариф',        zsTariffLabel(existing.report_type || reportType)],
    ['Сформировано', zsFmtDate(existing.finished_at)],
  ];
  if (isOwned && existing.visibility) {
    rows.push(['Доступ', zsVisibilityLabel(existing.visibility)]);
  }
  const rowsHtml = rows.map(([k, v]) =>
    `<div class="zs-choice-row"><span class="k">${k}</span><span class="v">${v}</span></div>`
  ).join('');
  const noteIcon = '<svg class="zs-note-ic" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>';
  const note = isOwned
    ? 'Обновление запускает новый платный сбор публичных данных и AI-анализ. Текущее досье останется доступным, пока новое не будет успешно готово.'
    : 'Создание своего досье запускает независимый новый анализ — это отдельный платный заказ.';

  const bg = document.createElement('div');
  bg.className = 'zs-modal-bg';
  bg.innerHTML = `
    <div class="zs-modal" role="dialog" aria-modal="true">
      <div class="zs-modal-inner">
        <div class="zs-modal-head">
          <div class="zs-modal-title">${isOwned ? 'У вас уже есть это досье' : 'Досье уже есть в «Общих»'}</div>
          <button class="zs-modal-x" type="button" aria-label="Закрыть">✕</button>
        </div>
        <div class="zs-modal-body">
          <div class="zs-choice">${rowsHtml}</div>
          <p class="zs-choice-note">${noteIcon}<span>${note}</span></p>
          <div class="zs-choice-actions">
            <button class="zs-btn light" type="button" data-zs-action="open">${isOwned ? 'Открыть досье' : 'Открыть общее'}</button>
            ${isOwned
              ? `<button class="zs-btn" type="button" data-zs-action="refresh">Обновить${costStr}</button>`
              : `<button class="zs-btn" type="button" data-zs-action="create_own">Создать своё${costStr}</button>`}
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('open'));

  const errEl = () => bg.querySelector('.zs-modal-error');
  const showChoiceError = (msg) => {
    let el = errEl();
    if (!el) {
      el = document.createElement('p');
      el.className = 'zs-choice-note zs-modal-error';
      el.style.color = 'var(--red)';
      bg.querySelector('.zs-choice').appendChild(el);
    }
    el.textContent = msg || 'Не удалось выполнить запрос. Попробуйте ещё раз.';
  };
  const setButtonsDisabled = (disabled) => {
    bg.querySelectorAll('.zs-modal-actions button').forEach(b => { b.disabled = disabled; });
  };

  // повторный платный POST со своим ключом идемпотентности:
  // fingerprint тела меняется (refresh/source_order_id или create_own),
  // поэтому purchaseKey() выдаст отдельный ключ операции
  async function rePostChoice(extra, btn) {
    setButtonsDisabled(true);
    try {
      const res = await fetch('/api/orders', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': purchaseKey({...baseBody, ...extra}),
        },
        body: JSON.stringify({...baseBody, ...extra}),
      });
      const t = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(t.error || `HTTP ${res.status}`);
      closeZsModal();
      showLoading();
      await finishPurchase(t, user, reportType);
    } catch (err) {
      showChoiceError(err.message);
      setButtonsDisabled(false);
    }
  }

  bg.addEventListener('click', (e) => {
    const action = e.target.closest('[data-zs-action]')?.dataset.zsAction;
    if (action === 'open') {
      // навигация к готовому досье: без POST и без списания
      window.location.href = existing.open_url;
      return;
    }
    if (action === 'refresh') {
      rePostChoice({refresh: true, source_order_id: existing.order_id}, e.target);
      return;
    }
    if (action === 'create_own') {
      rePostChoice({create_own: true}, e.target);
      return;
    }
    if (action === 'cancel' || e.target === bg || e.target.closest('.zs-modal-x')) {
      closeZsModal(); // отмена: ничего не создаётся и не списывается
    }
  });
  zsChoiceCtx = {
    bg,
    onEscape: (e) => { if (e.key === 'Escape') closeZsModal(); },
  };
  document.addEventListener('keydown', zsChoiceCtx.onEscape, true);
}

async function pollOrderProgress(orderId) {
  return new Promise((resolve, reject) => {
    const stages = [
      {key: 'profile',       label: 'Профиль'},
      {key: 'fetch_posts',   label: 'Сообщения'},
      {key: 'fetch_threads', label: 'Темы'},
      {key: 'fetch_wall',    label: 'Стена'},
      {key: 'metrics',       label: 'Метрики'},
      {key: 'done',          label: 'Готово'},
    ];
    const stageState = {};
    stages.forEach(s => stageState[s.key] = 'pending');

    const poll = async () => {
      try {
        const res   = await fetch(`/api/orders/${orderId}`);
        if (!res.ok) { reject(new Error(`HTTP ${res.status}`)); return; }
        const order = await res.json();

        if (order.status === 'queued' || order.status === 'paid') {
          $('#queueInfo').classList.remove('hidden');
          $('#queuePosition').textContent = `#${order.position}`;
          $('#queueEta').textContent = order.position > 1
            ? `~${order.position * 90} сек ожидания`
            : 'Скоро начнётся...';
          $('#loadingTitle').textContent  = 'В очереди...';
          $('#loadingSubtitle').textContent = 'Другой пользователь уже анализируется';
          $('#progressStages').innerHTML = '';
        } else if (order.status === 'running') {
          $('#queueInfo').classList.add('hidden');
          const p = order.progress || {};
          updateStagesUI(stages, stageState, p);
          $('#loadingTitle').textContent = p.message || 'Анализ...';
        } else if (order.status === 'done') {
          $('#queueInfo').classList.add('hidden');
          stages.forEach(s => stageState[s.key] = 'done');
          updateStagesUI(stages, stageState, {stage: 'done'});
          $('#loadingTitle').textContent = 'Готово!';
          setTimeout(() => resolve(order.result), 500);
          return;
        } else if (order.status === 'error') {
          reject(new Error(order.error || 'Ошибка'));
          return;
        }

        setTimeout(poll, 1000);
      } catch (e) {
        reject(e);
      }
    };
    poll();
  });
}

function updateStagesUI(stages, stageState, progress) {
  const currentStage = progress.stage;
  const currentIdx   = stages.findIndex(s => s.key === currentStage);
  stages.forEach((s, i) => {
    if (currentStage === 'done')   stageState[s.key] = 'done';
    else if (i < currentIdx)       stageState[s.key] = 'done';
    else if (i === currentIdx)     stageState[s.key] = 'active';
    else                           stageState[s.key] = 'pending';
  });

  let html = '';
  stages.forEach(s => {
    const state = stageState[s.key];
    let progressText = '';
    if (state === 'active' && s.key === progress.stage && progress.total > 0) {
      progressText = `${progress.current}/${progress.total}`;
    }
    const icon = state === 'done' ? '✓' : (state === 'active' ? '●' : '');
    html += `<div class="stage-row ${state}">
      <div class="stage-icon">${icon}</div>
      <div class="stage-label">${s.label}</div>
      <div class="stage-progress">${progressText}</div>
    </div>`;
  });
  $('#progressStages').innerHTML = html;

  const doneCount = Object.values(stageState).filter(s => s === 'done').length;
  $('#loadingBar').style.width = ((doneCount / stages.length) * 100) + '%';
}

function showLoading() {
  loadingSection.classList.remove('hidden');
  loadingTitle.textContent    = 'Готовим анализ...';
  loadingSubtitle.textContent = 'Параллельный fetch через 3 токена';
  loadingBar.style.width = '0%';
  $('#queueInfo').classList.add('hidden');
  $('#progressStages').innerHTML = '';
  analyzeBtn.disabled = true;
}
function hideLoading() {
  loadingSection.classList.add('hidden');
  loadingBar.style.width = '100%';
  setTimeout(() => loadingBar.style.width = '0%', 300);
  analyzeBtn.disabled = false;
}
function showError(msg)  { errorText.textContent = msg; errorSection.classList.remove('hidden'); }
function hideError()     { errorSection.classList.add('hidden'); }
function showDossier()   { dossierApp.classList.remove('hidden'); setTimeout(() => window.scrollTo({top: 0, behavior: 'smooth'}), 100); }
function hideDossier()   { dossierApp.classList.add('hidden'); }
function backToSearch()  { hideDossier(); window.scrollTo({top: 0, behavior: 'smooth'}); }

// ── Navigation between pages ───────────────────────────────
$$('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const page = item.dataset.page;
    if (!page) return;
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    $$('.page').forEach(p => p.classList.remove('active'));
    $(`#page-${page}`).classList.add('active');
    window.scrollTo({top: 0, behavior: 'smooth'});
  });
});

// =========================================================
// MAIN RENDER
// =========================================================
function renderDossier(d, user, reportType) {
  CURRENT_DOSSIER = d;
  renderSidebar(d, user);
  renderOverview(d);
  renderActivityPage(d);
  renderBehaviorPage(d);

  if (d.ai_analysis) {
    renderPsychologyPage(d);
    renderAIPage(d.ai_analysis);
    $('#psychBadge').style.display   = 'inline';
    $('#aiNavBadge').style.display   = 'inline';
  } else {
    $('#psychMannerBody').innerHTML = '<p class="muted">Психологический портрет доступен только в тарифе <strong>Полный (AI)</strong>.</p>';
    $('#aiLitePortraitBody').innerHTML = '<p class="muted">AI-анализ доступен только в тарифе <strong>Полный (AI)</strong>.</p>';
    $('#psychBadge').style.display   = 'none';
    $('#aiNavBadge').style.display   = 'none';
  }
}

function renderSidebar(d, user) {
  const c      = d.card;
  const avatar = c.avatar || user?.avatar || '';
  const letter = (c.username[0] || '?').toUpperCase();

  $('#sidebarUsername').textContent = c.username;
  $('#sidebarUid').textContent      = '#' + c.user_id;

  const img      = $('#sidebarAvatarImg');
  const letterEl = $('#sidebarAvatarLetter');
  if (avatar) {
    img.src = avatar;
    img.style.display      = 'block';
    letterEl.style.display = 'none';
  } else {
    img.style.display      = 'none';
    letterEl.style.display = 'flex';
    letterEl.textContent   = letter;
  }
}

// =========================================================
// PAGE: OVERVIEW
// =========================================================
function renderOverview(d) {
  const c = d.card;

  const tags = $('#verdictTags');
  tags.innerHTML = '';
  if (d.safety.in_blacklist) tags.innerHTML += `<span class="verdict-tag banned">🚫 Заблокирован</span>`;
  else                        tags.innerHTML += `<span class="verdict-tag safe">✅ Чист</span>`;
  if (c.warning_points > 0)  tags.innerHTML += `<span class="verdict-tag warn">⚠ ${c.warning_points}/3</span>`;
  if (c.tenure && c.tenure !== '—') tags.innerHTML += `<span class="verdict-tag">${escapeHtml(c.tenure)}</span>`;

  const types = (d.ai_analysis?.psychologist?.parsed?.personality_types) || d.portrait?.archetypes || [];
  types.slice(0, 3).forEach(t => tags.innerHTML += `<span class="verdict-tag archetype">${escapeHtml(t)}</span>`);

  $('#verdictUsername').textContent = c.username;
  const summary = typeof d.verdict === 'string' ? d.verdict : (d.verdict?.summary || '');
  $('#verdictSentence').textContent = summary;

  const metrics  = $('#overviewMetrics');
  const conflict = d.portrait?.conflict?.score ?? 0;
  const emotion  = d.portrait?.emotion || {};
  const rawStats = d.raw_stats || {};
  const posts    = rawStats.posts_fetched || 0;
  const exactPostTotal = Number.isInteger(rawStats.exact_post_total)
    ? rawStats.exact_post_total
    : null;
  const profileMessageCount = Number.isInteger(rawStats.profile_message_count)
    ? rawStats.profile_message_count
    : null;
  const totalMessages = exactPostTotal ?? c.message_count ?? 0;
  const threads  = rawStats.threads_fetched || 0;
  const likes    = c.likes_received || 0;

  metrics.innerHTML = `
    ${metricCard('Конфликтность', conflict + '/10',          conflictVerdict(conflict),              conflictColor(conflict))}
    ${metricCard('Оскорбления',    (emotion.toxic_pct || 0) + '%', 'постов с адресными оскорблениями', (emotion.toxic_pct || 0) >= 25 ? 'red' : 'green')}
    ${metricCard('Эмоции',        (emotion.neutral_pct || 0) + '%', 'нейтрально',                   'blue')}
    ${metricCard('Сообщений',     totalMessages.toLocaleString('ru'), exactPostTotal !== null ? 'точный итог' : 'в профиле', 'purple')}
    ${metricCard('Сканировано',   posts.toLocaleString('ru'),    'сообщений',                       'purple')}
    ${metricCard('Тем',           threads.toLocaleString('ru'),  'создано',                          'blue')}
    ${metricCard('Лайков',        likes.toLocaleString('ru'),    'получено',                         'green')}
  `;

  $('#cardUid').textContent = '#' + c.user_id;
  $('#cardBody').innerHTML = `
    <div class="kv-list">
      ${kvRow('Никнейм',         escapeHtml(c.username))}
      ${kvRow('ID',              '#' + c.user_id, 'mono')}
      ${kvRow('Статус',          escapeHtml(c.status))}
      ${kvRow('Группы',          c.groups.length ? c.groups.map(g => `<span class="chip">${escapeHtml(g)}</span>`).join(' ') : '—')}
      ${kvRow('Активность',      escapeHtml(c.last_activity), c.is_banned ? 'danger' : '')}
      ${kvRow('Стаж',            escapeHtml(c.tenure))}
      ${kvRow('Ворнинги',        escapeHtml(c.warnings), c.warning_points >= 3 ? 'danger' : c.warning_points > 0 ? 'warn' : 'success')}
      ${kvRow('Трофеи',          c.trophy_count)}
      ${kvRow(exactPostTotal !== null ? 'Всего сообщений (точно)' : 'Всего сообщений', totalMessages.toLocaleString('ru'), 'mono')}
      ${profileMessageCount !== null ? kvRow('Сообщений в профиле', profileMessageCount.toLocaleString('ru'), 'mono') : ''}
      ${kvRow('Сообщений отсканировано', posts.toLocaleString('ru'), 'mono')}
      ${kvRow('Лайков получено', c.likes_received.toLocaleString('ru'), 'mono')}
      ${kvRow('Подписок / фолловеров', rawStats.following + ' / ' + rawStats.followers)}
    </div>
  `;

  const s   = d.safety;
  const cls = s.in_blacklist ? 'banned' : 'safe';
  const icon = s.in_blacklist ? '🚫' : '✅';
  const detail = s.ban_reason && s.ban_reason !== 'Причина не указана в API'
    ? `Группа: ${s.ban_reason}`
    : 'Не найден в блеклисте, не заблокирован';
  $('#safetyBody').innerHTML = `
    <div class="safety-block ${cls}">
      <div class="safety-icon">${icon}</div>
      <div>
        <div class="safety-verdict">${escapeHtml(s.verdict)}</div>
        <div class="safety-detail">${escapeHtml(detail)}</div>
      </div>
    </div>
  `;

  const v = d.verdict;
  if (typeof v === 'string') {
    $('#finalVerdictBody').innerHTML = `<div class="verdict-text">${escapeHtml(v)}</div>`;
  } else {
    let html = `<div class="verdict-text" style="margin-bottom:20px">${escapeHtml(v?.summary || '')}</div>`;
    if (v?.personality) {
      html += `<div class="kv-list">
        ${kvRow('Тип общения',     v.personality.тип_общения + (v.personality.доп_тип && v.personality.доп_тип !== '—' ? ' + ' + v.personality.доп_тип : ''))}
        ${kvRow('Эмоциональный фон', v.personality.эмоциональный_фон)}
        ${kvRow('Эго-индекс',       v.personality.эго_индекс)}
        ${kvRow('Уверенность',      v.personality.уверенность)}
        ${kvRow('Конфликтность',    v.personality.конфликтность)}
        ${kvRow('Грамотность',      v.personality.грамотность)}
        ${kvRow('Типажи',           v.personality.архетипы?.join(', '))}
      </div>`;
    }
    if (v?.useful_for?.length) {
      html += `<div style="margin-top:16px"><div class="stat-label" style="margin-bottom:8px">✅ Кому полезен</div><ul style="list-style:none;padding:0">${v.useful_for.map(u => `<li style="padding:4px 0;font-size:13px">• ${escapeHtml(u)}</li>`).join('')}</ul></div>`;
    }
    if (v?.dangerous_for?.length) {
      html += `<div style="margin-top:16px"><div class="stat-label" style="margin-bottom:8px;color:var(--red)">⚠ Кому опасен</div><ul style="list-style:none;padding:0">${v.dangerous_for.map(u => `<li style="padding:4px 0;font-size:13px">• ${escapeHtml(u)}</li>`).join('')}</ul></div>`;
    }
    if (v?.newbies_note) {
      html += `<div style="margin-top:16px;padding:12px;background:var(--bg-elev-2);border-radius:var(--radius);border-left:3px solid var(--yellow)"><div class="stat-label" style="margin-bottom:4px">🎯 Если ты новичок</div><div style="font-size:13px">${escapeHtml(v.newbies_note)}</div></div>`;
    }
    $('#finalVerdictBody').innerHTML = html;
  }
}

function conflictColor(score) {
  if (score >= 7) return 'red';
  if (score >= 5) return 'orange';
  if (score >= 3) return 'yellow';
  return 'green';
}
function conflictVerdict(score) {
  if (score >= 8) return 'агрессор';
  if (score >= 6) return 'конфликтный';
  if (score >= 3) return 'бывает резок';
  return 'мирный';
}
function metricCard(label, value, sub, color = '') {
  return `<div class="metric-card ${color}">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value ${color}">${escapeHtml(String(value))}</div>
    <div class="metric-sub">${escapeHtml(sub)}</div>
  </div>`;
}
function kvRow(label, value, cls = '') {
  return `<div class="kv-row">
    <div class="kv-label">${escapeHtml(label)}</div>
    <div class="kv-value ${cls}">${value}</div>
  </div>`;
}

// =========================================================
// PAGE: ACTIVITY
// =========================================================
function renderActivityPage(d) {
  const a  = d.activity;
  const tp = a.time_profile;

  $('#activityTimeBody').innerHTML = `
    <div class="stat-card" style="margin-bottom:12px">
      <div class="stat-label">Когда обитает</div>
      <div style="font-size:15px;font-weight:600;margin-top:4px">${escapeHtml(tp.verdict)}</div>
    </div>
    ${tp.peak_hour != null ? `
    <div class="stat-grid">
      ${statCard('Пик',          tp.peak_hour + ':00', 'blue')}
      ${statCard('Утро (6-12)',  pct(tp.morning_ratio), '')}
      ${statCard('День (12-18)', pct(tp.day_ratio), '')}
      ${statCard('Вечер (18-24)',pct(tp.evening_ratio), '')}
      ${statCard('Ночь (0-6)',   pct(tp.night_ratio), '')}
      ${statCard('Выходные',     pct(tp.weekend_ratio), '')}
    </div>` : ''}
  `;

  const yd = a.yearly_dynamics;
  if (yd?.by_year_sorted?.length) {
    const maxY = Math.max(...yd.by_year_sorted.map(y => y[1]));
    $('#activityYearsBody').innerHTML = `
      <div class="stat-card" style="margin-bottom:12px">
        <div class="stat-label">Динамика</div>
        <div style="font-size:13px;margin-top:4px">${escapeHtml(yd.verdict)}</div>
      </div>
      <div class="year-chart">
        ${yd.by_year_sorted.map(([year, count]) => `
          <div class="year-bar">
            <div class="year-bar-value">${count}</div>
            <div class="year-bar-fill" style="height:${Math.max(2, count/maxY*100)}%"></div>
            <div class="year-bar-label">${year}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    $('#activityYearsBody').innerHTML = '<p class="muted">Недостаточно данных</p>';
  }

  $('#activityForumsBody').innerHTML = a.top_forums?.length
    ? a.top_forums.map(f => `<div class="list-row"><span class="list-name">${escapeHtml(f.forum)}</span><span class="list-count">${f.count}</span></div>`).join('')
    : '<p class="muted">Нет данных</p>';

  const r = a.reactions;
  if (r) {
    $('#activityReactionsBody').innerHTML = `
      <div class="stat-grid">
        ${statCard('Всего лайков', r.total_likes.toLocaleString('ru'), 'green')}
        ${statCard('Среднее',      r.avg_likes, '')}
        ${statCard('Максимум',     r.max_likes, 'blue')}
        ${statCard('Без лайков',   r.zero_like_pct + '%', r.zero_like_pct > 70 ? 'red' : '')}
      </div>
      <div style="margin-top:12px;font-size:13px;color:var(--fg-muted)">${escapeHtml(r.verdict)}</div>
    `;
  }

  $('#activityTopThreadsBody').innerHTML = a.top_threads_by_views?.length
    ? a.top_threads_by_views.map(t => {
        const tUrl = t.url || (t.thread_id ? `https://lolz.team/threads/${t.thread_id}/` : '');
        const titleHtml = tUrl
          ? `<a class="example-title" href="${tUrl}" target="_blank" rel="noopener">${escapeHtml(t.title)}</a>`
          : `<span class="example-title">${escapeHtml(t.title)}</span>`;
        return `
        <div class="example-row">
          <span class="example-date">${escapeHtml(t.date)}</span>
          ${titleHtml}
          <span class="example-meta"><span>👁 ${t.views.toLocaleString('ru')}</span><span>💬 ${t.replies}</span></span>
        </div>`;
      }).join('')
    : '<p class="muted">Нет данных</p>';

  $('#activityTopPostsBody').innerHTML = a.top_posts_by_likes?.length
    ? a.top_posts_by_likes.map(p => `
        <div class="phrase pink">
          «${escapeHtml(p.body)}»
          <div style="margin-top:8px;font-size:11px;color:var(--fg-muted);font-style:normal;font-family:var(--font-mono)">
            ❤️ ${p.likes} · 💬 ${p.comments} · ${escapeHtml(p.date)} · ${escapeHtml(p.thread_title || p.forum || '')}
          </div>
        </div>
      `).join('')
    : '<p class="muted">Нет залайканных постов</p>';

  $('#activityWallBody').innerHTML = `
    <div class="wall-block">
      <div class="wall-atmosphere">${escapeHtml(a.wall_atmosphere)}</div>
      ${a.wall_posters?.length ? `<div class="wall-posters">${a.wall_posters.map(p => `<span class="chip">@${escapeHtml(p.name)} <span class="count">×${p.count}</span></span>`).join('')}</div>` : ''}
    </div>
  `;
}

function statCard(label, value, color = '') {
  return `<div class="stat-card">
    <div class="stat-label">${escapeHtml(label)}</div>
    <div class="stat-value ${color}">${escapeHtml(String(value))}</div>
  </div>`;
}

// =========================================================
// PAGE: BEHAVIOR
// =========================================================
function renderBehaviorPage(d) {
  const p = d.portrait;

  $('#behaviorMannerBody').innerHTML = `
    <div style="font-size:24px;font-weight:700;margin-bottom:8px">${escapeHtml(p.manner.primary)}${p.manner.secondary ? ` <span class="dim">+ ${escapeHtml(p.manner.secondary)}</span>` : ''}</div>
    <div class="muted" style="margin-bottom:12px;font-size:13px">${escapeHtml(p.manner.description)}</div>
    <div class="stat-grid">
      ${statCard('Слов/пост',  p.stats.avg_words_per_post, '')}
      ${statCard('Капс',       pct(p.stats.caps_avg), '')}
      ${statCard('Эмодзи/пост',p.stats.emoji_avg, '')}
    </div>
  `;

  const aiTypes   = d.ai_analysis?.psychologist?.parsed?.personality_types || [];
  const coreTypes = aiTypes.length ? aiTypes : (p.archetypes || []);
  $('#behaviorTypesBody').innerHTML = `
    <div class="chips-list">
      ${coreTypes.map(t => `<span class="chip purple">${escapeHtml(t)}</span>`).join('')}
    </div>
    ${aiTypes.length
      ? '<div class="muted small" style="margin-top:10px">от AI-психолога (DeepSeek)</div>'
      : '<div class="muted small" style="margin-top:10px">от ядра (тариф «Полный» даёт AI-психотипы)</div>'}
  `;

  const e = p.emotion;
  $('#behaviorEmotionBody').innerHTML = `
    <div class="bars-list">
      ${barRow('Позитив',    e.positive_pct, 100, 'green')}
      ${barRow('Нейтрально', e.neutral_pct,  100, 'blue')}
      ${barRow('Негатив',    e.negative_pct, 100, 'orange')}
      ${barRow('Оскорбления', e.toxic_pct,    100, 'red')}
    </div>
    <div style="margin-top:12px;font-size:13px;color:var(--fg-muted)">${escapeHtml(e.verdict)}</div>
  `;

  $('#behaviorEgoBody').innerHTML = `
    <div class="donut-grid">
      ${donutCard('Эго-индекс', p.ego.per_100,       10,  'purple', p.ego.verdict)}
      ${donutCard('Уверенность',p.confidence.score,  100, 'blue',   p.confidence.verdict)}
    </div>
  `;

  const cs = p.conflict.score || 0;
  const cColor = conflictColor(cs);
  $('#behaviorConflictBody').innerHTML = `
    <div class="gauge">
      ${gaugeSVG(cs, cColor)}
      <div class="gauge-info">
        <div class="gauge-label">Конфликтность</div>
        <div><span class="gauge-score" style="color:var(--${cColor === 'orange' ? 'orange' : cColor})">${cs}</span><span class="gauge-max">/10</span></div>
        <div class="gauge-note">${escapeHtml(p.conflict.verdict)}</div>
      </div>
    </div>
  `;

  const tr = d.triggers;
  if (tr) {
    $('#behaviorTriggersBody').innerHTML = `
      <div class="stat-card" style="margin-bottom:12px">
        <div class="stat-label">Вердикт</div>
        <div style="font-size:13px;margin-top:4px">${escapeHtml(tr.verdict)}</div>
      </div>
      ${tr.top_topic_triggers?.length ? tr.top_topic_triggers.map(t => `
        <div class="trigger-row">
          <div class="trigger-topic">${escapeHtml(t.topic)}</div>
          <div class="trigger-meta">
            <span class="trigger-pill toxic">мат ×${t.toxic_count}</span>
            ${t.caps_count > 0 ? `<span class="trigger-pill caps">КАПС ×${t.caps_count}</span>` : ''}
          </div>
          ${t.sample ? `<div class="trigger-sample">«${escapeHtml(t.sample)}»</div>` : ''}
        </div>
      `).join('') : '<p class="muted">Нет конкретных триггеров</p>'}
    `;
  }

  const am = d.admit_mistakes;
  if (am) {
    const color = am.count === 0 ? 'red' : am.count <= 2 ? 'yellow' : 'green';
    $('#behaviorMistakesBody').innerHTML = `
      <div class="stat-grid">${statCard('Случаев', am.count + '/' + (am.total_posts || '?'), color)}</div>
      <div style="margin-top:12px;font-size:13px;color:var(--fg-muted)">${escapeHtml(am.verdict)}</div>
      ${am.examples?.length ? `<div style="margin-top:12px">${am.examples.map(ex => `<div class="phrase">«${escapeHtml(ex.body)}»</div>`).join('')}</div>` : ''}
    `;
  }

  const em = d.empathy;
  if (em) {
    const color = em.count === 0 ? 'red' : em.count <= 2 ? 'yellow' : 'green';
    $('#behaviorEmpathyBody').innerHTML = `
      <div class="stat-grid">${statCard('Поддержек', em.count, color)}</div>
      <div style="margin-top:12px;font-size:13px;color:var(--fg-muted)">${escapeHtml(em.verdict)}</div>
      ${em.examples?.length ? `<div style="margin-top:12px">${em.examples.map(ex => `<div class="phrase green">«${escapeHtml(ex)}»</div>`).join('')}</div>` : ''}
    `;
  }

  const nb = d.newbies;
  if (nb) {
    $('#behaviorNewbiesBody').innerHTML = `
      <div class="stat-card" style="margin-bottom:12px">
        <div class="stat-label">Вердикт</div>
        <div style="font-size:13px;margin-top:4px">${escapeHtml(nb.verdict)}</div>
      </div>
      ${(nb.total_newbie_mentions || 0) > 0 ? `
      <div class="stat-grid">
        ${statCard('Токсичных новичкам', nb.toxic_to_newbies,   'red')}
        ${statCard('Помог новичкам',     nb.helpful_to_newbies, 'green')}
      </div>` : ''}
    `;
  }

  const lit = p.literacy;
  if (lit) {
    const color = lit.score >= 8 ? 'green' : lit.score >= 5 ? 'yellow' : 'red';
    $('#behaviorLiteracyBody').innerHTML = `
      <div class="donut-grid">${donutCard('Скор', lit.score, 10, color, lit.verdict)}</div>
      <div class="stat-grid" style="margin-top:12px">
        ${statCard('Слов/пост',   lit.avg_words_per_post, '')}
        ${statCard('С запятыми',  pct(lit.comma_ratio),   '')}
        ${statCard('С точками',   pct(lit.dot_ratio),     '')}
      </div>
    `;
  }

  if (p.interests) {
    let html = '';
    if (p.interests.tech_keywords?.length) {
      html += `<div class="stat-label" style="margin-bottom:8px">Технические маркеры</div>
      <div class="chips-list" style="margin-bottom:16px">
        ${p.interests.tech_keywords.map((kw, i) => `<span class="chip ${i < 3 ? 'green' : ''}">${escapeHtml(kw.word)} <span class="count">${kw.count}</span></span>`).join('')}
      </div>`;
    }
    if (p.interests.general_keywords?.length) {
      html += `<div class="stat-label" style="margin-bottom:8px">Ключевые слова</div>
      <div class="chips-list">
        ${p.interests.general_keywords.map((kw, i) => `<span class="chip ${i < 3 ? 'blue' : ''}">${escapeHtml(kw.word)} <span class="count">${kw.count}</span></span>`).join('')}
      </div>`;
    }
    $('#behaviorInterestsBody').innerHTML = html || '<p class="muted">Нет данных</p>';
  }

  $('#behaviorPhrasesBody').innerHTML = p.sample_phrases?.length
    ? p.sample_phrases.map(ph => `<div class="phrase">«${escapeHtml(ph)}»</div>`).join('')
    : '<p class="muted">Нет примеров</p>';
}

// =========================================================
// PAGE: PSYCHOLOGY
// =========================================================
function renderPsychologyPage(d) {
  const ai = d.ai_analysis;
  if (!ai?.psychologist?.parsed) {
    $('#psychMannerBody').innerHTML = '<p class="muted">Нет данных психолога.</p>';
    return;
  }
  const p     = ai.psychologist.parsed;
  const usage = ai.psychologist.usage;
  const model = ai.psychologist.model || 'DeepSeek';

  $('#psychModel').textContent = `${model} · ${usage?.total_tokens || '?'} ток.`;
  $('#psychMannerBody').innerHTML = `<div class="ai-portrait-text"><p>${escapeHtml(p.manner_description || '')}</p></div>`;

  const bf = p.big_five;
  if (bf) {
    $('#psychBigFiveBody').innerHTML = `
      <div class="donut-grid">
        ${donutCard('Открытость',   bf.openness,          10, bigFiveColor(bf.openness),          '')}
        ${donutCard('Добросовест.', bf.conscientiousness, 10, bigFiveColor(bf.conscientiousness), '')}
        ${donutCard('Экстраверсия', bf.extraversion,      10, bigFiveColor(bf.extraversion),      '')}
        ${donutCard('Доброжелат.', bf.agreeableness,      10, bigFiveColor(bf.agreeableness),     '')}
        ${donutCard('Нейротизм',   bf.neuroticism,         10, bigFiveColor(bf.neuroticism, true), '')}
      </div>
      ${bf.note ? `<div style="margin-top:14px;padding:12px;background:var(--bg-elev-2);border-radius:var(--radius);font-size:13px;color:var(--fg-muted)">${escapeHtml(bf.note)}</div>` : ''}
    `;
  }

  const dt = p.dark_triad;
  if (dt) {
    const flags = dt.red_flags || [];
    const allZero = !dt.narcissism && !dt.machiavellianism && !dt.psychopathy;
    $('#psychDarkTriadBody').innerHTML = allZero && !flags.length
      ? `<div style="padding:14px 0;font-size:14px;line-height:1.5;color:var(--fg-muted)">Выраженных черт тёмной триады не выявлено — по постам признаков манипулятивности, эгоцентричной агрессии или жестокости нет.</div>`
      : `
      <div class="bars-list">
        ${barRow('Нарциссизм',    dt.narcissism,       10, dt.narcissism >= 6 ? 'red' : dt.narcissism >= 4 ? 'orange' : 'green')}
        ${barRow('Макиавеллизм',  dt.machiavellianism, 10, dt.machiavellianism >= 6 ? 'red' : dt.machiavellianism >= 4 ? 'orange' : 'green')}
        ${barRow('Психопатия',    dt.psychopathy,       10, dt.psychopathy >= 6 ? 'red' : dt.psychopathy >= 4 ? 'orange' : 'green')}
      </div>
      ${flags.length
        ? `<div class="red-flags"><strong>🚩 Красные флаги:</strong><ul>${flags.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`
        : '<div style="margin-top:12px;font-size:13px;color:var(--green)">✅ Красных флагов не обнаружено</div>'}
    `;
  }

  const ei = p.emotional_intelligence;
  if (ei) {
    $('#psychEIBody').innerHTML = `
      <div class="donut-grid">
        ${donutCard('Самосознание',  ei.self_awareness,  10, eiColor(ei.self_awareness), '')}
        ${donutCard('Саморегуляция', ei.self_regulation, 10, eiColor(ei.self_regulation), '')}
        ${donutCard('Эмпатия',       ei.empathy,          10, eiColor(ei.empathy), '')}
        ${donutCard('Соц. навыки',   ei.social_skills,    10, eiColor(ei.social_skills), '')}
      </div>
    `;
  }

  let defensesHTML = '';
  if (p.defense_mechanisms?.length) {
    defensesHTML += `<div class="stat-label" style="margin-bottom:8px">Защитные механизмы</div>
    <div class="chips-list" style="margin-bottom:16px">
      ${p.defense_mechanisms.map(x => `<span class="chip purple">${escapeHtml(x)}</span>`).join('')}
    </div>`;
  }
  if (p.cognitive_distortions?.length) {
    defensesHTML += `<div class="stat-label" style="margin-bottom:8px">Когнитивные искажения</div>
    <div class="chips-list">
      ${p.cognitive_distortions.map(x => `<span class="chip red">${escapeHtml(x)}</span>`).join('')}
    </div>`;
  }
  $('#psychDefensesBody').innerHTML = defensesHTML || '<p class="muted">Не обнаружено</p>';

  $('#psychAttachmentBody').innerHTML = `<div class="ai-insight-text">${escapeHtml(p.attachment_style || '—')}</div>`;
  $('#psychConflictBody').innerHTML   = `<div class="ai-insight-text">${escapeHtml(p.conflict_pattern || '—')}</div>`;

  const rp = p.relationship_predictor;
  if (rp) {
    $('#psychRelationsBody').innerHTML = `
      <div class="scenarios-grid">
        ${rp.with_authority ? scenarioCard('С модераторами', rp.with_authority) : ''}
        ${rp.with_peers     ? scenarioCard('С равными',      rp.with_peers)     : ''}
        ${rp.with_newbies   ? scenarioCard('С новичками',    rp.with_newbies)   : ''}
        ${rp.with_targets   ? scenarioCard('С «мамонтами»',  rp.with_targets)   : ''}
      </div>
    `;
  }

  $('#psychCoreBody').innerHTML = p.core_need
    ? `<div class="stat-label" style="margin-bottom:8px">Что реально нужно от форума</div>
       <div class="ai-insight-text">${escapeHtml(p.core_need)}</div>`
    : '<p class="muted">—</p>';

  $('#psychSummaryBody').innerHTML = `<div class="ai-one-liner">«${escapeHtml(p.summary_one_line || '—')}»</div>`;
}

function bigFiveColor(v, inverted = false) {
  if (inverted) { return v <= 3 ? 'green' : v <= 6 ? 'yellow' : 'red'; }
  return v >= 7 ? 'green' : v >= 4 ? 'yellow' : 'red';
}
function eiColor(v) { return v >= 7 ? 'green' : v >= 4 ? 'yellow' : 'red'; }

// =========================================================
// PAGE: AI
// =========================================================
function renderAIPage(ai) {
  if (!ai) return;
  const lite  = ai.lite  || {};
  const max   = ai.max   || {};
  const liteP = lite.parsed || {};
  const maxP  = max.parsed  || {};

  $('#aiLiteModel').textContent = `${lite.model || '?'} · ${lite.usage?.total_tokens || '?'} ток.`;
  $('#aiMaxModel').textContent  = `${max.model  || '?'} · ${max.usage?.total_tokens  || '?'} ток.`;

  if (liteP.psychological_portrait) {
    const portrait = Array.isArray(liteP.psychological_portrait)
      ? liteP.psychological_portrait.join('\n\n')
      : liteP.psychological_portrait;
    $('#aiLitePortraitBody').innerHTML = `<div class="ai-portrait-text"><p>${escapeHtml(portrait).replace(/\n\n/g, '</p><p>')}</p></div>`;
  } else if (lite.error) {
    $('#aiLitePortraitBody').innerHTML = `<p class="muted">Ошибка: ${escapeHtml(lite.error)}</p>`;
  } else {
    $('#aiLitePortraitBody').innerHTML = '<p class="muted">—</p>';
  }

  if (liteP.behavior_scenarios) {
    $('#aiLiteScenariosBody').innerHTML = `
      <div class="scenarios-grid">
        ${Object.entries(liteP.behavior_scenarios).map(([k, v]) => scenarioCard(k.replace(/_/g, ' '), v)).join('')}
      </div>
    `;
  }

  $('#aiLiteTraitsBody').innerHTML = liteP.key_traits?.length
    ? `<div class="chips-list">${liteP.key_traits.map(t => `<span class="chip blue">${escapeHtml(t)}</span>`).join('')}</div>`
    : '<p class="muted">—</p>';

  $('#aiMaxHiddenBody').innerHTML = maxP.hidden_signals
    ? `<div class="ai-insight-text">${escapeHtml(maxP.hidden_signals)}</div>`
    : (max.error ? `<p class="muted">Ошибка: ${escapeHtml(max.error)}</p>` : '<p class="muted">—</p>');

  $('#aiMaxTriggersBody').innerHTML = maxP.predicted_triggers?.length
    ? `<div class="chips-list">${maxP.predicted_triggers.map(t => `<span class="chip pink">⚡ ${escapeHtml(t)}</span>`).join('')}</div>`
    : '<p class="muted">—</p>';

  $('#aiMaxVerdictBody').innerHTML = maxP.verdict_one_line
    ? `<div class="ai-one-liner">«${escapeHtml(maxP.verdict_one_line)}»</div>`
    : '<p class="muted">—</p>';
}

function scenarioCard(label, text) {
  return `<div class="scenario-card">
    <div class="scenario-label">${escapeHtml(label)}</div>
    <div class="scenario-text">${escapeHtml(text)}</div>
  </div>`;
}

// =========================================================
// HELPERS: SVG components
// =========================================================
function donutSVG(value, max, color) {
  const v   = Math.max(0, Math.min(max, value || 0));
  const pct = max > 0 ? v / max : 0;
  const circumference = 2 * Math.PI * 42;
  const offset = circumference * (1 - pct);
  const colorVar = `var(--${color})`;
  return `<div class="donut">
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle class="donut-bg" cx="50" cy="50" r="42"/>
      <circle class="donut-fill" cx="50" cy="50" r="42" stroke="${colorVar}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
    </svg>
    <div class="donut-center">
      <div class="donut-value" style="color:${colorVar}">${v}</div>
      <div class="donut-max">/${max}</div>
    </div>
  </div>`;
}
function donutCard(label, value, max, color, note = '') {
  return `<div class="donut-card">
    ${donutSVG(value, max, color)}
    <div class="donut-label">${escapeHtml(label)}</div>
    ${note ? `<div class="donut-note">${escapeHtml(note)}</div>` : ''}
  </div>`;
}
function gaugeSVG(score, color) {
  const s   = Math.max(0, Math.min(10, score || 0));
  const pct = s / 10;
  const colorVar = `var(--${color === 'orange' ? 'orange' : color})`;
  const circumference = Math.PI * 42;
  const offset = circumference * (1 - pct);
  return `<div class="gauge-svg">
    <svg width="120" height="70" viewBox="0 0 100 60">
      <path d="M 8 55 A 42 42 0 0 1 92 55" fill="none" stroke="var(--bg)" stroke-width="8" stroke-linecap="round"/>
      <path d="M 8 55 A 42 42 0 0 1 92 55" fill="none" stroke="${colorVar}" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
    </svg>
  </div>`;
}
function barRow(label, value, max, color) {
  const v   = value || 0;
  const pct = max > 0 ? (v / max) * 100 : 0;
  return `<div class="bar-row">
    <div class="bar-label">${escapeHtml(label)}</div>
    <div class="bar-track"><div class="bar-fill ${color}" style="width:${pct}%"></div></div>
    <div class="bar-value">${v}${max === 100 ? '%' : ''}</div>
  </div>`;
}

// =========================================================
// UTILS
// =========================================================
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function pct(v) {
  if (v === null || v === undefined) return '—';
  return Math.round(v * 100) + '%';
}

// ── Health check + auto-load from ?order=<id> ─────────────
(async () => {
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    const dot = $('#navStatus');
    if (h.lolz_tokens > 0) {
      dot.style.color = 'var(--green)';
      dot.title = `API токены загружены (${h.lolz_tokens})`;
    } else {
      dot.style.color = 'var(--red)';
      dot.title = 'API токены НЕ загружены';
    }
  } catch (_) {}

  // Если в URL есть ?order=<id> — загружаем результат сразу
  const orderId = new URLSearchParams(location.search).get('order');
  if (orderId) {
    history.replaceState(null, '', '/');   // убираем параметр из адресной строки
    try {
      const r     = await fetch(`/api/orders/${orderId}`);
      const order = await r.json();
      if (order.status === 'done' && order.result) {
        const user = { user_id: order.user_id, username: order.username, avatar: order.avatar };
        renderDossier(order.result, user, order.report_type || 'basic');
        showDossier();
      } else {
        // заказ ещё не готов — встаём на поллинг
        showLoading();
        const result = await pollOrderProgress(orderId);
        if (result) { renderDossier(result, {}, 'basic'); showDossier(); }
        hideLoading();
      }
    } catch (_) {}
  }
})();


/* zelscan-forum-nickname-render-v1 */
function forumUsernameText(user) {
  const username = String(user?.username || '');
  if (!username.includes('<')) return username;
  const template = document.createElement('template');
  template.innerHTML = username;
  return template.content.textContent.trim() || username.replace(/<[^>]*>/g, '');
}

function forumUsernameMarkup(user) {
  const fallback = escapeHtml(forumUsernameText(user));
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

  const text = escapeHtml(nickname.textContent.trim());
  return style ? `<span style="${escapeHtml(style)}">${text}</span>` : text;
}
