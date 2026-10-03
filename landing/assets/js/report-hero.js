/* report-hero.js — SINGLE SOURCE OF TRUTH for filling the report hero block.
   Loaded on every report tab (overview, activity, behavior, psychology,
   analysis) so the hero (avatar, tags, name, tenure, views, description and
   the 4 metric tiles incl. "Эмпатия") is populated identically everywhere.
   Relies on helpers from zs-loader-menu-clean.js (_el/_els/_set/_html/_esc/
   _clamp/_pct/zsIsProductionReport/zsRenderViewCount/zsLoad), which is loaded
   before this file. Every hero element access is a safe no-op when absent. */
zsLoad(function (d, order) {
  const c = d.card || {};
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
      heroAva.textContent = ((c.username || '?')[0] || '?').toUpperCase();
    }
  }

  const heroTags = _el('.hero-tags');
  if (heroTags) {
    const archetypes = (ai?.psychologist?.parsed?.personality_types) || p.archetypes || [];
    const banned = d.safety?.in_blacklist;
    const clsArr = ['y', 'r', 'b'];
    heroTags.innerHTML =
      archetypes.slice(0, 3).map((t, i) => `<span class="tag ${clsArr[i] || ''}">${_esc(t)}</span>`).join('') +
      (banned ? '<span class="tag r">Заблокирован</span>' : '<span class="tag">Чист</span>');
  }

  _set('.hero-name', c.username);
  const heroMeta = _el('.hero-meta');
  _html('.hero-meta', c.tenure ? `<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>${_esc(c.tenure)}` : '');
  if (typeof zsRenderViewCount === 'function' && (typeof zsIsProductionReport !== 'function' || zsIsProductionReport())) {
    zsRenderViewCount(heroMeta, order.view_count);
  }
  const vsum = typeof d.verdict === 'string' ? d.verdict : (d.verdict?.summary || '');
  _set('.hero-desc p', vsum);

  /* ── TILES ── */
  const conflict = p.conflict?.score ?? 0;
  const toxicPct = emotion.toxic_pct ?? 0;
  const neutralPct = emotion.neutral_pct ?? 0;
  const empathyCount = empathy && Number.isFinite(Number(empathy.count)) ? Math.max(0, Number(empathy.count)) : null;
  const empathyTotal = empathy && Number.isFinite(Number(empathy.total_posts)) ? Math.max(0, Number(empathy.total_posts)) : null;
  const empathyRatio = empathy && Number.isFinite(Number(empathy.ratio)) ? _clamp(Number(empathy.ratio), 0, 100) : null;
  const empathyAvailable = empathyCount !== null || empathyRatio !== null || Boolean(empathy?.verdict);
  const empathyPct = empathyRatio !== null ? empathyRatio : (empathyCount !== null && empathyTotal ? _clamp(empathyCount / empathyTotal * 100, 0, 100) : 0);
  const empathyValue = empathyAvailable ? Math.round(empathyPct) + '%' : '—';
  const empathyBullets = empathyAvailable
    ? [empathy.verdict || '', empathyCount !== null && empathyTotal !== null ? `${empathyCount} из ${empathyTotal} сообщений с поддержкой` : '']
    : ['Данные об эмпатии недоступны'];

  const tileData = [
    { val: conflict + '/10', bullets: [p.conflict?.verdict || '', `${d.raw_stats?.posts_fetched || 0} сообщений`] },
    { val: toxicPct + '%', bullets: [emotion.verdict || '', `Токсичных: ${toxicPct} из 100`] },
    { val: neutralPct + '%', bullets: [`Позитивных: ${Math.round(emotion.positive_pct || 0)}%`, emotion.verdict || ''] },
    { val: empathyValue, bullets: empathyBullets },
  ];

  const tilePcts = [_clamp(conflict * 10, 0, 100), _clamp(toxicPct, 0, 100), _clamp(neutralPct, 0, 100), _clamp(empathyPct, 0, 100)];
  const tileColors = [conflict >= 7 ? '#EF4444' : conflict >= 4 ? '#F59E0B' : '#34D399', '#EF4444', '#3B82F6', '#AA57FA'];
  _els('.tiles .tile').slice(0, 4).forEach((tile, i) => {
    tile.style.setProperty('--tile-value', tilePcts[i] + '%');
    tile.style.setProperty('--tile-color', tileColors[i]);
    tile.querySelectorAll('.tile-val,.tile-ghost .val').forEach(el => el.textContent = tileData[i].val);
    tile.querySelectorAll('.tile-track i,.track i').forEach(el => {
      el.style.setProperty('--tile-value', tilePcts[i] + '%');
      el.style.setProperty('--tile-color', tileColors[i]);
      el.setAttribute('role', 'progressbar');
      el.setAttribute('aria-valuenow', String(tilePcts[i]));
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', '100');
    });
  });
  _els('.tile-body').forEach((body, i) => {
    if (!tileData[i]) return;
    body.innerHTML = `<div class="tile-why">Откуда цифра</div><div class="tile-rows">${
      tileData[i].bullets.filter(Boolean).map(b => `<div class="tile-row"><span class="tile-dot" style="background:#888"></span><span>${_esc(b)}</span></div>`).join('')
    }</div>`;
  });
});
