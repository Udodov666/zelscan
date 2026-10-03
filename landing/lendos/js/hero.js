/* ═══════════════════════════════════════
   HERO — figure pingpong + day→evening scroll + promo fold
   ═══════════════════════════════════════ */
(function(){
  var TOTAL_FRAMES = 44;
  var DAY_SCROLL   = 600;

  /* --- preload всех кадров (прогресс ждёт лоадер: hero-frames:done) --- */
  var frames = [];
  var framesLoaded = 0;
  window.heroFrames = {total: TOTAL_FRAMES, loaded: 0};
  function frameReady(){
    framesLoaded++;
    window.heroFrames.loaded = framesLoaded;
    if (framesLoaded >= TOTAL_FRAMES) {
      document.dispatchEvent(new Event('hero-frames:done'));
    }
  }
  for (var i = 1; i <= TOTAL_FRAMES; i++) {
    var img = new Image();
    img.src = 'images/anim/' + i + '.webp';
    if (img.complete) { frameReady(); }
    else { img.onload = frameReady; img.onerror = frameReady; }
    frames.push(img);
  }

  var heroFigure   = document.querySelector('.hero-figure');
  var dayVideo     = document.querySelector('.heroblock-video--day');
  var dayGlow      = document.querySelector('.heroblock-day-glow');
  var dayHills     = document.querySelector('.hero-hills-overlay--day');
  var eveningHills = document.querySelector('.hero-hills-overlay--evening');
  var eveningBlurEdge = document.querySelector('.hero-hills-blur-edge--evening');
  var promo        = document.querySelector('.promo');
  var heroOuter    = document.querySelector('.hero-outer');
  var heroBlock    = document.querySelector('.heroblock');
  var heroHeader   = document.querySelector('.hdr');
  var floatingHeader = document.getElementById('floatingHeader');

  if (heroHeader && floatingHeader && !floatingHeader.innerHTML.trim()) {
    floatingHeader.innerHTML = '<div class="hdr-floating-left">' + heroHeader.children[0].innerHTML + '</div><div class="hdr-floating-right">' + heroHeader.children[1].outerHTML + '</div>';
  }

  /* --- pingpong анимация фигуры --- */
  var fi = 0, dir = 1;
  setInterval(function(){
    fi += dir;
    if (fi >= TOTAL_FRAMES - 1){ fi = TOTAL_FRAMES - 1; dir = -1; }
    if (fi <= 0){ fi = 0; dir = 1; }
    heroFigure.src = 'images/anim/' + (fi + 1) + '.webp';
  }, 80);

  /* --- эффект "распахивания" hero на весь экран при скролле вниз --- */
  var EXPAND_DIST = 260;
  function getHeroPad(){
    var w = window.innerWidth;
    /* Laptop hero needs visibly wider side breathing room than desktop. */
    if (w >= 1280 && w < 1600) return Math.max(22, Math.min(26, w * 0.016));
    return 13;
  }
  function updateExpand(){
    var rect = heroBlock.getBoundingClientRect();
    /* прогресс: 0 пока hero виден, →1 когда верх блока ушёл за экран */
    var p = Math.min(Math.max(-rect.top / EXPAND_DIST, 0), 1);
    var pad = (getHeroPad() * (1 - p)).toFixed(2);
    heroOuter.style.setProperty('--hero-pad', pad + 'px');
  }

  function updateFloatingHeader(){
    if (!floatingHeader || !heroOuter) return;
    var rect = heroOuter.getBoundingClientRect();
    var show = rect.bottom <= 96;
    floatingHeader.classList.toggle('-show', show);
    floatingHeader.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  /* --- день → вечер при скролле --- */
  function onScroll(){
    var s = window.scrollY;

    /* promo fold */
    promo.classList.toggle('promo--hidden', s > 60);
    var dayP = Math.min(Math.max(s / DAY_SCROLL, 0), 1);
    var dayOpacity = 1 - dayP;
    dayVideo.style.opacity     = dayOpacity;
    dayGlow.style.opacity      = dayOpacity;
    dayHills.style.opacity     = dayOpacity;
    eveningHills.style.opacity = dayP;
    if (eveningBlurEdge) eveningBlurEdge.style.opacity = dayP;

    updateExpand();
    updateFloatingHeader();
  }

  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', function(){ updateExpand(); updateFloatingHeader(); }, {passive: true});
  updateExpand();
  updateFloatingHeader();

  /* обновляем ссылку на промо после возможного закрытия */
  promo = document.getElementById('promoBar');
})();

function closePromo(){
  var p = document.getElementById('promoBar');
  var hero = document.querySelector('.hero-outer');
  p.classList.add('promo--hidden');
  if (hero) hero.classList.add('promo-removed');
  setTimeout(function(){
    p.style.display='none';
    p.setAttribute('aria-hidden','true');
  }, 500);
}

(function(){
  var wrap = document.querySelector('.ft-word-wrap');
  var word = document.querySelector('.ft-word');
  if (!wrap || !word) return;

  var blur = document.querySelector('.ft-word-blur');

  function fitFooterWord(){
    var targets = blur ? [word, blur] : [word];

    targets.forEach(function(el){
      el.style.removeProperty('--ft-word-fit');
      el.style.fontSize = '';
      el.style.lineHeight = '';
    });

    var wrapWidth = wrap.clientWidth;
    var wordWidth = word.getBoundingClientRect().width;
    if (!wrapWidth || !wordWidth) return;

    var fit = Math.min(1, (wrapWidth - 2) / wordWidth);
    if (fit >= 0.999) return;

    targets.forEach(function(el){
      el.style.setProperty('--ft-word-fit', fit.toFixed(4));
    });

    wordWidth = word.getBoundingClientRect().width;
    if (wordWidth > wrapWidth + 1) {
      fit = Math.min(fit, (wrapWidth - 2) / wordWidth);
      targets.forEach(function(el){
        el.style.setProperty('--ft-word-fit', fit.toFixed(4));
      });
    }
  }

  window.addEventListener('load', fitFooterWord);
  window.addEventListener('resize', fitFooterWord, {passive:true});

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fitFooterWord).observe(wrap);
  }

  requestAnimationFrame(function(){
    requestAnimationFrame(fitFooterWord);
  });
})();
