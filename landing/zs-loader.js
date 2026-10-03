/* zs-loader.js — общий загрузчик данных для страниц отчёта Zelscan
   Подключается как <script src="zs-loader.js"></script> перед </body>
   Каждая страница вызывает zsLoad(renderFn) со своей функцией рендера.
   Если ?order= нет в URL — страница остаётся статичной (режим превью). */

const ZS_API = window.ZS_API || 'http://localhost:5050';
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
  const COLORS=['#22D3EE','#A78BFA','#FBBF24','#34D399','#F472B6'];
  let s=`<svg viewBox="0 0 436 411" width="436" height="411" style="max-width:100%">`;
  RADII.forEach(r => s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1A1A1A" stroke-width="1"/>`);
  // декоративные точки
  for(let i=0;i<8;i++){const a=i*45*Math.PI/180,r=RADII[2];s+=`<circle cx="${(cx+r*Math.cos(a)).toFixed(1)}" cy="${(cy+r*Math.sin(a)).toFixed(1)}" r="2.3" fill="#333"/>`;}

  const top=posters.slice(0,5);
  top.forEach((p,i) => {
    const a=(-90+i*72)*Math.PI/180;
    const r=i===0?RADII[0]:i<=2?RADII[1]:RADII[2];
    const px=cx+r*Math.cos(a), py=cy+r*Math.sin(a);
    const col=COLORS[i], sz=i===0?24:17, fs=i===0?18:13;
    const name=p.name||p.poster_name||'?';
    const lbl=name.length>12?name.slice(0,12)+'…':name;
    const letter=(name[0]||'?').toUpperCase();
    const ly=py-sz-10, my=ly-14;
    s+=`<line x1="${cx}" y1="${cy}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${i===0?col:'#242424'}" stroke-width="${i===0?1.5:1}"/>`;
    s+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${sz}" fill="#0E1518" stroke="${col}" stroke-width="${i===0?2:1.8}"/>`;
    s+=`<text x="${px.toFixed(1)}" y="${(py+fs*0.38).toFixed(1)}" fill="${col}" font-family="Inter" font-size="${fs}" font-weight="700" text-anchor="middle">${_esc(letter)}</text>`;
    s+=`<text x="${px.toFixed(1)}" y="${ly.toFixed(1)}" fill="#C9C9C9" font-family="Inter" font-size="12" font-weight="600" text-anchor="middle">${_esc(lbl)}</text>`;
    if(i===0) s+=`<text x="${px.toFixed(1)}" y="${my.toFixed(1)}" fill="#5E5E5E" font-family="Inter" font-size="10" text-anchor="middle">×${p.count} · ядро</text>`;
  });

  if(!top.length) s+=`<text x="${cx}" y="${cy-50}" fill="#555" font-family="Inter" font-size="13" text-anchor="middle">Стена пуста</text>`;

  // центр
  s+=`<circle cx="${cx}" cy="${cy}" r="30" fill="#EDEDED"/>`;
  s+=`<text x="${cx}" y="${cy+5}" fill="#0A0A0A" font-family="Inter" font-size="14" font-weight="800" text-anchor="middle">Он</text>`;
  return s+'</svg>';
}

// ── Mosaic (13×8 = 104 клетки, тональность) ─────────────────
// emotion.*_pct — целые % (0-100), не дроби
function mosaicSVG(emotion) {
  const TOTAL=104, W=13, H=8, CELL=30, GAP=7;
  const toxicN  = Math.round(_clamp((emotion.toxic_pct||0)/100,0,1)*TOTAL);
  const posN    = Math.round(_clamp((emotion.positive_pct||0)/100,0,1)*TOTAL);
  const cells   = Array(TOTAL).fill('#242424');
  for(let i=0;i<toxicN;i++)   cells[i]='#EF4444';
  for(let i=toxicN;i<toxicN+posN&&i<TOTAL;i++) cells[i]='#34D399';
  // shuffle
  for(let i=TOTAL-1;i>0;i--){const j=Math.floor(Math.abs(Math.sin(i*137.5))*i);[cells[i],cells[j]]=[cells[j],cells[i]];}
  let s=`<svg viewBox="0 0 ${W*(CELL+GAP)-GAP} ${H*(CELL+GAP)-GAP}" width="100%" style="max-width:${W*(CELL+GAP)}px">`;
  cells.forEach((c,n)=>{
    const col=n%W, row=Math.floor(n/W);
    s+=`<rect x="${col*(CELL+GAP)}" y="${row*(CELL+GAP)}" width="${CELL}" height="${CELL}" rx="7" fill="${c}"/>`;
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
  var score=Math.round((p+m+n)/30*100);

  var finalEdges=[FAN_Y0]; var cur=FAN_Y0;
  for(var i=0;i<bands.length;i++){cur-=bands[i][0]/total*span;finalEdges.push(cur);}
  var finalTop=finalEdges[finalEdges.length-1];

  var s='';
  for(var k=0;k<9;k++){var tx=FAN_X0+(FAN_W-FAN_X0)*k/8;s+='<line x1="'+tx.toFixed(1)+'" y1="'+FAN_Y0+'" x2="'+tx.toFixed(1)+'" y2="'+(FAN_Y0+6)+'" stroke="#222" stroke-width="1"/>';}
  for(i=0;i<bands.length;i++){s+='<polygon id="fanP'+i+'" points="'+FAN_X0+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+'" fill="'+bands[i][1]+'" fill-opacity="0.9"/>';}
  s+='<polygon id="fanCap" points="'+FAN_X0+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+' '+FAN_W+','+FAN_Y0+'" fill="#ffffff" fill-opacity="0.07"/>';
  var dx=FAN_X0+(FAN_W-FAN_X0)*0.80;
  s+='<line id="fanDash" x1="'+dx.toFixed(1)+'" y1="'+FAN_Y0+'" x2="'+dx.toFixed(1)+'" y2="'+FAN_Y0+'" stroke="#9A9A9A" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>';
  s+='<g id="fanBadge" opacity="0"><rect x="'+(dx-32).toFixed(1)+'" y="12" width="64" height="22" rx="6" fill="#161616" stroke="#262626"/>';
  s+='<text x="'+dx.toFixed(1)+'" y="23" fill="#EBEBEB" font-family="Inter" font-size="12" font-weight="600" text-anchor="middle" dominant-baseline="central" id="fanScore">0/100</text></g>';
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
    if(t>0.55){var dk=_easeOutCubic(Math.min((t-0.55)/0.35,1));var dash=svg.querySelector('#fanDash');if(dash){dash.setAttribute('opacity',String(dk));var yt=FAN_Y0+(curTop-FAN_Y0)*(dx-FAN_X0)/(FAN_W-FAN_X0);dash.setAttribute('y2',yt.toFixed(1));}}
    if(t>0.72){var bk=Math.min((t-0.72)/0.2,1);var bg=svg.querySelector('#fanBadge');if(bg){bg.setAttribute('opacity',String(bk));var yt2=FAN_Y0+(curTop-FAN_Y0)*(dx-FAN_X0)/(FAN_W-FAN_X0);var by=Math.max(yt2-30,12);var rect=bg.querySelector('rect');var txt=bg.querySelector('text');if(rect)rect.setAttribute('y',by.toFixed(1));if(txt)txt.setAttribute('y',(by+11).toFixed(1));var sc=svg.querySelector('#fanScore');if(sc)sc.textContent=Math.round(score*bk)+'/100';}}
    if(t<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return svg.outerHTML;
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
  if(newBtn) newBtn.onclick=()=>window.location.href='zelscan_dashboard.html';
}

// ── сохраняем контекст отчёта во всех вкладках ─────────────
function zsPropagateContext() {
  const current=new URLSearchParams(location.search), next=new URLSearchParams();
  for(const key of ['order','public','share'])if(current.get(key))next.set(key,current.get(key));
  const query=next.toString(); if(!query)return;
  _els('.tab[href]').forEach(el=>{const base=el.getAttribute('href').split('?')[0];el.href=`${base}?${query}`});
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
    const r=await fetch(url,{headers,credentials:'include'});
    if(!r.ok) return;
    const order=await r.json();
    if(order.status!=='done'||!order.result) return;

    const safeResult=_zsSanitize(order.result);
    ZS.order=order;
    ZS.data=safeResult;

    zsCommon(safeResult, order);
    renderFn(safeResult, order);
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
  const modal=document.createElement('div');modal.className='report-modal';modal.innerHTML='<div class="report-sheet"><button class="report-close">×</button><div class="report-modal-body"></div></div>';document.body.append(modal);
  const icons={share:'<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><path d="m8 11 8-5M8 13l8 5"/></svg>',copy:'<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',refresh:'<svg viewBox="0 0 24 24"><path d="M20 6v5h-5"/><path d="M18.5 15a7 7 0 1 1-.7-7.8L20 11"/></svg>',external:'<svg viewBox="0 0 24 24"><path d="M14 5h5v5"/><path d="M10 14 19 5"/><path d="M19 14v5H5V5h5"/></svg>',trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>'};
  const notice=(type,title,message)=>{if(window.ZSNotice&&typeof window.ZSNotice.show==='function')window.ZSNotice.show({type,title,message});};
  const api=async(path,opt={})=>{const t=localStorage.getItem('lzt_token')||'',r=await fetch(ZS_API+path,{...opt,credentials:opt.credentials||'include',headers:{'Content-Type':'application/json',...(t?{Authorization:`Bearer ${t}`}:{}) ,...(opt.headers||{})}}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error('request_failed');return j};
  const pos=()=>{const r=dots.getBoundingClientRect(),w=230;menu.style.left=Math.min(innerWidth-w-12,Math.max(12,r.right-w))+'px';menu.style.top=Math.min(innerHeight-250,r.bottom+8)+'px'};
  const item=(label,act,icon,cls='')=>`<button type="button" role="menuitem" data-act="${act}" class="${cls}">${icons[icon]}<span>${label}</span></button>`;
  function draw(){const own=[item('Поделиться и доступ','access','share'),item('Копировать ссылку','copy','copy'),item('Обновить досье','refresh','refresh'),item('Открыть профиль LZT','profile','external'),'<div class="menu-sep"></div>',item('Удалить досье','delete','trash','danger')];const guest=[item('Копировать ссылку','copy','copy'),item('Открыть профиль LZT','profile','external')];menu.innerHTML=(order.is_owner?own:guest).join('');menu.querySelectorAll('button').forEach(b=>b.onclick=()=>act(b.dataset.act))}
  async function act(a){closeMenu();try{if(a==='copy'){await navigator.clipboard.writeText(location.href);notice('success','Ссылка скопирована','Её можно отправить человеку, которому вы хотите открыть доступ.');return}if(a==='profile'){open('https://lolz.live/members/'+(d.card?.user_id||order.user_id)+'/','_blank');return}if(a==='refresh'){var u={user_id:d.card?.user_id||order.user_id,username:d.card?.username||'',avatar:d.card?.avatar||'',message_count:d.raw_stats?.message_count||d.raw_stats?.posts_fetched||0,thread_count:d.raw_stats?.threads_fetched||0,wall_count:d.raw_stats?.wall_posts_fetched||0};window.selectedUser=u;if(window.ZSModals&&ZSModals.openOrder){ZSModals.openOrder(u);notice('success','Досье обновлено','Новые публичные данные и анализ сохранены.');}else location.href='zelscan_dashboard.html';return}if(a==='delete'){if(confirm('Удалить досье? Оно исчезнет из личного и публичного разделов.')){await api(`/api/my/orders/${order.order_id}`,{method:'DELETE'});notice('info','Досье удалено','Отчёт удалён из «Моих досье».');setTimeout(()=>{location.href='my_dossiers.html'},250)}return}if(a==='access')openAccess()}catch(e){notice('error','Не удалось выполнить действие','Попробуйте ещё раз.')}}
  function openAccess(){const v=order.visibility||'private';modal.querySelector('.report-modal-body').innerHTML=`<h2>Доступ к досье</h2><p>Выберите, кто сможет просматривать отчёт.</p><label><input type="radio" name="vis" value="private" ${v==='private'?'checked':''}> Только я</label><label><input type="radio" name="vis" value="unlisted" ${v==='unlisted'?'checked':''}> Все, у кого есть ссылка</label><label><input type="radio" name="vis" value="public" ${v==='public'?'checked':''}> Опубликовать для всех</label><button class="report-save">Сохранить доступ</button><div class="share-output"></div>`;modal.classList.add('open');modal.querySelector('.report-save').onclick=async()=>{const vis=modal.querySelector('[name=vis]:checked').value;try{if(vis==='unlisted'){const x=await api(`/api/my/orders/${order.order_id}/share-link`,{method:'POST'});order.visibility='unlisted';notice('success','Ссылка готова','Доступ к досье открыт по ссылке.');modal.querySelector('.share-output').innerHTML=`<span>Ссылка готова</span><button class="copy-share">Копировать</button>`;modal.querySelector('.copy-share').onclick=async()=>{try{await navigator.clipboard.writeText(new URL(x.share_url,location.href).href);notice('success','Ссылка скопирована','Её можно отправить человеку, которому вы хотите открыть доступ.')}catch(e){notice('error','Не удалось скопировать ссылку','Попробуйте ещё раз.')}}}else{await api(`/api/my/orders/${order.order_id}/visibility`,{method:'PATCH',body:JSON.stringify({visibility:vis})});order.visibility=vis;notice('success','Доступ обновлён','Настройки видимости досье сохранены.');modal.classList.remove('open')}draw()}catch(e){modal.querySelector('.share-output').textContent='Не удалось сохранить настройки доступа. Попробуйте ещё раз.';notice('error','Не удалось сохранить доступ','Попробуйте ещё раз.')}}}
  const closeMenu=()=>{menu.classList.remove('open');dots.setAttribute('aria-expanded','false')};draw();dots.onclick=e=>{e.stopPropagation();pos();const open=!menu.classList.contains('open');menu.classList.toggle('open',open);dots.setAttribute('aria-expanded',String(open))};dots.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();dots.click()}if(e.key==='Escape')closeMenu()};document.addEventListener('click',e=>{if(!menu.contains(e.target))closeMenu()});modal.querySelector('.report-close').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')};
  const left=_el('.report-left');if(left&&!left.querySelector('.report-back')&&order.access!=='shared'){const b=document.createElement('button');b.className='report-back';b.type='button';b.setAttribute('aria-label','Назад');b.innerHTML='<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';b.onclick=()=>{if(history.length>1)history.back();else location.href=order.is_owner?'my_dossiers.html':'public_dossiers.html'};left.prepend(b)}
}



/* zelscan-report-menu-fa-icons-v1 */
(function(){
  const menuIconMap = [
    [/Поделиться и доступ/i, 'fa-share-nodes'],
    [/Автограф автора/i, 'fa-signature'],
    [/Обновить досье/i, 'fa-arrows-rotate'],
    [/Открыть профиль LZT/i, 'fa-arrow-up-right-from-square'],
    [/Удалить досье/i, 'fa-trash-can']
  ];
  function applyReportMenuIcons(menu){
    if (!menu || menu.dataset.zsFaIcons === '1') return;
    menu.querySelectorAll('button,a[role="menuitem"]').forEach(function(item){
      const found = menuIconMap.find(function(pair){ return pair[0].test(item.textContent || ''); });
      if (!found) return;
      item.querySelectorAll('svg,.ic').forEach(function(oldIcon){ oldIcon.remove(); });
      const iconHost = document.createElement('span');
      iconHost.className = 'ic';
      iconHost.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('i');
      icon.className = 'fa-solid ' + found[1];
      iconHost.appendChild(icon);
      item.prepend(iconHost);
    });
    menu.dataset.zsFaIcons = '1';
  }
  new MutationObserver(function(){
    document.querySelectorAll('.report-menu').forEach(applyReportMenuIcons);
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('.report-menu').forEach(applyReportMenuIcons);
})();


/* zelscan-report-menu-exact-test-icons-v2 — exact icon map and row markup from report-menu-variants-test.html */
(function(){
  const exactTestIcons = [
    [/Поделиться и доступ/i, 'fa-share-nodes'],
    [/Автограф автора/i, 'fa-signature'],
    [/Обновить досье/i, 'fa-arrows-rotate'],
    [/Открыть профиль LZT/i, 'fa-arrow-up-right-from-square'],
    [/Удалить досье/i, 'fa-trash-can']
  ];
  function rebuildExactTestRows(menu){
    if (!menu) return;
    menu.querySelectorAll('button,a[role="menuitem"]').forEach(function(row){
      const label = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const pair = exactTestIcons.find(function(item){ return item[0].test(label); });
      if (!pair || row.dataset.zsExactTestIcon === pair[1]) return;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'ic';
      iconWrap.setAttribute('aria-hidden', 'true');
      const icon = document.createElement('i');
      icon.className = 'fa-solid ' + pair[1];
      iconWrap.appendChild(icon);
      const text = document.createElement('span');
      text.textContent = label;
      row.replaceChildren(iconWrap, text);
      row.dataset.zsExactTestIcon = pair[1];
    });
  }
  new MutationObserver(function(){
    document.querySelectorAll('.report-menu').forEach(rebuildExactTestRows);
  }).observe(document.documentElement, {childList:true, subtree:true});
  document.querySelectorAll('.report-menu').forEach(rebuildExactTestRows);
})();
