/* ============================================================
   Profile Modal — self-contained open/close logic.
   No dependencies. Safe to include once per page.

   API:
     ProfileModal.open()   — open the modal
     ProfileModal.close()  — close the modal
     ProfileModal.toggle() — toggle

   Auto-wiring:
     - Close button (.pm-close), overlay backdrop click, and Esc close it.
     - Any element with [data-pm-open] opens it on click.
   ============================================================ */
(function (global) {
  'use strict';

  var OVERLAY_ID = 'profileModal';
  var OPEN_CLASS = 'pm-open';

  function overlay() { return document.getElementById(OVERLAY_ID); }

  function open() {
    var o = overlay();
    if (!o) return;
    o.classList.add(OPEN_CLASS);
    document.documentElement.style.overflow = 'hidden'; // lock scroll
  }

  function close() {
    var o = overlay();
    if (!o) return;
    o.classList.remove(OPEN_CLASS);
    document.documentElement.style.overflow = '';
  }

  function toggle() {
    var o = overlay();
    if (!o) return;
    o.classList.contains(OPEN_CLASS) ? close() : open();
  }

  function isOpen() {
    var o = overlay();
    return !!o && o.classList.contains(OPEN_CLASS);
  }

  function bind() {
    var o = overlay();
    if (!o || o.__pmBound) return;
    o.__pmBound = true;

    // Close on backdrop click (but not when clicking inside the modal)
    o.addEventListener('click', function (e) {
      if (e.target === o) close();
    });

    // Close button
    var btn = o.querySelector('.pm-close');
    if (btn) btn.addEventListener('click', close);

    // Esc to close
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && isOpen()) close();
    });

    // Delegated open triggers: any [data-pm-open]
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest && e.target.closest('[data-pm-open]');
      if (trigger) { e.preventDefault(); open(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.ProfileModal = { open: open, close: close, toggle: toggle, isOpen: isOpen };
})(window);
