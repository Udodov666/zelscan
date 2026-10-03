zsLoad(function(d) {
  const p     = d.portrait || {};
  const am    = d.admit_mistakes || {};
  const emp   = d.empathy || {};
  const posts = Number(d.raw_stats?.posts_fetched) || 0;

  const shortPhrase = function(s) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length <= 30 ? t : t.slice(0, 30).replace(/\s+\S*$/, '') + '…';
  };

  /* ── Уверенность: кольцо + орб ── */
  const conf      = p.confidence || {};
  const confScore = Math.round(_clamp(conf.score || 0, 0, 100));
  const certain   = Number(conf.certain || 0);
  const hedging   = Number(conf.hedging || 0);
  const cfTotal   = certain + hedging;
  const cfShare   = cfTotal ? certain / cfTotal : 0;

  const CF_STATES = [
    {k:"lost",  min:0,  max:20,  n:"растерян",    spd:9,   c:["#CBD5E1","#7C8CA6","#1E293B"], g:"rgba(148,163,184,.26)"},
    {k:"doubt", min:20, max:40,  n:"сомневается", spd:8,   c:["#BFDBFE","#5B8DEF","#1E3A8A"], g:"rgba(96,165,250,.30)"},
    {k:"think", min:40, max:55,  n:"думает",      spd:6.5, c:["#A5F3FC","#22D3EE","#0E7490"], g:"rgba(34,211,238,.30)"},
    {k:"calm",  min:55, max:70,  n:"спокоен",     spd:5.5, c:["#A7F3D0","#34D399","#065F46"], g:"rgba(52,211,153,.32)"},
    {k:"sure",  min:70, max:85,  n:"уверен",      spd:4.5, c:["#BBF7D0","#3BC96A","#14532D"], g:"rgba(34,197,94,.34)"},
    {k:"assert",min:85, max:101, n:"категоричен", spd:3.5, c:["#E4FBA6","#A3E635","#3F6212"], g:"rgba(163,230,53,.30)"}
  ];
  const cfState = CF_STATES.find(s => confScore >= s.min && confScore < s.max) || CF_STATES[CF_STATES.length - 1];

  const cfCard = _el('#confidence-card');
  if (cfCard) cfCard.style.setProperty('--accent', cfState.c[1]);
  _set('#confidence-card [data-score]', confScore);
  _set('#confidence-card [data-level]', cfState.n);
  _set('#confidence-card [data-hedging]', hedging);
  _set('#confidence-card [data-certain]', certain);
  _set('#confidence-card [data-total]', cfTotal);
  _set('#confidence-card [data-share]', Math.round(cfShare * 100) + '%');
  _set('#confidence-card [data-share-inv]', Math.round((1 - cfShare) * 100) + '%');
  (function() {
    const r = hedging / Math.max(1, certain);
    const w = _el('#confidence-card [data-why]');
    if (!w) return;
    w.textContent = r >= 1.6
      ? `Оговорок в ${r.toFixed(1).replace(/\.0$/, '')} раза больше, чем утверждений — поэтому речь звучит скорее сомневающейся.`
      : r >= 0.7
        ? 'Оговорок и утверждений примерно поровну — речь звучит сбалансированно.'
        : 'Утверждений заметно больше, чем оговорок — речь звучит твёрдо.';
  })();

  /* кольцо: два сегмента с зазором */
  (function() {
    const svg = _el('#confidence-card svg'); if (!svg) return;
    const C = 2 * Math.PI * 76, GAP = 50;
    const greenLen = Math.max(0, cfShare * C - GAP / 2);
    const greyLen  = Math.max(0, (1 - cfShare) * C - GAP / 2);
    const green = svg.querySelector('[data-ring]'), grey = svg.querySelector('[data-ring-t]');
    if (green) {
      green.style.strokeDasharray = greenLen.toFixed(1) + ' ' + (C - greenLen).toFixed(1);
      green.setAttribute('transform', 'rotate(-90 100 100)');
    }
    if (grey) {
      const greyStart = -90 + ((greenLen + GAP / 2) / C) * 360;
      grey.style.strokeDasharray = greyLen.toFixed(1) + ' ' + (C - greyLen).toFixed(1);
      grey.setAttribute('transform', 'rotate(' + greyStart.toFixed(1) + ' 100 100)');
    }
  })();

  /* орб Glass+Aura с мимикой состояния */
  (function() {
    const host = _el('#confidence-card [data-cf-orb]'); if (!host) return;
    const st = cfState;
    function eyes(state) {
      const rx = 3.5;
      switch (state) {
        case "lost":  return '<circle class="e" cx="46" cy="53" r="4.4"/><circle class="e" cx="74" cy="53" r="4.4"/>';
        case "doubt": return '<rect class="e" x="42.5" y="44" width="7" height="19" rx="' + rx + '"/><rect class="e" x="70.5" y="44" width="7" height="19" rx="' + rx + '"/>';
        case "think": return '<rect class="e" x="42.5" y="45" width="7" height="18" rx="' + rx + '"/><rect class="e" x="70.5" y="45" width="7" height="18" rx="' + rx + '"/>';
        case "calm":  return '<rect class="e" x="42.5" y="45" width="7" height="18" rx="' + rx + '"/><rect class="e" x="70.5" y="45" width="7" height="18" rx="' + rx + '"/>';
        case "sure":  return '<path class="m" d="M39 55 Q46.5 44.5 54 55"/><path class="m" d="M66 55 Q73.5 44.5 81 55"/>';
        default:      return '<rect class="e" x="38" y="49" width="17" height="6.6" rx="3.3" transform="rotate(-7 46.5 52.3)"/><rect class="e" x="65" y="49" width="17" height="6.6" rx="3.3" transform="rotate(7 73.5 52.3)"/>';
      }
    }
    function mouth(state) {
      switch (state) {
        case "lost":  return '<path class="m" d="M43 77 q5.5 -6.5 11 0 t11 0"/>';
        case "doubt": return '<path class="m" d="M45 81 Q60 71 75 81"/>';
        case "think": return '<path class="m" d="M47 81 L73 76.5"/>';
        case "calm":  return '<path class="m" d="M46 75 Q60 83.5 74 75"/>';
        case "sure":  return '<path class="m" d="M41 72 Q60 90 79 72"/>';
        default:      return '<path class="m" d="M44 79 Q61 86 79 71.5"/>';
      }
    }
    host.className = 'cforb';
    host.style.setProperty('--spd', st.spd + 's');
    host.style.setProperty('--c1', st.c[0]);
    host.style.setProperty('--c2', st.c[1]);
    host.style.setProperty('--c3', st.c[2]);
    host.style.setProperty('--glow', st.g);
    host.innerHTML = '<span class="cforb__glow"></span><span class="cforb__aura"></span><span class="cforb__aura2"></span>' +
      '<span class="cforb__core"></span><span class="cforb__glass"><span class="cforb__sheen"></span></span>' +
      '<svg class="cforb__face cff--' + st.k + '" viewBox="0 0 120 120" aria-hidden="true"><g stroke-width="3.2"><g class="fe">' +
      eyes(st.k) + '</g><g class="fm">' + mouth(st.k) + '</g></g></svg>';
  })();

  /* ── Психологический возраст: 1:1 из psych-age-test.html (частицы + дуга style D) ── */
  (function() {
    const card = _el('#age-card');
    if (!card) return;
    const pa = p.psychological_age || {};
    const rawAge = Number(pa.score ?? pa.age ?? pa.value);
    const available = pa.available !== false && Number.isFinite(rawAge);

    // Старые сохранённые отчёты не содержат psychological_age. Не скрываем
    // из-за этого всю вторую колонку: показываем нейтральное состояние карточки.
    const MIN = 14, MAX = 60;
    const age = available ? Math.round(_clamp(rawAge, MIN, MAX)) : null;
    const verdict = available
      ? String(pa.verdict || (age < 19 ? 'юный стиль общения' : age < 26 ? 'молодой стиль общения' : age < 40 ? 'зрелый стиль общения' : 'умудрённый стиль общения'))
      : 'данные появятся после обновления анализа';
    card.classList.toggle('is-pending', !available);

    // подзаголовок + пилюля-факт (как в макете)
    _set('#age-card [data-age-sub]', 'Насколько зрело он ведёт себя в общении');
    const pill = card.querySelector('[data-age-pill]');
    if (pill) {
      const ic = pill.querySelector('.fa-solid');
      if (ic) ic.className = 'fa-solid fa-comment-dots';
      const vt = pill.querySelector('[data-age-verdict]');
      if (vt) vt.textContent = verdict;
    }

    /* ── движок частиц (число) ── */
    const FIELDS = [];
    class ParticleShape {
      constructor(canvas, drawFn, o = {}) {
        this.cv = canvas; this.ctx = canvas.getContext('2d');
        this.drawFn = drawFn; this.o = o; this.parts = []; this.born = false;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.resize(); FIELDS.push(this);
      }
      resize() {
        const r = this.cv.getBoundingClientRect();
        // Округляем CSS-размеры и backing-store так, чтобы соотношение сторон
        // канваса точно совпадало с трансформацией в frame() (dpr по X и Y).
        // Иначе на адаптивных брейкпоинтах (планшет/ноут) меняется высота через
        // clamp(), ratio плывёт и текст-частицы выглядят «наклонёнными».
        this.w = Math.max(10, Math.round(r.width));
        this.h = Math.max(10, Math.round(r.height));
        this.cv.width = Math.round(this.w * this.dpr);
        this.cv.height = Math.round(this.h * this.dpr);
      }
      retarget() {
        this.resize();
        const off = document.createElement('canvas');
        off.width = this.w; off.height = this.h;
        const oc = off.getContext('2d');
        this.drawFn(oc, this.w, this.h);
        const img = oc.getImageData(0, 0, this.w, this.h).data;
        const step = this.o.step || 4, pts = [];
        for (let y = 0; y < this.h; y += step)
          for (let x = 0; x < this.w; x += step) {
            const i = (y * this.w + x) * 4;
            if (img[i + 3] > 120) pts.push({ x: x + (Math.random() - .5) * 1.5, y: y + (Math.random() - .5) * 1.5,
              r: img[i], g: img[i + 1], b: img[i + 2] });
          }
        const P = this.parts;
        while (P.length < pts.length)
          P.push({ x: Math.random() * this.w, y: this.h * .5 + (Math.random() - .5) * this.h * 1.6,
            vx: 0, vy: 0, a: 0, ph: Math.random() * Math.PI * 2, sp: .5 + Math.random() * .8 });
        for (let k = 0; k < P.length; k++) {
          const pt = P[k];
          if (k < pts.length) {
            pt.tx = pts[k].x; pt.ty = pts[k].y;
            pt.tr = pts[k].r; pt.tg = pts[k].g; pt.tb = pts[k].b; pt.gone = false;
          } else { pt.gone = true; pt.ty = -40; pt.tx = pt.x; }
        }
        if (!this.born) {
          for (const pt of P) { pt.x = Math.random() * this.w; pt.y = Math.random() * this.h; }
          this.born = true;
        }
      }
      scatter(x, y) {
        const cx = Number.isFinite(x) ? x : this.w * .5;
        const cy = Number.isFinite(y) ? y : this.h * .5;
        this.scattered = true;
        for (const pt of this.parts) {
          const dx = pt.x - cx, dy = pt.y - cy;
          const len = Math.hypot(dx, dy) || 1;
          const dist = 12 + Math.random() * 20;
          pt.tx0 = pt.tx; pt.ty0 = pt.ty;
          pt.tx = pt.x + dx / len * dist + (Math.random() - .5) * 16;
          pt.ty = pt.y + dy / len * dist + (Math.random() - .5) * 12;
          pt.vx += dx / len * (0.6 + Math.random() * 0.9);
          pt.vy += dy / len * (0.6 + Math.random() * 0.9);
        }
      }
      gather() {
        if (!this.scattered) return;
        this.scattered = false;
        for (const pt of this.parts) {
          if (Number.isFinite(pt.tx0)) { pt.tx = pt.tx0; pt.ty = pt.ty0; }
        }
      }
      frame(t) {
        const c = this.ctx, d = this.dpr, wob = this.o.wobble ?? 0.7;
        c.setTransform(d, 0, 0, d, 0, 0);
        c.clearRect(0, 0, this.w, this.h);
        const rad = this.o.radius || 1.5;
        for (const pt of this.parts) {
          const k = pt.gone ? 0.02 : 0.085;
          pt.vx = (pt.vx + (pt.tx - pt.x) * k) * 0.72;
          pt.vy = (pt.vy + (pt.ty - pt.y) * k) * 0.72;
          pt.x += pt.vx; pt.y += pt.vy;
          const dist = Math.hypot(pt.tx - pt.x, pt.ty - pt.y);
          const targetA = pt.gone ? 0 : Math.max(0, Math.min(1, 1.15 - dist / 90));
          pt.a += (targetA - pt.a) * 0.08;
          if (pt.a < 0.02) continue;
          const fx = Math.sin(t * 0.0011 * pt.sp + pt.ph) * wob;
          const fy = Math.cos(t * 0.0009 * pt.sp + pt.ph) * wob;
          c.globalAlpha = pt.a;
          c.fillStyle = 'rgb(' + (pt.tr | 0) + ',' + (pt.tg | 0) + ',' + (pt.tb | 0) + ')';
          c.beginPath(); c.arc(pt.x + fx, pt.y + fy, rad, 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1;
      }
    }
    function gradNumPainter(text, fontPx, stops, cx = .5, cy = .52) {
      return (c, w, h) => {
        const px = Math.min(fontPx, w * 0.52);
        const g = c.createLinearGradient(w * cx - 150, h * cy - 70, w * cx + 150, h * cy + 70);
        for (const [off, col] of stops) g.addColorStop(off, col);
        c.fillStyle = g;
        c.font = '500 ' + px + 'px Inter, sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(text, w * cx, h * cy);
      };
    }

    /* ── большая дуга (style D — минимал) ── */
    class BigArc {
      constructor(canvas) {
        this.cv = canvas; this.ctx = canvas.getContext('2d');
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
      }
      draw(psych) {
        const cv = this.cv, c = this.ctx, dpr = this.dpr;
        const r = cv.getBoundingClientRect();
        const w = Math.max(10, r.width), h = Math.max(10, r.height);
        cv.width = w * dpr; cv.height = h * dpr;
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);

        const R = w * 0.62, cx = w / 2, cy = R + 40;
        const thMax = Math.asin(Math.min(0.98, (w / 2 + 26) / R));
        const thMin = -thMax;
        const WIN_SPAN = 0.68;
        const thOf = f => (thMin + f * (thMax - thMin)) * WIN_SPAN;
        const pt = th => ({ x: cx + R * Math.sin(th), y: cy - R * Math.cos(th) });

        const WSIZE = 5;
        const lo = Math.max(MIN, Math.min(Math.round(psych) - 2, MAX - WSIZE + 1));
        const hi = lo + WSIZE - 1;
        const toF = y => (y - lo) / (WSIZE - 1);
        const f = toF(psych);
        const SUB = 7;

        for (let y = lo; y <= hi; y++) {
          const tt = toF(y);
          const th = thOf(tt);
          const dx = Math.sin(th), dy = -Math.cos(th);
          const hot = tt <= f + 0.001;
          let col, lw = 2.2, len = 14;
          if (hot) { col = 'rgba(87,239,169,0.95)'; }
          else { col = 'rgba(255,255,255,0.16)'; }
          c.save();
          c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
          c.beginPath();
          c.moveTo(cx + dx * (R - 1), cy + dy * (R - 1));
          c.lineTo(cx + dx * (R + len), cy + dy * (R + len));
          c.stroke();
          c.restore();
          if (hot) {
            const hk = Math.min(1, f <= 0.001 ? 0 : tt / Math.max(0.001, f));
            const c1 = [87, 239, 169], c2 = [214, 255, 242];
            c.fillStyle = 'rgba(' + (c1[0] + (c2[0] - c1[0]) * hk | 0) + ',' + (c1[1] + (c2[1] - c1[1]) * hk | 0) + ',' +
              (c1[2] + (c2[2] - c1[2]) * hk | 0) + ',0.95)';
          } else {
            c.fillStyle = 'rgba(255,255,255,0.55)';
            c.strokeStyle = 'rgba(255,255,255,0.38)';
            c.beginPath();
            c.moveTo(cx + dx * (R - 1), cy + dy * (R - 1));
            c.lineTo(cx + dx * (R + 14), cy + dy * (R + 14));
            c.stroke();
          }
          c.font = (y === Math.round(psych) ? '600 12px Inter' : '500 10px Inter');
          c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(String(y), cx + dx * (R + 24), cy + dy * (R + 24));
        }

        for (let y = lo; y < hi; y++) {
          for (let s = 1; s < SUB; s++) {
            const tt = toF(y) + s / (SUB * (WSIZE - 1));
            const th = thOf(tt);
            const dx = Math.sin(th), dy = -Math.cos(th);
            const edge = Math.min(tt, 1 - tt) / 0.10;
            const fade = Math.max(0, Math.min(1, edge));
            const hot = tt <= f + 0.001;
            let col;
            if (hot) { col = 'rgba(87,239,169,' + (0.95 * fade).toFixed(3) + ')'; }
            else { col = 'rgba(255,255,255,' + (0.16 * fade).toFixed(3) + ')'; }
            c.strokeStyle = col; c.lineWidth = 1.1; c.lineCap = 'round';
            c.beginPath();
            c.moveTo(cx + dx * (R - 1), cy + dy * (R - 1));
            c.lineTo(cx + dx * (R + 5), cy + dy * (R + 5));
            c.stroke();
          }
        }

        const tailTick = th => {
          const dx = Math.sin(th), dy = -Math.cos(th);
          c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1.1; c.lineCap = 'round';
          c.beginPath();
          c.moveTo(cx + dx * (R - 1), cy + dy * (R - 1));
          c.lineTo(cx + dx * (R + 5), cy + dy * (R + 5));
          c.stroke();
        };
        const tailStep = (thOf(1) - thOf(0)) / ((WSIZE - 1) * SUB);
        for (let th = thOf(0) - tailStep; th > thMin * 0.999; th -= tailStep) tailTick(th);
        for (let th = thOf(1) + tailStep; th < thMax * 0.999; th += tailStep) tailTick(th);

        // заполненная линия (минимал)
        c.beginPath();
        c.arc(cx, cy, R, thOf(0) - Math.PI / 2, thOf(f) - Math.PI / 2, thOf(f) < thOf(0));
        c.strokeStyle = '#57EFA9'; c.lineWidth = 3; c.lineCap = 'round';
        c.stroke();

        // ползунок (минимал: плоская точка с белым центром)
        const pos = pt(thOf(f));
        c.fillStyle = '#57EFA9';
        c.beginPath(); c.arc(pos.x, pos.y, 6.5, 0, 6.2832); c.fill();
        c.fillStyle = '#FFFFFF';
        c.beginPath(); c.arc(pos.x, pos.y, 2.5, 0, 6.2832); c.fill();
      }
    }

    const numCv = card.querySelector('[data-age-num-canvas]');
    const arcCv = card.querySelector('[data-age-arc]');
    if (!numCv || !arcCv) return;
    if (!available) {
      numCv.hidden = true;
      arcCv.hidden = true;
      return;
    }

    let field, arc;
    function build() {
      field = new ParticleShape(numCv,
        (c, w, h) => gradNumPainter(String(age), 120,
          [[0, '#00E08F'], [0.55, '#7CF0C4'], [1, '#F2FFF9']])(c, w, h),
        { step: 4, radius: 1.8, wobble: 1.0 });
      arc = new BigArc(arcCv);
    }
    function retargetAll() { for (const fl of FIELDS) fl.retarget(); if (arc) arc.draw(age); }
    function loop(t) { for (const fl of FIELDS) fl.frame(t); requestAnimationFrame(loop); }

    numCv.addEventListener('pointerenter', e => {
      if (!field || field.scattered || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const r = numCv.getBoundingClientRect();
      field.scatter(e.clientX - r.left, e.clientY - r.top);
    });
    numCv.addEventListener('pointerleave', () => {
      if (field) field.gather();
    });

    const start = () => {
      build(); retargetAll();
      requestAnimationFrame(loop);
      setTimeout(retargetAll, 400);
      setTimeout(retargetAll, 1200);
    };
    if (document.fonts && document.fonts.load) {
      document.fonts.load('500 120px Inter').finally(start);
    } else { start(); }
    window.addEventListener('resize', () => { clearTimeout(window.__ageRz); window.__ageRz = setTimeout(retargetAll, 150); });

    // Отслеживаем реальное изменение размеров канваса (адаптивные брейкпоинты
    // меняют высоту через clamp() без window-resize, напр. при повороте/зуме
    // или reflow контейнера) — перекладываем частицы под новый box, чтобы цифра
    // не «наклонялась».
    if (window.ResizeObserver) {
      let rzRaf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(rzRaf);
        rzRaf = requestAnimationFrame(retargetAll);
      });
      ro.observe(numCv);
    }
  })();

  /* ── Признание ошибок: весы ── */
  (function() {
    const card = _el('#admit-card'); if (!card) return;
    const left  = Number(am.count || 0);
    // Правая чаша — не «все посты», а сообщения, где тема правоты/ошибки/
    // спора вообще поднималась (context_posts). Иначе получаем ложные
    // «700 раз не признал вину» на постах про раздачи и оффтопик.
    const ctx = Number(am.context_posts);
    const total = (Number.isFinite(ctx) && ctx > 0)
      ? ctx
      : (Number(am.total_posts) || posts);
    const right = Math.max(0, total - left);
    const pivotX = 200, pivotY = 98, L = 118, maxDeg = 15;
    const theta = total > 0 ? ((right - left) / total) * maxDeg * Math.PI / 180 : 0;
    const lx = pivotX - L * Math.cos(theta), ly = pivotY - L * Math.sin(theta);
    const rx = pivotX + L * Math.cos(theta), ry = pivotY + L * Math.sin(theta);
    const set = (sel, attrs) => { const el = card.querySelector(sel); if (!el) return; for (const k in attrs) el.setAttribute(k, attrs[k]); };
    set('[data-beam]',  {x1: lx.toFixed(1), y1: ly.toFixed(1), x2: rx.toFixed(1), y2: ry.toFixed(1)});
    set('[data-rope-l]',{x1: lx.toFixed(1), y1: ly.toFixed(1), x2: lx.toFixed(1), y2: (ly + 28).toFixed(1)});
    set('[data-rope-r]',{x1: rx.toFixed(1), y1: ry.toFixed(1), x2: rx.toFixed(1), y2: (ry + 28).toFixed(1)});
    set('[data-pan-l]', {cx: lx.toFixed(1), cy: (ly + 56).toFixed(1)});
    set('[data-pan-r]', {cx: rx.toFixed(1), cy: (ry + 56).toFixed(1)});
    set('[data-txt-l]', {x: lx.toFixed(1), y: (ly + 56).toFixed(1)});
    set('[data-txt-r]', {x: rx.toFixed(1), y: (ry + 56).toFixed(1)});
    const tl = card.querySelector('[data-txt-l]'), tr = card.querySelector('[data-txt-r]');
    if (tl) tl.textContent = left;
    if (tr) tr.textContent = right;
    let note = card.querySelector('.adm__note');
    if (!note && card.querySelector('.adm__legend')) {
      note = document.createElement('div');
      note.className = 'adm__note';
      card.querySelector('.adm__legend').after(note);
    }
    if (note) {
      const hasCtx = Number.isFinite(ctx);
      note.textContent = (hasCtx && ctx > 0)
        ? 'из ' + ctx.toLocaleString('ru') + ' сообщений, где тема ошибки или спора поднималась'
        : (hasCtx ? 'тема ошибки/спора в собранных постах не поднималась'
                  : 'для этого отчёта нет разбивки по спорным сообщениям');
    }
  })();

  /* ── Эмпатия ── */
  (function() {
    const empCount = Number(emp.count || 0);
    // Знаменатель — сообщения, где кто-то делится проблемой или просит
    // помощи (context_posts), а не все посты: большинство сообщений к
    // чужим проблемам отношения не имеют.
    const empCtx = Number(emp.context_posts);
    const hasCtx = Number.isFinite(empCtx);
    const empTotal = (hasCtx && empCtx > 0)
      ? empCtx
      : (Number(emp.total_posts) || posts);
    const svg = _el('#emp-svg');
    if (svg) {
      const R2 = 56, C = 2 * Math.PI * R2, gap = 30;
      const empV = empCount > 0 ? Math.min(100, Math.round(empCount / empTotal * 100)) : 0;
      const greenLen = Math.max(4, C * empV / 100 - gap / 2);
      const greyLen = C - greenLen - gap;
      const greyRotate = -90 + 360 * (greenLen + gap / 2) / C;
      svg.innerHTML = '<circle cx="70" cy="70" r="' + R2 + '" fill="none" stroke="#2a2a2a" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + greyLen.toFixed(1) + ' ' + (C - greyLen).toFixed(1) + '" transform="rotate(' + greyRotate.toFixed(1) + ' 70 70)"/><circle cx="70" cy="70" r="' + R2 + '" fill="none" stroke="#34D399" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + greenLen.toFixed(1) + ' ' + (C - greenLen).toFixed(1) + '" transform="rotate(-90 70 70)"/>';
    }
    _set('.emp-side .n', empCount);
    const l = _el('.emp-side .l');
    if (l) {
      l.innerHTML = (hasCtx && empCtx > 0)
        ? 'из ' + empCtx.toLocaleString('ru') + ' сообщений<br>с чужими проблемами'
        : (hasCtx ? 'чужих проблем/просьб<br>в постах не было' : 'из ' + empTotal + ' постов<br>с поддержкой');
    }
    const chipsEl = _el('.emp-side .chips');
    if (chipsEl) {
      const ex = (emp.examples || []).slice(0, 3).map(x => shortPhrase(x));
      chipsEl.innerHTML = ex.length ? ex.map(x => '<span class="hc g">' + _esc(x) + '</span>').join('') : '';
    }
  })();

  /* ── Эго: точечное кольцо ── */
  (function() {
    const card = _el('#ego-card'); if (!card) return;
    const ego  = p.ego || {};
    const hits = Number(ego.hits || 0);
    const per100 = Number(ego.per_100 || 0);
    const pct = _clamp(Math.round(per100 / 4 * 100), 3, 96);
    const tone = pct >= 50 ? '#EF4444' : pct >= 25 ? '#F59E0B' : '#34D399';
    const tag  = pct >= 50 ? 'Раздутое эго' : pct >= 25 ? 'Заметное эго' : 'Сдержанное эго';
    const svg = card.querySelector('[data-ego-dots]');
    if (svg) {
      const N = 24, on = Math.round(pct / 100 * N), Rr = 56, cx = 70, cy = 70;
      let h = '';
      for (let i = 0; i < N; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / N);
        const x = (cx + Math.cos(a) * Rr).toFixed(1), y = (cy + Math.sin(a) * Rr).toFixed(1);
        h += '<circle cx="' + x + '" cy="' + y + '" r="4.2" fill="' + (i < on ? tone : '#262626') + '"/>';
      }
      svg.innerHTML = h;
    }
    const n = card.querySelector('[data-ego-pct]'); if (n) n.textContent = pct + '%';
    const t = card.querySelector('[data-ego-tag]'); if (t) { t.textContent = tag; t.style.color = tone; }
    const ec = card.querySelector('[data-ego-count]'); if (ec) ec.textContent = hits;
    const note = card.querySelector('[data-ego-note]'); if (note) note.textContent = ego.verdict || '';
  })();

  /* ── Конфликтность: график с ховером ── */
  (function() {
    const card = _el('#conflict-card'); if (!card) return;
    const cs = p.conflict || {};
    const score = Number(cs.score || 0);
    const cTone = score >= 7 ? '#EF4444' : score >= 5 ? '#F59E0B' : '#34D399';
    const big = card.querySelector('.psy-hero .big');
    if (big) { big.innerHTML = score + '<span style="font-size:24px;color:#6B6B6B">/10</span>'; big.style.color = cTone; }
    const lbl = card.querySelector('.lbl');
    if (lbl) lbl.textContent = cs.verdict || '';
    const v = card.querySelector('[data-conflict-v]');
    if (v) v.textContent = 'Средняя токсичность ' + (cs.avg_tox != null ? cs.avg_tox : 0) + ', но разовые всплески до ' + (cs.max_tox != null ? cs.max_tox : 0) + '.';

    const wrap = _el('#conf-chart'); if (!wrap) return;
    const W = 490, H = 64, PAD = 6;
    const N = 36;
    const base  = score / 10 * 0.55 + 0.08;
    const peak  = Math.min(1, score / 10 * 0.9 + 0.15);
    const spikeAt = Math.floor(N * 0.72);
    const pts = [];
    for (let i = 0; i < N; i++) {
      let vv = base + (Math.random() - 0.5) * 0.06;
      if (i === spikeAt) vv = peak;
      if (i === spikeAt + 1 || i === spikeAt - 1) vv = Math.min(1, base + peak * 0.25);
      pts.push(_clamp(vv, 0.03, 1));
    }
    const stepX = (W - PAD * 2) / (N - 1);
    const X = i => PAD + i * stepX, Y = v => H - PAD - v * (H - PAD * 2);
    let d = 'M' + X(0).toFixed(1) + ',' + Y(pts[0]).toFixed(1);
    for (let i = 1; i < N; i++) d += ' L' + X(i).toFixed(1) + ',' + Y(pts[i]).toFixed(1);
    const sid = 'conf-grad';
    let h = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    h += '<defs><linearGradient id="' + sid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + cTone + '" stop-opacity=".22"/><stop offset="1" stop-color="' + cTone + '" stop-opacity="0"/></linearGradient></defs>';
    h += '<path d="' + d + ' L' + X(N - 1).toFixed(1) + ',' + H + ' L' + X(0).toFixed(1) + ',' + H + ' Z" fill="url(#' + sid + ')"/>';
    h += '<path d="' + d + '" fill="none" stroke="' + cTone + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    h += '<line data-c-line x1="0" y1="0" x2="0" y2="' + H + '" stroke="' + cTone + '" stroke-opacity=".35" stroke-width="1" opacity="0"/>';
    h += '<circle data-c-dot r="4.5" fill="' + cTone + '" stroke="#0a0a0a" stroke-width="2" opacity="0"/>';
    h += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/>';
    h += '</svg>';
    wrap.insertAdjacentHTML('afterbegin', h);
    const svg = wrap.querySelector('svg'), tip = wrap.querySelector('[data-conf-tip]');
    const dot = svg ? svg.querySelector('[data-c-dot]') : null, line = svg ? svg.querySelector('[data-c-line]') : null;
    if (svg && dot && line && tip) {
      svg.addEventListener('mousemove', function(e) {
        const r = svg.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width * W;
        let i = Math.round((px - PAD) / stepX); i = _clamp(i, 0, N - 1);
        const cx = X(i), cy = Y(pts[i]);
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('opacity', '1');
        line.setAttribute('x1', cx); line.setAttribute('x2', cx); line.setAttribute('opacity', '1');
        const sc = (pts[i] * 10).toFixed(1);
        tip.innerHTML = 'пик <b>' + sc + '/10</b>';
        tip.style.left = (cx / W * 100) + '%';
        tip.style.top = (cy / H * 100) + '%';
        tip.style.opacity = '1';
      });
      svg.addEventListener('mouseleave', function() {
        dot.setAttribute('opacity', '0'); line.setAttribute('opacity', '0'); tip.style.opacity = '0';
      });
    }
  })();
});
