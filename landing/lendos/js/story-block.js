/* ═══════════════════════════════════════
   STORY BLOCK — аккордеон «возможности» + кадры-иллюстрации.
   Автосмена каждые 4.2с, пауза при наведении/фокусе,
   клик по пункту — ручное переключение.
═══════════════════════════════════════ */
(function(){
  'use strict';
  var section=document.querySelector('.zw');
  if(!section)return;

  var items=[].slice.call(section.querySelectorAll('.zw-item'));
  var shots=[].slice.call(section.querySelectorAll('.zw-shot'));
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cur=0,timer=null,DELAY=4200;

  /* предзагрузка иллюстраций — чтобы смена кадров была плавной */
  shots.forEach(function(s){
    var img=s.querySelector('.zw-shot-img');
    if(img&&img.getAttribute('src')){var p=new Image();p.src=img.getAttribute('src');}
  });

  function set(i){
    cur=i;
    items.forEach(function(it,k){
      it.classList.toggle('is-on',k===i);
      var b=it.querySelector('.zw-btn');
      if(b)b.setAttribute('aria-expanded',k===i?'true':'false');
    });
    shots.forEach(function(s,k){s.classList.toggle('is-on',k===i);});
  }
  function play(){
    if(reduced)return;
    stop();
    timer=setInterval(function(){set((cur+1)%items.length);},DELAY);
  }
  function stop(){
    if(timer){clearInterval(timer);timer=null;}
  }

  items.forEach(function(it,k){
    var btn=it.querySelector('.zw-btn');
    if(btn)btn.addEventListener('click',function(){set(k);play();});
  });

  var shell=section.querySelector('.zw-shell');
  if(shell){
    shell.addEventListener('mouseenter',stop);
    shell.addEventListener('mouseleave',play);
    shell.addEventListener('focusin',stop);
    shell.addEventListener('focusout',play);
  }

  set(0);
  play();
})();
