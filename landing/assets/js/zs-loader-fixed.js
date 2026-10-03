/* zs-loader.js — общий загрузчик данных для страниц отчёта Zelscan
   Подключается как <script src="zs-loader.js"></script> перед </body>
   Каждая страница вызывает zsLoad(renderFn) со своей функцией рендера.
   Если ?order= нет в URL — страница остаётся статичной (режим превью). */

const ZS_API = window.ZS_API || '';
window.ZS = {};

// ── утилиты ──────────────────────────────────────────────────
function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _clamp(v,a,b) { return Math.max(a,Math.min(b,v||0)); }
function _pct(v) { return (v==null)?'—':Math.round(_clamp(v,0,1)*100)+'%'; }
function _el(sel) { return document.querySelector(sel); }
function _els(sel) { return [...document.querySelectorAll(sel)]; }
function _set(sel, val) { const e=_el(sel); if(e) e.textContent=val; }
function _html(sel, html) { const e=_el(sel); if(e) e.innerHTML=html; }
function _zsSanitize(value) {
  const replacements=[
    [/\u0441\u0443\u0445\u0430\u0440\w*/giu,'пишет по делу'],
    [/\u0442\u0435\u0445\u043d\u0430\u0440\w*/giu,'разбирается в теме'],
    [/\u0444\u0438\u043a\u0441[\u0435\u0451]\u0440\w*/giu,'Решала'],
    [/\u043f\u043b\u043e\u0434\u043e\u0432\u0438\u0442\w*/giu,'активный'],
    [/\u0431\u0440\u0430\u0442\u0430\u043d[- ](?:\u0431\u0440\u0430\u0442\u0443\u0448\u043d\u0438\u043a|\u043a\u0430\u0431\u0430\u043d)\w*/giu,'свой в общении']
  ];
  if(typeof value==='string')return replacements.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),value);
  if(Array.isArray(value))return value.map(_zsSanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,_zsSanitize(item)]));
  return value;
}

// ── Big Five пятиугольник ────────────────────────────────────
// cx=235 cy=192 maxR=150; ось 0 = вверх (-90°), шаг 72° по часовой
function b5Points(vals10) {
  const cx=235, cy=192, maxR=150;
  return vals10.map((v,i) => {
    const r = _clamp(v,0,10)/10 * maxR;
    const a = (-90 + i*72) * Math.PI/180;
    return `${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// ── Orbit SVG (круг общения) ─────────────────────────────────
function orbitSVG(posters, centerName) {
  const cx=218, cy=205;
  const RADII=[80,134,188];
  let defs='', body='';
  RADII.forEach(r => body+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1A1A1A" stroke-width="1"/>`);
  // декоративные точки
  for(let i=0;i<8;i++){const a=i*45*Math.PI/180,r=RADII[2];body+=`<circle cx="${(cx+r*Math.cos(a)).toFixed(1)}" cy="${(cy+r*Math.sin(a)).toFixed(1)}" r="2.3" fill="#333"/>`;}

  const top=posters.slice(0,5);
  const TIER=['чаще всех','часто','часто','иногда','иногда'];
  top.forEach((p,i) => {
    const a=(-90+i*72)*Math.PI/180;
    const r=i===0?RADII[0]:i<=2?RADII[1]:RADII[2];
    const px=cx+r*Math.cos(a), py=cy+r*Math.sin(a);
    const sz=i===0?24:17, fs=i===0?18:13;
    const name=p.name||p.poster_name||'?';
    const lbl=name.length>12?name.slice(0,12)+'…':name;
    const letter=(name[0]||'?').toUpperCase();
    const ly=py-sz-18;
    body+=`<g class="orbit-node" data-idx="${i}">`;
    body+=`<line x1="${cx}" y1="${cy}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#242424" stroke-width="1"/>`;
    body+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${sz}" fill="#0E1518" stroke="#4A4A4A" stroke-width="1.8"/>`;
    if(p.avatar){
      const ar=sz-2, cid='orbitClip'+i;
      defs+=`<clipPath id="${cid}"><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${ar}"/></clipPath>`;
      body+=`<image href="${_esc(p.avatar)}" xlink:href="${_esc(p.avatar)}" x="${(px-ar).toFixed(1)}" y="${(py-ar).toFixed(1)}" width="${(2*ar).toFixed(1)}" height="${(2*ar).toFixed(1)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/>`;
    } else {
      body+=`<text class="orbit-letter" x="${px.toFixed(1)}" y="${(py+fs*0.38).toFixed(1)}" fill="#C9C9C9" font-family="Inter" font-size="${fs}" font-weight="500" text-anchor="middle">${_esc(letter)}</text>`;
    }
    body+=`<text x="${px.toFixed(1)}" y="${ly.toFixed(1)}" fill="#C9C9C9" font-family="Inter" font-size="12" font-weight="400" text-anchor="middle">${_esc(lbl)}</text>`;
    body+=`<text class="orbit-info" x="${px.toFixed(1)}" y="${(ly+12).toFixed(1)}" fill="#7C8694" font-family="Inter" font-size="8.5" font-weight="400" text-anchor="middle" opacity="0">${_esc(TIER[i])}</text>`;
    body+=`</g>`;
  });

  if(!top.length) body+=`<text x="${cx}" y="${cy-50}" fill="#555" font-family="Inter" font-size="13" text-anchor="middle">Стена пуста</text>`;

  // центр
  body+=`<circle cx="${cx}" cy="${cy}" r="30" fill="#EDEDED"/>`;
  body+=`<text x="${cx}" y="${cy+5}" fill="#0A0A0A" font-family="Inter" font-size="14" font-weight="500" text-anchor="middle">Он</text>`;
  return `<svg viewBox="0 0 436 411" width="436" height="411" style="max-width:100%"><defs>${defs}</defs>${body}</svg>`;
}

// ── Mosaic (46×8 = 368 квадратов, тональность) ───────────────
// emotion.*_pct — целые % (0-100), не дроби
function mosaicSVG(emotion) {
  const TOTAL=368, W=46, H=8, CELL=16, CH=16, GAP=6;
  const toxicN  = Math.round(_clamp((emotion.toxic_pct||0)/100,0,1)*TOTAL);
  const posN    = Math.round(_clamp((emotion.positive_pct||0)/100,0,1)*TOTAL);
  const cells   = Array(TOTAL).fill('n');
  for(let i=0;i<toxicN;i++)   cells[i]='t';
  for(let i=toxicN;i<toxicN+posN&&i<TOTAL;i++) cells[i]='p';
  // shuffle
  for(let i=TOTAL-1;i>0;i--){const j=Math.floor(Math.abs(Math.sin(i*137.5))*i);[cells[i],cells[j]]=[cells[j],cells[i]];}
  const C={'t':'#EF4444','p':'#34D399','n':'#242424'};
  const T={'t':'токсичный пост','p':'позитивный пост','n':'нейтральный пост'};
  const WW=W*CELL+(W-1)*GAP, HH=H*CH+(H-1)*GAP;
  let s=`<svg viewBox="0 0 ${WW} ${HH}" width="100%" style="max-width:${WW}px">`;
  cells.forEach((c,n)=>{
    const col=n%W, row=Math.floor(n/W);
    s+=`<rect class="mos-cell" data-t="${c}" x="${col*(CELL+GAP)}" y="${row*(CH+GAP)}" width="${CELL}" height="${CH}" rx="7" fill="${C[c]}"><title>${T[c]}</title></rect>`;
  });
  return s+'</svg>';
}

// ── 24-часовой ритм (bar chart) ──────────────────────────────
function rhythmSVG(tp) {
  if(!tp) return '';
  const peak=tp.peak_hour??12;
  // Используем реальные данные по часам если они есть
  let hrs;
  if(tp.hours && Object.keys(tp.hours).length>0) {
    hrs=Array(24).fill(0).map((_,h)=>Number(tp.hours[h]??tp.hours[String(h)]??0));
  } else {
    const mr=tp.morning_ratio||0, dr=tp.day_ratio||0, er=tp.evening_ratio||0, nr=tp.night_ratio||0;
    hrs=Array(24).fill(0).map((_,h)=>h<6?nr/6:h<12?mr/6:h<18?dr/6:er/6);
    hrs[peak]=Math.max(hrs[peak]*1.5,0.12);
  }
  const maxH=Math.max(...hrs,0.01);
  // viewBox ~1020px чтобы при width:100% в afull (1020px контент) масштаб ≈ 1:1
  const BW=36,GAP=7,BASE=110,H=136,W=24*(BW+GAP)+20;
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
  hrs.forEach((v,h)=>{
    const bh=Math.max(4,v/maxH*90);
    const x=10+h*(BW+GAP);
    const isPeak=h===peak;
    const fill=isPeak?'#FFFFFF':`rgba(255,255,255,${0.06+v/maxH*0.18})`;
    s+=`<rect x="${x}" y="${BASE-bh}" width="${BW}" height="${bh}" rx="5" fill="${fill}"/>`;
    if(h%4===0||isPeak) s+=`<text x="${x+BW/2}" y="${BASE+14}" fill="#555" font-family="Inter" font-size="11" text-anchor="middle">${h}:00</text>`;
  });
  return s+'</svg>';
}

// ── Годовой бар-чарт ─────────────────────────────────────────
function yearlyBarSVG(yd) {
  if(!yd?.by_year_sorted?.length) return '<p style="color:#555;font-size:13px">Недостаточно данных</p>';
  const data=yd.by_year_sorted;
  const maxV=Math.max(...data.map(d=>d[1]),1);
  // фиксированный viewBox 460×150, бары занимают всю ширину равномерно
  const SVGW=460, PAD=16, BASE=118, H=150;
  const slotW=(SVGW-PAD*2)/data.length;
  const BW=Math.max(20, slotW*0.65);
  const G=slotW-BW;
  let s=`<svg viewBox="0 0 ${SVGW} ${H}" width="100%" style="display:block">`;
  data.forEach(([year,cnt],i)=>{
    const bh=Math.max(4,cnt/maxV*100);
    const x=PAD+i*slotW+(slotW-BW)/2;
    s+=`<rect x="${x.toFixed(1)}" y="${BASE-bh}" width="${BW.toFixed(1)}" height="${bh}" rx="6" fill="rgba(255,255,255,0.15)"/>`;
    s+=`<text x="${(x+BW/2).toFixed(1)}" y="${BASE+14}" fill="#555" font-family="Inter" font-size="11" text-anchor="middle">${year}</text>`;
    s+=`<text x="${(x+BW/2).toFixed(1)}" y="${BASE-bh-6}" fill="#888" font-family="Inter" font-size="10" text-anchor="middle">${cnt}</text>`;
  });
  return s+'</svg>';
}

// ── Fan chart (Тёмная триада) — анимированная версия ─────────
var FAN_X0=6, FAN_Y0=246, FAN_W=462, FAN_TOP=8;
function _easeOutCubic(t){return 1-Math.pow(1-t,3);}
function fanSVG(psychopathy, machiavellianism, narcissism) {
  var p=psychopathy||0, m=machiavellianism||0, n=narcissism||0;
  var bands=[[n,'#34D399'],[m,'#F59E0B'],[p,'#EF4444']];
  var total=bands.reduce(function(s,b){return s+b[0];},0)||1;
  var span=FAN_Y0-FAN_TOP;
  var sum=p+m+n;
  var level, lvColor;
  if(sum<=6){level='Тёмных черт почти нет';lvColor='#34D399';}
  else if(sum<=12){level='Тёмных черт немного';lvColor='#F59E0B';}
  else if(sum<=18){level='Тёмные черты заметны';lvColor='#F97316';}
  else{level='Тёмные черты сильно выражены';lvColor='#EF4444';}
  var plainTrait={0:'самовлюблённость',1:'хитрость и манипуляции',2:'равнодушие к другим'};
  var vals=[n,m,p];
  var maxV=Math.max(p,m,n), domIdx=maxV>0?vals.indexOf(maxV):-1;
  var line2=domIdx>=0?plainTrait[domIdx]:'все три черты в норме';

  var finalEdges=[FAN_Y0]; var cur=FAN_Y0;
  for(var i=0;i<bands.length;i++){cur-=bands[i][0]/total*span;finalEdges.push(cur);}
  var finalTop=finalEdges[finalEdges.length-1];

  var s='';
  for(var k=0;k<9;k++){var tx=FAN_X0+(FAN_W-FAN_X0)*k/8;s+='<line x1="'+tx.toFixed(1)+'" y1="'+FAN_Y0+'" x2="'+tx.toFixed(1)+'" y2="'+(FAN_Y0+6)+'" stroke="#222" stroke-width="1"/>';}
  for(i=0;i<bands.length;i++){s+='<polygon id="fanP'+i+'" points="'+FAN_X0+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+'" fill="'+bands[i][1]+'" fill-opacity="0.9"/>';}
  s+='<polygon id="fanCap" points="'+FAN_X0+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+'" fill="#ffffff" fill-opacity="0.07"/>';
  var dx=FAN_X0+(FAN_W-FAN_X0)*0.80;
  s+='<line id="fanDash" x1="'+dx.toFixed(1)+'" y1="'+FAN_Y0+'" x2="'+dx.toFixed(1)+'" y2="'+FAN_Y0+'" stroke="#9A9A9A" stroke-width="1" stroke-dasharray="3 3" opacity="0" style="transition:opacity .2s ease"/>';
  var bh=42, fs1=10.5, fs2=9.5;
  var l1w=level.length*5.6, l2w=line2.length*5.05;
  var bw=Math.round(Math.max(l1w,l2w)+36);
  var bx=dx-bw/2;
  s+='<g id="fanBadge" opacity="0" style="transition:opacity .2s ease"><rect x="'+bx.toFixed(1)+'" y="12" width="'+bw+'" height="'+bh+'" rx="9" fill="#161616" stroke="rgba(255,255,255,0.08)"/>';
  s+='<rect id="fanBar" x="'+(bx+7).toFixed(1)+'" y="22" width="3" height="22" rx="1.5" fill="'+lvColor+'"/>';
  s+='<text id="fanCat" x="'+(bx+18).toFixed(1)+'" y="0" fill="#EBEBEB" font-family="Inter" font-size="'+fs1+'" font-weight="600" text-anchor="start" dominant-baseline="central">'+level+'</text>';
  s+='<text id="fanScore" x="'+(bx+18).toFixed(1)+'" y="0" fill="#8A8A8A" font-family="Inter" font-size="'+fs2+'" text-anchor="start" dominant-baseline="central">'+line2+'</text></g>';
  s+='<circle cx="'+FAN_X0+'" cy="'+FAN_Y0+'" r="5" fill="#020202" stroke="#34D399" stroke-width="2.5"/>';
  var el=document.createElement('div'); el.innerHTML='<svg viewBox="0 0 468 260" width="468" height="260" preserveAspectRatio="none" style="width:100%">'+s+'</svg>';
  var svg=el.firstChild;

  var dur=1100, start=null;
  function frame(ts){
    if(!start)start=ts;
    var e=ts-start; var t=Math.min(e/dur,1); var k=_easeOutCubic(t);
    var curEdges=[FAN_Y0];
    for(var i=0;i<bands.length;i++)curEdges.push(FAN_Y0+(finalEdges[i+1]-FAN_Y0)*k);
    for(i=0;i<bands.length;i++){var poly=svg.querySelector('#fanP'+i);if(poly)poly.setAttribute('points',FAN_X0+','+FAN_Y0+' '+FAN_W+','+curEdges[i].toFixed(1)+' '+FAN_W+','+curEdges[i+1].toFixed(1));}
    var curTop=curEdges[curEdges.length-1];
    var cap=svg.querySelector('#fanCap'); if(cap)cap.setAttribute('points',FAN_X0+','+FAN_Y0+' '+FAN_W+','+curTop.toFixed(1)+' '+FAN_W+','+(curTop-11).toFixed(1));
    if(t>0.55){var dash=svg.querySelector('#fanDash');if(dash){var yt=FAN_Y0+(curTop-FAN_Y0)*(dx-FAN_X0)/(FAN_W-FAN_X0);dash.setAttribute('y2',yt.toFixed(1));}}
    if(t>0.72){var bg=svg.querySelector('#fanBadge');if(bg){var yt2=FAN_Y0+(curTop-FAN_Y0)*(dx-FAN_X0)/(FAN_W-FAN_X0);var by=Math.max(yt2-bh-10,12);var rect=bg.querySelector('rect');if(rect)rect.setAttribute('y',by.toFixed(1));var bar=bg.querySelector('#fanBar');if(bar)bar.setAttribute('y',(by+10).toFixed(1));var catT=bg.querySelector('#fanCat');if(catT)catT.setAttribute('y',(by+15).toFixed(1));var scT=bg.querySelector('#fanScore');if(scT)scT.setAttribute('y',(by+30).toFixed(1));}}
    if(t<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  var badgeEl=svg.querySelector('#fanBadge'), dashEl=svg.querySelector('#fanDash');
  svg.addEventListener('mouseenter',function(){ if(badgeEl)badgeEl.setAttribute('opacity','1'); if(dashEl)dashEl.setAttribute('opacity','0.7'); });
  svg.addEventListener('mouseleave',function(){ if(badgeEl)badgeEl.setAttribute('opacity','0'); if(dashEl)dashEl.setAttribute('opacity','0'); });
  return svg;
}

// ── Donut chart (полукруг) ────────────────────────────────────
function donutSVG(val, max, color) {
  const v=_clamp(val,0,max);
  const pct=max>0?v/max:0;
  const C=2*Math.PI*42;
  const off=C*(1-pct);
  return `<svg width="120" height="120" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
    <circle cx="50" cy="50" r="42" fill="none" stroke="${color}" stroke-width="8"
      stroke-dasharray="${C}" stroke-dashoffset="${off}" stroke-linecap="round"
      transform="rotate(-90 50 50)"/>
    <text x="50" y="46" fill="${color}" font-family="Inter" font-size="18" font-weight="600" text-anchor="middle">${Math.round(v)}</text>
    <text x="50" y="60" fill="#555" font-family="Inter" font-size="10" text-anchor="middle">/${max}</text>
  </svg>`;
}

// ── Заполнение общих элементов (все страницы) ────────────────
function zsCommon(d, order) {
  const c=d.card;
  const oid=order.order_id||order.task_id||'';

  // title + hero + sidebar + acc-pill — общие для всех страниц отчёта
  document.title = `zelscan · ${c.username}`;

  // hero-ava
  const heroAva=_el('.hero-ava');
  if(heroAva){
    if(c.avatar) heroAva.innerHTML=`<img src="${_esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    else heroAva.textContent=(c.username?.[0]||'?').toUpperCase();
  }
  // hero-tags (labels)
  const heroTags=_el('.hero-tags');
  if(heroTags) heroTags.innerHTML=(c.labels||[]).map(l=>`<span class="tag">${_esc(l)}</span>`).join('');
  // hero text
  _set('.hero-name', c.username||'');
  _set('.hero-meta', c.user_id?`на форуме ${c.tenure||'—'} · ID ${c.user_id}`:'');
  const heroDescP=_el('.hero-desc p');
  if(heroDescP){
    const vsum=typeof d.verdict==='string'?d.verdict:(d.verdict?.summary||'');
    heroDescP.textContent=vsum||c.description||'';
  }

  // sidebar/account identity is rendered by account-ui.js

  // hero tiles (4 базовых на всех страницах)
  // conflict.score — уже 0-10, emotion.*_pct — уже целые % (не дроби)
  const em=d.portrait?.emotion||{};
  const conflict=d.portrait?.conflict?.score??0;
  const empathy=d.empathy||{};
  const empathyCount=Number(empathy.count||0);
  const empathyScore=empathyCount===0?0:empathyCount<=2?3:empathyCount<=5?6:empathyCount<=10?8:10;
  const tileMetrics=[
    {text:conflict+'/10', pct:_clamp(conflict*10,0,100), color:conflict>=7?'#EF4444':conflict>=4?'#F59E0B':'#34D399'},
    {text:(em.toxic_pct??0)+'%', pct:_clamp(em.toxic_pct??0,0,100), color:'#EF4444'},
    {text:(em.neutral_pct??0)+'%', pct:_clamp(em.neutral_pct??0,0,100), color:'#3B82F6'},
    {text:empathyScore+'/10', pct:empathyScore*10, color:'#AA57FA'}
  ];
  _els('.tile').slice(0,4).forEach((tile,i)=>{
    const metric=tileMetrics[i]; if(!metric)return;
    tile.style.setProperty('--tile-value',metric.pct+'%');
    tile.style.setProperty('--tile-color',metric.color);
    tile.querySelectorAll('.val,.tile-val').forEach(el=>el.textContent=metric.text);
    tile.querySelectorAll('.track i,.tile-track i').forEach(el=>{el.style.setProperty('--tile-value',metric.pct+'%');el.style.setProperty('--tile-color',metric.color);el.setAttribute('role','progressbar');el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax','100');el.setAttribute('aria-valuenow',String(metric.pct));});
  });

  // единые раскрывающиеся hero-метрики и размер выборки
  const raw=d.raw_stats||{};
  const empathyBullets=[empathy.verdict||'Нет данных',`${empathyCount} явных сигналов поддержки в ${raw.posts_fetched||empathy.total_posts||0} сообщениях`,'Оценка отражает только публичное общение'];
  const bullets=[
    [d.portrait?.conflict?.verdict||'',`${raw.posts_fetched||0} сообщений в выборке`],
    [em.verdict||'',`${em.toxic_pct??0}% сообщений с токсичными сигналами`],
    [em.verdict||'',`${em.neutral_pct??0}% сообщений в нейтральном тоне`],
    empathyBullets
  ];
  _els('.tiles .tile').slice(0,4).forEach((tile,i)=>{
    if(!tile.querySelector('.tile-card')){
      const label=tile.querySelector('.lab')?.textContent||'';
      tile.innerHTML=`<div class="tile-ghost"><div class="tl"><span class="lab">${_esc(label)}</span><div class="track"><i></i></div></div><span class="val">${tileMetrics[i].text}</span></div><div class="tile-card"><div class="tile-head"><div class="tile-tl"><span class="tile-lab">${_esc(label)}</span><div class="tile-track"><i></i></div></div><span class="tile-val">${tileMetrics[i].text}</span></div><div class="tile-sep"></div><div class="tile-body"></div></div>`;
    }
    const body=tile.querySelector('.tile-body'); if(body)body.innerHTML=`<div class="tile-why">Откуда цифра</div><div class="tile-rows">${bullets[i].filter(Boolean).map(b=>`<div class="tile-row"><span class="tile-dot" style="background:${tileMetrics[i].color}"></span><span>${_esc(b)}</span></div>`).join('')}</div>`;
    tile.querySelectorAll('.val,.tile-val').forEach(el=>el.textContent=tileMetrics[i].text);
    tile.querySelectorAll('.track i,.tile-track i').forEach(el=>{el.style.setProperty('--tile-value',tileMetrics[i].pct+'%');el.style.setProperty('--tile-color',tileMetrics[i].color)});
    tile.tabIndex=0;
  });
  const metricsRoot=_el('.metrics');
  if(metricsRoot&&!_el('.sample-note')){const n=document.createElement('div');n.className='sample-note';n.innerHTML=`Проанализировано <b>${Number(raw.posts_fetched||0).toLocaleString('ru-RU')}</b> из <b>${Number(raw.message_count||0).toLocaleString('ru-RU')}</b> сообщений · <b>${Number(raw.threads_fetched||0).toLocaleString('ru-RU')}</b> тем · <b>${Number(raw.wall_posts_fetched||0).toLocaleString('ru-RU')}</b> записей стены`;metricsRoot.insertAdjacentElement('afterend',n)}
  const fourth=_els('.tiles .tile').slice(0,4)[3]; if(fourth)fourth.querySelectorAll('.lab,.tile-lab').forEach(x=>x.textContent='Эмпатия');
  zsReportActions(order,d);

  // дата отчёта
  const repD=_el('.report-h .d');
  if(repD && d.generated_at){
    const dt=new Date(d.generated_at*1000);
    repD.textContent=`Досье #${order.display_id||oid} · `+dt.toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'})+' года';
  }

  // кнопка "Новое досье" → дашборд
  const newBtn=_el('.btn-new');
  if(newBtn) newBtn.onclick=()=>window.location.href='/app';
}

// ── сохраняем контекст отчёта во всех вкладках ─────────────
function zsPropagateContext() {
  const current=new URLSearchParams(location.search), next=new URLSearchParams();
  for(const key of ['order','public','share'])if(current.get(key))next.set(key,current.get(key));
  const query=next.toString(); if(!query)return;
  _els('.tab[href]').forEach(el=>{const base=el.getAttribute('href').split('?')[0];el.href=`${base}?${query}`});
}

// ── Состояние ожидания/ошибки на странице отчёта ────────────
let _zsWaitEl=null;
function _zsWaitRoot(){
  if(_zsWaitEl&&_zsWaitEl.parentNode)return _zsWaitEl;
  _zsWaitEl=document.createElement('div');_zsWaitEl.className='zs-report-wait';
  _zsWaitEl.innerHTML='<div class="zr-w-inner"><div class="zr-w-ring"></div><div class="zr-w-lab">Собираем досье…</div><div class="zr-w-stage"></div><div class="zr-w-pos"></div></div>';
  const main=_el('.main'); if(main)main.appendChild(_zsWaitEl);
  return _zsWaitEl;
}
const _ZS_STAGE_NAMES={profile:'Профиль',fetch_posts:'Сообщения',fetch_threads:'Темы',fetch_wall:'Стена',metrics:'Метрики',ai:'AI-анализ'};
function zsShowProgress(progress,position){
  const root=_zsWaitRoot();
  const main=_el('.main'); if(main)main.classList.add('zs-loading');
  const lab=root.querySelector('.zr-w-lab'); if(lab)lab.textContent='Собираем досье…';
  const stage=root.querySelector('.zr-w-stage');
  if(stage)stage.textContent=(progress&&(_ZS_STAGE_NAMES[progress.stage]||progress.message))||'';
  const posEl=root.querySelector('.zr-w-pos');
  if(posEl)posEl.textContent=(position>1)?('В очереди: #'+position):'';
}
function zsShowNotice(kind,msg){
  const root=_zsWaitRoot();
  const main=_el('.main'); if(main)main.classList.add('zs-loading');
  const lab=root.querySelector('.zr-w-lab'); if(lab)lab.textContent=(kind==='error')?'Не удалось собрать досье':'Досье недоступно';
  const stage=root.querySelector('.zr-w-stage'); if(stage)stage.textContent=msg||'';
  const posEl=root.querySelector('.zr-w-pos'); if(posEl)posEl.textContent='';
}
function zsHideWait(){
  if(_zsWaitEl&&_zsWaitEl.parentNode)_zsWaitEl.parentNode.removeChild(_zsWaitEl);
  _zsWaitEl=null;
  const main=_el('.main'); if(main)main.classList.remove('zs-loading');
}

// ── Главный загрузчик ────────────────────────────────────────
async function zsLoad(renderFn) {
  const qs=new URLSearchParams(location.search), oid=qs.get('order'), publicId=qs.get('public'), share=qs.get('share');
  if(!oid&&!publicId) return; // нет order — статичный режим

  // прокидываем order сразу, до любых сетевых запросов (fix: табы теряли order при недоступном API)
  zsPropagateContext();

  try {
    const token=localStorage.getItem('lzt_token')||'';
    const url=publicId?`${ZS_API}/api/public/dossiers/${encodeURIComponent(publicId)}`:`${ZS_API}/api/orders/${oid}`;
    const headers={}; if(token)headers.Authorization=`Bearer ${token}`; if(share)headers['X-Share-Token']=share;

    // продлеваем сессию: валидируем токен до запроса данных (кеш сервера — 24ч)
    if(token&&!publicId&&!share){
      try{await fetch(`${ZS_API}/api/me`,{credentials:'include',headers:{...(token?{Authorization:`Bearer ${token}`}:{})}})}catch(_e){}
    }

    for(let attempt=0; attempt<240; attempt++){
      const r=await fetch(url,{headers,credentials:'include'});
      if(!r.ok) return;
      const order=await r.json();
      if(order.status==='done'&&order.result){
        zsHideWait();
        const safeResult=_zsSanitize(order.result);
        ZS.order=order;
        ZS.data=safeResult;
        zsCommon(safeResult, order);
        renderFn(safeResult, order);
        return;
      }
      if(order.status==='error'){
        zsShowNotice('error', order.error||'Попробуйте позже или создайте заказ заново');
        return;
      }
      if(order.status==='pending_payment'){
        zsShowNotice('wait', 'Заказ ожидает оплаты');
        return;
      }
      // ещё собирается — показываем живой прогресс и ждём
      zsShowProgress(order.progress||{}, order.position||0);
      await new Promise(res=>setTimeout(res,2000));
    }
    zsShowNotice('error','Превышено время ожидания. Проверьте статус в «Мои досье».');
  } catch(e) {
    console.warn('ZS load error:', e);
  }
}

// прокидываем ?order= при самой загрузке скрипта (независимо от zsLoad/fetch)
(function(){
  const oid = new URLSearchParams(location.search).get('order');
  zsPropagateContext();
})();

function zsReportActions(order,d){
  const dots=_el('.hero-dots'); if(!dots||dots.dataset.ready)return; dots.dataset.ready='1';dots.setAttribute('role','button');dots.tabIndex=0;dots.setAttribute('aria-label','Действия с досье');dots.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='report-menu';menu.setAttribute('role','menu');document.body.append(menu);
  const icons={
    share:'<i class="fa-solid fa-share-nodes" aria-hidden="true"></i>',pen:'<i class="fa-solid fa-signature" aria-hidden="true"></i>',
    copy:'<i class="fa-solid fa-signature" aria-hidden="true"></i>',
    refresh:'<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>',
    external:'<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>',
    trash:'<i class="fa-solid fa-trash-can" aria-hidden="true"></i>'
  };
  const notice=(type,title,message)=>{if(window.ZSNotice&&typeof window.ZSNotice.show==='function')window.ZSNotice.show({type,title,message});};
  const api=async(path,opt={})=>{const t=localStorage.getItem('lzt_token')||'',r=await fetch(ZS_API+path,{...opt,credentials:opt.credentials||'include',headers:{'Content-Type':'application/json',...(t?{Authorization:`Bearer ${t}`}:{}) ,...(opt.headers||{})}}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error('request_failed');return j};
  const pos=()=>{const r=dots.getBoundingClientRect(),w=230;menu.style.left=Math.min(innerWidth-w-12,Math.max(12,r.right-w))+'px';menu.style.top=Math.min(innerHeight-250,r.bottom+8)+'px'};
  const item=(label,act,icon,cls='')=>`<button type="button" role="menuitem" data-act="${act}" class="${cls}">${icons[icon]}<span>${label}</span></button>`;
  function draw(){const own=[item('Поделиться и доступ','access','share'),item('Автограф автора','sig','pen'),item('Обновить досье','refresh','refresh'),item('Открыть профиль LZT','profile','external'),'<div class="menu-sep"></div>',item('Удалить досье','delete','trash','danger')];const guest=[item('Автограф автора','sig','pen'),item('Открыть профиль LZT','profile','external')];menu.innerHTML=(order.is_owner?own:guest).join('');menu.querySelectorAll('button').forEach(b=>b.onclick=()=>act(b.dataset.act))}
  async function act(a){closeMenu();try{if(a==='sig'){openSignature();return}if(a==='copy'){await navigator.clipboard.writeText(location.href);notice('success','Ссылка скопирована','Её можно отправить человеку, которому вы хотите открыть доступ.');return}if(a==='profile'){open('https://lolz.live/members/'+(d.card?.user_id||order.user_id)+'/','_blank');return}if(a==='refresh'){var u={user_id:d.card?.user_id||order.user_id,username:d.card?.username||'',avatar:d.card?.avatar||'',message_count:d.raw_stats?.message_count||d.raw_stats?.posts_fetched||0,thread_count:d.raw_stats?.threads_fetched||0,wall_count:d.raw_stats?.wall_posts_fetched||0};window.selectedUser=u;if(typeof ZSModals!=='undefined'&&ZSModals.openOrder){var isFull=(d&&d.report_type==='full');ZSModals.openOrder(u,{tariff:isFull?'pro':'both',refresh:true});notice('success','Досье обновлено','Новые публичные данные и анализ сохранены.');}else location.href='/app';return}if(a==='delete'){if(confirm('Удалить досье? Оно исчезнет из личного и публичного разделов.')){await api(`/api/my/orders/${order.order_id}`,{method:'DELETE'});notice('info','Досье удалено','Отчёт удалён из «Моих досье».');setTimeout(()=>{location.href='/dossiers'},250)}return}if(a==='access')openAccess()}catch(e){notice('error','Не удалось выполнить действие','Попробуйте ещё раз.')}}
  function openAccess(){
    let selected=order.visibility||'private', shareUrl='';
    const icon={private:'v_lock',unlisted:'v_link',public:'v_globe'};
    const svg=name=>({v_lock:'<svg viewBox="0 0 448 512" fill="currentColor"><path d="M144 144v48h160v-48c0-44-36-80-80-80s-80 36-80 80zM80 192v-48C80 64 145 0 224 0s144 64 144 144v48h16c35 0 64 29 64 64v192c0 35-29 64-64 64H64c-35 0-64-29-64-64V256c0-35 29-64 64-64h16z"/></svg>',v_link:'<svg viewBox="0 0 640 512" fill="currentColor"><path d="M579.8 267.7c56.5-56.5 56.5-148 0-204.5-50-50-128.8-56.5-186.3-15.4l-1.6 1.1c-14.4 10.3-17.7 30.3-7.4 44.6s30.3 17.7 44.6 7.4l1.6-1.1c32.1-22.9 76-19.3 103.8 8.6 31.5 31.5 31.5 82.5 0 114L422.3 334.8c-31.5 31.5-82.5 31.5-114 0-27.9-27.9-31.5-71.8-8.6-103.8l1.1-1.6c10.3-14.4 6.9-34.4-7.4-44.6s-34.4-6.9-44.6 7.4l-1.1 1.6C206.5 251.2 213 330 263 380c56.5 56.5 148 56.5 204.5 0l112.3-112.3z"/></svg>',v_globe:'<svg viewBox="0 0 512 512" fill="currentColor"><path d="M0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256-192c-20 0-39 31-49 80h98c-10-49-29-80-49-80zm-64 80c8-38 22-70 40-91-50 10-91 47-111 91h71zm-71 64c-3 15-5 31-5 48s2 33 5 48h86c-2-15-3-31-3-48s1-33 3-48h-86zm0 160c20 44 61 81 111 91-18-21-32-53-40-91h-71zm135 80c20 0 39-31 49-80h-98c10 49 29 80 49 80zm64-80c-8 38-22 70-40 91 50-10 91-47 111-91h-71zm71-64c3-15 5-31 5-48s-2-33-5-48h-86c2 15 3 31 3 48s-1 33-3 48h86zm-71-160h71c-20-44-61-81-111-91 18 21 32 53 40 91z"/></svg>'})[name];
    const modal=document.createElement('div'); modal.className='zs-modal-bg';
    modal.innerHTML='<div class="zs-modal"><div class="zs-modal-inner"><div class="zs-modal-head"><div class="zs-modal-title">Поделиться и доступ</div><button class="zs-modal-x" type="button" aria-label="Закрыть">×</button></div><div class="zs-modal-body"></div></div></div>';
    document.body.append(modal);
    const close=()=>modal.remove();
    const render=()=>{const body=modal.querySelector('.zs-modal-body');body.innerHTML=`<div class="zs-modal-top"><div class="zs-group"><div class="zs-lab-row"><span class="zs-label">Доступ к досье</span></div><div class="zs-vis report-vis"><div class="zs-vis-ind"></div>${[['private','Только я'],['unlisted','По ссылке'],['public','Для всех']].map(([id,label])=>`<button type="button" data-vis="${id}" class="${selected===id?'on':''}">${svg(icon[id])}<span>${label}</span></button>`).join('')}</div></div><div class="report-share-panel ${selected==='private'?'hidden':''}"><div class="zs-label">Ссылка на досье</div><div class="report-share-row"><input readonly value="${shareUrl||location.href}"><button type="button">Копировать</button></div></div><div class="zs-err hidden" role="alert"></div></div><div class="zs-actions"><button class="zs-btn light report-save" type="button">Сохранить</button></div>`;body.querySelectorAll('[data-vis]').forEach(button=>button.onclick=()=>{selected=button.dataset.vis;render()});body.querySelector('.report-share-row button').onclick=()=>navigator.clipboard.writeText(body.querySelector('.report-share-row input').value);body.querySelector('.report-save').onclick=save;};
    const save=async()=>{const err=modal.querySelector('.zs-err');try{if(selected==='unlisted'){const x=await api(`/api/my/orders/${order.order_id}/share-link`,{method:'POST'});shareUrl=new URL(x.share_url,location.href).href;order.visibility='unlisted';notice('success','Ссылка готова','Доступ к досье открыт по ссылке.');render()}else{await api(`/api/my/orders/${order.order_id}/visibility`,{method:'PATCH',body:JSON.stringify({visibility:selected})});order.visibility=selected;notice('success','Доступ обновлён','Настройки видимости досье сохранены.');draw();close()}}catch(e){err.textContent='Не удалось сохранить настройки доступа. Попробуйте ещё раз.';err.classList.remove('hidden');notice('error','Не удалось сохранить доступ','Попробуйте ещё раз.')}};
    modal.querySelector('.zs-modal-x').onclick=close;modal.onclick=e=>{if(e.target===modal)close()};render();requestAnimationFrame(()=>modal.classList.add('open'));
  }

  /* ══ модалка автографа (zs-modal style) ══ */
  let sigModal=null;
  function openSignature(){
    if(!sigModal){
      sigModal=document.createElement('div');
      sigModal.className='zs-modal-bg';
      sigModal.innerHTML='<div class="zs-modal"><div class="zs-modal-inner"><div class="zs-modal-head"><div class="zs-modal-title">Автограф автора</div><button class="zs-modal-x" type="button"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="none"><path d="M16.45 4.55a.77.77 0 00-1.09 0L10.5 9.4 5.64 4.55a.77.77 0 10-1.09 1.09L9.4 10.5l-4.85 4.86a.77.77 0 101.09 1.09l4.86-4.86 4.86 4.86a.77.77 0 001.09-1.09L11.6 10.5l4.85-4.86a.77.77 0 000-1.09z" fill="currentColor"/></svg></button></div><div class="zs-modal-body"></div></div></div>';
      document.body.append(sigModal);
      sigModal.querySelector('.zs-modal-x').onclick=()=>sigModal.classList.remove('open');
      sigModal.onclick=e=>{if(e.target===sigModal)sigModal.classList.remove('open')};
    }
    const sigData=order.signature_data||'';
    const buyerId=order.buyer_id||'';
    const buyerName=order.buyer_name||(buyerId?('Lolzteam #'+buyerId):'Автор досье');
    const buyerAvatar=order.buyer_avatar||'';
    const avaHtml=buyerAvatar?`<img src="${buyerAvatar}" alt="">`:buyerName.charAt(0).toUpperCase();
    const created=order.created_at?new Date(order.created_at*1000).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}):'';
    const tariff=(order.report_type==='full')?'Pro':'Базовый';
    const dossierId=order.display_id||('ZS-'+String(order.order_id||'').slice(0,8).toUpperCase());
    const body=sigModal.querySelector('.zs-modal-body');
    if(!sigData){
      body.innerHTML='<div class="zs-modal-top"><div class="zs-group" style="align-items:center"><div class="zs-label" style="text-align:center;color:#5B5C62">Подпись не сохранена</div></div></div><div class="zs-actions"><button class="zs-btn light" id="sigDone">Готово</button></div>';
      sigModal.querySelector('#sigDone').onclick=()=>sigModal.classList.remove('open');
      sigModal.classList.add('open');
      return;
    }
    body.innerHTML=
      '<div class="zs-modal-top">'+
        '<div class="zs-group">'+
          '<div class="zs-user"><div class="zs-user-in">'+
            '<div class="zs-glow"></div>'+
            '<div class="zs-m-row">'+
              '<div class="zs-av">'+avaHtml+'</div>'+
              '<div class="zs-m-txt">'+
                '<div class="zs-m-name">'+buyerName+'</div>'+
                '<div class="zs-m-sub">Автор досье</div>'+
              '</div>'+
            '</div>'+
          '</div></div>'+
        '</div>'+
        '<div class="zs-group">'+
          '<div class="zs-lab-row"><span class="zs-label">Подпись</span></div>'+
          '<div class="zs-sig-display">'+
            '<img src="'+sigData+'" alt="подпись">'+
            '<div class="zs-sig-meta">'+
              '<span class="zs-sig-meta-lab"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" fill="#2BAD72"/><path d="M7 10l2 2 4-4" stroke="#161a1a" stroke-width="1.5" stroke-linecap="round"/></svg> Подпись сохранена</span>'+
              '<span class="zs-sig-meta-sub">Оставлена при создании досье</span>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div class="zs-group">'+
          '<div class="zs-meta-rows">'+
            '<div class="zs-meta-row"><span class="k">Дата</span><span class="v">'+(created||'—')+'</span></div>'+
            '<div class="zs-meta-sep"></div>'+
            '<div class="zs-meta-row"><span class="k">Тариф</span><span class="v">'+tariff+'</span></div>'+
            '<div class="zs-meta-sep"></div>'+
            '<div class="zs-meta-row"><span class="k">Досье</span><span class="v">'+dossierId+'</span></div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="zs-actions"><button class="zs-btn light" id="sigDone">Готово</button></div>';
    sigModal.querySelector('#sigDone').onclick=()=>sigModal.classList.remove('open');
    sigModal.classList.add('open');
  }
  const closeMenu=()=>{menu.classList.remove('open');dots.setAttribute('aria-expanded','false')};
  if(order.is_owner&&!_el('.hero-share')){const share=document.createElement('button');share.className='hero-share';share.type='button';share.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></svg><span>Поделиться</span>';share.onclick=openAccess;dots.before(share)}
  draw();dots.onclick=e=>{e.stopPropagation();pos();const open=!menu.classList.contains('open');menu.classList.toggle('open',open);dots.setAttribute('aria-expanded',String(open))};dots.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();dots.click()}if(e.key==='Escape')closeMenu()};document.addEventListener('click',e=>{if(!menu.contains(e.target))closeMenu()});
  const left=_el('.report-left');if(left&&!left.querySelector('.report-back')&&order.access!=='shared'){const b=document.createElement('button');b.className='report-back';b.type='button';b.setAttribute('aria-label','Назад');b.innerHTML='<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';b.onclick=()=>{if(history.length>1)history.back();else location.href=order.is_owner?'/dossiers':'/explore'};left.prepend(b)}
}


/* zelscan-report-header-back-override-v2 */
(()=>{
  const refresh=()=>document.querySelectorAll('.report-h .report-back').forEach(button=>{
    if (!button.querySelector('.fa-chevron-left')) button.innerHTML='<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>';
  });
  refresh();
  new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true});
})();
