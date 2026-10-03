/* ==========================================================================
   ZELSCAN CONTROL CENTER — admin.js
   SPA-роутинг, все разделы панели, работа с реальными API /api/admin/*
   ========================================================================== */
(() => {
  "use strict";

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  let CSRF = "";
  let currentPage = "overview";
  let SESSION = null;

  /* Прямое обращение к бэкенду (5050), как в остальном фронте.
     Лендинг-прокси (8000) кеширует GET и не проксирует POST/DELETE. */
  const API = window.ZS_API || window.__ZS_API__ || "";
  const zsToken = () => localStorage.getItem("lzt_token") || "";

  /* ---------- Утилиты ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtN = (n) => { n = Number(n) || 0; return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }); };
  const fmtInt = (n) => (Number(n) || 0).toLocaleString("ru-RU");
  const fmtUsd = (n) => "$" + (Number(n) || 0).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") || "$0";
  const fmtPct = (n) => (Number(n) || 0).toFixed(1) + "%";
  const fmtDate = (ts) => ts ? new Date(Number(ts) * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtDay = (ts) => ts ? new Date(Number(ts) * 1000).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) : "—";

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    headers["Authorization"] = "Bearer " + zsToken();
    if (opts.method && opts.method !== "GET") headers["X-CSRF-Token"] = CSRF;
    if (opts.body) headers["Content-Type"] = "application/json";
    const r = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
    let data = {};
    try { data = await r.json(); } catch (e) { /* пусто */ }
    if (!r.ok) { const err = new Error(data.error || ("HTTP " + r.status)); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  function toast(msg, type = "info") {
    const safeType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
    const fallback = safeType === "error" ? "Не удалось выполнить действие. Попробуйте ещё раз." : String(msg || "");
    if (window.ZSNotice && typeof window.ZSNotice.show === "function") {
      window.ZSNotice.show({ type: safeType, title: fallback });
    }
  }

  function notice(type, title, message) {
    if (window.ZSNotice && typeof window.ZSNotice.show === "function") {
      window.ZSNotice.show({ type, title, message });
    }
  }

  function openModal(title, bodyHTML, wide) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHTML;
    const m = $("#modal");
    m.classList.toggle("wide", !!wide);
    m.hidden = false;
    m.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  }
  function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }

  const badgeHtml = (label, color) => `<span class="badge badge-${color} badge-plain">${esc(label)}</span>`;

  const orderBadge = (o) => {
    if (o.refunded_at) return badgeHtml("Возврат", "purple");
    switch (o.status) {
      case "pending_payment": return badgeHtml("Ожидает оплаты", "orange");
      case "paid": return badgeHtml("В очереди", "blue");
      case "processing": return badgeHtml("Обработка", "blue");
      case "done": return badgeHtml("Готово", "green");
      case "error": return badgeHtml("Ошибка", "red");
      case "cancelled": return badgeHtml("Отменён", "gray");
      default: return badgeHtml(o.status, "gray");
    }
  };

  const ringSvg = (pct, color) => {
    const R = 38, C = 2 * Math.PI * R;
    pct = Math.max(0, Math.min(100, pct || 0));
    const off = C - (C * pct) / 100;
    return `<div class="ring ${color}">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle class="ring-bg" cx="44" cy="44" r="${R}" fill="none" stroke-width="8"/>
        <circle class="ring-fill" cx="44" cy="44" r="${R}" fill="none" stroke-width="8"
          stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
      </svg>
      <div class="ring-label"><div><b>${pct}%</b><small>${esc(color === "green" ? "выполнено" : "")}</small></div></div>
    </div>`;
  };

  const skeletonCards = (n = 4) => Array.from({ length: n }, () => $("#tpl-skeleton-card").innerHTML).join("");
  const skeletonRows = (n = 6) => Array.from({ length: n }, () => $("#tpl-skeleton-row").innerHTML).join("");

  /* ---------- Скелетон экрана ---------- */
  function renderSkeleton() { $("#content").innerHTML = `<div class="page">${skeletonCards(4)}${skeletonCards(2)}</div>`; }

  /* ---------- Роутер ---------- */
  const PAGES = {
    overview: { title: "Обзор", render: renderOverview },
    users: { title: "Пользователи", render: renderUsers },
    orders: { title: "Заказы и отчёты", render: renderOrders },
    promos: { title: "Промокоды", render: renderPromos },
    ai: { title: "ИИ и расходы", render: renderAI },
    finance: { title: "Финансы", render: renderFinance },
    analytics: { title: "Аналитика", render: renderAnalytics },
    traffic: { title: "Трафик", render: renderTraffic },
    audit: { title: "Аудит", render: renderAudit },
    settings: { title: "Настройки", render: renderSettings },
  };

  function navigate(page, pushHash = true) {
    if (!PAGES[page]) page = "overview";
    currentPage = page;
    $$(".nav-item").forEach((n) => { n.classList.toggle("active", n.dataset.page === page); if (n.dataset.page === page) n.setAttribute("aria-current", "page"); else n.removeAttribute("aria-current"); });
    $("#pageTitle").textContent = PAGES[page].title;
    if (pushHash) location.hash = "#/" + page;
    renderSkeleton();
    PAGES[page].render().catch((e) => { console.error(e); $("#content").innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">⚠</div><h3>Не удалось загрузить данные</h3><p>Попробуйте обновить страницу.</p></div></div>'; });
    if (window.innerWidth <= 820) $("#sidebar").classList.remove("open");
  }

  /* ==========================================================================
     ГАТЕ (авторизация)
     ========================================================================== */
  async function checkAccess() {
    try {
      const a = await api("/api/admin/access");
      SESSION = a;
      if (a.eligible && a.unlocked) { CSRF = a.csrf || ""; $("#shell").hidden = false; $("#gate").hidden = true; loadHash(); startHealth(); }
      else if (a.eligible) showLogin();
      else showDenied();
    } catch (e) { showDenied(); notice("error", "Не удалось подключиться к админке", "Сервер управления временно недоступен."); }
  }

  function showLogin() {
    $("#shell").hidden = true;
    $("#gate").hidden = false;
    $("#gateTitle").textContent = "Вход в панель";
    $("#gateText").textContent = "Аккаунт подтверждён. Введи четырёхзначный код.";
    $("#loginForm").hidden = false;
    $("#gateError").textContent = "";
  }
  function showDenied() {
    $("#shell").hidden = true;
    $("#gate").hidden = false;
    $("#loginForm").hidden = true;
    $("#gateTitle").textContent = "Доступ закрыт";
    $("#gateText").textContent = "Панель доступна только владельцу аккаунта #638074.";
    $("#gateError").textContent = "";
  }

  async function doLogin(password) {
    const form = $("#loginForm");
    const submit = $("button[type=submit]", form);
    const input = $("#adminPassword");
    const originalLabel = submit.innerHTML;
    submit.disabled = true;
    input.disabled = true;
    submit.textContent = "Входим…";
    $("#gateError").textContent = "";
    try {
      const r = await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      CSRF = r.csrf;
      $("#shell").hidden = false; $("#gate").hidden = true;
      loadHash(); startHealth();
      notice("success", "Токен применён", "Новый токен успешно проверен и сохранён.");
    } catch (e) {
      $("#gateError").textContent = "Не удалось войти. Проверьте код и повторите попытку.";
      input.focus();
    } finally {
      submit.disabled = false;
      input.disabled = false;
      submit.innerHTML = originalLabel;
    }
  }

  async function doLogout() {
    try { await api("/api/admin/logout", { method: "POST" }); } catch (e) { /* игнор */ }
    CSRF = ""; $("#shell").hidden = true; showLogin();
  }

  function startHealth() {
    setInterval(async () => {
      try { const a = await api("/api/admin/access"); if (!(a.eligible && a.unlocked)) { window.location.reload(); } }
      catch (e) { $("#healthDetail").textContent = "Нет связи"; $("#healthIndicator").style.opacity = "0.5"; }
    }, 30000);
  }

  /* ==========================================================================
     ОБЗОР
     ========================================================================== */
  async function renderOverview() {
    const d = await api("/api/admin/overview");
    const k = d.kpis || {}, s = d.series || [];
    const maxOrders = Math.max(1, ...s.map((x) => x.orders));
    const bars = s.map((x) => {
      const h = Math.round((x.orders / maxOrders) * 100);
      return `<div class="bar" title="${fmtDay(x.day)}: ${fmtInt(x.orders)} заказов">
        <div class="bar-value">${x.done ? "✓" : ""}</div>
        <div class="bar-col"><div class="bar-fill" style="height:${h}%"></div></div>
        <div class="bar-label">${fmtDay(x.day)}</div>
      </div>`;
    }).join("");

    const recent = (d.recent_events || []).slice(0, 10).map((ev) => `
      <div class="table-row">
        <div class="cell shrink"><span class="badge badge-blue badge-plain">${esc(ev.event)}</span></div>
        <div class="cell"><div class="cell-main">${esc(ev.object_type || "—")}${ev.object_id ? " · " + esc(ev.object_id) : ""}</div><div class="cell-sub">${esc(ev.meta_json || "")}</div></div>
        <div class="cell shrink cell-sub">${ev.user_id ? "ID " + esc(ev.user_id) : "аноним"}</div>
        <div class="cell shrink cell-num cell-sub">${fmtDate(ev.created_at)}</div>
      </div>`).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header">
        <div class="page-title"><h1>Обзор системы</h1><p>Живые показатели за последние сутки и месяц</p></div>
        <div class="page-actions">
          <span class="pills" data-period-pills>
            <button class="pill" data-period="day">24 часа</button>
            <button class="pill" data-period="month">30 дней</button>
            <button class="pill active" data-period="all">Всё время</button>
          </span>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon blue">♙</div><div class="stat-label">Пользователей</div><div class="stat-value">${fmtInt(k.users)}</div><div class="stat-note">активных за 24ч: <b>${fmtInt(k.active_day)}</b></div></div>
        <div class="stat-card"><div class="stat-icon green">▤</div><div class="stat-label">Заказов за месяц</div><div class="stat-value">${fmtInt(k.orders_month)}</div><div class="stat-note">готово: <b>${fmtInt(k.done_month)}</b></div></div>
        <div class="stat-card"><div class="stat-icon orange">₽</div><div class="stat-label">Выручка за месяц</div><div class="stat-value">${fmtInt(k.revenue_month)} <small>₽</small></div><div class="stat-note">средний LTV: <b>${fmtN(k.avg_ltv)}</b> ₽</div></div>
        <div class="stat-card"><div class="stat-icon purple">✦</div><div class="stat-label">Расходы на ИИ / мес</div><div class="stat-value">${fmtUsd(k.ai_cost_month)}</div><div class="stat-note">очередь: <b>${fmtInt(k.queue)}</b> заданий</div></div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><h2>Заказы по дням</h2><span class="card-sub">30 дней</span></div>
          <div class="chart-bars">${bars || '<div class="empty"><div class="empty-icon">▤</div><h3>Пока пусто</h3><p>Заказы появятся здесь</p></div>'}</div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Последние события</h2><span class="card-sub">события пользователей</span></div>
          <div class="table-list">${recent || '<div class="empty"><div class="empty-icon">⌁</div><h3>Событий нет</h3></div>'}</div>
        </div>
      </div>
    </div>`;
  }

  /* ==========================================================================
     ПОЛЬЗОВАТЕЛИ
     ========================================================================== */
  async function renderUsers(query = "") {
    const d = await api("/api/admin/users" + (query ? "?q=" + encodeURIComponent(query) : ""));
    const rows = (d.users || []).map((u) => `
      <div class="table-row clickable" data-uid="${esc(u.user_id)}">
        <div class="cell shrink"><div class="admin-avatar">${esc((u.username || "?")[0].toUpperCase())}</div></div>
        <div class="cell"><div class="cell-main">${esc(u.username || "—")} ${u.admin_banned ? badgeHtml("Забанен", "red") : ""}</div><div class="cell-sub">ID ${esc(u.user_id)}</div></div>
        <div class="cell shrink cell-num"><b>${fmtN(u.credits)}</b> <span class="text-muted">₽</span></div>
        <div class="cell shrink cell-num"><span class="text-orange">${fmtN(u.bonus_credits)}</span> <span class="text-muted">бонус</span></div>
        <div class="cell shrink cell-num cell-sub">заказов: ${fmtInt(u.orders_count)}</div>
        <div class="cell shrink cell-num cell-sub">LTV ${fmtN(u.ltv)} ₽</div>
        <div class="cell shrink cell-sub">${fmtDate(u.last_seen)}</div>
      </div>`).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header">
        <div class="page-title"><h1>Пользователи</h1><p>Поиск по нику или ID, просмотр балансов и операций</p></div>
        <form id="userSearch" class="flex">
          <input class="input" id="userSearchInput" style="width:260px" placeholder="Ник или ID…" value="${esc(query)}">
          <button class="btn btn-primary" type="submit">Найти</button>
        </form>
      </div>
      <div class="card">
        <div class="table-header"><span class="cell">Пользователь</span><span class="cell shrink">Рубли</span><span class="cell shrink">Бонусы</span><span class="cell shrink">Заказы</span><span class="cell shrink">LTV</span><span class="cell shrink">Активность</span></div>
        <div class="table-list">${rows || '<div class="empty"><div class="empty-icon">♙</div><h3>Никого не нашли</h3></div>'}</div>
      </div>
    </div>`;

    $("#userSearch").addEventListener("submit", (e) => { e.preventDefault(); renderUsers($("#userSearchInput").value.trim()); });
    $$(".table-row.clickable[data-uid]").forEach((r) => r.addEventListener("click", () => openUser($(r).dataset.uid)));
  }

  async function openUser(uid) {
    const d = await api("/api/admin/users/" + uid);
    const u = d.user;
    const tx = (d.transactions || []).slice(0, 20).map((t) => `
      <div class="detail-row"><span class="detail-label">${esc(t.kind)} · ${esc(t.description || "")}</span><span class="detail-value ${t.credits >= 0 ? "text-green" : "text-red"}">${t.credits >= 0 ? "+" : ""}${fmtN(t.credits)} ₽</span></div>`).join("");
    openModal("Пользователь · " + esc(u.username), `
      <div class="detail-panel">
        <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value mono">${esc(u.user_id)}</span></div>
        <div class="detail-row"><span class="detail-label">Рублёвый баланс</span><span class="detail-value">${fmtN(u.credits)} ₽</span></div>
        <div class="detail-row"><span class="detail-label">Бонусный баланс</span><span class="detail-value text-orange">${fmtN(u.bonus_credits)}</span></div>
        <div class="detail-row"><span class="detail-label">Заказов всего</span><span class="detail-value">${fmtInt(u.total_orders)}</span></div>
        <div class="detail-row"><span class="detail-label">Первый вход</span><span class="detail-value cell-sub">${fmtDate(u.first_seen)}</span></div>
        <div class="detail-row"><span class="detail-label">Последний вход</span><span class="detail-value cell-sub">${fmtDate(u.last_seen)}</span></div>
      </div>
      <div class="divider"></div>
      <h3 class="section-title">Изменить баланс</h3>
      <div class="field-row" data-cols="3">
        <div class="field"><label>Баланс</label><select class="select" id="balType"><option value="credits">Рубли</option><option value="bonus">Бонусы</option></select></div>
        <div class="field"><label>Сумма</label><input class="input" id="balAmount" type="number" step="1" placeholder="+100 / -50"></div>
        <div class="field"><label>Причина</label><input class="input" id="balReason" placeholder="обязательно"></div>
      </div>
      <button class="btn btn-primary btn-full" id="balApply">Применить</button>
      ${tx ? `<div class="divider"></div><h3 class="section-title">Последние операции</h3><div class="detail-panel">${tx}</div>` : ""}
    `, true);

    $("#balApply").addEventListener("click", async () => {
      const amount = parseFloat($("#balAmount").value); const reason = $("#balReason").value.trim(); const type = $("#balType").value;
      if (!amount || !reason) return toast("Укажи сумму и причину", "warning");
      try {
        const r = await api("/api/admin/users/" + uid + "/balance", { method: "POST", body: JSON.stringify({ type, amount, reason }) });
        toast(`Баланс обновлён: ${fmtN(r.balance)}`, "success"); closeModal(); renderUsers();
      } catch (e) { toast(e.message, "error"); }
    });
  }

  /* ==========================================================================
     ЗАКАЗЫ
     ========================================================================== */
  async function renderOrders() {
    const d = await api("/api/admin/orders");
    const rows = (d.orders || []).map((o) => `
      <div class="table-row clickable" data-oid="${esc(o.id)}">
        <div class="cell shrink">${orderBadge(o)}</div>
        <div class="cell"><div class="cell-main mono">${esc(o.display_id || o.id)}</div><div class="cell-sub">${esc(o.report_type)} · ${esc(o.username || ("ID " + (o.buyer_id || o.user_id || "?")))}</div></div>
        <div class="cell shrink cell-num cell-sub">${fmtN(o.ai_tokens)} tok</div>
        <div class="cell shrink cell-num cell-sub">${fmtUsd(o.ai_cost)}</div>
        <div class="cell shrink cell-sub">${fmtDate(o.created_at)}</div>
      </div>`).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Заказы и отчёты</h1><p>300 последних заказов · клик по строке для управления</p></div></div>
      <div class="card">
        <div class="table-header"><span class="cell shrink">Статус</span><span class="cell">Заказ</span><span class="cell shrink">Токены</span><span class="cell shrink">ИИ</span><span class="cell shrink">Создан</span></div>
        <div class="table-list">${rows || '<div class="empty"><div class="empty-icon">▤</div><h3>Заказов пока нет</h3></div>'}</div>
      </div>
    </div>`;

    $$(".table-row.clickable[data-oid]").forEach((r) => r.addEventListener("click", () => openOrder($(r).dataset.oid)));
  }

  async function openOrder(oid) {
    const d = await api("/api/admin/orders");
    const o = (d.orders || []).find((x) => x.id === oid);
    if (!o) return toast("Заказ не найден", "error");
    const aiBtn = o.report_type === "full" ? `<button class="btn btn-secondary btn-sm" id="orderAiUsage">Расходы ИИ</button>` : "";
    openModal("Заказ · " + esc(o.display_id || o.id), `
      <div class="detail-panel">
        <div class="detail-row"><span class="detail-label">Статус</span><span class="detail-value">${orderBadge(o)}</span></div>
        <div class="detail-row"><span class="detail-label">Тип отчёта</span><span class="detail-value">${esc(o.report_type)}</span></div>
        <div class="detail-row"><span class="detail-label">Покупатель</span><span class="detail-value">${esc(o.username || ("ID " + (o.buyer_id || o.user_id || "?")))}</span></div>
        <div class="detail-row"><span class="detail-label">Файл результата</span><span class="detail-value">${o.result_path ? "✔ есть" : '<span class="text-red">нет</span>'}</span></div>
        <div class="detail-row"><span class="detail-label">Ошибка</span><span class="detail-value ${o.error ? "text-red" : "text-muted"}">${esc(o.error || "—")}</span></div>
        <div class="detail-row"><span class="detail-label">Создан</span><span class="detail-value cell-sub">${fmtDate(o.created_at)}</span></div>
        <div class="detail-row"><span class="detail-label">Оплачен</span><span class="detail-value cell-sub">${fmtDate(o.paid_at)}</span></div>
        <div class="detail-row"><span class="detail-label">Готов</span><span class="detail-value cell-sub">${fmtDate(o.finished_at)}</span></div>
        <div class="detail-row"><span class="detail-label">Просмотров</span><span class="detail-value">${fmtInt(o.view_count)}</span></div>
      </div>
      <div class="divider"></div>
      <div class="field"><label>Причина действия (обязательна)</label><input class="input" id="orderReason" placeholder="например: пользователь написал в лс"></div>
      <div class="btn-group wrap mt-sm">
        ${o.status === "error" ? '<button class="btn btn-secondary btn-sm" data-act="retry">Перезапустить</button>' : ""}
        ${o.report_type === "full" && !o.result_path ? '<button class="btn btn-secondary btn-sm" data-act="retry_ai">Перегенерировать ИИ</button>' : ""}
        ${o.status === "pending_payment" ? '<button class="btn btn-secondary btn-sm" data-act="mark_paid">Отметить оплаченным</button>' : ""}
        ${(o.status === "pending_payment" || o.status === "paid") ? '<button class="btn btn-secondary btn-sm" data-act="cancel">Отменить</button>' : ""}
        ${!o.refunded_at ? '<button class="btn btn-danger btn-sm" data-act="refund">Вернуть средства</button>' : ""}
        <button class="btn btn-ghost btn-sm" data-act="hide">Скрыть</button>
      </div>
      <div class="btn-group wrap mt-sm">
        <button class="btn btn-ghost btn-sm" data-act="visibility_unlisted">Unlisted</button>
        <button class="btn btn-ghost btn-sm" data-act="visibility_public">Public</button>
        <button class="btn btn-ghost btn-sm" data-act="revoke_share">Забрать доступ</button>
      </div>
      ${aiBtn}
      <div id="orderAiUsageWrap" class="mt"></div>
    `, true);

    $("#orderAiUsageWrap");
    const actBtn = $("#orderAiUsage");
    if (actBtn) actBtn.addEventListener("click", showAiUsage(oid));
    $$("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const reason = $("#orderReason").value.trim();
      if (!reason) return toast("Укажи причину действия", "warning");
      const act = b.dataset.act;
      try {
        const r = await api("/api/admin/orders/" + oid + "/action", { method: "POST", body: JSON.stringify({ action: act, reason }) });
        toast("Готово", "success");
        if (r.share_url) { toast("Ссылка: " + r.share_url, "info"); }
        closeModal(); renderOrders();
      } catch (e) { toast(e.message, "error"); }
    }));
  }

  function showAiUsage(oid) {
    return async () => {
      const wrap = $("#orderAiUsageWrap");
      wrap.innerHTML = skeletonRows(3);
      try {
        const d = await api("/api/admin/ai/usage/" + oid);
        const slots = Object.entries(d.by_slot || {}).map(([slot, s]) => `
          <div class="detail-row"><span class="detail-label">${esc(slot)} (${s.calls} вызов)</span><span class="detail-value">${fmtInt(s.total_tokens)} ток · ${fmtUsd(s.cost_usd)}</span></div>`).join("");
        wrap.innerHTML = `
          <div class="card mt"><div class="card-header"><h3>Расход токенов по заказу</h3><span class="card-sub">итого ${fmtInt(d.total_tokens)} ток · ${fmtUsd(d.total_cost_usd)}</span></div>
          <div class="detail-panel">${slots || '<div class="empty"><div class="empty-icon">✦</div><h3>Нет записей</h3></div>'}</div></div>`;
      } catch (e) { wrap.innerHTML = `<div class="card"><div class="empty"><p class="text-red">${esc(e.message)}</p></div></div>`; }
    };
  }

  /* ==========================================================================
     ПРОМОКОДЫ
     ========================================================================== */
  async function renderPromos() {
    const d = await api("/api/admin/promo?active=true");
    const rows = (d.promos || []).map((p) => {
      const type = (p.bonus_type === "credits" ? "₽ " : "бонус ") + (p.value_type === "percent" ? p.bonus + "%" : fmtN(p.bonus));
      const used = p.budget != null ? `${fmtN(p.spent)}/${fmtN(p.budget)}` : `${fmtInt(p.used_count)}/${fmtInt(p.max_uses)}`;
      const expired = p.expires_at && p.expires_at < Math.floor(Date.now() / 1000);
      return `
      <div class="table-row">
        <div class="cell shrink"><button class="btn btn-ghost btn-sm" data-toggle="${esc(p.code)}" title="Вкл/выкл">${p.active ? "●" : "○"}</button></div>
        <div class="cell"><div class="cell-main mono">${esc(p.code)}</div><div class="cell-sub">${esc(p.description || (p.bonus_type + " · " + p.value_type))}</div></div>
        <div class="cell shrink cell-num"><span class="text-green">${type}</span></div>
        <div class="cell shrink cell-num cell-sub">${used}</div>
        <div class="cell shrink cell-sub">${expired ? badgeHtml("Истёк", "red") : p.expires_at ? badgeHtml("до " + fmtDay(p.expires_at), "gray") : badgeHtml("без срока", "gray")}</div>
        <div class="cell shrink"><div class="btn-group">
          <button class="btn btn-ghost btn-sm" data-edit="${esc(p.code)}">✎</button>
          <button class="btn btn-ghost btn-sm text-red" data-del="${esc(p.code)}">×</button>
        </div></div>
      </div>`;
    }).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header">
        <div class="page-title"><h1>Промокоды</h1><p>Фиксированная сумма или процент, на рубли или бонусы</p></div>
        <button class="btn btn-primary" id="promoCreate">+ Создать промокод</button>
      </div>
      <div class="card">
        <div class="table-header"><span class="cell shrink">Актив</span><span class="cell">Код</span><span class="cell shrink">Начисление</span><span class="cell shrink">Израсходовано</span><span class="cell shrink">Срок</span><span class="cell shrink">Действия</span></div>
        <div class="table-list">${rows || '<div class="empty"><div class="empty-icon">◈</div><h3>Промокодов нет</h3><p>Создай первый — для акций и привлечения</p></div>'}</div>
      </div>
    </div>`;

    $("#promoCreate").addEventListener("click", () => promoForm());
    $$("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
      const code = b.dataset.toggle; const on = b.textContent.trim() !== "●";
      try { await api("/api/admin/promo/" + code + "/toggle", { method: "POST", body: JSON.stringify({ active: on }) }); toast(on ? "Включён" : "Выключен", "success"); renderPromos(); } catch (e) { toast(e.message, "error"); }
    }));
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => promoForm(b.dataset.edit)));
    $$("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      const code = b.dataset.del;
      if (!confirm("Удалить промокод " + code + "?")) return;
      try { await api("/api/admin/promo/" + code, { method: "DELETE", body: JSON.stringify({}) }); toast("Удалён", "success"); renderPromos(); } catch (e) { toast(e.message, "error"); }
    }));
  }

  async function promoForm(code) {
    let existing = null;
    if (code) {
      const d = await api("/api/admin/promo?active=false");
      existing = (d.promos || []).find((p) => p.code === code);
    }
    const val = (v) => esc(v == null ? "" : v);
    openModal(existing ? "Редактировать " + esc(code) : "Новый промокод", `
      <div class="field-row" data-cols="2">
        <div class="field"><label>Код <span class="req">*</span></label><input class="input" id="pCode" value="${val(existing && existing.code)}" ${existing ? "disabled" : ""} placeholder="SUMMER30" style="text-transform:uppercase"></div>
        <div class="field"><label>На какой баланс</label><select class="select" id="pType"><option value="bonus" ${existing && existing.bonus_type === "bonus" ? "selected" : ""}>Бонусы</option><option value="credits" ${existing && existing.bonus_type === "credits" ? "selected" : ""}>Рубли (credits)</option></select></div>
      </div>
      <div class="field-row" data-cols="3">
        <div class="field"><label>Тип значения</label><select class="select" id="pValueType"><option value="fixed" ${existing && existing.value_type === "fixed" ? "selected" : ""}>Фикс. сумма</option><option value="percent" ${existing && existing.value_type === "percent" ? "selected" : ""}>Процент</option></select></div>
        <div class="field"><label>Значение</label><input class="input" id="pBonus" type="number" step="0.01" min="0.01" value="${val(existing && existing.bonus)}"></div>
        <div class="field"><label>Лимит юзеров на 1 чел.</label><input class="input" id="pPerUser" type="number" min="1" value="${val(existing ? existing.per_user : 1)}"></div>
      </div>
      <div class="field-row" data-cols="3">
        <div class="field"><label>Макс. использований</label><input class="input" id="pMaxUses" type="number" min="1" value="${val(existing ? existing.max_uses : 100)}"></div>
        <div class="field"><label>Бюджет выдачи (пусто = ∞)</label><input class="input" id="pBudget" type="number" step="1" value="${val(existing && existing.budget)}" placeholder="не ограничен"></div>
        <div class="field"><label>Срок (дней от сегодня)</label><input class="input" id="pDays" type="number" min="1" value="${existing && existing.expires_at ? Math.ceil((existing.expires_at - Date.now() / 1000) / 86400) : ""}" placeholder="без срока"></div>
      </div>
      <div class="field"><label>Описание</label><input class="input" id="pDesc" value="${val(existing && existing.description)}" placeholder="для внутренних заметок"></div>
      <div class="btn-group mt"><button class="btn btn-primary btn-full" id="pSave">${existing ? "Сохранить" : "Создать"}</button></div>
    `);

    $("#pSave").addEventListener("click", async () => {
      const code = $("#pCode").value.trim().toUpperCase();
      const body = {
        code,
        bonus_type: $("#pType").value,
        value_type: $("#pValueType").value,
        bonus: parseFloat($("#pBonus").value),
        per_user: parseInt($("#pPerUser").value, 10),
        max_uses: parseInt($("#pMaxUses").value, 10),
        description: $("#pDesc").value.trim(),
      };
      const b = $("#pBudget").value; if (b !== "") body.budget = parseFloat(b);
      const days = parseInt($("#pDays").value, 10); if (days) body.expires_at = Math.floor(Date.now() / 1000) + days * 86400;
      try {
        if (existing) { await api("/api/admin/promo/" + code + "/update", { method: "POST", body: JSON.stringify(body) }); }
        else { await api("/api/admin/promo", { method: "POST", body: JSON.stringify(body) }); }
        toast("Сохранено", "success"); closeModal(); renderPromos();
      } catch (e) { toast(e.message, "error"); }
    });
  }

  /* ==========================================================================
     ИИ И РАСХОДЫ
     ========================================================================== */
  async function renderAI() {
    const d = await api("/api/admin/ai");
    const providers = (d.providers || []).map((p) => {
      const bal = p.balance != null ? `<b>${fmtN(p.balance)} ${esc(p.balance_currency || "USD")}</b> <span class="cell-sub">${p.balance_updated_at ? "· " + fmtDate(p.balance_updated_at) : ""}</span>` : `<span class="cell-sub">баланс не определяется (у многих API закрыт)</span>`;
      return `
      <div class="card" data-pid="${esc(p.id)}">
        <div class="card-header">
          <h2>${esc(p.name)} <span class="badge badge-${p.enabled ? "green" : "gray"}">${p.enabled ? "вкл" : "выкл"}</span></h2>
          <div class="btn-group">
            <button class="btn btn-ghost btn-sm" data-sync="${esc(p.id)}" ${p.kind === "gigachat" ? "disabled" : ""}>Синхр. модели</button>
            <button class="btn btn-ghost btn-sm" data-test="${esc(p.id)}">Тест</button>
            <button class="btn btn-ghost btn-sm" data-bal="${esc(p.id)}">Баланс</button>
          </div>
        </div>
        <div class="detail-panel">
          <div class="detail-row"><span class="detail-label">Тип</span><span class="detail-value mono">${esc(p.kind)}</span></div>
          <div class="detail-row"><span class="detail-label">API URL</span><span class="detail-value mono cell-sub">${esc(p.base_url)}</span></div>
          <div class="detail-row"><span class="detail-label">Ключ</span><span class="detail-value mono">${esc(p.key_masked)}</span></div>
          <div class="detail-row"><span class="detail-label">Баланс</span><span class="detail-value">${bal}</span></div>
        </div>
      </div>`;
    }).join("");

    const cfg = d.config || {};
    const models = [];
    (d.providers || []).forEach((p) => (p.models || []).forEach((m) => { if (m.enabled) models.push(m); }));
    const selOpts = (slot) => models.map((m) => `<option value="${esc(m.id)}" ${cfg[slot + "_model_id"] === m.id ? "selected" : ""}>${esc(m.label)} · ${esc(m.model)}</option>`).join("") || '<option value="">— моделей нет —</option>';

    const usageRows = (d.usage || []).map((u) => `
      <div class="table-row">
        <div class="cell"><div class="cell-main mono">${esc(u.model)}</div></div>
        <div class="cell shrink cell-num cell-sub">${fmtInt(u.tokens)} токенов</div>
        <div class="cell shrink cell-num cell-sub">${fmtInt(u.reports)} отчётов</div>
        <div class="cell shrink cell-num"><b>${fmtUsd(u.cost)}</b></div>
      </div>`).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>ИИ и расходы</h1><p>Провайдеры, ключи и расход токенов за 30 дней</p></div></div>
      <div class="grid grid-2">${providers || '<div class="card"><div class="empty"><div class="empty-icon">✦</div><h3>Нет провайдеров</h3></div></div>'}</div>
      <div class="card">
        <div class="card-header"><h2>Слоты генерации</h2><span class="card-sub">версия конфига v${esc(cfg.version)}</span></div>
        <div class="field"><label>Lite — дешёвая модель (заголовки, короткие задачи)</label><select class="select" id="cfgLite">${selOpts("lite")}</select></div>
        <div class="field"><label>Max — основная генерация отчётов</label><select class="select" id="cfgMax">${selOpts("max")}</select></div>
        <div class="field"><label>Psychologist — психологический разбор</label><select class="select" id="cfgPsycho">${selOpts("psychologist")}</select></div>
        <div class="field"><label>Причина смены моделей <span class="req">*</span></label><input class="input" id="cfgReason" placeholder="например: переводим на deepseek-v4-pro"></div>
        <button class="btn btn-primary" id="cfgSave">Сохранить конфиг</button>
      </div>
      <div class="card">
        <div class="card-header"><h2>Расходы по моделям</h2><span class="card-sub">30 дней</span></div>
        <div class="table-list">${usageRows || '<div class="empty"><div class="empty-icon">✦</div><h3>Расходов нет</h3><p>Записи появятся после генерации отчётов</p></div>'}</div>
      </div>
    </div>`;

    $$("[data-sync]").forEach((b) => b.addEventListener("click", async () => {
      b.textContent = "…";
      try { const r = await api("/api/admin/ai/providers/" + b.dataset.sync + "/sync-models", { method: "POST", body: JSON.stringify({}) }); toast("Получено моделей: " + r.received, "success"); renderAI(); }
      catch (e) { toast(e.message, "error"); b.textContent = "Синхр. модели"; }
    }));
    $$("[data-test]").forEach((b) => b.addEventListener("click", async () => {
      b.textContent = "…";
      try { const r = await api("/api/admin/ai/providers/" + b.dataset.test + "/test", { method: "POST", body: JSON.stringify({}) }); toast(`Тест OK (${r.latency_ms} мс): «${r.response}»`, "success"); }
      catch (e) { toast(e.message, "error"); } finally { b.textContent = "Тест"; }
    }));
    $$("[data-bal]").forEach((b) => b.addEventListener("click", async () => {
      b.textContent = "…";
      try { const r = await api("/api/admin/ai/providers/" + b.dataset.bal + "/balance", { method: "POST", body: JSON.stringify({}) }); toast(`Баланс: ${r.balance ?? "—"} ${r.currency || "USD"}`, "success"); }
      catch (e) { toast(e.message, "info"); } finally { b.textContent = "Баланс"; }
    }));

    $("#cfgSave").addEventListener("click", async () => {
      const reason = $("#cfgReason").value.trim();
      if (!reason) return toast("Укажи причину смены моделей", "warning");
      try {
        await api("/api/admin/ai/config", { method: "POST", body: JSON.stringify({ lite_model_id: $("#cfgLite").value, max_model_id: $("#cfgMax").value, psychologist_model_id: $("#cfgPsycho").value, reason }) });
        toast("Конфиг ИИ сохранён", "success");
      } catch (e) { toast(e.message, "error"); }
    });
  }

  /* ==========================================================================
     ФИНАНСЫ
     ========================================================================== */
  async function renderFinance() {
    const d = await api("/api/admin/finance");
    const t = d.totals || {}, a = d.period_24h || {}, b = d.period_30d || {};
    const periodCard = (label, p) => `
      <div class="card">
        <div class="card-header"><h2>${label}</h2></div>
        <div class="detail-panel">
          <div class="detail-row"><span class="detail-label">Пополнения</span><span class="detail-value text-green">+${fmtN(p.topups)} ₽</span></div>
          <div class="detail-row"><span class="detail-label">Списания</span><span class="detail-value text-red">${fmtN(p.charges)} ₽</span></div>
          <div class="detail-row"><span class="detail-label">Выдано промокодами</span><span class="detail-value text-orange">${fmtN(p.promo_given)}</span></div>
          <div class="detail-row"><span class="detail-label">Потрачено на заказы</span><span class="detail-value">${fmtN(p.order_spent)} ₽</span></div>
          <div class="detail-row"><span class="detail-label">Нетто</span><span class="detail-value ${p.net >= 0 ? "text-green" : "text-red"}">${p.net >= 0 ? "+" : ""}${fmtN(p.net)} ₽</span></div>
        </div>
      </div>`;
    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Финансы</h1><p>Балансы системы и движение средств</p></div></div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon green">₽</div><div class="stat-label">Рублёвый баланс системы</div><div class="stat-value">${fmtInt(t.credits)} <small>₽</small></div></div>
        <div class="stat-card"><div class="stat-icon orange">◈</div><div class="stat-label">Бонусный баланс</div><div class="stat-value">${fmtInt(t.bonus)}</div></div>
        <div class="stat-card"><div class="stat-icon blue">Σ</div><div class="stat-label">Суммарно</div><div class="stat-value">${fmtInt(t.combined)} <small>₽</small></div></div>
      </div>
      <div class="grid grid-2">${periodCard("За 24 часа", a)}${periodCard("За 30 дней", b)}</div>
    </div>`;
  }

  /* ==========================================================================
     АНАЛИТИКА
     ========================================================================== */
  async function renderAnalytics() {
    const d = await api("/api/admin/analytics");
    const k = d.kpis || {}, daily = d.daily || [];
    const maxOrders = Math.max(1, ...daily.map((x) => x.orders));
    const bars = daily.map((x) => {
      const h = Math.round((x.orders / maxOrders) * 100);
      const fullPct = x.orders ? Math.round((x.full / x.orders) * 100) : 0;
      return `<div class="bar" title="${fmtDay(x.day)}: ${x.orders} (${x.full} full)">
        <div class="bar-col"><div class="bar-fill" style="height:${h}%; background:${fullPct >= 50 ? "linear-gradient(180deg,var(--green),var(--green-dim))" : "linear-gradient(180deg,var(--blue),var(--blue-dim))"}"></div></div>
        <div class="bar-label">${fmtDay(x.day)}</div>
      </div>`;
    }).join("");
    const total = k.full_orders + k.basic_orders || 1;
    const fullPct = Math.round((k.full_orders / total) * 100);

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Аналитика</h1><p>Бизнес-метрики: привлечение, ценность, маржа</p></div></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><h2>Состав отчётов</h2></div>
          <div class="ring-wrap">
            ${ringSvg(fullPct, "green")}
            <div class="ring-legend">
              <div class="legend-row"><span class="legend-dot" style="background:var(--green)"></span> Full <b>${fmtInt(k.full_orders)}</b></div>
              <div class="legend-row"><span class="legend-dot" style="background:var(--blue)"></span> Basic <b>${fmtInt(k.basic_orders)}</b></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Заказы по дням</h2><span class="card-sub">30 дней</span></div>
          <div class="chart-bars">${bars || '<div class="empty"><div class="empty-icon">▦</div><h3>Нет данных</h3></div>'}</div>
        </div>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-icon blue">♙</div><div class="stat-label">Пользователей</div><div class="stat-value">${fmtInt(k.total_users)}</div><div class="stat-note">платящих: <b>${fmtInt(k.paying_users)}</b></div></div>
        <div class="stat-card"><div class="stat-icon green">LTV</div><div class="stat-label">LTV средний</div><div class="stat-value">${fmtN(k.ltv_avg)} <small>₽</small></div><div class="stat-note">всего: <b>${fmtN(k.ltv_total)} ₽</b></div></div>
        <div class="stat-card"><div class="stat-icon purple">ARPU</div><div class="stat-label">ARPU</div><div class="stat-value">${fmtN(k.arpu)} <small>₽</small></div></div>
        <div class="stat-card"><div class="stat-icon orange">CAC</div><div class="stat-label">CAC (промо)</div><div class="stat-value">${fmtN(k.cac)} <small>₽</small></div><div class="stat-note">выдано промо: <b>${fmtN(k.promo_spent)}</b></div></div>
        <div class="stat-card"><div class="stat-icon green">ROAS</div><div class="stat-label">ROAS</div><div class="stat-value">${fmtN(k.roas)}×</div><div class="stat-note">возврат на промо-вложения</div></div>
        <div class="stat-card"><div class="stat-icon blue">↻</div><div class="stat-label">Retention</div><div class="stat-value">${fmtPct(k.retention_rate)}</div><div class="stat-note">повторных клиентов</div></div>
        <div class="stat-card"><div class="stat-icon purple">Σ</div><div class="stat-label">Заказов на юзера</div><div class="stat-value">${fmtN(k.avg_orders_per_user)}</div><div class="stat-note">конверсия в full: <b>${fmtPct(k.full_conversion_pct)}</b></div></div>
        <div class="stat-card"><div class="stat-icon green">AOV</div><div class="stat-label">Средний чек (LTV/заказ)</div><div class="stat-value">${fmtN(k.aov)} <small>₽</small></div></div>
        <div class="stat-card"><div class="stat-icon purple">✦</div><div class="stat-label">ИИ за месяц</div><div class="stat-value">${fmtUsd(k.ai_cost_month)}</div><div class="stat-note">всего: <b>${fmtUsd(k.ai_cost_total)}</b></div></div>
        <div class="stat-card"><div class="stat-icon ${k.margin >= 0 ? "green" : "red"}">≈</div><div class="stat-label">Маржа (LTV−CAC−ИИ)</div><div class="stat-value ${k.margin >= 0 ? "" : "text-red"}">${fmtN(k.margin)} <small>₽</small></div></div>
      </div>
    </div>`;
  }

  /* ==========================================================================
     ТРАФИК
     ========================================================================== */
  async function renderTraffic() {
    const d = await api("/api/admin/traffic");
    const src = d.sources || [], camp = d.campaigns || [], f = d.funnel || {};
    const maxSrc = Math.max(1, ...src.map((x) => x.visits));
    const maxCamp = Math.max(1, ...camp.map((x) => x.visits));
    const sourceRows = src.map((s) => `
      <div class="table-row"><div class="cell"><div class="cell-main">${esc(s.source) || "direct"}</div><div class="cell-sub">${fmtInt(s.users)} юзеров</div></div>
      <div class="cell"><div class="progress blue"><i style="width:${Math.round((s.visits / maxSrc) * 100)}%"></i></div></div>
      <div class="cell shrink cell-num"><b>${fmtInt(s.visits)}</b></div></div>`).join("");
    const campRows = camp.map((c) => `
      <div class="table-row"><div class="cell"><div class="cell-main">${esc(c.campaign)}</div></div>
      <div class="cell"><div class="progress purple"><i style="width:${Math.round((c.visits / maxCamp) * 100)}%"></i></div></div>
      <div class="cell shrink cell-num"><b>${fmtInt(c.visits)}</b></div></div>`).join("");
    const funnel = [["Визиты", f.visits], ["Логины", f.logins], ["Заказы", f.orders], ["Оплачено", f.paid], ["Готово", f.done]];
    const maxF = Math.max(1, f.visits);
    const funnelRows = funnel.map(([name, val], i) => `<div class="table-row">
      <div class="cell"><div class="cell-main">${name}</div></div>
      <div class="cell"><div class="progress ${i === 4 ? "green" : "blue"}"><i style="width:${Math.round((val / maxF) * 100)}%"></i></div></div>
      <div class="cell shrink cell-num"><b>${fmtInt(val)}</b> <span class="cell-sub">${maxF ? Math.round((val / maxF) * 100) : 0}%</span></div></div>`).join("");

    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Трафик</h1><p>Источники, кампании и воронка за 30 дней</p></div></div>
      <div class="grid grid-2">
        <div class="card"><div class="card-header"><h2>Источники</h2></div><div class="table-list">${sourceRows || '<div class="empty"><div class="empty-icon">⌁</div><h3>Нет данных</h3></div>'}</div></div>
        <div class="card"><div class="card-header"><h2>UTM-кампании</h2></div><div class="table-list">${campRows || '<div class="empty"><div class="empty-icon">⌁</div><h3>Кампаний нет</h3></div>'}</div></div>
      </div>
      <div class="card"><div class="card-header"><h2>Воронка</h2><span class="card-sub">30 дней</span></div><div class="table-list">${funnelRows}</div></div>
    </div>`;
  }

  /* ==========================================================================
     АУДИТ
     ========================================================================== */
  async function renderAudit() {
    const d = await api("/api/admin/audit");
    const rows = (d.audit || []).slice(0, 100).map((a) => `
      <div class="table-row">
        <div class="cell shrink"><span class="badge badge-blue badge-plain">${esc(a.action)}</span></div>
        <div class="cell"><div class="cell-main">${esc(a.target_type || "—")} ${esc(a.target_id || "")}</div><div class="cell-sub">${esc(a.reason || "")}</div></div>
        <div class="cell shrink cell-num cell-sub">${fmtDate(a.created_at)}</div>
      </div>`).join("");
    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Аудит</h1><p>Журнал действий администратора</p></div></div>
      <div class="card"><div class="table-list">${rows || '<div class="empty"><div class="empty-icon">⌾</div><h3>Записей нет</h3></div>'}</div></div>
    </div>`;
  }

  /* ==========================================================================
     НАСТРОЙКИ
     ========================================================================== */
  async function renderSettings() {
    let a = { admin_user_id: 638074 };
    try { a = await api("/api/admin/access"); } catch (e) { /* ignore */ }
    const exp = SESSION && SESSION.expires_at ? fmtDate(SESSION.expires_at) : "—";
    $("#content").innerHTML = `
    <div class="page">
      <div class="page-header"><div class="page-title"><h1>Настройки</h1><p>Профиль администратора и сессия</p></div></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><h2>Администратор</h2></div>
          <div class="detail-panel">
            <div class="detail-row"><span class="detail-label">Аккаунт Lolzteam</span><span class="detail-value">#${esc(a.admin_user_id)}</span></div>
            <div class="detail-row"><span class="detail-label">Сессия до</span><span class="detail-value">${exp}</span></div>
            <div class="detail-row"><span class="detail-label">Куки</span><span class="detail-value">HttpOnly · SameSite=Strict · Secure</span></div>
          </div>
          <div class="btn-group mt"><button class="btn btn-danger" id="settingsLogout">Выйти из панели</button></div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Справка</h2></div>
          <div class="detail-panel">
            <div class="detail-row"><span class="detail-label">Обзор</span><span class="detail-value cell-sub">KPI + заказы по дням + события</span></div>
            <div class="detail-row"><span class="detail-label">ИИ и расходы</span><span class="detail-value cell-sub">провайдеры, слоты, токены</span></div>
            <div class="detail-row"><span class="detail-label">Аналитика</span><span class="detail-value cell-sub">CAC / LTV / ROAS / ARPU</span></div>
            <div class="detail-row"><span class="detail-label">Промокоды</span><span class="detail-value cell-sub">фикс/процент на рубли или бонусы</span></div>
          </div>
        </div>
      </div>
    </div>`;
    $("#settingsLogout").addEventListener("click", doLogout);
  }

  /* ---------- hash-роутинг ---------- */
  function loadHash() {
    const m = location.hash.match(/#\/(\w+)/);
    navigate(m ? m[1] : "overview", false);
  }

  /* ---------- init ---------- */
  function bindShell() {
    $$(".nav-item").forEach((n) => n.addEventListener("click", () => navigate(n.dataset.page)));
    $("#loginForm").addEventListener("submit", (e) => { e.preventDefault(); doLogin($("#adminPassword").value); });
    $("#showPass")?.addEventListener("click", () => { const i = $("#adminPassword"); i.type = i.type === "password" ? "text" : "password"; });
    $("#refreshAll").addEventListener("click", () => { toast("Обновляю…", "info"); PAGES[currentPage].render().then(() => toast("Данные обновлены", "success")).catch(() => {}); });
    $("#menuToggle").addEventListener("click", () => { $("#sidebar").classList.toggle("open"); });
    $("#logout").addEventListener("click", doLogout);
    $(".modal-bg").addEventListener("click", (e) => { if (e.target.classList.contains("modal-bg")) closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
    window.addEventListener("hashchange", loadHash);
  }

  document.addEventListener("DOMContentLoaded", () => { bindShell(); checkAccess(); });
})();
