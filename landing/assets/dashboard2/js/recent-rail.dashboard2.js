/* Dashboard2 only: canvas background + the single reachable dr3 recent rail. */
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

  
  function boot(){ initSquares(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();


/* Тест: «Недавние досье» — мини-карточки, рельс с прокруткой (drag/тач/колесо) */
(function(){
  'use strict';
  var root = document.getElementById('rcRecent');
  if (!root) return;
  var rail = root.querySelector('.dr3-rail');
  var track = root.querySelector('.dr3-track');
  var seg = Array.prototype.slice.call(root.querySelectorAll('.dr3-seg button'));
  var API = window.ZSDashboard2.apiBase;
  var SAFE = ['color','background','background-image','background-color','background-clip','-webkit-background-clip','-webkit-text-fill-color','text-shadow'];
  function safeNicknameStyle(prop, value){
    var v = String(value || '').trim();
    if (!v || /url\s*\(|expression\s*\(|@import|javascript\s*:|behavior\s*:|-moz-binding|var\s*\(/i.test(v)) return false;
    if (prop === 'background' || prop === 'background-image') return /^(?:linear-gradient|radial-gradient)\s*\(/i.test(v);
    if (prop === 'background-clip' || prop === '-webkit-background-clip') return /^text$/i.test(v);
    if (prop === '-webkit-text-fill-color') return /^transparent$/i.test(v) || safeNicknameStyle('color', v);
    if (prop === 'color' || prop === 'background-color') return /^(?:#[0-9a-f]{3,8}|rgba?\([^;{}]+\)|hsla?\([^;{}]+\)|[a-z]+)$/i.test(v);
    if (prop === 'text-shadow') return !/[;{}]/.test(v);
    return false;
  }
  var CHEV = '<span class="dr3-chev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></span>';
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
  var DASH = '<svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible" aria-hidden="true"><rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" rx="23" fill="none" stroke="rgba(255,255,255,.04)" stroke-width="1" stroke-dasharray="8 6" stroke-linecap="round"><animate attributeName="stroke-dashoffset" from="0" to="-14" dur=".8s" repeatCount="indefinite"/></rect></svg>';
  function fmtViews(n){ var v = Number(n) || 0; return v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',').replace(',0', '') + 'K' : String(v); }
  function fmtDate(ts){
    if (!ts) return '—';
    var d = new Date(ts * 1000); if (isNaN(d)) return '—';
    var now = new Date();
    var time = d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'});
    if (d.toDateString() === now.toDateString()) return 'Сегодня, ' + time;
    if (new Date(now.getTime() - 864e5).toDateString() === d.toDateString()) return 'Вчера, ' + time;
    return d.toLocaleDateString('ru-RU', {day:'numeric', month:'long'}) + ', ' + time;
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function cleanUsername(v){ var p = new DOMParser().parseFromString(String(v || ''), 'text/html'); return (p.body.textContent || '').trim(); }
  function applyForumNicknameStyle(el, html){
    if (!el || !html) return;
    var p = new DOMParser().parseFromString(html, 'text/html');
    var src = p.querySelector('.styleUserNickname, [style]');
    if (!src) return;
    SAFE.forEach(function(prop){
      var v = src.style.getPropertyValue(prop).trim();
      if (!safeNicknameStyle(prop, v)) return;
      el.style.setProperty(prop, v);
    });
  }
  function num(v){ return new Intl.NumberFormat('ru-RU').format(Number(v) || 0); }

  var data = { all: null, mine: null };
  var fetched = { all: false, mine: false };
  var demo = false;
  var mode = 'all';
  var LIMIT = 8;

  function reportHref(o, m){
    var key = m === 'all' ? 'public' : 'order';
    var id = m === 'all' ? o.display_id : o.order_id;
    if (!id) return '';
    // The dashboard is served by the static frontend, while report data comes
    // from the API. Keep the navigation on this frontend origin.
    var url = new URL('zelscan.html', window.location.href);
    url.searchParams.set(key, String(id));
    return url.href;
  }
  function cardEl(o, m){
    var html = String(o.username_html || '');
    var name = cleanUsername(html || o.username) || ('ID ' + o.user_id);
    var href = reportHref(o, m);
    var letter = esc((name[0] || '?').toUpperCase());
    var avatarUrl=window.ZSDashboard2.safeUrl(o.avatar);
    var av = avatarUrl ? '<img src="' + esc(avatarUrl) + '" alt="" referrerpolicy="no-referrer">' : letter;
    var blur = avatarUrl ? '<img class="dr3-blur" src="' + esc(avatarUrl) + '" alt="" aria-hidden="true" referrerpolicy="no-referrer">' : '';
    var rep = o.report || {};
    var metaLine = o.view_count != null
      ? '<div class="dr3-views">' + EYE + '<span>' + esc(fmtViews(o.view_count)) + '</span></div>'
      : '<div class="dr3-views">' + esc(fmtDate(o.finished_at || o.created_at)) + '</div>';
    var tags = (Array.isArray(rep.tags) ? rep.tags : []).map(function(t){ return String(t || '').trim(); }).filter(Boolean).slice(0, 1);
    var tagsHtml = tags.length ? '<div class="dr3-tags">' + tags.map(function(t){ return '<span class="dr3-tag">' + esc(t) + '</span>'; }).join('') + '</div>' : '';
    var full = o.report_type === 'full';
    var plan = '<span class="dr3-plan' + (full ? ' dr3-plan--full' : '') + '"><img src="assets/img/gotovo' + (full ? 2 : 1) + '.png" alt=""><span>' + (full ? 'Полный AI' : 'Базовый') + '</span></span>';
    var topics = rep.topics != null ? rep.topics : (o._demoTopics != null ? o._demoTopics : 0);
    var messages = rep.messages != null ? rep.messages : (o.message_count != null ? o.message_count : 0);
    var wall = rep.wall != null ? rep.wall : (o._demoWall != null ? o._demoWall : 0);
    var a = document.createElement('a');
    a.className = 'dr3-card';
    a.href = href;
    a.innerHTML = blur
      + '<div class="dr3-top"><div class="dr3-person">'
      + '<span class="dr3-av">' + av + '</span>'
      + '<div class="dr3-copy"><div class="dr3-name-row"><span class="dr3-name">' + esc(name) + '</span><span class="dr3-verified"><img src="assets/img/zelenka.svg" alt=""></span></div><div class="dr3-sub">' + metaLine + '</div></div>'
      + '</div>' + plan + '</div>'
      + '<div class="dr3-stats">'
      + '<div class="dr3-stat"><strong>' + num(topics) + '</strong><span>Темы</span></div>'
      + '<div class="dr3-stat"><strong>' + num(messages) + '</strong><span>Сообщений</span></div>'
      + '<div class="dr3-stat"><strong>' + num(wall) + '</strong><span>Стена</span></div>'
      + '</div>';
    applyForumNicknameStyle(a.querySelector('.dr3-name'), html);
    return a;
  }
  function ctaEl(m, count){
    var a = document.createElement(m === 'all' ? 'a' : 'button');
    a.className = 'dr3-card dr3-cta';
    if (m !== 'all') a.type = 'button';
    if (m === 'all') { a.href = 'public_dossiers.html'; a.innerHTML = DASH + '<span>Смотреть все досье</span>' + CHEV; }
    else {
      a.innerHTML = DASH + '<span>' + (count ? 'Создать ещё' : 'Создать первое досье') + '</span>' + CHEV;
      a.addEventListener('click', function(e){ e.preventDefault(); if (typeof window.focusSearch === 'function') window.focusSearch(); });
    }
    return a;
  }
  function railCards(count){
    return Array.from({ length: count || 2 }, function(){
      var card = document.createElement('div');
      card.className = 'dr3-card dr3-skeleton';
      card.setAttribute('aria-hidden', 'true');
      card.innerHTML = '<div class="dr3-top"><span class="dr3-av sk"></span><div class="dr3-copy"><div class="sk-line sk" style="width:120px"></div><div class="sk-line sk" style="width:76px;margin-top:9px"></div></div></div><div class="dr3-stats"><div class="sk-line sk"></div><div class="sk-line sk"></div><div class="sk-line sk"></div></div>';
      return card;
    });
  }
  function render(m){
    track.innerHTML = '';
    track.scrollLeft = 0;
    if (!fetched[m] || data[m] === null) { railCards(2).forEach(function(card){ track.appendChild(card); }); return; }
    var items = data[m] || [];
    if (!items.length && m === 'mine') { track.appendChild(ctaEl(m, 0)); return; }
    items.slice(0, LIMIT).forEach(function(o){ track.appendChild(cardEl(o, m)); });
    track.appendChild(ctaEl(m, items.length));
  }
  var autoOn = false, hovered = false, manualPause = false, resumeTimer = 0, autoTimer = 0, atEnd = false;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cardStep(){
    var c = track.querySelector('.dr3-card');
    return c ? c.getBoundingClientRect().width + 12 : 320;
  }
  function autoAdvance(){
    if (!autoOn || reduced || hovered || manualPause || dragging) return;
    var max = Math.max(0, track.scrollWidth - track.clientWidth);
    if (max <= 2) return;
    if (atEnd) { atEnd = false; track.scrollTo({ left: 0, behavior: 'smooth' }); return; }
    var target = (Math.round(track.scrollLeft / cardStep()) + 1) * cardStep();
    if (target >= max - 2) atEnd = true;
    track.scrollTo({ left: Math.min(target, max), behavior: 'smooth' });
  }
  function startAuto(){ if (!autoTimer) autoTimer = setInterval(autoAdvance, 4500); }
  function pauseFor(ms){ manualPause = true; clearTimeout(resumeTimer); resumeTimer = setTimeout(function(){ manualPause = false; }, ms || 1700); }
  function setMode(next){
    mode = next;
    seg.forEach(function(b){ var on=b.dataset.mode === mode; b.classList.toggle('active',on); b.setAttribute('aria-selected',String(on)); });
    render(mode);
    if (!fetched[mode]) load(mode);
  }
  var loadSeq = { all: 0, mine: 0 };
  function load(m){
    var seq = ++loadSeq[m];
    fetched[m] = false;
    data[m] = null;
    if (mode === m) render(m);
    if (m === 'all') {
      window.ZSDashboard2.apiFetch('/api/public/dossiers?limit=' + LIMIT + '&sort=new').then(function(r){ return r.ok ? r.json() : {}; }).then(function(j){
        if (seq !== loadSeq.all) return;
        data.all = j.dossiers || [];
        fetched.all = true;
        demo = false;
      }).catch(function(){ if (seq === loadSeq.all) { data.all = []; fetched.all = true; demo = false; } }).then(function(){ if (seq === loadSeq.all && mode === 'all') render('all'); });
    } else {
      var H = (typeof window.zsAuthHeaders === 'function') ? window.zsAuthHeaders() : {};
      window.ZSDashboard2.apiFetch('/api/my/orders?limit=' + LIMIT + '&status=done', { headers: H }).then(function(r){ return r.ok ? r.json() : {}; }).then(function(j){
        if (seq !== loadSeq.mine) return;
        data.mine = j.orders || [];
        fetched.mine = true;
        if (mode === 'mine') render('mine');
      }).catch(function(){ if (seq === loadSeq.mine) { data.mine = []; fetched.mine = true; if (mode === 'mine') render('mine'); } });
    }
  }

  /* Drag only after a deliberate horizontal movement: pointer capture on pointerdown retargets a normal card click to the track. */
  var dragging = false, moved = false, captured = false, startX = 0, startY = 0, startScroll = 0, lastX = 0, lastT = 0, velocity = 0, inertia = 0;
  var DRAG_THRESHOLD = 8;
  track.addEventListener('dragstart', function(e){ e.preventDefault(); });
  track.addEventListener('pointerdown', function(e){
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancelAnimationFrame(inertia);
    dragging = true; moved = false; captured = false;
    startX = lastX = e.clientX; startY = e.clientY; startScroll = track.scrollLeft; lastT = performance.now(); velocity = 0;
    pauseFor(2200);
  });
  track.addEventListener('pointermove', function(e){
    if (!dragging) return;
    var now = performance.now(), dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      moved = true;
      track.classList.add('dragging');
      try { track.setPointerCapture(e.pointerId); captured = true; } catch (err) {}
    }
    track.scrollLeft = startScroll - dx;
    var dt = Math.max(1, now - lastT);
    velocity = (lastX - e.clientX) / dt;
    lastX = e.clientX; lastT = now;
    if (e.cancelable) e.preventDefault();
  });
  function release(e){
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    if (captured) try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!moved) return;
    var v = velocity;
    var glide = function(){
      if (Math.abs(v) < 0.02) return;
      var max = Math.max(0, track.scrollWidth - track.clientWidth);
      track.scrollLeft = Math.max(0, Math.min(max, track.scrollLeft + v * 16)); 
      v *= 0.92;
      updateEdges();
      if (track.scrollLeft > 0 && track.scrollLeft < max) inertia = requestAnimationFrame(glide);
    };
    inertia = requestAnimationFrame(glide);
  }
  pauseFor(1900);
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('click', function(e){ if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  track.addEventListener('wheel', function(){ pauseFor(1800); }, { passive: true });
  root.addEventListener('mouseenter', function(){ hovered = true; });
  root.addEventListener('mouseleave', function(){ hovered = false; pauseFor(900); });

  seg.forEach(function(b){ b.onclick = function(){ setMode(b.dataset.mode); }; });
  setTimeout(function(){ autoOn = true; startAuto(); }, 1200);
  function cleanup(){
    clearInterval(autoTimer);
    clearTimeout(resumeTimer);
    cancelAnimationFrame(inertia);
    loadSeq.all++;
    loadSeq.mine++;
  }
  window.addEventListener('pagehide', cleanup, { once: true });
  window.ZSRecentRail = {
    setMine: function(orders){ data.mine = (orders || []).filter(function(o){ return o.status === 'done'; }); fetched.mine = true; if (mode === 'mine') render('mine'); },
    reload: function(){ data.all = null; data.mine = null; fetched.all = false; fetched.mine = false; demo = false; load('all'); load('mine'); },
    cleanup: cleanup
  };
  render('all');
  load('all');
})();

