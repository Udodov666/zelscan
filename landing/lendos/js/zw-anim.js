/* ═══════════════════════════════════════
   zw-anim — анимации и микровзаимодействия
   HTML-иллюстраций zw-блока (тест-страница).
   Каркас: .is-live на активном кадре запускает
   CSS-анимации; счётчики и последовательности — здесь.
   ═══════════════════════════════════════ */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;                      // статичные финальные состояния
  document.body.classList.add('zw-anim-on');

  var arts = [].slice.call(document.querySelectorAll('.zw-shot--art'));
  if (!arts.length) return;

  /* точки эго-кольца (24 шт, верхняя — зелёная) */
  (function(){
    var ring = document.querySelector('.ab-ring');
    if (!ring || ring.dataset.ready) return;
    ring.dataset.ready = '1';
    for (var i = 0; i < 24; i++) {
      var d = document.createElement('i');
      d.style.setProperty('--a', (i * 15) + 'deg');
      d.style.setProperty('--i', i);
      if (i === 0) d.className = 'lit';
      ring.appendChild(d);
    }
  })();

  /* фит арт-сцены (743×640) под фактическую ширину кадра */
  function fitArt(){
    var r = document.querySelector('.zw-right');
    if (!r) return;
    r.style.setProperty('--zwfit', Math.min(1, r.clientWidth / 743).toFixed(4));
  }
  window.addEventListener('resize', fitArt, { passive: true });
  fitArt();

  /* ── утилиты ── */
  function ease(t){ return 1 - Math.pow(1 - t, 3); }
  function fmt(v, space){ return space ? v.toLocaleString('ru-RU') : String(v); }

  function countUp(art, el, to, dur, suffix, space){
    if (!el) return;
    var g = art._gen, t0 = performance.now();
    (function fr(now){
      if (art._gen !== g) return;           // кадр сменился — стоп
      var p = Math.min(1, Math.max(0, (now - t0) / dur));
      el.textContent = fmt(Math.round(to * ease(p)), space) + (suffix || '');
      if (p < 1) requestAnimationFrame(fr);
    })(t0);
  }
  function later(art, ms, fn){
    var g = art._gen;
    setTimeout(function(){ if (art._gen === g) fn(); }, ms);
  }

  /* ── кадр 3: индекс доверия ── */
  function runIndex(art){
    var g = ++art._gen;
    var prog  = art.querySelector('.ix-arc-prog');
    var glow  = art.querySelector('.ix-arc-glow');
    var needle = art.querySelector('.ix-needle');
    var knob  = art.querySelector('.ix-knob');
    var flag  = art.querySelector('.ix-flag');
    var num   = art.querySelector('.ix-num .n');
    var t0 = performance.now(), DUR = 800, PCT = 0.588;

    if (prog) {
      var L = prog.getTotalLength();
      [prog, glow].forEach(function(p){
        if (!p) return;
        var l = p.getTotalLength();
        p.style.strokeDasharray = l;
        p.style.strokeDashoffset = l;       // невидимая до старта
      });
      (function fr(now){
        if (art._gen !== g) return;
        var p = Math.min(1, Math.max(0, (now - t0) / DUR)), e = ease(p);
        if (prog) prog.style.strokeDashoffset = L * (1 - e);
        if (glow) glow.style.strokeDashoffset = glow.getTotalLength() * (1 - e);
        if (needle) needle.style.transform = 'rotate(' + (60 - (60 - 23.6) * e) + 'deg)';
        if (knob) knob.style.left = (193.13 * e) + 'px';
        if (p < 1) requestAnimationFrame(fr);
        else if (flag) flag.classList.add('zw-pop-in');
      })(t0);
    }
    if (num) countUp(art, num, 58, DUR);

    /* счётчики и полоски — лёгкий стаггер */
    [].forEach.call(art.querySelectorAll('[data-count]'), function(el, i){
      if (el.classList.contains('n')) return;   // 58 уже считается отдельно
      setTimeout(function(){
        countUp(art, el, +el.getAttribute('data-count'), 800,
                el.getAttribute('data-suffix'), el.getAttribute('data-space') === '1');
      }, 120 + 90 * i);
    });
    [].forEach.call(art.querySelectorAll('.mx .bar i'), function(bar, i){
      var w = +bar.getAttribute('data-w');
      setTimeout(function(){
        bar.style.width = '0%';
        void bar.offsetWidth;
        bar.style.width = w + '%';
      }, 120 + 90 * i);
    });
  }

  /* ── кадр 2: о досье ── */
  function runAbout(art){
    var v = art.querySelector('.ab-ring-v');
    var n = art.querySelector('.ab-ego-n');
    if (v) countUp(art, v, 6, 800, '%');
    setTimeout(function(){ if (n) countUp(art, n, 83, 900); }, 120);
  }

  /* ── кадр 4: поделиться ссылкой — сброс transient-состояний ── */
  function runLink(art){
    var modal = art.querySelector('.lk-modal');
    if (modal) modal.classList.remove('closed', 'reopen');
    var cp = art.querySelector('.lk-copy');
    if (cp) cp.classList.remove('done');
    var sv = art.querySelector('.lk-save');
    if (sv) { sv.classList.remove('is-loading', 'is-done'); }
    var svT = art.querySelector('.lk-save-t');
    if (svT) svT.textContent = 'Сохранить';
    /* выбранная кнопка доступа сохраняется за юзером */
  }

  var runners = { '1': runAbout, '2': runIndex, '3': runLink };

  function activate(art){
    art.classList.add('is-live');
    art._gen = (art._gen || 0) + 1;
    var r = runners[art.dataset.i];
    if (r) r(art);
    clearTimeout(art._doneT);
    art._doneT = setTimeout(function(){ art.classList.add('zw-done'); }, 2000);
  }
  function deactivate(art){
    art.classList.remove('is-live', 'zw-done');
    art._gen = (art._gen || 0) + 1;         // гасим rAF и таймеры
  }

  /* ── наблюдение за переключением кадров ── */
  var mo = new MutationObserver(function(muts){
    muts.forEach(function(m){
      var f = m.target;
      if (!f.classList || !f.classList.contains('zw-shot--art')) return;
      if (f.classList.contains('is-on') && !f.classList.contains('is-live')) activate(f);
      else if (!f.classList.contains('is-on') && f.classList.contains('is-live')) deactivate(f);
    });
  });
  arts.forEach(function(f){
    mo.observe(f, { attributes: true, attributeFilter: ['class'] });
    if (f.classList.contains('is-on')) activate(f);   // уже активный при загрузке
  });

  /* ── интерактив кадра «Поделиться ссылкой» ── */
  var qp = new URLSearchParams(location.search);
  if (qp.get('toast')) {
    setTimeout(function(){ toast('Ссылка скопирована'); }, 400);
  }
  if (qp.get('copy')) {
    setTimeout(function(){
      var cp = linkArt.querySelector('.lk-copy'), inp = linkArt.querySelector('.lk-input');
      if (cp) cp.classList.add('done');
      if (inp) inp.classList.add('copying');
      if (toastEl) { toast('Ссылка скопирована'); if (urlPill) urlPill.classList.add('dimmed'); }
    }, 400);
  }
  var linkArt = arts.filter(function(f){ return f.dataset.i === '3'; })[0];
  if (!linkArt) return;

  var toastEl = linkArt.querySelector('.lk-toast'), toastT = null;
  function toast(msg){
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toastEl.classList.remove('show'); }, 1800);
  }

  /* кнопки доступа */
  var btns = [].slice.call(linkArt.querySelectorAll('.lk-btn'));
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      btns.forEach(function(x){ x.classList.remove('is-active'); });
      b.classList.add('is-active');
    });
  });

  /* копирование ссылки */
  var copy = linkArt.querySelector('.lk-copy');
  var input = linkArt.querySelector('.lk-input');
  if (copy) copy.addEventListener('click', function(){
    var txt = 'https://app.zelscan.xyz/report?order=fe942cf832';
    function done(){
      copy.classList.add('copied');
      input.classList.add('copying');
      toast('Ссылка скопирована');
      setTimeout(function(){
        copy.classList.remove('copied');
        input.classList.remove('copying');
      }, 1800);
    }
    function legacy(){
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function(){ legacy(); done(); });
    } else { legacy(); done(); }
  });

  /* «Сохранить»: спиннер → галочка → тост */
  var save = linkArt.querySelector('.lk-save');
  var saveT = linkArt.querySelector('.lk-save-t');
  var saveBusy = false;
  if (save) save.addEventListener('click', function(){
    if (saveBusy) return;
    saveBusy = true;
    save.classList.add('is-loading');
    if (saveT) saveT.textContent = 'Сохранение';
    setTimeout(function(){
      save.classList.remove('is-loading');
      save.classList.add('is-done');
      if (saveT) saveT.textContent = 'Сохранено';
      toast('Успешно сохранено');
      setTimeout(function(){
        save.classList.remove('is-done');
        if (saveT) saveT.textContent = 'Сохранить';
        saveBusy = false;
      }, 1600);
    }, 600);
  });

  /* крестик: закрыть и «переоткрыть» */
  var closeBtn = linkArt.querySelector('.lk-close');
  var modal = linkArt.querySelector('.lk-modal');
  var modalBusy = false;
  if (closeBtn && modal) closeBtn.addEventListener('click', function(){
    if (modalBusy) return;
    modalBusy = true;
    modal.classList.add('closed');
    setTimeout(function(){
      modal.classList.remove('closed');
      modal.classList.add('reopen');
      setTimeout(function(){ modal.classList.remove('reopen'); modalBusy = false; }, 450);
    }, 1400);
  });
})();
