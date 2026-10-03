zsLoad(function(d) {
  const p   = d.portrait        || {};
  const am  = d.admit_mistakes  || {};
  const emp = d.empathy         || {};
  const v   = d.verdict         || {};
  const ai  = d.ai_analysis     || {};
  const aiL = ai.lite?.parsed   || {};
  const aiM = ai.max?.parsed    || {};
  const aiP = ai.psychologist?.parsed || {};
  const b5  = aiP.big_five      || {};

  // ── базовые метрики ──
  const conflict  = p.conflict?.score   || 0;
  const confScore = p.confidence?.score || 0;
  const egoScore  = _clamp(p.ego?.per_100 || 0, 0, 10);
  const empCount  = emp.count || 0;
  const posts     = d.raw_stats?.posts_fetched || 100;
  const empScore  = Math.min(10, empCount/posts*100*2);
  const stub      = am.count===0 ? 10 : Math.round(10 - am.count/posts*100);
  const toxPct    = p.emotion?.toxic_pct    || 0;
  const posPct    = p.emotion?.positive_pct || 0;
  const trustIdx  = _clamp(Math.round(100 - conflict*6 - toxPct*0.5 + confScore*0.1 + empScore*2), 0, 100);

  // ── 1. Aurora verdict hero ──
  const titleEl = _el('[style*="font-size:44px"]');
  // Заголовок и подпись AI-блока запоминаем: другие блоки страницы не должны
  // повторять тот же текст (портрет и hero часто пишут об одном и том же).
  let aiHeadline = '', aiSubline = '';
  if (titleEl) {
    const tagsDiv = titleEl.parentElement.firstElementChild;
    const traits  = aiL.key_traits || [];
    if (tagsDiv && traits.length)
      tagsDiv.innerHTML = traits.map(t=>`<span class="tag">${_esc(t)}</span>`).join('');
    // Блок «Сделано с помощью ИИ» не имеет права повторять шапку отчёта:
    // v.summary — это то же «Описание» сверху, поэтому в фолбэке не участвует.
    const _norm = s => String(s || '').toLowerCase().replace(/[\s.,!?«»"']+/g, ' ').trim();
    const heroSummary = _norm(v.summary);
    const aiCandidates = [
      aiM.verdict_one_line,
      aiP.summary_one_line,
      String(aiL.psychological_portrait || '').split(/(?<=[.!?])\s/)[0]
    ].map(s => String(s || '').trim()).filter(Boolean);
    const aiTitle = aiCandidates.find(s => _norm(s) !== heroSummary) || '';
    aiHeadline = aiTitle;
    titleEl.textContent = aiTitle;
    if (!aiTitle) titleEl.style.display = 'none';
    const subEl = titleEl.nextElementSibling;
    if (subEl) {
      aiSubline = aiM.hidden_signals || '';
      subEl.textContent = aiSubline;
      if (!aiSubline) subEl.style.display = 'none';
    }
  }

  // ── 2. Score badge ──
  const badge = _el('.an-scorebadge');
  if (badge) badge.innerHTML = `<b style="font-weight:500">${trustIdx}</b>/100 индекс доверия`;

  // ── 3. LED bars (цвет = значение и полярность оси) ──
  const sarcasmScore = Math.min(10, Math.round(toxPct*0.5 + conflict*0.3));
  const secrecyScore = Math.min(10, Math.round(10 - (p.stats?.avg_words_per_post||5)/10*3));
  const warmth       = Math.min(10, Math.round(empScore + posPct/100*50));
  const openness     = Math.min(10, Math.round(posPct/100*50 + confScore/20));
  function ledRow(label, val10, positive) {
    const n = _clamp(Math.round(val10), 0, 10);
    const color = positive ? (n>=7?'#34D399':n>=4?'#F59E0B':'#EF4444')
                           : (n>=7?'#EF4444':n>=4?'#F59E0B':'#34D399');
    const bars = Array(10).fill(0).map((_,i)=>
      `<span style="flex:1;height:14px;border-radius:2px;background:${i<n?color:'#1E1E1E'}"></span>`
    ).join('');
    return `<div class="an-ledrow"><span class="an-ln">${label}</span><div style="display:flex;gap:3px;flex:1">${bars}</div><span class="an-lv" style="color:${color}">${n}</span></div>`;
  }
  function ledSep(text, top) {
    return `<div style="display:flex;align-items:center;gap:12px;margin-top:${top||10}px;margin-bottom:4px"><span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#4A4A4A;white-space:nowrap">${text}</span><div style="flex:1;height:1px;background:#161616"></div></div>`;
  }
  const ledSection = _el('.an-ledrow')?.parentElement;
  if (ledSection) {
    ledSection.innerHTML = [
      ledSep('Негативные приёмы', 0),
      ledRow('Провокация', conflict),
      ledRow('Скрытность', secrecyScore),
      ledRow('Сарказм',    sarcasmScore),
      ledRow('Упёртость',  stub),
      ledSep('Позитивные приёмы', 30),
      ledRow('Теплота',    warmth,  true),
      ledRow('Открытость', openness, true),
    ].join('');
  }

  // ── 4. Trust index gauge (half-circle SVG, center=160,150 r=120) ──
  const tAngle = (180 + (trustIdx/100)*180) * Math.PI/180;
  const tx = (160 + 120*Math.cos(tAngle)).toFixed(1);
  const ty = (150 + 120*Math.sin(tAngle)).toFixed(1);
  const gaugeSvgs = _els('.arow .acard svg');
  const gaugeSvg  = gaugeSvgs[0];
  if (gaugeSvg) {
    const paths = gaugeSvg.querySelectorAll('path');
    if (paths[1]) paths[1].setAttribute('d', `M40.0,150.0 A120,120 0 0 1 ${tx},${ty}`);
    gaugeSvg.querySelectorAll('circle').forEach(c=>{c.setAttribute('cx',tx);c.setAttribute('cy',ty);});
    const gtexts = gaugeSvg.querySelectorAll('text');
    if (gtexts[0]) gtexts[0].innerHTML = `${trustIdx}<tspan font-size="13" fill="#5E5E5E">/100</tspan>`;
    const lbl = trustIdx>66?'надёжно':trustIdx>33?'умеренно':'опасно';
    if (gtexts[1]) { gtexts[1].textContent = lbl; gtexts[1].setAttribute('fill', trustIdx>66?'#34D399':trustIdx>33?'#F59E0B':'#EF4444'); }
    const stops = gaugeSvg.querySelectorAll('#gAN stop');
    const gc = trustIdx>66?['#1F9D74','#34D399']:trustIdx>33?['#B45309','#F59E0B']:['#B91C1C','#EF4444'];
    if (stops[0]) stops[0].setAttribute('stop-color', gc[0]);
    if (stops[1]) stops[1].setAttribute('stop-color', gc[1]);
  }

  // ── 5. Trust zone strip ──
  const tzRoot = _el('.tz-root');
  if (tzRoot) {
    const knob = tzRoot.querySelector('.tz-knob');
    if (knob) knob.style.left = `calc(${trustIdx}% - 10px)`;
    const callout = tzRoot.querySelector('.tz-callout');
    if (callout) {
      callout.style.left = `${trustIdx}%`;
      const col    = trustIdx>66?'#34D399':trustIdx>33?'#F59E0B':'#EF4444';
      const colRgb = trustIdx>66?'52,211,153':trustIdx>33?'245,158,11':'239,68,68';
      const bubble = callout.querySelector('.tz-bubble');
      if (bubble) {
        bubble.style.borderColor = `rgba(${colRgb},.35)`;
        bubble.style.background  = `rgba(${colRgb},.08)`;
        bubble.innerHTML = `<span style="color:${col};font-size:13px;font-weight:500;letter-spacing:-.01em">${trustIdx}</span><span style="color:${col};font-size:10px;opacity:.7">/100</span>`;
      }
      const stem = callout.querySelector('.tz-stem');
      if (stem) stem.style.background = `linear-gradient(to bottom,${col},transparent)`;
    }
    const activeZone=trustIdx>66?2:trustIdx>33?1:0;
    tzRoot.querySelectorAll('.tz-labels>div').forEach((zone,index)=>{
      const dot=zone.children[0],label=zone.children[1];
      const active=index===activeZone;
      const color=index===0?'#EF4444':index===1?'#F59E0B':'#34D399';
      if(dot){dot.style.background=active?color:'#222';dot.style.boxShadow=active?`0 0 7px ${color}`:'none';}
      if(label){label.style.color=active?color:'#2E2E2E';label.style.fontWeight=active?'500':'400';}
    });
  }

  // ── 6. Useful / Dangerous ──
  const usefulUl = _el('.ud.good ul');
  if (usefulUl && v.useful_for?.length)
    usefulUl.innerHTML = v.useful_for.map(u=>`<li>${_esc(String(u).replace(/\uFFFD/g,''))}</li>`).join('');
  const dangerUl = _el('.ud.bad ul');
  if (dangerUl && v.dangerous_for?.length)
    dangerUl.innerHTML = v.dangerous_for.map(u=>`<li>${_esc(String(u).replace(/\uFFFD/g,''))}</li>`).join('');

  // ── 7. Radar chart (big_five, иначе — фоллбэк на базовые метрики) ──
  const _mScore = k => (p.manner?.scores?.[k] || 0);
  const hasB5 = b5.openness != null;
  const o=hasB5?(b5.openness||5):5, c=hasB5?(b5.conscientiousness||5):5,
        e=hasB5?(b5.extraversion||5):5, a=hasB5?(b5.agreeableness||5):5, n=hasB5?(b5.neuroticism||5):5;
  const axVals = hasB5 ? [
    _clamp(Math.round(n*0.5+(10-a)*0.5), 1, 10),
    _clamp(Math.round(n*0.4+o*0.3+(10-a)*0.3), 1, 10),
    _clamp(Math.round((10-e)*0.6+n*0.4), 1, 10),
    _clamp(Math.round(o*0.6+c*0.4), 1, 10),
    _clamp(Math.round(c*0.6+(10-n)*0.4), 1, 10),
    _clamp(Math.round(a*0.6+e*0.4), 1, 10),
    _clamp(Math.round(e*0.5+a*0.3+(10-n)*0.2), 1, 10),
    _clamp(Math.round(o*0.4+n*0.3+(10-c)*0.3), 1, 10),
    _clamp(Math.round(a*0.5+(10-n)*0.5), 1, 10),
  ] : [
    _clamp(Math.round(conflict), 1, 10),                                    // Провокация
    _clamp(Math.round(sarcasmScore), 1, 10),                                // Сарказм
    _clamp(Math.round(secrecyScore), 1, 10),                                // Скрытность
    _clamp(Math.round(_mScore('разбирается')/Math.max(1,posts)*10), 1, 10), // Знание темы
    _clamp(Math.round(confScore/10), 1, 10),                                // Чёткость
    _clamp(Math.round(empScore), 1, 10),                                    // Помощь
    _clamp(Math.round(openness), 1, 10),                                    // Свойскость
    _clamp(Math.round(sarcasmScore), 1, 10),                                // Ирония
    _clamp(Math.round(warmth), 1, 10),                                      // Теплота
  ];
  const rSvg = gaugeSvgs[1];
  if (rSvg) {
    const CX=170, CY=155, MAXR=110;
    function rpt(ai, val) {
      const ang=(-90+ai*40)*Math.PI/180, r=val/10*MAXR;
      return `${(CX+r*Math.cos(ang)).toFixed(1)},${(CY+r*Math.sin(ang)).toFixed(1)}`;
    }
    const groups=[[0,1,2],[3,4,5],[6,7,8]];
    const polys=rSvg.querySelectorAll('polygon');
    const circs=rSvg.querySelectorAll('circle');
    groups.forEach((axs,gi)=>{
      if (polys[gi+3]) polys[gi+3].setAttribute('points', axs.map(ai=>rpt(ai,axVals[ai])).join(' '));
      axs.forEach((ai,ci)=>{
        const ang=(-90+ai*40)*Math.PI/180, r=axVals[ai]/10*MAXR;
        const idx=gi*3+ci;
        if (circs[idx]) {
          circs[idx].setAttribute('cx',(CX+r*Math.cos(ang)).toFixed(1));
          circs[idx].setAttribute('cy',(CY+r*Math.sin(ang)).toFixed(1));
        }
      });
    });

    /* ── ховер: вершины (тултип) и грани (подсветка) ── */
    const AXN=['Провокация','Сарказм','Скрытность','Знание темы','Чёткость','Помощь','Свойскость','Ирония','Теплота'];
    const card=rSvg.closest('.acard');
    if (card) {
      card.style.position='relative';
      const rtip=document.createElement('div');rtip.className='tip';card.appendChild(rtip);
      const dataPolys=[polys[3],polys[4],polys[5]];
      dataPolys.forEach(pl=>{if(pl){pl.style.transition='opacity .2s,fill-opacity .2s';pl.style.cursor='pointer';}});
      function highlight(gi){
        dataPolys.forEach((pl,j)=>{
          if(!pl)return;
          if(gi===null){pl.style.opacity=1;pl.setAttribute('stroke-width','1.5');pl.style.fillOpacity='0.12';}
          else if(gi===j){pl.style.opacity=1;pl.setAttribute('stroke-width','2.5');pl.style.fillOpacity='0.26';}
          else{pl.style.opacity=0.22;}
        });
      }
      function svgToCard(cx,cy){
        const sr=rSvg.getBoundingClientRect(),cr=card.getBoundingClientRect();
        return{x:sr.left-cr.left+cx/340*sr.width,y:sr.top-cr.top+cy/320*sr.height};
      }
      dataPolys.forEach((pl,j)=>{
        if(!pl)return;
        pl.addEventListener('mouseenter',()=>highlight(j));
        pl.addEventListener('mouseleave',()=>highlight(null));
      });
      circs.forEach((cc,i)=>{
        cc.style.cursor='pointer';
        cc.style.transition='r .15s';
        cc.addEventListener('mouseenter',()=>{
          const gi=Math.floor(i/3);
          highlight(gi);
          cc.setAttribute('r','5.5');
          const pos=svgToCard(+cc.getAttribute('cx'),+cc.getAttribute('cy'));
          rtip.innerHTML='<b>'+AXN[i]+'</b><s>'+axVals[i]+' / 10</s>';
          rtip.style.left=pos.x+'px';rtip.style.top=pos.y+'px';rtip.style.opacity=1;
        });
        cc.addEventListener('mouseleave',()=>{
          highlight(null);
          cc.setAttribute('r','3');
          rtip.style.opacity=0;
        });
      });
      const legend=card.querySelector('div[style*="gap:18px"]');
      if(legend){
        [...legend.children].forEach((sp,j)=>{
          if(j>2)return;
          sp.style.cursor='pointer';sp.style.transition='opacity .2s';
          sp.addEventListener('mouseenter',()=>highlight(j));
          sp.addEventListener('mouseleave',()=>highlight(null));
        });
      }
    }
  }

  // ── 8. Психологический портрет ──
  // Семантическая близость текстов: доля общих «содержательных» слов.
  // Стемминг-обрезка ловит словоформы: «сарказмом»/«саркастическим» → «сарка».
  const _tok = s => (String(s || '').toLowerCase().match(/[а-яёa-z]{4,}/g) || [])
    .map(w => w.length > 5 ? w.slice(0, 5) : w);
  const _sim = (a, b) => {
    const A = new Set(_tok(a)), B = new Set(_tok(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size);
  };
  const archTypes = (aiP.personality_types?.length ? aiP.personality_types : (p.archetypes || []));
  // Заголовок портрета пишет только ИИ (portrait_headline — 2–4 ёмких слова).
  // Склейка архетипов («По делу шарит») и длинные summary_one_line запрещены:
  // если AI-заголовка нет или он дублирует hero — заголовок просто скрыт.
  let archTitle = String(aiP.portrait_headline || '').trim();
  // Отбраковка склеек типажей («Саркастичный Шарит», «По делу Шарит»):
  // нормальная фраза-кличка пишется с одной заглавной — первой.
  const _glued = (() => {
    const words = archTitle.split(/\s+/).filter(Boolean);
    return words.length > 1 && words.slice(1).some(w => /^[А-ЯЁA-Z]/.test(w));
  })();
  if (!archTitle || _glued ||
      archTitle.split(/\s+/).length > 5 || _sim(archTitle, aiHeadline) > 0.6)
    archTitle = '';
  const archEl = _el('.an-arch');
  if (archEl) {
    if (archTitle) archEl.textContent = archTitle;
    else archEl.style.display = 'none';
  }
  const adescEl = _el('.an-adesc');
  let adescText = String(aiP.manner_description || p.manner?.description || '').trim();
  // Описание портрета не должно пересказывать AI-hero: если похоже —
  // пробуем алгоритмическое описание манеры, иначе скрываем строку.
  if (adescText && (_sim(adescText, aiHeadline) > 0.6 || _sim(adescText, aiSubline) > 0.6))
    adescText = String(p.manner?.description || '').trim();
  if (adescEl) {
    if (adescText && _sim(adescText, aiHeadline) <= 0.6) adescEl.textContent = adescText;
    else adescEl.style.display = 'none';
  }
  const chipsEl = _el('.an-chips');
  if (chipsEl && archTypes.length) {
    const chipCols = ['#EF4444','#F59E0B','#22D3EE','#34D399'];
    chipsEl.innerHTML = archTypes.slice(0,3).map((t,i)=>
      `<span class="an-chip"><i style="background:${chipCols[i%chipCols.length]}"></i>${_esc(t)}</span>`
    ).join('');
  }

  // ── 9. Ring maturity (две дуги с зазором, r=39) ──
  const maturity = _clamp(Math.round(100 - stub*5 - conflict*3 + empScore*4), 0, 100);
  const ringbox = _el('.an-ringbox');
  if (ringbox) {
    const R9=39, C=2*Math.PI*R9, gap=26;
    const col=maturity>60?'#34D399':maturity>35?'#F59E0B':'#EF4444';
    const colLen=Math.max(4,C*maturity/100-gap/2), greyLen=Math.max(4,C-colLen-gap);
    const greyRotate=-90+360*(colLen+gap/2)/C;
    const svg=ringbox.querySelector('[data-mat-ring]');
    if (svg) svg.innerHTML=`<circle cx="46" cy="46" r="${R9}" fill="none" stroke="#2a2a2a" stroke-width="7" stroke-linecap="round" stroke-dasharray="${greyLen.toFixed(1)} ${(C-greyLen).toFixed(1)}" transform="rotate(${greyRotate.toFixed(1)} 46 46)"/><circle cx="46" cy="46" r="${R9}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${colLen.toFixed(1)} ${(C-colLen).toFixed(1)}" transform="rotate(-90 46 46)"/>`;
    const numEl=ringbox.querySelector('.an-rn');
    if (numEl) { numEl.textContent=maturity; numEl.style.color=col; }
  }

  // ── 10. Оси характера ──
  const axCap = _el('.an-axcap');
  if (axCap) {
    // заметка оси — короткая, максимум 3 слова (отрезаем « — длинное пояснение»)
    const _note3 = s => { const s0=String(s||'').trim(); const first=(s0.split(/\s+[—-]\s+/)[0]||s0); return first.split(/\s+/).slice(0,3).join(' '); };
    const axes = [
      {n:'Упёртость',    v:stub,         c:'#EF4444', note:`${am.count} признаний ошибок`},
      {n:'Конфликтность',v:conflict,     c:'#EF4444', note:_note3(p.conflict?.verdict)},
      {n:'Саморегуляция',v:10-conflict,  c:'#34D399', note:'самоконтроль'},
      {n:'Эмпатия',      v:empScore,     c:'#F59E0B', note:`${empCount} из ${posts} постов`},
      {n:'Эго',          v:egoScore,     c:'#22D3EE', note:`${(p.ego?.per_100||0).toFixed(2)} я/100 слов`},
      {n:'Уверенность',  v:confScore/10, c:'#F59E0B', note:`${confScore}% формулировок`},
    ].sort((a,b)=>b.v-a.v);
    _els('.an-ax').forEach((el,i)=>{
      if (!axes[i]) return;
      const ax=axes[i];
      el.querySelector('.an-ax-n').textContent=ax.n;
      const tkI=el.querySelector('.an-ax-tk i');
      tkI.style.width=`${Math.round(ax.v/10*100)}%`; tkI.style.background=ax.c;
      const vEl=el.querySelector('.an-ax-v');
      vEl.style.color=ax.c; vEl.innerHTML=`${Math.round(ax.v)}<i>/10</i>`;
      const uEl=el.querySelector('.an-ax-u');
      if (uEl) uEl.textContent=ax.note;
    });
  }

  // ── 11. Вердикт-карточка: полутоновый силуэт с зонами нагрева ──
  const _v4wrap = _el('.v4wrap');
  if (_v4wrap && _v4wrap.firstChild) {
    const _BW=300, _BH=340;
    const AXES={
      'Упёртость':{c:'#F59E0B'},
      'Конфликтность':{c:'#EF4444'},
      'Саморегуляция':{c:'#22D3EE'},
      'Эмпатия':{c:'#34D399'},
      'Эго':{c:'#A78BFA'},
      'Уверенность':{c:'#D5DE58'}
    };
    const axVals={'Упёртость':stub,'Конфликтность':conflict,'Саморегуляция':Math.max(0,10-conflict),'Эмпатия':empScore,'Эго':egoScore,'Уверенность':confScore/10};
    const AX=k=>axVals[k]!=null?axVals[k]:5;
    const CLR=k=>(AXES[k]||{c:'#34D399'}).c;
    const nrm=v=>Math.max(0,Math.min(1,v/10));
    const hexRgb=h=>{const n=parseInt(h.slice(1),16);return[n>>16&255,n>>8&255,n&255];};
    const zones=[
      {n:'Саморегуляция',x:150,y:84,r:64},
      {n:'Конфликтность',x:150,y:134,r:38},
      {n:'Уверенность',x:150,y:198,r:48},
      {n:'Эмпатия',x:150,y:264,r:98}
    ];
    const BUST='M150,42 C176,42 196,64 196,92 C196,116 186,134 172,144 L172,160 C172,168 178,174 190,180 C232,198 262,214 276,240 C288,262 294,290 296,338 L4,338 C6,290 12,262 24,240 C38,214 68,198 110,180 C122,174 128,168 128,160 L128,144 C114,134 104,116 104,92 C104,64 124,42 150,42 Z';
    const hitCv=document.createElement('canvas'); hitCv.width=_BW; hitCv.height=_BH;
    const hitCtx=hitCv.getContext('2d');
    const bustPath=new Path2D(BUST);
    const inBust=(x,y)=>hitCtx.isPointInPath(bustPath,x,y);
    const canvas=_v4wrap.firstChild;
    const ctx=canvas.getContext('2d'); ctx.scale(2,2);
    const tip=_el('.tip');
    const dots=[];
    for(let y=44;y<_BH;y+=8){
      for(let x=4;x<_BW;x+=8){
        if(!inBust(x,y))continue;
        let r=0,g=0,b=0,h=0,zn=null,zb=0;
        for(let i=0;i<zones.length;i++){
          const z=zones[i],f=Math.max(0,1-Math.hypot(x-z.x,y-z.y)/z.r);
          if(f<=0)continue;
          const k=f*f*nrm(AX(z.n)),c=hexRgb(CLR(z.n));
          h+=k;r+=c[0]*k;g+=c[1]*k;b+=c[2]*k;
          if(f>zb){zb=f;zn=z.n;}
        }
        const col=h>0.02?[r/h,g/h,b/h]:[235,235,235];
        dots.push({x:x,y:y,h:Math.min(1,h),c:col,z:zn,d:Math.hypot(x-150,y-190)});
      }
    }
    let active=null;
    _v4wrap.addEventListener('mousemove',function(e){
      const rc=_v4wrap.getBoundingClientRect(),mx=e.clientX-rc.left,my=e.clientY-rc.top;
      let best=null,bf=0;
      zones.forEach(z=>{const f=1-Math.hypot(mx-z.x,my-z.y)/z.r;if(f>bf){bf=f;best=z;}});
      if(best&&bf>0&&inBust(mx,my)){
        active=best.n;
        if(tip){
          tip.innerHTML='<b>'+best.n+'</b><s>'+AX(best.n).toFixed(1)+' / 10</s>';
          tip.style.left=(_v4wrap.offsetLeft+mx)+'px';
          tip.style.top=(_v4wrap.offsetTop+my)+'px';
          tip.style.opacity=1;
        }
      }else{active=null;if(tip)tip.style.opacity=0;}
    });
    _v4wrap.addEventListener('mouseleave',function(){active=null;if(tip)tip.style.opacity=0;});
    (function loop(t){
      ctx.clearRect(0,0,_BW,_BH);
      for(let i=0;i<dots.length;i++){
        const p=dots[i];
        const pulse=0.5+0.5*Math.sin(t*1.05-p.d*0.035);
        const boost=(active&&p.z===active)?1:0;
        ctx.beginPath();
        ctx.fillStyle='rgba('+(p.c[0]|0)+','+(p.c[1]|0)+','+(p.c[2]|0)+','+(0.2+p.h*0.7+pulse*0.1+boost*0.35).toFixed(3)+')';
        ctx.arc(p.x,p.y,0.8+p.h*2.4+pulse*(0.25+p.h*0.5)+boost,0,6.283);
        ctx.fill();
      }
      requestAnimationFrame(loop);
    })(0);
  }
});
