(() => {
  'use strict';
  function applyMinimalToolbar() {
    const toolbar = document.querySelector('.my-dossiers-cards-lab .account-toolbar');
    if (!toolbar) return;
    toolbar.querySelector('.dossier-lab-filters')?.remove();
    toolbar.classList.add('dossier-toolbar--sort-only');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyMinimalToolbar);
  } else {
    applyMinimalToolbar();
  }
})();
