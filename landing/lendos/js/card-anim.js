/* ═══════════════════════════════════════
   .ac ANIMATION CONTROLLER — block 2 card stages
   ═══════════════════════════════════════ */
(function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const CHK='<svg viewBox="0 0 24 24" fill="none" stroke="#0a0a0a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  /* ── stage 0: поиск ── */
  const acRows=[...document.querySelectorAll('#acResults .ac-row')];
  let searchTimers=[];
  function runSearch(){
    searchTimers.forEach(clearTimeout);searchTimers=[];
    /* выбранный (root_duck) не теряет .sel; .hl — слабый бегунок по остальным */
    acRows[0].classList.add('sel');
    const seq=[1,2,3,4,5,6];
    seq.forEach((idx,k)=>{
      searchTimers.push(setTimeout(()=>{
        acRows.forEach((r,i)=>r.classList.toggle('hl',i===idx));
      },500+k*400));
      if(k===seq.length-1)searchTimers.push(setTimeout(()=>{
        acRows.forEach(r=>r.classList.remove('hl'));
      },500+(k+1)*400));
    });
  }

  /* ── stage 1: загрузка ── */
  const srcFills=[...document.querySelectorAll('#acSources .ac-src-fill')];
  const srcPcts=[...document.querySelectorAll('#acSources .ac-src-pct')];
  const acLoadStatus=document.getElementById('acLoadStatus');
  const STATUS=['Подключаемся к форуму…','Читаем профиль…','Парсим посты…','Считаем активность…','Проверяем репутацию…'];
  let statusTimer;
  function runLoader(){
    const start=performance.now(),dur=2600;
    (function t(now){
      if(acCur!==1)return;
      const p=clamp((now-start)/dur,0,1);
      srcFills.forEach((f,i)=>{
        const l=clamp(p*4-i,0,1);
        f.style.width=(l*100).toFixed(0)+'%';
        srcPcts[i].textContent=Math.round(l*100)+'%';
        srcPcts[i].style.color=l>=1?'#34D399':'#3a3a3a';
      });
      if(p<1)requestAnimationFrame(t);
    })(performance.now());
    let si=0;acLoadStatus.textContent=STATUS[0];
    clearInterval(statusTimer);
    statusTimer=setInterval(()=>{
      if(acCur!==1){clearInterval(statusTimer);return;}
      si=(si+1)%STATUS.length;acLoadStatus.textContent=STATUS[si];
    },750);
  }

  /* ── stage 2: скан ── */
  const MESSAGES=['я сам по себе','бабки то есть?','это полезно','я в дотане','актив упал','спокойной ночи','ты в ударе','а он откуда','не вопрос'];
  const POOL='·•∙:°⋅∘•·•∙01·•∙·.·•';
  const acGrid=document.getElementById('acMsgGrid');
  const acBeam=document.getElementById('acBeam');
  const acScanCount=document.getElementById('acScanCount');
  const scanLayout=[];
  MESSAGES.forEach(txt=>{
    const m=document.createElement('div');m.className='ac-msg';
    m.innerHTML='<div class="ac-msg-bub"><span class="txt"></span><span class="ac-msg-chk">'+CHK+'</span></div>';
    acGrid.appendChild(m);
    scanLayout.push({el:m,bub:m.firstChild,txt:m.querySelector('.txt'),full:txt,left:0,width:0,rev:0,fin:false});
  });
  let acGridW=380,lastNoise=0;
  function paintMsg(o){
    const full=o.full,rev=o.rev||0,shown=Math.floor(rev*full.length);
    let h='<span class="rev">'+full.slice(0,shown)+'</span><span class="noise">';
    for(let i=shown;i<full.length;i++){h+=full[i]===' '?' ':POOL[(Math.random()*POOL.length)|0];}
    o.txt.innerHTML=h+'</span>';
  }
  function measureMsgs(){
    scanLayout.forEach(o=>{o.bub.style.width='auto';o.txt.textContent=o.full;});
    scanLayout.forEach(o=>{o.bub.style.width=o.bub.offsetWidth+'px';});
    acGridW=acGrid.clientWidth||380;
    scanLayout.forEach(o=>{o.left=o.el.offsetLeft;o.width=o.el.offsetWidth;paintMsg(o);});
  }
  function runScan(){
    measureMsgs();
    scanLayout.forEach(o=>{o.rev=0;o.fin=false;o.el.classList.remove('done');paintMsg(o);});
    const start=performance.now(),sweepT=3500;
    (function t(now){
      if(acCur!==2)return;
      const ct=clamp((now-start)/sweepT,0,1);
      const beamX=lerp(-30,acGridW+30,ct);
      acBeam.style.left=beamX+'px';
      acBeam.style.opacity=(ct<=0.002||ct>=0.999)?0:1;
      scanLayout.forEach(o=>{
        const rev=clamp((beamX-o.left)/o.width,0,1);o.rev=rev;
        if(rev>=1){if(!o.fin){o.fin=true;o.txt.innerHTML='<span class="rev">'+o.full+'</span>';}o.el.classList.add('done');}
        else{o.fin=false;o.el.classList.remove('done');}
      });
      if(now-lastNoise>70){lastNoise=now;scanLayout.forEach(o=>{if((o.rev||0)<1)paintMsg(o);});}
      acScanCount.textContent=Math.round(ct*207);
      if(ct<1)requestAnimationFrame(t);
    })(performance.now());
  }

  /* ── stage 3: отчёт ── */
  const rFills=[...document.querySelectorAll('.ac-r-m-fill')];
  function runReport(){
    rFills.forEach(f=>f.style.width='0');
    requestAnimationFrame(()=>requestAnimationFrame(()=>rFills.forEach(f=>f.style.width=f.dataset.w)));
  }

  /* ── контроллер стадий ── */
  const acScreens=[...document.querySelectorAll('.ac-screen')];
  const b2Tabs=[...document.querySelectorAll('#b2Tabs .b2-tab')];
  const STAGE_DUR=[4200,3400,4200];
  let acCur=-1,stageTimer;
  function setStage(i){
    acCur=i;
    acScreens.forEach(s=>s.classList.toggle('on',+s.dataset.s===i));
    b2Tabs.forEach(t=>{
      const on=+t.dataset.s===i;
      t.querySelector('.tab-dot').classList.toggle('on',on);
      t.querySelector('.tab-lbl').classList.toggle('on',on);
    });
    if(i===0)runSearch();
    if(i===1)runLoader();
    if(i===2)runScan();

  }
  function nextStage(){
    const next=(acCur+1)%3;
    setStage(next);
    stageTimer=setTimeout(nextStage,STAGE_DUR[acCur]);
  }
  /* клик по табу — переключает стадию и сбрасывает таймер */
  b2Tabs.forEach(t=>t.addEventListener('click',()=>{
    clearTimeout(stageTimer);
    setStage(+t.dataset.s);
    stageTimer=setTimeout(nextStage,STAGE_DUR[acCur]);
  }));
  measureMsgs();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(measureMsgs);
  nextStage();
})();
