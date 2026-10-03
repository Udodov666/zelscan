zsLoad(function(d, order) {
  const c = d.card;
  const p = d.portrait || {};
  const ai = d.ai_analysis;
  const emotion = p.emotion || {};
  const empathy = d.empathy && typeof d.empathy === 'object' ? d.empathy : null;

  /* ── HERO ── */
  const heroAva = _el('.hero-ava');
  if (heroAva) {
    if (c.avatar) {
      heroAva.innerHTML = `<img src="${_esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    } else {
      heroAva.textContent = (c.username[0]||'?').toUpperCase();
    }
  }

  const heroTags = _el('.hero-tags');
  if (heroTags) {
    const archetypes = (ai?.psychologist?.parsed?.personality_types) || p.archetypes || [];
    const banned = d.safety?.in_blacklist;
    const clsArr = ['y','r','b'];
    heroTags.innerHTML =
      archetypes.slice(0,3).map((t,i)=>`<span class="tag ${clsArr[i]||''}">${_esc(t)}</span>`).join('') +
      (banned ? '<span class="tag r">Заблокирован</span>' : '<span class="tag">Чист</span>');
  }

  _set('.hero-name', c.username);
  const heroMeta = _el('.hero-meta');
  _html('.hero-meta', c.tenure ? `<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>${_esc(c.tenure)}` : '');
  if (zsIsProductionReport()) zsRenderViewCount(heroMeta, order.view_count);
  const vsum = typeof d.verdict==='string' ? d.verdict : (d.verdict?.summary||'');
  _set('.hero-desc p', vsum);

  /* ── TILES ── */
  const conflict  = p.conflict?.score ?? 0;
  const toxicPct  = emotion.toxic_pct ?? 0;
  const neutralPct= emotion.neutral_pct ?? 0;
  const empathyCount = empathy && Number.isFinite(Number(empathy.count)) ? Math.max(0, Number(empathy.count)) : null;
  const empathyTotal = empathy && Number.isFinite(Number(empathy.total_posts)) ? Math.max(0, Number(empathy.total_posts)) : null;
  const empathyRatio = empathy && Number.isFinite(Number(empathy.ratio)) ? _clamp(Number(empathy.ratio), 0, 100) : null;
  const empathyAvailable = empathyCount !== null || empathyRatio !== null || Boolean(empathy?.verdict);
  // Единая шкала с остальными страницами: число явных сигналов → оценка 0–10.
  const empathyScore = empathyCount === null ? null : empathyCount === 0 ? 0 : empathyCount <= 2 ? 3 : empathyCount <= 5 ? 6 : empathyCount <= 10 ? 8 : 10;
  const empathyPct = empathyScore !== null ? empathyScore * 10 : (empathyRatio !== null ? empathyRatio : 0);
  const empathyValue = empathyAvailable ? (empathyScore !== null ? empathyScore + '/10' : Math.round(empathyPct) + '%') : '—';
  const empathyEvidence = Array.isArray(empathy?.examples) ? empathy.examples.filter(Boolean).slice(0, 2) : [];
  const empathyBullets = empathyAvailable
    ? [empathy.verdict || '', ...empathyEvidence, empathyCount !== null && empathyTotal !== null ? `${empathyCount} явных сигналов поддержки в ${empathyTotal} сообщениях` : '']
    : ['Данные об эмпатии недоступны'];

  const tileData = [
    { val: conflict+'/10', bullets: [p.conflict?.verdict||'', `${d.raw_stats?.posts_fetched||0} сообщений`] },
    { val: toxicPct+'%',   bullets: [emotion.verdict||'', `Токсичных: ${toxicPct} из 100`] },
    { val: neutralPct+'%', bullets: [`Позитивных: ${Math.round(emotion.positive_pct||0)}%`, emotion.verdict||''] },
    { val: empathyValue,   bullets: empathyBullets },
  ];

  const tilePcts=[_clamp(conflict*10,0,100),_clamp(toxicPct,0,100),_clamp(neutralPct,0,100),_clamp(empathyPct,0,100)];
  const tileColors=[conflict>=7?'#EF4444':conflict>=4?'#F59E0B':'#34D399','#EF4444','#3B82F6','#AA57FA'];
  _els('.tiles .tile').slice(0,4).forEach((tile,i)=>{
    tile.style.setProperty('--tile-value',tilePcts[i]+'%'); tile.style.setProperty('--tile-color',tileColors[i]);
    tile.querySelectorAll('.tile-val,.tile-ghost .val').forEach(el=>el.textContent=tileData[i].val);
    tile.querySelectorAll('.tile-track i,.track i').forEach(el=>{el.style.setProperty('--tile-value',tilePcts[i]+'%');el.style.setProperty('--tile-color',tileColors[i]);el.setAttribute('role','progressbar');el.setAttribute('aria-valuenow',String(tilePcts[i]));el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax','100');});
  });
  _els('.tile-ghost .lab').forEach((el,i) => {}); // keep labels
  _els('.tile-body').forEach((body,i) => {
    if(!tileData[i]) return;
    body.innerHTML=`<div class="tile-why">Откуда цифра</div><div class="tile-rows">${
      tileData[i].bullets.filter(Boolean).map(b=>`<div class="tile-row"><span class="tile-dot" style="background:#888"></span><span>${_esc(b)}</span></div>`).join('')
    }</div>`;
  });

  /* ── BIG FIVE ── */
  const bf = ai?.psychologist?.parsed?.big_five;
  const poly = _el('.b5-chart polygon[fill="#FFFFFF"]');
  const b5vals = _els('.b5row b');
  const b5circ = _els('.b5-chart circle');
  const b5axes = _els('.b5-chart line');
  const b5labs = _els('.b5-chart text');
  const b5rows = _els('.b5row');
  if (bf) {
    const vals10 = [bf.openness, bf.conscientiousness, bf.extraversion, bf.agreeableness, bf.neuroticism].map(v=>v||0);
    // Обновляем data-полигон (он единственный с fill="#FFFFFF")
    if (poly) poly.setAttribute('points', b5Points(vals10));
    // Маркеры значений на осях — те же вершины, что у полигона
    const pts = b5Points(vals10).split(' ').map(pr=>pr.split(',').map(Number));
    b5circ.forEach((c,i) => {
      if (pts[i]) {
        c.setAttribute('cx', pts[i][0]);
        c.setAttribute('cy', pts[i][1]);
        c.setAttribute('stroke', '#020202');
        c.setAttribute('stroke-width', '1.5');
      }
    });
    // Значения в списке — из big_five, нормированные на сумму 100
    const total10 = vals10.reduce((s,v)=>s+v,0);
    let disp;
    if (total10 <= 0) {
      disp = vals10.map(()=>0);
    } else {
      const pct = vals10.map(v=>v/total10*100);
      const floors = pct.map(Math.floor);
      let rem = 100 - floors.reduce((s,v)=>s+v,0);
      const frac = pct.map((v,i)=>({i, f:v-Math.floor(v)}));
      frac.sort((a,b)=>b.f-a.f);
      for (let k=0;k<rem;k++) floors[frac[k].i]++;
      disp = floors;
    }
    b5vals.forEach((el,i)=>{ el.textContent = disp[i]; });

    // Ховер: активная грань подсвечивается, остальные приглушаются
    const svgEl = poly ? poly.ownerSVGElement : null;
    if (svgEl && b5circ.length) {
      b5circ.forEach(c=>{ c.style.transition='opacity .18s ease'; });
      b5axes.forEach(a=>{ a.style.transition='opacity .18s ease, stroke .18s ease'; });
      b5labs.forEach(l=>{ l.style.transition='opacity .18s ease'; });

      // Обводка полигона → 5 отдельных рёбер (каждое можно приглушать отдельно)
      if (poly) poly.setAttribute('stroke','none');
      const edges = [];
      for (let k=0;k<5;k++){
        const p1=pts[k], p2=pts[(k+1)%5];
        const e=document.createElementNS('http://www.w3.org/2000/svg','line');
        e.setAttribute('x1',p1[0]); e.setAttribute('y1',p1[1]);
        e.setAttribute('x2',p2[0]); e.setAttribute('y2',p2[1]);
        e.setAttribute('stroke','#FFFFFF'); e.setAttribute('stroke-width','2.3'); e.setAttribute('stroke-linecap','round');
        e.style.transition='stroke .18s ease';
        svgEl.appendChild(e); edges.push(e);
      }

      const zones = [];
      pts.forEach(pt => {
        const z = document.createElementNS('http://www.w3.org/2000/svg','line');
        z.setAttribute('x1',235); z.setAttribute('y1',192);
        z.setAttribute('x2',pt[0]); z.setAttribute('y2',pt[1]);
        z.setAttribute('stroke','transparent'); z.setAttribute('stroke-width','16');
        svgEl.appendChild(z); zones.push(z);
      });

      const reset = () => {
        b5circ.forEach(c=>{ c.style.opacity=''; c.setAttribute('r',4.4); });
        b5axes.forEach(a=>{ a.style.opacity=''; a.style.stroke=''; });
        b5labs.forEach(l=>{ l.style.opacity=''; });
        edges.forEach(e=>{ e.style.stroke=''; });
        b5rows.forEach(r=>r.classList.remove('active','dim'));
      };
      const active = (i) => {
        b5rows.forEach((r,j)=>{ r.classList.toggle('active', j===i); r.classList.toggle('dim', j!==i); });
        b5circ.forEach((c,j)=>{ c.style.opacity = j===i ? '1' : '0.1'; });
        if (b5circ[i]) b5circ[i].setAttribute('r', 5.8);
        b5axes.forEach((a,j)=>{ a.style.stroke = j===i ? '#EBEBEB' : '#4A4A4A'; });
        b5labs.forEach((l,j)=>{ l.style.opacity = j===i ? '1' : '0.25'; });
        edges.forEach((e,j)=>{ e.style.stroke = (j===i || j===(i+4)%5) ? '#FFFFFF' : '#565656'; });
      };
      zones.forEach((z,i)=> z.addEventListener('mouseenter',()=>active(i)));
      b5circ.forEach((c,i)=> c.addEventListener('mouseenter',()=>active(i)));
      b5labs.forEach((l,i)=> l.addEventListener('mouseenter',()=>active(i)));
      svgEl.addEventListener('mouseleave', reset);
    }
  } else {
    // Нет данных big_five — не показываем статичные фейковые значения
    b5vals.forEach(el => { el.textContent='—'; });
    if (poly) poly.style.opacity='0';
    b5circ.forEach(c => { c.style.opacity='0'; });
    var b5badge=_el('.badge'); if(b5badge) b5badge.style.display='none';
  }

  /* ── DARK TRIAD ── */
  var dt = ai?.psychologist?.parsed?.dark_triad;
  if (dt) {
    var _p=dt.psychopathy||0, _m=dt.machiavellianism||0, _n=dt.narcissism||0;
    var dtVals=[_p,_m,_n];
    var dtColors=['#EF4444','#F59E0B','#34D399'];
    _els('.tri-h .v').forEach((el,i) => { el.textContent=dtVals[i]+'/10'; });
    _els('.tri-tk .f').forEach((el,i) => {
      el.style.width=(dtVals[i]/10*100)+'%';
      el.style.background=`linear-gradient(90deg,${dtColors[i]} 73%,#FFFFFF 100%)`;
    });
    var fanWrap=_el('.fan-wrap');
    if(fanWrap){ fanWrap.innerHTML=''; fanWrap.appendChild(fanSVG(_p,_m,_n)); }
    var flags=dt.red_flags||[];
    var warns=_el('.warns');
    if(warns&&flags.length) warns.innerHTML=flags.slice(0,3).map(f=>`<span>⚠ ${_esc(f)}</span>`).join('');
  } else {
    // фолбэк: нет данных dark_triad — не показываем статичные фейковые значения
    _els('.tri-h .v').forEach(el => { el.textContent='—'; });
    _els('.tri-tk .f').forEach(el => { el.style.width='0%'; });
    var fanWrap2=_el('.fan-wrap'); if(fanWrap2){ fanWrap2.style.display='none'; }
    var warns2=_el('.warns'); if(warns2){ warns2.style.display='none'; }
  }

  /* ── ORBIT ── */
  const orbitWrap = _el('.orbit-wrap');
  if (orbitWrap) {
    const posters = (d.activity?.wall_posters || []).slice(0,5);
    if (posters.length) {
      orbitWrap.innerHTML = orbitSVG(posters, c.username);
      _pullOrbitAvatars(orbitWrap, posters);
      // ховер: выбранный подсвечен, остальные приглушены + метрика под ником
      const nodes = Array.from(orbitWrap.querySelectorAll('.orbit-node'));
      nodes.forEach(n => {
        n.addEventListener('mouseenter', () => {
          nodes.forEach(o => o.style.opacity = (o === n) ? '1' : '0.3');
          const info = n.querySelector('.orbit-info');
          if (info) info.style.opacity = '1';
        });
        n.addEventListener('mouseleave', () => {
          nodes.forEach(o => o.style.opacity = '1');
          const info = n.querySelector('.orbit-info');
          if (info) info.style.opacity = '0';
        });
      });
    }
  }

  /* ── MOSAIC ── */
  const mosWrap = _el('.mos-wrap');
  if (mosWrap) {
    mosWrap.innerHTML = mosaicSVG(emotion);
    _bindMosaicTip(mosWrap);
  }

  const toxN=emotion.toxic_pct??0, posN=emotion.positive_pct??0;
  _html('.legendrow', `
    <span class="lg"><i style="background:#242424"></i>нейтрал ${100-toxN-posN}%</span>
    <span class="lg"><i style="background:#EF4444"></i>токсик ${toxN}%</span>
    <span class="lg"><i style="background:#34D399"></i>позитив ${posN}%</span>`);

  /* ── STATUS MATRIX ── */
  const statusMat = _el('#statusMat');
  const statusLanes = _el('#statusLanes');
  if (statusMat && statusLanes) {
    renderStatusMatrix(statusMat, statusLanes, d);
  }
});

// ── Круг общения: подтягиваем реальные аватарки ─────────────
function _bindMosaicTip(wrap) {
  const tip = document.createElement('div');
  tip.className = 'mos-tip';
  wrap.appendChild(tip);
  const TEXTS = { t:['токсичный','#EF4444'], p:['позитивный','#34D399'], n:['нейтральный','#242424'] };
  wrap.addEventListener('mousemove', e => {
    const r = e.target && e.target.classList && e.target.classList.contains('mos-cell') ? e.target : null;
    if (!r) { tip.classList.remove('show'); return; }
    const t = TEXTS[r.getAttribute('data-t')] || TEXTS.n;
    tip.innerHTML = `<i style="background:${t[1]}"></i><span>${t[0]}</span>`;
    const rect = wrap.getBoundingClientRect();
    tip.style.left = (e.clientX - rect.left + 14) + 'px';
    tip.style.top  = (e.clientY - rect.top - 10) + 'px';
    tip.classList.add('show');
  });
  wrap.addEventListener('mouseleave', () => tip.classList.remove('show'));
}

function _applyOrbitAvatar(svg, idx, avatar) {
  if (!svg) return;
  const g = svg.querySelector('.orbit-node[data-idx="'+idx+'"]');
  if (!g) return;
  const circle = g.querySelector('circle');
  const letter = g.querySelector('.orbit-letter');
  if (!circle || !letter) return;
  const r  = parseFloat(circle.getAttribute('r'));
  const cx = parseFloat(circle.getAttribute('cx'));
  const cy = parseFloat(circle.getAttribute('cy'));
  const ar = r - 2, cid = 'orbitClip' + idx, NS = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector('defs');
  if (!defs) { defs = svg.ownerDocument.createElementNS(NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
  if (!defs.querySelector('#' + cid)) {
    const cp = svg.ownerDocument.createElementNS(NS, 'clipPath');
    cp.setAttribute('id', cid);
    const cc = svg.ownerDocument.createElementNS(NS, 'circle');
    cc.setAttribute('cx', cx); cc.setAttribute('cy', cy); cc.setAttribute('r', ar);
    cp.appendChild(cc); defs.appendChild(cp);
  }
  const img = svg.ownerDocument.createElementNS(NS, 'image');
  img.setAttribute('href', avatar);
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', avatar);
  img.setAttribute('x', cx - ar); img.setAttribute('y', cy - ar);
  img.setAttribute('width', 2 * ar); img.setAttribute('height', 2 * ar);
  img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  img.setAttribute('clip-path', 'url(#' + cid + ')');
  g.replaceChild(img, letter);
}

async function _pullOrbitAvatars(wrap, posters) {
  const missing = posters.map((p, i) => ({ p, i })).filter(x => x.p && x.p.name && !x.p.avatar);
  if (!missing.length) return;
  const svg = wrap.querySelector('svg');
  const need = [];
  missing.forEach(x => {
    let cached = null;
    try { cached = sessionStorage.getItem('zs_orbit_av_' + x.p.name); } catch (e) {}
    if (cached) { _applyOrbitAvatar(svg, x.i, cached); }
    else need.push(x.p.name);
  });
  if (!need.length) return;
  try {
    const base = window.ZS_API || '';
    const t = localStorage.getItem('lzt_token') || '';
    const r = await fetch(base + '/api/avatars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
      credentials: 'same-origin',
      body: JSON.stringify({ names: need })
    });
    if (!r.ok) return;
    const j = await r.json();
    const map = j.avatars || {};
    Object.keys(map).forEach(n => {
      if (!map[n]) return;
      try { sessionStorage.setItem('zs_orbit_av_' + n, map[n]); } catch (e) {}
    });
    missing.forEach(x => { if (map[x.p.name]) _applyOrbitAvatar(svg, x.i, map[x.p.name]); });
  } catch (e) {}
}

/* ── Матрица «Отношение по статусу» ───────────────────────── */
function _statusRoleValue(d, role) {
  const rel = d?.ai_analysis?.relations?.by_status
    || d?.ai_analysis?.status_relation
    || d?.ai_analysis?.psychologist?.parsed?.status_relation;
  if (rel && typeof rel[role] === 'number') return rel[role];
  return null; // данных нет — не рисуем фейковые значения
}

function _attWord(v) {
  if (v <= 20) return { w: 'по-доброму', c: '#34D399' };
  if (v <= 40) return { w: 'иронизирует', c: '#F59E0B' };
  if (v <= 60) return { w: 'игнорит', c: '#7C8694' };
  if (v <= 80) return { w: 'терпит', c: '#6B7C93' };
  return { w: 'троллит', c: '#EF4444' };
}

function renderStatusMatrix(mat, lanes, d) {
  const ROLES = [
    { id: 'peer',   name: 'равный тебе',    y: 45 },
    { id: 'newbie', name: 'новичок',        y: 72 },
    { id: 'mod',    name: 'модератор / власть', y: 18 },
    { id: 'weak',   name: 'слабее него',    y: 85 }
  ];
  const vals = ROLES.map(r => _statusRoleValue(d, r.id));

  mat.querySelectorAll('.mNode').forEach(n => n.remove());

  if (vals.some(v => typeof v !== 'number')) {
    lanes.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'lane';
    empty.innerHTML = '<span class="laneName" style="opacity:.45">недостаточно данных для оценки</span>';
    lanes.appendChild(empty);
    return;
  }

  const A = vals.map(_attWord);
  const nodes = [];
  ROLES.forEach((r, i) => {
    const nd = document.createElement('div');
    nd.className = 'mNode';
    nd.style.left = (8 + vals[i] * 0.84) + '%';
    nd.style.top = r.y + '%';
    nd.innerHTML = `<span class="bub"></span><span class="nm">${r.name}</span><span class="wd"></span>`;
    nd.querySelector('.bub').style.background = A[i].c;
    nd.querySelector('.wd').textContent = A[i].w;
    nd.querySelector('.wd').style.color = A[i].c;
    mat.appendChild(nd);
    nodes.push(nd);
  });

  lanes.innerHTML = '';
  ROLES.forEach((r, i) => {
    const dEl = document.createElement('div');
    dEl.className = 'lane';
    dEl.innerHTML = `<span class="laneName">${r.name}</span>
      <span class="laneTrk"><span class="laneDot"></span></span>
      <span class="laneWord"></span>`;
    dEl.querySelector('.laneDot').style.left = vals[i] + '%';
    dEl.querySelector('.laneDot').style.background = A[i].c;
    const wd = dEl.querySelector('.laneWord');
    wd.textContent = A[i].w;
    wd.style.color = A[i].c;
    lanes.appendChild(dEl);
  });

  _spreadNodes(mat, nodes);
}

function _spreadNodes(mat, nodes) {
  const mw = mat.clientWidth, mh = mat.clientHeight;
  if (!mw || !mh) return;
  const rects = nodes.map(nd => {
    const l = nd.offsetLeft, t = nd.offsetTop, w = nd.offsetWidth, h = nd.offsetHeight;
    return { nd, mid: t, top: t - h / 2, bot: t + h / 2, left: l - w / 2, right: l + w / 2 };
  });
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a], B = rects[b];
        const ox = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        if (ox <= 0) continue;
        const oy = Math.min(A.bot, B.bot) - Math.max(A.top, B.top);
        if (oy <= 0) continue;
        const push = (oy + 8) / 2;
        if (A.mid < B.mid) {
          A.mid -= push; A.top -= push; A.bot -= push;
          B.mid += push; B.top += push; B.bot += push;
        } else {
          B.mid -= push; B.top -= push; B.bot -= push;
          A.mid += push; A.top += push; A.bot += push;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  rects.forEach(r => {
    const pct = Math.max(5, Math.min(95, r.mid / mh * 100));
    r.nd.style.top = pct + '%';
  });
}
