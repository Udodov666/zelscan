(function () {
  const backgrounds = [['bg-surface', 'Поверхность'], ['bg-accent', 'Акцент'], ['bg-depth', 'Глубина']];
  let background = 0, selected = 1;
  let switcher = null;

  function applyCards(cards) {
    cards.forEach(function (card, index) {
      if (!card.classList.contains(index ? 'ts-pro' : 'ts-basic')) {
        card.classList.add(index ? 'ts-pro' : 'ts-basic');
      }
      const icon = card.querySelector('.zs-t-ic');
      if (icon && !icon.querySelector('img')) {
        icon.innerHTML = '<img src="gotovo' + (index + 1) + '.png" alt="" aria-hidden="true">';
        icon.classList.add('tariff-3d-icon');
      }
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
    });
  }

  function ensureSwitcher() {
    if (switcher) return;
    switcher = document.createElement('div');
    switcher.id = 'tariff-background-switch';
    switcher.innerHTML = '<span>Фон</span>' + backgrounds.map(function (item, index) {
      return '<button type="button" data-background="' + index + '" aria-pressed="' + (index === 0) + '">' + item[1] + '</button>';
    }).join('');
    document.body.append(switcher);
    switcher.onclick = function (event) {
      const button = event.target.closest('button[data-background]');
      if (button) { background = Number(button.dataset.background); scan(); }
    };
  }

  function render(root, cards) {
    backgrounds.forEach(function (item) { root.classList.remove(item[0]); });
    root.classList.add(backgrounds[background][0]);
    cards.forEach(function (card, index) {
      card.classList.toggle('is-selected', index === selected);
      card.setAttribute('aria-pressed', String(index === selected));
    });
    if (switcher) {
      [...switcher.querySelectorAll('button')].forEach(function (button, index) {
        button.setAttribute('aria-pressed', String(index === background));
      });
    }
  }

  function scan() {
    const cards = [...document.querySelectorAll('.zs-t')].slice(0, 2);
    if (cards.length !== 2) return;
    const root = cards[0].parentElement;
    if (!root) return;
    applyCards(cards);
    ensureSwitcher();
    cards.forEach(function (card, index) {
      card.onclick = function () {
        selected = index;
        scan();
        if (window.ZSModals && card.dataset.tid) ZSModals._pickTariff(card.dataset.tid);
      };
      card.onkeydown = function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selected = index;
          scan();
          if (window.ZSModals && card.dataset.tid) ZSModals._pickTariff(card.dataset.tid);
        }
      };
    });
    render(root, cards);
  }

  let observing = false;
  function observe() {
    if (observing) return;
    observing = true;
    new MutationObserver(function () { scan(); }).observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    const cards = [...document.querySelectorAll('.zs-t')].slice(0, 2);
    if (cards.length === 2 && !document.getElementById('tariff-background-switch')) {
      scan();
      observe();
      return true;
    }
    return false;
  }

  let attempts = 0;
  const timer = setInterval(function () { if (init() || ++attempts > 100) clearInterval(timer); }, 40);
})();
