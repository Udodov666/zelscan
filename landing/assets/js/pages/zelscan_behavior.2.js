zsLoad(function(d) {
  const p  = d.portrait || {};
  const em = p.emotion  || {};
  const tr = d.triggers || {};
  const mn = p.manner   || {};
  const lit = p.literacy || {};
  const st = p.stats    || {};
  const interests = p.interests || {};
  const c = d.card || {};

  /* ── Манера (сегментный бар + легенда) ── */
  const MANNER_COLORS = {
    'сомневающийся':'#8AA0B8','токсик':'#EF4444','свой':'#34D399',
    'стёбщик':'#F59E0B','разбирается':'#22D3EE','помогает':'#A78BFA',
    'категоричный':'#F472B6','по_делу':'#6B6B6B'
  };
  const scores = mn.scores || {};
  const scoreEntries = Object.entries(scores).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const totalScore = scoreEntries.reduce((s,[,v])=>s+v,0)||1;
  const comp = _el('.comp');
  if (comp && scoreEntries.length) {
    comp.innerHTML = scoreEntries.map(([k,v],idx)=>{
      const pct = Math.round(v/totalScore*100);
      const col = MANNER_COLORS[k]||'#555';
      return `<div class="seg" data-key="${k}" style="--i:${idx};flex:${v};background:${col}">${pct>8?`<b>${pct}</b>`:''}</div>`;
    }).join('');
  }
  const legC = _el('.legC');
  if (legC && scoreEntries.length) {
    legC.innerHTML = scoreEntries.map(([k,v],idx)=>{
      const pct = Math.round(v/totalScore*100);
      const col = MANNER_COLORS[k]||'#555';
      const friendly={по_делу:'По делу',разбирается:'Разбирается',помогает:'Помогает',свой:'Свой'};
      const label = friendly[k]||(k.charAt(0).toUpperCase()+k.slice(1));
      return `<span class="lc" data-key="${k}" style="--i:${idx}"><i style="background:${col}"></i>${label} <b>${pct}</b></span>`;
    }).join('');
  }
  /* интерактив: ховер сегмента/легенды — соседние тухнут, активный подсвечен */
  const segs = comp ? [...comp.querySelectorAll('.seg')] : [];
  const lcs = legC ? [...legC.querySelectorAll('.lc')] : [];
  function dimManner(activeKey){
    segs.forEach(s=>{
      const on = s.dataset.key===activeKey;
      s.style.opacity = on ? '1' : '0.25';
    });
    lcs.forEach(l=>{
      const on = l.dataset.key===activeKey;
      l.style.opacity = on ? '1' : '0.45';
      l.style.color = on ? '#EBEBEB' : '';
    });
  }
  function resetManner(){
    segs.forEach(s=>{ s.style.opacity=''; });
    lcs.forEach(l=>{ l.style.opacity=''; l.style.color=''; });
  }
  if (comp) {
    comp.addEventListener('mouseover', e=>{ const seg=e.target.closest('.seg'); if(seg) dimManner(seg.dataset.key); });
    comp.addEventListener('mouseleave', resetManner);
  }
  if (legC) {
    legC.addEventListener('mouseover', e=>{ const lc=e.target.closest('.lc'); if(lc) dimManner(lc.dataset.key); });
    legC.addEventListener('mouseleave', resetManner);
  }
  /* pill заголовка манеры */
  const mannerPill = _el('.afull .mc-h .pill');
  if (mannerPill) mannerPill.textContent = mn.primary||(mn.description||'');

  /* ── Эмоциональный окрас ── */
  const toxPct = Math.round(_clamp(em.toxic_pct||0,0,100));
  const posPct = Math.round(_clamp(em.positive_pct||0,0,100));
  const neuPct = Math.max(0, 100-toxPct-posPct);
  const emoBig = _el('.emo-big');
  if (emoBig) emoBig.textContent = `${neuPct}%`;
  (function(){
    const svg = document.getElementById('zs-emo-bars');
    if (!svg) return;
    const TOTAL=43, LW=8, GAP=3, H=72;
    const bars=[];
    function $b(tag,attrs){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
    // seeded shuffle
    let seed=12345;
    function rand(){seed=(seed*1664525+1013904223)&0x7FFFFFFF;return seed/0x7FFFFFFF;}
    const order=Array.from({length:TOTAL},(_,i)=>i);
    for(let i=order.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
    const nTox=Math.max(1,Math.round(toxPct/100*TOTAL));
    const nPos=Math.max(1,Math.round(posPct/100*TOTAL));
    const toxSet=new Set(order.slice(0,nTox));
    const posSet=new Set(order.slice(nTox,nTox+nPos));
    for(let i=0;i<TOTAL;i++){
      const x=i*(LW+GAP);
      const fill=toxSet.has(i)?'#EF4444':posSet.has(i)?'#34C759':'#7C8694';
      const base=toxSet.has(i)||posSet.has(i)?1:0.38;
      const group=toxSet.has(i)?'toxic':posSet.has(i)?'pos':'neutral';
      const r=$b('rect',{class:'zs-emo-bar',x,y:72,width:LW,height:0,rx:3,fill,opacity:base,'data-group':group,'data-base':String(base)});
      const t=document.createElementNS('http://www.w3.org/2000/svg','title');
      t.textContent = group==='toxic'?'токсик':group==='pos'?'позитив':'нейтрал';
      r.appendChild(t);
      r.style.transitionDelay=(i*5)+'ms';
      svg.appendChild(r);
      bars.push(r);
    }
    // рост снизу с каскадом
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      bars.forEach(r=>{ r.setAttribute('y',0); r.setAttribute('height',H); });
    }));
    setTimeout(()=>bars.forEach(r=>r.style.transitionDelay='0ms'), TOTAL*5+700);
    // ховер легенды — соседние группы тухнут
    const emoL2=_el('.emo-leg');
    if (emoL2){
      emoL2.addEventListener('mouseover', e=>{
        const span=e.target.closest('span[data-grp]'); if(!span) return;
        const grp=span.dataset.grp;
        bars.forEach(r=>{
          const base=parseFloat(r.dataset.base||'0.38');
          r.style.opacity = r.dataset.group===grp ? String(base) : '0.1';
        });
      });
      emoL2.addEventListener('mouseleave', ()=>bars.forEach(r=>r.style.opacity = r.dataset.base||'0.38'));
    }
  })();
  const emoLeg = _el('.emo-leg');
  if (emoLeg) emoLeg.innerHTML =
    `<span data-grp="neutral"><i style="background:#7C8694"></i>нейтрал ${neuPct}%</span>` +
    `<span data-grp="toxic"><i style="background:#EF4444"></i>токсик ${toxPct}%</span>` +
    `<span data-grp="pos"><i style="background:#34C759"></i>позитив ${posPct}%</span>`;
  const emoQ = _el('.emo-q');
  if (emoQ) emoQ.textContent = em.verdict ? `«${em.verdict}»` : '';

  /* ── Стиль письма — пузырь ── */
  const bubbleAv = _el('.bubble-av');
  if (bubbleAv) {
    if (c.avatar) bubbleAv.innerHTML = `<img src="${_esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
    else bubbleAv.textContent = (c.username?.[0]||'?').toUpperCase();
  }
  const bubbleWho = _el('.bubble .who');
  if (bubbleWho) bubbleWho.textContent = c.username||'';
  const bubbleMsg = _el('.bubble .msg');
  if (bubbleMsg && p.sample_phrases?.length) bubbleMsg.textContent = p.sample_phrases[0];

  /* ── st-kpi (4 ячейки) ── */
  const stKpis = _els('.st-kpi .k');
  if (stKpis.length >= 4) {
    const avgWords = (lit.avg_words_per_post || st.avg_words_per_post || 0).toFixed(1);
    const commaP = Math.round((lit.comma_ratio||0)*100)+'%';
    const capsP = Math.round((st.caps_avg||0)*100)+'%';
    const emojiAvg = (st.emoji_avg||0).toFixed(1);
    [[avgWords,'слова в посте'],[commaP,'с запятыми'],[capsP,'с заглавными'],[emojiAvg,'эмодзи']].forEach(([n,l],i)=>{
      const k=stKpis[i];
      if(!k) return;
      const nEl=k.querySelector('.n'); if(nEl) nEl.textContent=n;
      const lEl=k.querySelector('.l'); if(lEl) lEl.textContent=l;
    });
  }
  /* st-insight */
  const stIns = _el('.st-insight');
  if (stIns && lit.verdict) stIns.textContent = lit.verdict;

  /* ── Срывы и мат: таймлайн по времени суток + топ слов ── */
  const swTimeline = _el('#swTimeline');
  const swTopWords = _el('#swTopWords');
  const totalTrig = tr.total_trigger_posts||0;
  if (swTopWords) {
    const words = (tr.trigger_words||[]).slice(0,5);
    swTopWords.innerHTML = words.length
      ? words.map(w=>`<span class="sw-top-word">${_esc(w.word)}</span>`).join('')
      : '';
    const topBox = swTopWords.closest('.sw-top-words');
    if (topBox) topBox.style.display = words.length ? '' : 'none';
  }
  if (swTimeline) {
    let byHour;
    if (!totalTrig) {
      byHour = new Array(24).fill(0); // чисто — плоский таймлайн
    } else if (Array.isArray(tr.toxic_by_hour)) {
      byHour = tr.toxic_by_hour;
    } else {
      const hours = d.activity?.time_profile?.hours || {};
      byHour = Array.from({length:24}, (_,i)=>Number(hours[i])||0);
    }
    const windows = [
      {label:'09:00', from:6,  to:12},
      {label:'15:00', from:12, to:18},
      {label:'22:00', from:18, to:24}
    ];
    const rows = windows.map(w=>{
      const vals=[];
      for (let h=w.from; h<w.to; h++) vals.push(Number(byHour[h])||0);
      return {label:w.label, vals, total:vals.reduce((s,v)=>s+v,0)};
    });
    const maxAll = Math.max(1, ...rows.flatMap(r=>r.vals));
    const peakRow = totalTrig ? rows.reduce((a,b)=>b.total>a.total?b:a) : null;
    swTimeline.innerHTML = rows.map(r=>{
      const peak = r===peakRow;
      const bars = r.vals.map(v=>{
        const h = v>0 ? Math.max(6, Math.round(v/maxAll*100)) : 8;
        return `<div class="sw-bar${peak?' peak':''}" style="height:${h}%"></div>`;
      }).join('');
      return `<div class="sw-row"><div class="sw-time">${r.label}</div><div class="sw-bars">${bars}</div></div>`;
    }).join('');
  }
  const swrV = _el('.swr-v');
  if (swrV && tr.verdict) swrV.textContent = tr.verdict;

  /* ── Hex heatmap (Частотный паттерн) ── */
  (function(){
    const svg = document.getElementById('zs-hex');
    if (!svg) return;
    const kw = [...(interests.general_keywords||[]), ...(interests.tech_keywords||[])].slice(0, 32);
    if (!kw.length) return;
    const maxF = kw[0]?.count || 1;
    function $s(tag, attrs, text) {
      const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text != null) e.textContent = text;
      return e;
    }
    function roundedHex(cx, cy, r, cr) {
      const pts = Array.from({length:6}, (_,k) => {
        const a = (k*60-30)*Math.PI/180;
        return [cx+r*Math.cos(a), cy+r*Math.sin(a)];
      });
      let d = '';
      pts.forEach((pt, i) => {
        const prev = pts[(i+5)%6], next = pts[(i+1)%6];
        const d1x=pt[0]-prev[0], d1y=pt[1]-prev[1], l1=Math.sqrt(d1x*d1x+d1y*d1y);
        const d2x=next[0]-pt[0], d2y=next[1]-pt[1], l2=Math.sqrt(d2x*d2x+d2y*d2y);
        const p1=[pt[0]-d1x/l1*cr, pt[1]-d1y/l1*cr];
        const p2=[pt[0]+d2x/l2*cr, pt[1]+d2y/l2*cr];
        d += i===0?`M${p1[0].toFixed(1)} ${p1[1].toFixed(1)} `
                  :`L${p1[0].toFixed(1)} ${p1[1].toFixed(1)} `;
        d += `Q${pt[0].toFixed(1)} ${pt[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
      });
      return d + 'Z';
    }
    const cols = 8;
    const R = 25;
    const CR = 4;
    const W = R * 1.95;
    const H2 = R * 1.7;
    const rows = Math.ceil(kw.length / cols);
    const offX = R + 6;
    const offY = R + 6;
    const vbW = 2 * offX + (cols - 1) * W + W / 2;
    const vbH = 2 * offY + (rows - 1) * H2;
    svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    kw.forEach((_, idx) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const cx = offX + col * W + (row % 2) * W / 2;
      const cy = offY + row * H2;
      svg.appendChild($s('path', {d: roundedHex(cx, cy, R, CR), fill:'#131313', stroke:'none'}));
    });
    kw.forEach((word, idx) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const cx = offX + col * W + (row % 2) * W / 2;
      const cy = offY + row * H2;
      const t = (word.count || 1) / maxF;
      const base = (6.6 + (23.5-6.6) * Math.pow(t, 0.6));
      const maxW = W * 0.9;
      const estW = word.word.length * base * 0.62;
      const fontSize = (estW > maxW ? Math.max(6.6, maxW / (word.word.length * 0.62)) : base).toFixed(1);
      svg.appendChild($s('text', {x:cx.toFixed(1), y:(cy+1).toFixed(1),
        fill:`rgba(255,255,255,${(0.08+t*0.92).toFixed(2)})`,
        'font-size': fontSize, 'font-weight': '400',
        'font-family':'Inter,sans-serif', 'text-anchor':'middle', 'dominant-baseline':'middle'}, word.word));
    });
  })();

  /* ── Адаптивный письменный профиль ── */
  (function(){
    const svg=document.getElementById('zs-dots'); if(!svg)return;
    const avgW=lit.avg_words_per_post||st.avg_words_per_post||0;
    const rn=(v,max)=>Math.min((v||0)/max,1);
    const axes=[
      {l:'Краткость',v:Math.max(0,1-rn(avgW,20)),va:avgW.toFixed(1)+' слова'},
      {l:'Пунктуация',v:lit.comma_ratio||0,va:Math.round((lit.comma_ratio||0)*100)+'%'},
      {l:'Заглавные',v:_clamp(st.caps_avg||0,0,1),va:Math.round((st.caps_avg||0)*100)+'%'},
      {l:'Эмодзи',v:rn(st.emoji_avg||0,3),va:(st.emoji_avg||0).toFixed(0)+' шт'},
      {l:'Повторы',v:lit.repeat_ratio||0,va:lit.repeat_ratio?Math.round(lit.repeat_ratio*100)+'%':'—'},
      {l:'Вопросы',v:lit.question_ratio||0,va:lit.question_ratio?(lit.question_ratio>0.2?'часто':'редко'):'редко'}
    ];
    const ns='http://www.w3.org/2000/svg';
    const add=(tag,a,t)=>{const e=document.createElementNS(ns,tag);Object.entries(a).forEach(([k,v])=>e.setAttribute(k,v));if(t!=null)e.textContent=t;svg.appendChild(e);};
    function render(){
      const width=Math.max(300,Math.round(svg.clientWidth||svg.parentElement.clientWidth||300));
      const height=Math.max(220,Math.round(svg.clientHeight||220));
      svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
      const row=height/axes.length,font=Math.max(11,Math.min(16,row*.34));
      const left=Math.max(88,Math.min(130,width*.22)),right=Math.max(66,Math.min(100,width*.17));
      const track=Math.max(90,width-left-right),dotPitch=Math.max(11,Math.min(17,row*.32));
      const count=Math.max(8,Math.min(24,Math.floor(track/dotPitch))),radius=Math.max(3,Math.min(5,row*.11));
      const step=count>1?(track-radius*2)/(count-1):0;
      axes.forEach((ax,i)=>{const y=i*row+row/2,filled=Math.round(_clamp(ax.v,0,1)*count);
        add('text',{x:0,y:y+1,fill:'#777','font-size':font,'font-family':'Inter,sans-serif','dominant-baseline':'middle'},ax.l);
        for(let d=0;d<count;d++) add('circle',{cx:left+radius+d*step,cy:y,r:radius,fill:d<filled?'#34C759':'rgba(255,255,255,.07)',opacity:d<filled?(.45+.55*(d+1)/Math.max(filled,1)).toFixed(2):1});
        add('text',{x:width,y:y+1,fill:'#A8A8A8','font-size':font,'font-weight':600,'font-family':'Inter,sans-serif','text-anchor':'end','dominant-baseline':'middle'},ax.va);
      });
    }
    render(); if(window.ResizeObserver)new ResizeObserver(render).observe(svg);
  })();
});

/* ── Репутация и споры (v7) ── */
zsLoad(function(d){
  const rep = d.reputation_disputes || {};
  const card = _el('.rep-card');
  if(!card) return;
  const num = card.querySelector('.rep-num');
  if(num){ num.textContent = (rep.score!=null?rep.score:'\u2014'); num.style.color = rep.level_color||'#EBEBEB'; }
  const lvl = card.querySelector('.rep-lvl');
  if(lvl){ lvl.textContent = rep.level||''; lvl.style.color = rep.level_color||'#EBEBEB'; lvl.style.background = (rep.level_color||'#888')+'1A'; }
  const scoreBox = card.querySelector('.rep-score');
  if(scoreBox && rep.level_color){
    const lc = String(rep.level_color).toUpperCase();
    const tone = lc==='#EF4444' ? 'red' : lc==='#F59E0B' ? 'amber' : 'green';
    scoreBox.classList.add('rep-'+tone);
  }
  const sig = card.querySelector('.rep-signals');
  if(sig){
    const toneColor = {green:'#34D399',amber:'#F59E0B',red:'#EF4444'};
    const warns = Number(rep.warning_points)||0;
    const claims = Number(rep.claims)||0;
    const complaints = Number(rep.complaints)||0;
    const banned = !!(rep.is_banned || rep.in_blacklist);
    const rows = [
      {label:'Баллы предупреждений', value: rep.warnings_scale||(`${warns}/3`),
       tone: warns>=3?'red':warns>0?'amber':'green'},
      {label:'Темы-претензии (скам/кидок)', value: claims,
       tone: claims>0?'red':'green'},
      {label:'Темы-жалобы', value: complaints,
       tone: complaints>0?'amber':'green'},
      {label:'Заблокирован сейчас', value: banned?'да':'нет',
       tone: banned?'red':'green'},
      {label:'История блокировок', value:'API не отдаёт', tone:'amber'},
    ];
    sig.innerHTML = rows.map(s=>{
      const c = toneColor[s.tone]||'#6B6B6B';
      return `<div class="rep-sig">
        <span class="rep-sdot" style="background:${c}"></span>
        <div class="rep-slabel">${_esc(s.label)}</div>
        <div class="rep-sval">${_esc(String(s.value))}</div>
      </div>`;
    }).join('');
  }
  const v = card.querySelector('.rep-verdict'); if(v) v.textContent = rep.verdict||'';
});
