(function (window, document) {
  'use strict';
  const line = (width = '100%') => `<span class="zsk zsk-line" style="width:${width}"></span>`;
  const repeat = (count, render) => Array.from({ length: count }, render).join('');
  const api = {
    dossierGrid(count = 6) { return `<div class="zsk-dossier-grid" role="status" aria-label="Загрузка досье">${repeat(count, () => `<article class="dossier-card zsk-card zsk-dossier"><div class="dossier-card-top zsk-dossier-top"><div class="dossier-person zsk-dossier-person"><span class="zsk zsk-circle zsk-avatar"></span><div class="dossier-person-copy zsk-copy">${line('78%')}${line('58%')}</div></div><div class="dossier-meta zsk-dossier-meta"><div class="zsk-badges"><span class="zsk"></span><span class="zsk"></span></div><span class="zsk zsk-score"></span></div></div><div class="dossier-stats zsk-stats">${repeat(3, () => '<span class="zsk"></span>')}</div><div class="dossier-bars zsk-bars">${repeat(3, () => `<div class="zsk-bar-item">${line('42%')}<span class="zsk zsk-bar"></span>${line('72%')}</div>`)}</div></article>`)}</div>`; },
    txTable(count = 8) { return `<div role="status" aria-label="Загрузка транзакций">${repeat(count, () => `<div class="tx-row zsk-card zsk-tx">${repeat(5, () => line('75%'))}</div>`)}</div>`; },
    newsFeed(count = 3) { return `<div role="status" aria-label="Загрузка новостей">${repeat(count, () => `<article class="news-row zsk-card zsk-news"><div class="zsk-person"><span class="zsk zsk-circle zsk-avatar"></span><div class="zsk-copy">${line('28%')}${line('18%')}</div></div>${line('55%')}${line('94%')}${line('82%')}</article>`)}</div>`; },
    railCards(count = 2) { return `<div class="zsk-rail" role="status" aria-label="Загрузка недавних досье">${repeat(count, () => `<article class="dr3-card zsk-card zsk-rail-card">${line('65%')}${line('42%')}</article>`)}</div>`; },
    searchRows(count = 4) { return repeat(count, () => `<li class="zsk-search-row" aria-hidden="true"><span class="zsk zsk-circle"></span><span class="zsk-search-copy">${line('48%')}${line('30%')}</span></li>`); },
    reportHero() { return `<section class="zsk-report-hero" role="status" aria-label="Сбор досье">${line('34%')}${line('58%')}<div class="zsk-report-tiles">${repeat(4, () => '<span class="zsk zsk-report-tile"></span>')}</div><div class="zsk-report-overlay"><div class="zsk-core"><i></i><i></i><i></i></div></div></section>`; },
    mount(element, html) { if (!element) return performance.now(); element.setAttribute('aria-busy', 'true'); element.innerHTML = html; return performance.now(); },
    settle(element, content, startedAt, options = {}) { const minMs = options.minMs == null ? 350 : options.minMs; const wait = Math.max(0, minMs - (performance.now() - (startedAt || 0))); return new Promise((resolve, reject) => setTimeout(() => { if (!element) return resolve(); try { const html = typeof content === 'function' ? content() : content; if (html !== undefined) element.innerHTML = html; element.removeAttribute('aria-busy'); Array.from(element.children).forEach((node) => node.classList.add('zsk-enter')); resolve(html); } catch (error) { element.removeAttribute('aria-busy'); reject(error); } }, wait)); },
    bootDone() { const root = document.documentElement; const startedAt = Number(root.dataset.zskBootAt || Date.now()); setTimeout(() => { root.classList.add('zs-boot-done'); root.classList.remove('zs-boot'); const boot = document.getElementById('zskBoot'); if (boot) setTimeout(() => boot.remove(), 240); }, Math.max(0, 300 - (Date.now() - startedAt))); },
    minDelay(promise, ms) { return Promise.all([promise, new Promise((resolve) => setTimeout(resolve, ms))]).then(([value]) => value); },
  };
  window.ZSSkeleton = api;
  const failsafe = () => setTimeout(() => api.bootDone(), 6000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', failsafe, { once: true }); else failsafe();
})(window, document);
