/* ═══════════════════════════════════════
   ЛОАДЕР + ленивые тяжёлые вещи.
   Лоадер выпускает, когда загружены: страница (window load),
   все 44 кадра анимации героя (hero-frames:done из hero.js)
   и оба hero-видео (первый кадр). Failsafe — 6с.
   ═══════════════════════════════════════ */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- футер-видео: грузим только при приближении к футеру --- */
  var ftv = document.querySelector('.ft-video');
  if (ftv && ftv.getAttribute('data-src')) {
    var fio = new IntersectionObserver(function(es){
      for (var i = 0; i < es.length; i++) {
        if (es[i].isIntersecting) {
          ftv.src = ftv.getAttribute('data-src');
          ftv.removeAttribute('data-src');
          fio.disconnect();
          break;
        }
      }
    }, {rootMargin: '600px'});
    fio.observe(ftv);
  }

  /* --- плавное появление ленивых картинок --- */
  [].forEach.call(document.querySelectorAll('img[data-fade]'), function(im){
    function done(){ im.classList.add('-in'); }
    if (im.complete && im.naturalWidth) done();
    else {
      im.addEventListener('load', done, {once:true});
      im.addEventListener('error', done, {once:true});
    }
  });

  /* --- лоадер --- */
  var el = document.getElementById('pageLoader');
  if (!el) return;
  if (reduced) { el.parentNode.removeChild(el); return; }

  var t0 = Date.now(), released = false, got = 0;
  var vids = [].slice.call(document.querySelectorAll('.heroblock-video'));
  /* window load + кадры (если на странице есть hero-анимация) + каждый hero-ролик */
  var hasHeroAnim = !!document.querySelector('.hero-h1, .hero-outer');
  var need = 1 + vids.length + (hasHeroAnim ? 1 : 0);

  function release(){
    if (released) return;
    released = true;
    el.classList.add('is-ready');
    setTimeout(function(){
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 950);
  }
  function step(){
    got++;
    if (got < need) return;
    var left = 1000 - (Date.now() - t0); /* минимум 1с пульса, чтобы не мигал */
    setTimeout(release, Math.max(0, left));
  }

  window.addEventListener('load', step);

  var hf = window.heroFrames;           /* кадры могли догрузиться до нас */
  if (hf && hf.loaded >= hf.total) step();
  else document.addEventListener('hero-frames:done', step);

  [].forEach.call(vids, function(v){
    if (v.readyState >= 2) step();
    else {
      v.addEventListener('loadeddata', step, {once:true});
      v.addEventListener('error', step, {once:true});
    }
  });

  setTimeout(release, 6000);
})();
