zsLoad(function(d) {
  const act = d.activity || {};
  const tp  = act.time_profile || {};
  const yd  = act.yearly_dynamics || {};
  const rx  = act.reactions || {};
  const rs  = d.raw_stats || {};

  /* ── scope bar ── */
  // Zelscan truthful timeline counter v1
  const procN = rs.posts_fetched || 0;
  const timeline = rs.timeline_fetch || {};
  const targetN = Number(timeline.target_posts || 500);
  const shortSample = Boolean(timeline.source_exhausted && !timeline.target_reached);
  _html('[data-proc]', `Проанализировано <b>${procN.toLocaleString('ru')}</b> публичных сообщений`);
  _html('[data-all]', `Доступность публичной ленты: ${shortSample ? 'исчерпана' : 'сбор завершён'} · цель: <b>${targetN.toLocaleString('ru')}</b> сообщений`);
  /* обновляем all-notice — там может быть захардкоженный текст */
  const allNotice = _el('.all-notice');
  if (allNotice) {
    const svgIcon = allNotice.querySelector('svg');
    allNotice.innerHTML = (svgIcon ? svgIcon.outerHTML + ' ' : '') +
      `Детальная текстовая аналитика доступна только для <b>${procN.toLocaleString('ru')}</b> обработанных сообщений · остальные данные агрегированы со страницы профиля`;
  }

  /* ── 24ч ритм (новый дизайн: бары + тултипы) ── */
  const afull = _els('.afull');
  if (afull[0]) {
    const rhythmBox = afull[0].querySelector('div[style*="margin-top:40px"], div[style*="margin-top: 40px"]') || afull[0].querySelector('svg')?.parentElement;
    if (rhythmBox) {
      let hrs;
      if(tp.hours && Object.keys(tp.hours).length>0){
        hrs=Array(24).fill(0).map((_,h)=>Number(tp.hours[h]??tp.hours[String(h)]??0));
      } else {
        const mr=tp.morning_ratio||0, dr=tp.day_ratio||0, er=tp.evening_ratio||0, nr=tp.night_ratio||0;
        hrs=Array(24).fill(0).map((_,h)=>h<6?nr/6:h<12?mr/6:h<18?dr/6:er/6);
      }
      const peak=tp.peak_hour!=null?tp.peak_hour:hrs.indexOf(Math.max(...hrs));
      const total=hrs.reduce((a,b)=>a+b,0)||1;
      const maxH=Math.max(...hrs,0.01);
      rhythmBox.innerHTML='<div class="rh-bars">'+hrs.map((v,h)=>{
        const isPeak=h===peak;
        const pctH=Math.max(0,v/maxH*100);
        return `<div class="rh-col${isPeak?' peak':''}">
          <div class="rh-bar" style="height:${pctH}%"></div>
          <div class="rh-tip"><div class="tt"><span class="h">${('0'+h).slice(-2)}:00</span>${isPeak?'<span class="peak-mark">пик</span>':''}</div>
            <div class="tip-row"><span>сообщений</span><b>${v.toLocaleString('ru')}</b></div>
            <div class="tip-row"><span>доля трафика</span><b>${Math.round(v/total*100)}%</b></div>
            <div class="tip-row"><span>от пика</span><b>${Math.round(v/maxH*100)}%</b></div>
          </div>
          ${(h%4===0||isPeak)?`<span class="rh-lab">${h}:00</span>`:''}
        </div>`;
      }).join('')+'</div>';
      const cols=rhythmBox.querySelectorAll('.rh-col');
      if(cols.length){
        cols[0].classList.add('rh-edge-l');
        cols[cols.length-1].classList.add('rh-edge-r');
        /* тултип следует за курсором по вертикали */
        cols.forEach(col=>{
          const tip=col.querySelector('.rh-tip');
          if(!tip) return;
          col.addEventListener('mousemove',(e)=>{
            const r=col.getBoundingClientRect();
            const y=e.clientY-r.top;
            tip.style.bottom=Math.max(r.height-y,0)+10+'px';
          });
        });
      }
    }
    const sub = afull[0].querySelector('.mc-sub');
    if (sub) sub.textContent = tp.verdict || `Пик активности в ${tp.peak_hour ?? '?'}:00`;
    /* pills над чартом */
    const pillsEl = afull[0].querySelector('.pills');
    if (pillsEl && tp.peak_hour!=null) {
      const evPct = Math.round((tp.evening_ratio||0)*100);
      pillsEl.innerHTML =
        `<span class="pill">пик <b>${tp.peak_hour}:00</b></span>` +
        (evPct?`<span class="pill"><b>${evPct}%</b> после 18:00</span>`:'');
    }
  }

  /* ── рост по годам (новый дизайн: штриховка + зелёный хот-год) ── */
  const acards = _els('.acard');
  if (acards[0]) {
    const gc = acards[0];
    gc.style.display='flex'; gc.style.flexDirection='column';
    const growthBox = gc.querySelector('div[style*="margin-top:40px"]') || gc.querySelector('svg')?.parentElement;
    if (growthBox) {
      growthBox.style.flex='1';
      growthBox.style.display='flex';
      growthBox.style.alignItems='flex-end';
      growthBox.style.gap='12px';
      growthBox.style.padding='0 4px';
      growthBox.style.minHeight='150px';
      if (yd?.by_year_sorted?.length) {
        const sorted=yd.by_year_sorted;
        const maxV=Math.max(...sorted.map(r=>r[1]),1);
        let hotIdx=0; sorted.forEach((r,i)=>{ if(r[1]>sorted[hotIdx][1]) hotIdx=i; });
        const icMsg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
        growthBox.innerHTML = sorted.map(([yr,cnt],i)=>{
          const pct=Math.max(6,Math.round(cnt/maxV*100));
          const hot=i===hotIdx;
          return `<div class="yw-col yw${hot?' hot':''}">
            <div class="yw-fill">
              <span class="n">${icMsg}${cnt.toLocaleString('ru')}</span>
              <div class="yw-bar${hot?' hot':''}" style="height:${pct}%"></div>
            </div>
            <span class="yw-lab">${yr}</span>
          </div>`;
        }).join('');
      }
    }
    const sub = gc.querySelector('.mc-sub[style*="margin-top:14px"]');
    if (sub) { sub.textContent = yd.verdict || ''; sub.style.marginTop='14px'; }
    const pill = gc.querySelector('.pill[data-proc]');
    if (pill) pill.textContent = `${procN.toLocaleString('ru')} публичных`;
  }

  /* ── реакции (новый дизайн: донат 2 дуги + тайлы с иконками) ── */
  const rxCard = _el('.rx-card');
  if (rxCard && rx) {
    const totalLikes = rx.total_likes || 0;
    const avgLikes   = rx.avg_likes || 0;
    const maxLikes   = rx.max_likes || 0;
    const zeroPct    = rx.zero_like_pct || 0;
    const withPct    = 100 - zeroPct;

    const donut = rxCard.querySelector('.donut');
    if (donut) {
      donut.style.width='220px'; donut.style.height='220px';
      const C = 2*Math.PI*86;
      const gap = C*16.7/360;
      const greenLen = Math.max(0.01, withPct/100*C - gap);
      const darkLen  = Math.max(0.01, zeroPct/100*C - gap);
      const darkRot  = -90 + (greenLen+gap)/C*360;
      donut.innerHTML = `
        <svg viewBox="0 0 200 200" width="100%" height="100%">
          <circle cx="100" cy="100" r="86" fill="none" stroke="#3a3a3a" stroke-width="20" stroke-linecap="round" stroke-dasharray="${darkLen.toFixed(2)} ${(C-darkLen).toFixed(2)}" transform="rotate(${darkRot.toFixed(1)} 100 100)"/>
          <circle cx="100" cy="100" r="86" fill="none" stroke="#34D399" stroke-width="20" stroke-linecap="round" stroke-dasharray="${greenLen.toFixed(2)} ${(C-greenLen).toFixed(2)}" transform="rotate(-90 100 100)"/>
        </svg>
        <div class="ctr"><div class="n">${totalLikes.toLocaleString('ru')}</div><div class="l">лайков</div></div>`;
    }
    const rxSide = rxCard.querySelector('.rx-side');
    if (rxSide) {
      const iChart='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>';
      const iHeart='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
      const iDown='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
      const iLinkS='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      const tileCss='background:rgba(255,255,255,0.03);border:none;border-radius:16px;padding:13px 18px;display:flex;align-items:center;gap:14px';
      rxSide.innerHTML = `
        <div class="rx-tile" style="${tileCss}">
          ${iChart}
          <div><div class="n">${avgLikes.toFixed(2)}</div><div class="l">в среднем на пост</div></div>
        </div>
        <div class="rx-tile" style="${tileCss}">
          ${iHeart}
          <div style="flex:1"><div class="n">${maxLikes}</div><div class="l">лучший пост</div></div>
          <a href="#" style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,0.05);color:#6B6B6B;text-decoration:none" onclick="event.preventDefault()" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">${iLinkS}</a>
        </div>
        <div class="rx-tile" style="${tileCss}">
          ${iDown}
          <div><div class="n">${zeroPct}%</div><div class="l">ушли в пустоту</div></div>
        </div>`;
    }
    /* rx-leg */
    const rxLeg = rxCard.querySelector('.rx-leg');
    if (rxLeg) {
      rxLeg.innerHTML =
        `<span class="lg2"><i style="background:#34D399"></i>${withPct}% с реакцией</span>` +
        `<span class="lg2"><i style="background:#1c1c1c"></i>${zeroPct}% — 0 лайков</span>`;
    }
  }

  /* ── где сидит (форумы, новый дизайн: стек + легенда с hover) ── */
  const fcol = _el('.fcol');
  if (fcol && act.top_forums?.length) {
    const maxC = Math.max(...act.top_forums.map(f=>f.count),1);
    /* pills */
    const fcolPillProc = fcol.querySelector('.pill[data-proc]');
    const fcolPillAll = fcol.querySelector('.pill[data-all]');
    if (fcolPillProc) fcolPillProc.textContent = `${procN.toLocaleString('ru')} публичных`;
    if (fcolPillAll) fcolPillAll.textContent = `Цель: ${targetN.toLocaleString('ru')}`;
    const fcBottom = fcol.querySelector('.fcol-bottom');
    if (fcBottom) {
      const barsEl = fcBottom.querySelector('div');
      if (barsEl) {
        const tops=act.top_forums.slice(0,5);
        const colors=['#34D399','#22D3EE','#3B82F6','#8B5CF6','#EC4899'];
        const stack=tops.map((f,i)=>{const pct=(f.count/maxC*100).toFixed(1);return `<div class="seg" data-idx="${i}" style="width:${pct}%;background:${colors[i]}"></div>`;}).join('');
        const rows=tops.map((f,i)=>`<div class="label-row" data-idx="${i}"><div class="color" style="background:${colors[i]}"></div><span class="nm">${_esc(f.forum.slice(0,22))}</span><span class="ct">${f.count.toLocaleString('ru')}</span></div>`).join('');
        barsEl.innerHTML=`<div class="v5-stack">${stack}</div><div class="v5-labels">${rows}</div>`;
        /* hover-линковка стек ↔ легенда */
        const segs=barsEl.querySelectorAll('.v5-stack .seg');
        const rowsEls=barsEl.querySelectorAll('.v5-labels .label-row');
        const labelsEl=barsEl.querySelector('.v5-labels');
        segs.forEach((seg)=>{
          seg.addEventListener('mouseenter',()=>{
            const idx=seg.dataset.idx;
            segs.forEach(s=>{if(s!==seg)s.classList.add('dimmed');});
            rowsEls.forEach(r=>{if(r.dataset.idx===idx)r.classList.add('active');});
            labelsEl.classList.add('dimmed');
          });
          seg.addEventListener('mouseleave',()=>{
            segs.forEach(s=>s.classList.remove('dimmed'));
            rowsEls.forEach(r=>r.classList.remove('active'));
            labelsEl.classList.remove('dimmed');
          });
        });
      }
    }
  }

  /* ── вовлечённость (новый дизайн: белое число, яркие бары, 3 чипа) ── */
  const engCard = _els('.acard').find(c => c.querySelector('.eng-hero'));
  if (engCard && rx) {
    const avg = rx.avg_likes || 0;
    const maxL = rx.max_likes || 0;
    const zeroPct = rx.zero_like_pct || 0;
    const engEl = engCard.querySelector('.eng-hero .big');
    if (engEl) { engEl.textContent = avg.toFixed(1) + '×'; engEl.style.color = '#EBEBEB'; }
    const cmp = engCard.querySelector('.cmp');
    if (cmp) {
      const avgW = Math.min(avg*10/Math.max(maxL,0.01)*100,100);
      cmp.innerHTML = `
        <div class="row"><span class="k">Макс. лайков</span><div class="tk"><i style="width:100%;background:#34D399"></i></div><span class="v">${maxL}</span></div>
        <div class="row"><span class="k">Среднее</span><div class="tk"><i style="width:${avgW.toFixed(0)}%;background:#22D3EE"></i></div><span class="v">${avg.toFixed(2)}</span></div>
        <div class="row"><span class="k">Без лайков</span><div class="tk"><i style="width:${Math.min(zeroPct,100)}%;background:#EF4444"></i></div><span class="v">${zeroPct}%</span></div>
      `;
    }
    /* eng-chips из d.card */
    const chips = engCard.querySelector('.eng-chips');
    if (chips) {
      const card = d.card || {};
      const iTrophy='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';
      const iUsers='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
      const iAdd='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>';
      let chipsHtml = '';
      if (card.trophy_count != null) chipsHtml += `<div class="eng-chip">${iTrophy}<div><div class="n">${Number(card.trophy_count).toLocaleString('ru')}</div><div class="l">трофеев</div></div></div>`;
      if (card.followers != null) chipsHtml += `<div class="eng-chip">${iUsers}<div><div class="n">${Number(card.followers).toLocaleString('ru')}</div><div class="l">подписчиков</div></div></div>`;
      if (card.following != null) chipsHtml += `<div class="eng-chip">${iAdd}<div><div class="n">${Number(card.following).toLocaleString('ru')}</div><div class="l">подписок</div></div></div>`;
      chips.innerHTML = chipsHtml;
    }
  }

  /* ── топ тем (новый дизайн: иконки + ссылка) ── */
  if (afull[1] && act.top_threads_by_views?.length) {
    const list = afull[1].querySelector('div[style*="margin-top:40px"]');
    if (list) {
      const iEye='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      const iMsg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
      const iLink='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      list.innerHTML = act.top_threads_by_views.slice(0,7).map((t,i) => {
        const url = t.url || (t.thread_id ? `https://lolz.team/threads/${t.thread_id}/` : '');
        const titleHtml = url
          ? `<a class="tt" href="${url}" target="_blank" rel="noopener">${_esc(t.title||'—')}</a>`
          : `<div class="tt" onclick="this.classList.toggle('active');this.nextElementSibling.classList.toggle('active')">${_esc(t.title||'—')}</div>`;
        const linkHtml = url
          ? `<a href="${url}" class="thread-link" target="_blank" rel="noopener" title="Открыть тему на Lolzteam">${iLink}</a>`
          : `<a href="#" class="thread-link" onclick="event.preventDefault();this.previousElementSibling.classList.toggle('active');this.classList.toggle('active')">${iLink}</a>`;
        return `
        <div class="thread${i===0?' first':''}">
          <span class="rk">№${i+1}</span>
          <div class="ti">
            <div class="tt-row">
              ${titleHtml}
              ${linkHtml}
            </div>
            <div class="tf">${_esc(t.forum||'')}</div>
          </div>
          <div class="mv">
            <div class="m"><div class="mi">${iEye}<div class="n">${(t.views||0).toLocaleString('ru')}</div></div></div>
            <div class="m"><div class="mi">${iMsg}<div class="n">${t.replies||0}</div></div></div>
          </div>
        </div>`;}).join('');
    }
  }
});

/* ── Карта тем и экспертизы (v7) ── */
zsLoad(function(d){
  const te = (d.activity||{}).topic_expertise || {};
  const rows = te.rows || [];
  const list = _el('.te-card .te-list');
  if (list && rows.length) {
    list.innerHTML = rows.map((r,i)=>{
      const engPct = Math.round((r.engagement||0)*100);
      const expPct = Math.round((r.expertise||0)*100);
      let ex = (r.examples||[]).join(' · ');
      if(ex.length>55){ ex=ex.slice(0,55); ex=ex.slice(0, ex.lastIndexOf(' ')).trim()+'…'; }
      const col = r.color||'#7C8694';
      return `<div class="te-row${i===0?' first':''}">
        <span class="te-dot" style="background:${col}"></span>
        <div class="te-main">
          <div class="te-top"><span class="te-name">${_esc(r.topic||'—')}</span><span class="te-cat">${_esc(r.category||'')}</span></div>
          ${ex?`<div class="te-ex">${_esc(ex)}</div>`:''}
        </div>
        <div class="te-metric"><div class="ml">вовлечённость <b>${engPct}%</b></div><div class="te-bar"><i style="width:${engPct}%;background:${col}"></i></div></div>
        <div class="te-metric"><div class="ml">экспертиза <b>${expPct}%</b></div><div class="te-bar"><i style="width:${expPct}%;background:${col}"></i></div></div>
        <div class="te-ment"></div>
      </div>`;
    }).join('');
  }
});
