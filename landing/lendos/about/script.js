(() => {
  'use strict';

  const body = document.body;
  const heroOuter = document.querySelector('.hero-outer');
  const heroBlock = document.querySelector('.heroblock');
  const heroHeader = document.querySelector('.hdr');
  const floatingHeader = document.getElementById('floatingHeader');
  const promo = document.getElementById('promoBar');
  const promoClose = document.getElementById('promoClose');
  const factsPanel = document.getElementById('facts');

  if (heroHeader && floatingHeader) {
    floatingHeader.innerHTML = `<div class="hdr-floating-left">${heroHeader.children[0].innerHTML}</div><div class="hdr-floating-right">${heroHeader.children[1].outerHTML}</div>`;
  }

  document.addEventListener('click', event => {
    const control = event.target.closest('[data-href]');
    if (control) window.location.href = control.dataset.href;
  });

  promoClose?.addEventListener('click', () => {
    promo.classList.add('promo--hidden');
    heroOuter?.classList.add('promo-removed');
    setTimeout(() => { promo.hidden = true; }, 450);
  });

  function updateHeader() {
    if (!heroOuter || !heroBlock) return;
    const show = heroOuter.getBoundingClientRect().bottom <= 96;
    floatingHeader?.classList.toggle('-show', show);
    floatingHeader?.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (promo && !promo.hidden) promo.classList.toggle('promo--hidden', window.scrollY > 60);
  }

  const clamp = value => Math.min(1, Math.max(0, value));
  const smoothStep = value => value * value * (3 - 2 * value);
  let documentFrame = 0;

  function updateDocumentFrame() {
    documentFrame = 0;
    if (!factsPanel || !heroBlock) return;

    // на узких экранах документ всегда раскрыт: анимация маргинов
    // на планшетах/мобилках уходит в отрицательные отступы и рвёт вёрстку
    if (window.matchMedia('(max-width:1100px)').matches) {
      factsPanel.style.removeProperty('--document-edge');
      factsPanel.style.removeProperty('--document-radius');
      return;
    }

    const rect = factsPanel.getBoundingClientRect();
    const viewportHeight = Math.max(1, window.innerHeight);
    const restingEdge = Math.max(0, heroBlock.getBoundingClientRect().left);
    const restingRadius = parseFloat(getComputedStyle(heroBlock).borderTopLeftRadius) || 0;

    const enterStart = viewportHeight * 0.92;
    const enterEnd = viewportHeight * 0.16;
    const exitStart = viewportHeight * 1.08;
    const exitEnd = viewportHeight * 0.35;

    const entering = clamp((enterStart - rect.top) / (enterStart - enterEnd));
    const leaving = clamp((exitStart - rect.bottom) / (exitStart - exitEnd));
    const openness = Math.min(smoothStep(entering), 1 - smoothStep(leaving));

    factsPanel.style.setProperty('--document-edge', `${(restingEdge * (1 - openness)).toFixed(2)}px`);
    factsPanel.style.setProperty('--document-radius', `${(restingRadius * (1 - openness)).toFixed(2)}px`);
  }

  function requestDocumentFrame() {
    if (!documentFrame) documentFrame = requestAnimationFrame(updateDocumentFrame);
  }

  function updateOnScroll() {
    updateHeader();
    requestDocumentFrame();
  }

  window.addEventListener('scroll', updateOnScroll, { passive: true });
  window.addEventListener('resize', requestDocumentFrame, { passive: true });
  updateHeader();
  updateDocumentFrame();

  const details = [...document.querySelectorAll('[data-accordion] details')];
  details.forEach(item => item.addEventListener('toggle', () => {
    if (!item.open) return;
    details.forEach(other => { if (other !== item) other.open = false; });
  }));

  const footerWrap = document.querySelector('.ft-word-wrap');
  const footerWord = document.querySelector('.ft-word');
  function fitFooterWord() {
    if (!footerWrap || !footerWord) return;
    footerWord.style.removeProperty('--ft-word-fit');
    const width = footerWord.getBoundingClientRect().width;
    if (width) footerWord.style.setProperty('--ft-word-fit', Math.min(1, (footerWrap.clientWidth - 2) / width).toFixed(4));
  }
  window.addEventListener('resize', fitFooterWord, { passive: true });
  document.fonts?.ready.then(fitFooterWord);
  requestAnimationFrame(fitFooterWord);

  const trigger = document.getElementById('profileTrigger');
  const overlay = document.getElementById('profileModal');
  const close = overlay?.querySelector('.modal-close');
  let previousFocus = null;

  function openModal() {
    previousFocus = document.activeElement;
    overlay?.classList.add('-open');
    overlay?.setAttribute('aria-hidden', 'false');
    body.style.overflow = 'hidden';
    close?.focus();
  }
  function closeModal() {
    overlay?.classList.remove('-open');
    overlay?.setAttribute('aria-hidden', 'true');
    body.style.removeProperty('overflow');
    previousFocus?.focus?.();
  }

  trigger?.addEventListener('click', openModal);
  close?.addEventListener('click', closeModal);
  overlay?.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

  const portfolio = document.querySelector('.modal-projects-scroll');
  if (portfolio) {
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    portfolio.addEventListener('pointerdown', event => {
      dragging = true;
      startX = event.clientX;
      startScroll = portfolio.scrollLeft;
      portfolio.setPointerCapture?.(event.pointerId);
    });
    portfolio.addEventListener('pointermove', event => {
      if (dragging) portfolio.scrollLeft = startScroll - (event.clientX - startX);
    });
    ['pointerup', 'pointercancel'].forEach(type => portfolio.addEventListener(type, () => { dragging = false; }));
    portfolio.addEventListener('dragstart', event => event.preventDefault());
  }
})();


/* ── пайплайн: каскадное появление + счёт метрик ── */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cards = [].slice.call(document.querySelectorAll('.flow article'));
  var chips = [].slice.call(document.querySelectorAll('.metric-chip b[data-val]'));

  function countUp(el){
    var to = parseFloat(el.getAttribute('data-val'));
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var suf = el.getAttribute('data-suffix') || '';
    var t0 = performance.now(), DUR = 900;
    (function fr(now){
      var p = Math.min(Math.max((now - t0) / DUR, 0), 1);
      p = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * p).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(fr);
    })(t0);
  }

  function run(){
    cards.forEach(function(card, i){
      setTimeout(function(){ card.classList.add('-in'); }, i * 130);
    });
    chips.forEach(function(el, i){
      setTimeout(function(){ countUp(el); }, 250 + i * 120);
    });
  }

  if (reduced || !('IntersectionObserver' in window)) {
    cards.forEach(function(card){ card.classList.add('-in'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) { run(); io.disconnect(); }
    });
  }, {threshold: 0.3});
  var flow = document.querySelector('.flow');
  if (flow) io.observe(flow);
})();


/* ── общий reveal-каскад + счётчики цифр ── */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* счётчик: data-count, data-dec (знаков после запятой), data-suffix */
  function countUp(el){
    var to = parseFloat(el.getAttribute('data-count'));
    if (isNaN(to)) return;
    var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
    var suf = el.getAttribute('data-suffix') || '';
    var t0 = performance.now(), DUR = 1100;
    (function fr(now){
      var p = Math.min(Math.max((now - t0) / DUR, 0), 1);
      p = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * p).toFixed(dec) + suf;
      if (p < 1) requestAnimationFrame(fr);
    })(t0);
  }

  var counters = [].slice.call(document.querySelectorAll('[data-count]'));

  /* очередь внутри одной группы: младшие индексы получают меньшую задержку */
  function groupDelay(el){
    var d = parseInt(el.getAttribute('data-delay') || '0', 10);
    if (d) return d;
    var sibs = [].slice.call(el.parentElement.children).filter(function(x){
      return x.hasAttribute && x.hasAttribute('data-reveal');
    });
    return sibs.indexOf(el) * 90;
  }

  var els = [].slice.call(document.querySelectorAll('[data-reveal]'));
  if (reduced || !('IntersectionObserver' in window)) {
    els.forEach(function(el){ el.classList.add('-in'); });
    counters.forEach(function(el){ el.textContent = (parseFloat(el.getAttribute('data-count'))||0).toFixed(parseInt(el.getAttribute('data-dec')||'0',10)) + (el.getAttribute('data-suffix')||''); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      var el = e.target;
      setTimeout(function(){
        el.classList.add('-in');
        var c = el.querySelector('[data-count]');
        if (c) countUp(c);
      }, groupDelay(el));
      io.unobserve(el);
    });
  }, {threshold: 0.18, rootMargin: '0px 0px -5% 0px'});
  els.forEach(function(el){ io.observe(el); });
  /* счётчики вне reveal-блоков */
  counters.forEach(function(el){
    if (el.closest('[data-reveal]')) return;
    var io2 = new IntersectionObserver(function(es){
      es.forEach(function(e){ if (e.isIntersecting) { countUp(el); io2.disconnect(); } });
    }, {threshold: 0.4});
    io2.observe(el);
  });
})();


/* ── split-каскады: h1 по буквам, заголовки/лид — слова из размытия ── */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function splitWords(el){
    var words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map(function(w){
      return '<span class="w">' + w + '</span>';
    }).join(' ');
    [].forEach.call(el.querySelectorAll('.w'), function(w, i){
      w.style.transitionDelay = (i * 0.06) + 's';
    });
  }
  function splitChars(el){
    var lines = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = lines.map(function(line){
      return line.split('').map(function(ch){
        return ch === ' ' ? ' ' : '<span class="ch">' + ch + '</span>';
      }).join('');
    }).join('<br>');
    [].forEach.call(el.querySelectorAll('.ch'), function(ch, i){
      ch.style.transitionDelay = (i * 0.035) + 's';
    });
  }

  var targets = [].slice.call(document.querySelectorAll('[data-split]'));
  if (!targets.length) return;
  if (reduced) {
    targets.forEach(function(el){ el.classList.add(el.getAttribute('data-split') === 'chars' ? '-on' : '-in'); });
    return;
  }
  targets.forEach(function(el){
    if (el.getAttribute('data-split') === 'chars') splitChars(el);
    else splitWords(el);
  });
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      var el = e.target;
      setTimeout(function(){
        el.classList.add(el.getAttribute('data-split') === 'chars' ? '-on' : '-in');
      }, el.tagName === 'H1' ? 250 : 0);
      io.unobserve(el);
    });
  }, {threshold: 0.3});
  targets.forEach(function(el){ io.observe(el); });
})();
