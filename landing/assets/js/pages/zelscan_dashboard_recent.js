/* ────────────────────────────────────────────────────────────────────────────
   Дашборд v2: анимированный фон (blinking squares) + лента «Недавние досье».
   Источник дизайна: утверждённое превью continuous-rail-v10.
   ──────────────────────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  /* ═══════════════ 1. Анимированный фон ═══════════════ */
  function initSquares() {
    const canvas = document.getElementById('dashSquares');
    const container = canvas && canvas.parentElement;
    if (!canvas || !container) return;

    const GRID_SIZE = 133;
    const FILL_PERCENT = 16;
    const SQUARE_COLOR = [50, 185, 127];
    const TWINKLE_SPEED = 16;
    const OPACITY = 1;

    let raf = 0, width = 0, height = 0, cells = [], cellsKey = '';
    let started = performance.now();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    function ensureCells(cols, rows) {
      const key = cols + 'x' + rows;
      if (cellsKey === key && cells.length === cols * rows) return;
      const next = new Array(cols * rows);
      for (let i = 0; i < next.length; i++) {
        const a = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
        const b = Math.sin(i * 7.137 + 33.71) * 12345.6789;
        next[i] = { phase: (a - Math.floor(a)) * Math.PI * 2, rate: 0.6 + (b - Math.floor(b)) * 0.8 };
      }
      cells = next;
      cellsKey = key;
    }

    function resize() {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellsKey = '';
    }

    function draw(now) {
      const ctx = canvas.getContext('2d');
      if (!ctx || width <= 0 || height <= 0) return;
      const cellSize = Math.max(width, height) / Math.max(2, Math.floor(GRID_SIZE));
      const cols = Math.max(1, Math.ceil(width / cellSize));
      const rows = Math.max(1, Math.ceil(height / cellSize));
      ensureCells(cols, rows);
      ctx.clearRect(0, 0, width, height);

      const t = (now - started) / 1000;
      const speed = TWINKLE_SPEED * 0.05;
      const fill = Math.max(0.1, Math.min(1, FILL_PERCENT / 100));
      const inset = (1 - fill) * 0.5;

      for (let y = 0; y < rows; y++) {
        // Верх остаётся ярким, ниже квадратики затухают рано.
        const u = y / Math.max(1, rows - 1);
        const envelope = Math.pow(1 - Math.min(1, u / 0.55), 1.8);
        if (envelope <= 0.002) continue;
        for (let x = 0; x < cols; x++) {
          const cell = cells[y * cols + x];
          if (!cell) continue;
          const osc = 0.5 + 0.5 * Math.sin(t * speed * cell.rate * Math.PI * 2 + cell.phase);
          const alpha = envelope * osc * OPACITY;
          if (alpha <= 0.002) continue;
          const side = cellSize * fill;
          ctx.fillStyle = 'rgba(' + SQUARE_COLOR[0] + ',' + SQUARE_COLOR[1] + ',' + SQUARE_COLOR[2] + ',' + alpha.toFixed(3) + ')';
          ctx.fillRect(x * cellSize + cellSize * inset, y * cellSize + cellSize * inset, side, side);
        }
      }
    }

    function loop(now) { draw(now); raf = requestAnimationFrame(loop); }

    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(container);
    else window.addEventListener('resize', resize);
    resize();
    started = performance.now();

    if (reduced.matches) draw(started + 650);
    else raf = requestAnimationFrame(loop);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced.matches) { started = performance.now(); raf = requestAnimationFrame(loop); }
    });
  }

  /* ═══════════════ 2. Лента «Недавние досье» ═══════════════ */
  function initRail() {
    const root = document.getElementById('rcRecent');
    const stage = root && root.querySelector('.rc-stage');
    if (!root || !stage) return;

    const seg = Array.prototype.slice.call(root.querySelectorAll('.rc-seg button'));
    const shell = document.createElement('div');
    shell.className = 'rc-stage-shell';
    stage.parentNode.insertBefore(shell, stage);
    shell.appendChild(stage);

    const API = window.zsAccountApi || '';
    const authHeaders = () => (typeof window.zsAuthHeaders === 'function' ? window.zsAuthHeaders() : {});
    const LIMIT = 11;
    const AV = ['av1', 'av2', 'av3', 'av4', 'av5'];
    const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    const CHEV = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';
const BORDER = '<svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible"><rect x="0" y="0" width="100%" height="100%" rx="19" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1" stroke-dasharray="8 6" stroke-linecap="round"><animate attributeName="stroke-dashoffset" from="0" to="-14" dur=".8s" repeatCount="indefinite"/></rect></svg>';

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function fmtDate(ts) {
      if (!ts) return '—';
      const d = new Date(ts * 1000);
      if (isNaN(d)) return '—';
      const now = new Date();
      const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const sameDay = d.toDateString() === now.toDateString();
      const yesterday = new Date(now.getTime() - 864e5).toDateString() === d.toDateString();
      if (sameDay) return 'Сегодня, ' + time;
      if (yesterday) return 'Вчера, ' + time;
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', ' + time;
    }

    function fmtViews(n) {
      const v = Number(n) || 0;
      return v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',').replace(',0', '') + 'K' : String(v);
    }

    function cardEl(order, index, mode) {
      const name = order.username || ('ID ' + order.user_id);
      const href = mode === 'all'
        ? '/report?public=' + encodeURIComponent(order.display_id || '')
        : '/report?order=' + encodeURIComponent(order.order_id || '');
      const letter = esc((String(name)[0] || '?').toUpperCase());
      const avatar = order.avatar
        ? '<img src="' + esc(order.avatar) + '" alt="" onerror="this.remove()">'
        : '<span>' + letter + '</span>';
      const blur = order.avatar
        ? '<img class="rc-blur" src="' + esc(order.avatar) + '" alt="" aria-hidden="true" onerror="this.remove()">'
        : '';
      const report = order.report || {};
      const isFull = order.report_type === 'full';
      const topics = report.topics != null ? report.topics : 0;
      const messages = report.messages != null ? report.messages : (order.message_count || 0);
      const wall = report.wall != null ? report.wall : 0;
      const a = document.createElement('a');
      a.className = 'rc-card';
      a.href = href;
      a.innerHTML = blur +
        '<div class="rc-top">' +
          '<div class="rc-person">' +
            '<div class="rc-av ' + AV[index % AV.length] + '">' + avatar + '</div>' +
            '<div class="rc-copy"><div class="rc-name">' + esc(name) + '</div>' +
              '<div class="rc-meta"><span class="rc-date">' + esc(fmtDate(order.finished_at || order.created_at)) + '</span>' +
              '<span class="rc-views">' + EYE + '<span>' + esc(fmtViews(order.view_count)) + '</span></span></div>' +
            '</div>' +
          '</div>' +
          '<span class="rc-plan' + (isFull ? ' rc-plan--full' : '') + '">' + (isFull ? 'Полный AI' : 'Базовый') + '</span>' +
        '</div>' +
        '<div class="rc-stats">' +
          '<div class="rc-stat"><strong>' + esc(String(topics)) + '</strong><span>Темы</span></div>' +
          '<div class="rc-stat"><strong>' + esc(String(messages)) + '</strong><span>Сообщений</span></div>' +
          '<div class="rc-stat"><strong>' + esc(String(wall)) + '</strong><span>Стена</span></div>' +
        '</div>';
      return a;
    }

    function ctaEl(mode, count) {
      const a = document.createElement('a');
      a.className = 'rc-card rc-more';
      if (mode === 'all') {
        a.href = '/explore';
        a.innerHTML = BORDER + '<span>Смотреть все досье</span>' + CHEV;
      } else {
        a.href = 'javascript:void(0)';
        a.innerHTML = BORDER + '<span>' + (count ? 'Создать ещё' : 'Создать первое досье') + '</span>' + CHEV;
        a.addEventListener('click', e => {
          e.preventDefault();
          if (typeof window.focusSearch === 'function') window.focusSearch();
        });
      }
      return a;
    }

    /* ── состояние ── */
    let mode = 'all';
    const tracks = {};
    const data = { all: null, mine: null };
    const fetched = { all: false, mine: false };
    let dragging = false, moved = false, startX = 0, startScroll = 0, lastX = 0, lastT = 0;
    let velocity = 0, hovered = false, manualPause = false, resumeTimer = 0, inertia = 0;
    let autoReady = false, autoTimer = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function ensureTrack(m) {
      if (tracks[m]) return tracks[m];
      const t = document.createElement('div');
      t.className = 'rc-track';
      t.dataset.mode = m;
      tracks[m] = t;
      stage.appendChild(t);
      return t;
    }

    function renderTrack(m) {
      const track = ensureTrack(m);
      track.innerHTML = '';
      const items = data[m];
      if (items === null) {
        const msg = document.createElement('div');
        msg.className = 'rc-stage-msg';
        msg.textContent = 'Загружаем досье…';
        track.appendChild(msg);
      } else {
        items.slice(0, LIMIT).forEach((o, i) => track.appendChild(cardEl(o, i, m)));
        track.appendChild(ctaEl(m, items.length));
      }
      track.classList.toggle('active', m === mode);
      sizeCards();
    }

    function sizeCards() {
      const w = window.innerWidth <= 760
        ? Math.min(300, stage.clientWidth * 0.88)
        : (stage.clientWidth - 24) / 3;
      stage.style.setProperty('--rc-card-width', Math.max(220, w) + 'px');
      updateEdges();
    }

    function updateEdges() {
      const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
      shell.classList.toggle('can-left', stage.scrollLeft > 5);
      shell.classList.toggle('can-right', stage.scrollLeft < max - 5);
    }

    function pauseFor(ms) {
      manualPause = true;
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => { manualPause = false; }, ms || 1700);
    }
    function resumeNow() { manualPause = false; clearTimeout(resumeTimer); }

    function autoStep() {
      const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
      if (autoReady && !reduced && !hovered && !dragging && !manualPause && max > 2 && stage.scrollLeft < max - 0.5) {
        stage.scrollLeft = Math.min(max, stage.scrollLeft + 2);
      }
      updateEdges();
    }
    function startAuto() { if (!autoTimer) autoTimer = setInterval(autoStep, 50); }

    function setMode(next) {
      mode = next;
      cancelAnimationFrame(inertia);
      dragging = false;
      stage.classList.remove('dragging');
      Object.keys(tracks).forEach(m => tracks[m].classList.toggle('active', m === mode));
      seg.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      stage.scrollTo({ left: 0, behavior: reduced ? 'auto' : 'smooth' });
      resumeNow();
      pauseFor(700);
      requestAnimationFrame(sizeCards);
      if (autoReady) startAuto();
      if (!fetched[mode]) load(mode);
    }

    seg.forEach(b => { b.onclick = () => setMode(b.dataset.mode); });

    /* ── перетаскивание мышью / тачем ── */
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      cancelAnimationFrame(inertia);
      dragging = true; moved = false;
      startX = lastX = e.clientX;
      startScroll = stage.scrollLeft;
      lastT = performance.now();
      velocity = 0;
      stage.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      pauseFor(2200);
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging) return;
      const now = performance.now(), dx = e.clientX - startX;
      stage.scrollLeft = startScroll - dx;
      const dt = Math.max(1, now - lastT);
      velocity = (lastX - e.clientX) / dt;
      lastX = e.clientX; lastT = now;
      if (Math.abs(dx) > 5) moved = true;
      if (e.cancelable) e.preventDefault();
      updateEdges();
    });
    function release(e) {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove('dragging');
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      let v = velocity;
      const glide = () => {
        if (Math.abs(v) < 0.02) return;
        const max = Math.max(0, stage.scrollWidth - stage.clientWidth);
        stage.scrollLeft = Math.max(0, Math.min(max, stage.scrollLeft + v * 16));
        v *= 0.92;
        updateEdges();
        if (stage.scrollLeft > 0 && stage.scrollLeft < max) inertia = requestAnimationFrame(glide);
      };
      if (!reduced) inertia = requestAnimationFrame(glide);
      pauseFor(1900);
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('click', e => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
    }, true);
    stage.addEventListener('wheel', () => pauseFor(1800), { passive: true });
    stage.addEventListener('scroll', updateEdges, { passive: true });
    root.addEventListener('mouseenter', () => { hovered = true; });
    root.addEventListener('mouseleave', () => { hovered = false; pauseFor(900); });
    window.addEventListener('resize', sizeCards);

    /* ── данные ── */
    async function load(which) {
      try {
        if (which === 'all') {
          const r = await fetch(API + '/api/public/dossiers?limit=' + LIMIT + '&sort=new');
          const j = r.ok ? await r.json() : {};
          data.all = j.dossiers || [];
        } else {
          const r = await fetch(API + '/api/my/orders?limit=' + LIMIT + '&status=done', { headers: authHeaders(), credentials: 'same-origin' });
          const j = r.ok ? await r.json() : {};
          data.mine = j.orders || [];
        }
      } catch (err) {
        data[which] = data[which] || [];
      }
      fetched[which] = true;
      renderTrack(which);
    }

    /* Позволяет странице отдать уже загруженные заказы пользователя. */
    window.ZSRecentRail = {
      setMine(orders) {
        data.mine = Array.isArray(orders) ? orders.filter(o => o.status === 'done') : [];
        if (data.mine.length) fetched.mine = true;
        renderTrack('mine');
      },
      reload() { data.all = null; data.mine = null; fetched.all = false; fetched.mine = false; renderTrack('all'); load('all'); }
    };

    ensureTrack('all');
    ensureTrack('mine');
    renderTrack('all');
    renderTrack('mine');
    setMode('all');
    load('all');
    setTimeout(() => { autoReady = true; resumeNow(); startAuto(); }, 1000);
  }

  function boot() { initSquares(); initRail(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
