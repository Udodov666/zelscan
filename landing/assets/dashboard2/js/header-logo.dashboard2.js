(() => {
  const logos = document.querySelectorAll('.brand-logo');
  if (!logos.length) return;

  const navigation = performance.getEntriesByType('navigation')[0];
  const isReload = navigation && navigation.type === 'reload';
  const alreadyPlayed = sessionStorage.getItem('zelscan-logo-entered') === '1';
  const shouldAnimate = isReload || !alreadyPlayed;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  logos.forEach((logo) => {
    const finishEntrance = () => {
      logo.classList.add('is-entered');
      sessionStorage.setItem('zelscan-logo-entered', '1');
    };

    if (!shouldAnimate || reducedMotion) {
      logo.classList.add('is-entered', 'skip-entrance');
      if (!reducedMotion) sessionStorage.setItem('zelscan-logo-entered', '1');
      return;
    }

    const wordmark = logo.querySelector('.brand-text');
    if (wordmark) wordmark.addEventListener('animationend', finishEntrance, { once: true });
    else setTimeout(finishEntrance, 1060);
  });
})();
