/* ═══════════════════════════════════════
   BLOCK 3 — превью отчёта 1:1: графики + (опц.) табы
   ═════════════════════════════════════ */
(function(){
  /* ── суточный ритм 24ч (root_duck) ── */
  var HOURS = {0:20,1:13,2:8,3:1,8:5,9:8,10:16,11:35,12:33,13:39,14:48,15:60,16:36,17:75,18:79,19:64,20:43,21:114,22:60,23:62};
  var rhythm = document.querySelector('.b3-rhythm');
  if (rhythm) {
    var arr = [];
    for (var h = 0; h < 24; h++) arr.push(HOURS[h] || 0);
    var max = Math.max.apply(null, arr) || 1;
    rhythm.innerHTML = arr.map(function(v){
      var pct = Math.max(4, Math.round(v / max * 100));
      return '<i style="flex:1;background:rgba(52,211,153,0.7);border-radius:3px 3px 0 0;min-height:4px;height:' + pct + '%"></i>';
    }).join('');
  }

  /* ── рост по годам (root_duck) ── */
  var YEARS = [[2024, 191], [2025, 1116], [2026, 628]];
  var growth = document.querySelector('.b3-growth');
  if (growth) {
    var gmax = Math.max.apply(null, YEARS.map(function(r){ return r[1]; })) || 1;
    growth.innerHTML = YEARS.map(function(r){
      var pct = Math.max(8, Math.round(r[1] / gmax * 100));
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%">'
        + '<span style="font-size:12px;color:#888;margin-bottom:6px">' + r[1].toLocaleString('ru') + '</span>'
        + '<div style="width:100%;height:' + pct + '%;background:rgba(255,255,255,0.14);border-radius:16px;min-height:6px"></div>'
        + '<span style="font-size:12px;color:#555;margin-top:6px">' + r[0] + '</span>'
        + '</div>';
    }).join('');
  }

  /* ── переключение вкладок (если есть) ── */
  var tabs  = [].slice.call(document.querySelectorAll('#b3Tabs .b3-tab'));
  var panes = [].slice.call(document.querySelectorAll('#b3Metrics .rep-pane'));
  if (!tabs.length || !panes.length) return;

  var cur = 0;
  var timer;
  var DUR = [3400, 3800, 3400, 3400, 3600];

  function setStage(i){
    cur = i;
    tabs.forEach(function(t, k){ t.classList.toggle('on', k === i); });
    panes.forEach(function(p, k){ p.classList.toggle('on', k === i); });
  }
  function next(){
    setStage((cur + 1) % tabs.length);
    timer = setTimeout(next, DUR[cur]);
  }
  tabs.forEach(function(t){
    t.addEventListener('click', function(e){
      if (t.getAttribute('href') === '#') e.preventDefault();
      clearTimeout(timer);
      setStage(+t.dataset.s);
      timer = setTimeout(next, DUR[cur]);
    });
  });

  setStage(0);
  timer = setTimeout(next, DUR[0]);
})();


/* ═══════════════════════════════════════
   FEATURE CARDS — reveal on scroll
   ═══════════════════════════════════════ */
(function(){
  var cards=[].slice.call(document.querySelectorAll('.b3-card'));
  if(!cards.length)return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    cards.forEach(function(card){card.classList.add('-visible');});
    return;
  }
  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting)return;
      var card=entry.target;
      var index=cards.indexOf(card);
      window.setTimeout(function(){card.classList.add('-visible');},Math.max(0,index)*95);
      observer.unobserve(card);
    });
  },{threshold:0.22,rootMargin:'0px 0px -6% 0px'});
  cards.forEach(function(card){observer.observe(card);});
})();
