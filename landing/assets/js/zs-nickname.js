(function (root, factory) {
  const api = factory(root && root.document);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZSNickname = api;
})(typeof window !== 'undefined' ? window : globalThis, function (document) {
  'use strict';

  const SAFE_CLASSES = new Set([
    'styleUserNickname', 'GreatestUsernameIcon', 'groupUsernameIcon',
    'usernameIcon', 'username--style', 'username--staff', 'username--banned'
  ]);
  const ICON_CLASSES = new Set(['GreatestUsernameIcon', 'groupUsernameIcon', 'usernameIcon']);
  const SAFE_STYLES = new Set([
    'color', 'background', 'background-color', 'background-image',
    'background-clip', '-webkit-background-clip', '-webkit-text-fill-color',
    'text-shadow', 'font-weight', 'font-style', 'text-decoration'
  ]);
  const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'IMG', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON']);
  const DANGEROUS = /(?:url\s*\(|expression\s*\(|@import|javascript\s*:|data\s*:|vbscript\s*:|behavior\s*:|-moz-binding|var\s*\()/i;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function compactText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function safeStyle(source, target) {
    const raw = source.getAttribute('style') || '';
    raw.split(';').forEach(declaration => {
      const colon = declaration.indexOf(':');
      if (colon < 1) return;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!SAFE_STYLES.has(property) || !value || DANGEROUS.test(value)) return;
      if ((property === 'background' || property === 'background-image') && !/^(?:linear-gradient|radial-gradient)\(/i.test(value)) return;
      if ((property === 'background-clip' || property === '-webkit-background-clip') && value.toLowerCase() !== 'text') return;
      target.style.setProperty(property, value);
    });
  }

  function appendSanitized(source, target, outDocument) {
    if (source.nodeType === 3) {
      const text = compactText(source.nodeValue);
      if (text) target.appendChild(outDocument.createTextNode(text));
      return;
    }
    if (source.nodeType !== 1 || BLOCKED_TAGS.has(source.tagName)) return;
    if (source.tagName !== 'SPAN') {
      Array.from(source.childNodes).forEach(child => appendSanitized(child, target, outDocument));
      return;
    }
    const span = outDocument.createElement('span');
    const classes = Array.from(source.classList).filter(name => SAFE_CLASSES.has(name));
    if (classes.length) span.className = classes.join(' ');
    safeStyle(source, span);
    Array.from(source.childNodes).forEach(child => appendSanitized(child, span, outDocument));
    if (span.childNodes.length || classes.some(name => ICON_CLASSES.has(name))) target.appendChild(span);
  }

  function sanitize(raw, fallback) {
    const source = String(raw == null ? '' : raw);
    const fallbackText = compactText(fallback == null ? source.replace(/<[^>]*>/g, ' ') : fallback);
    if (!document || !document.implementation || source.indexOf('<') < 0) return escapeHtml(compactText(source) || fallbackText);
    const doc = document.implementation.createHTMLDocument('nickname');
    const host = doc.createElement('div');
    const output = doc.createElement('div');
    host.innerHTML = source;
    Array.from(host.childNodes).forEach(node => appendSanitized(node, output, doc));
    const text = compactText(output.textContent);
    if (!text && !output.querySelector('span')) return escapeHtml(fallbackText);
    return output.innerHTML.replace(/>\s+</g, '><').trim();
  }

  function sanitizeUser(user) {
    const u = user || {};
    return sanitize(u.username_html || u.username || u.nickname || u.id || '', u.username || u.nickname || u.id || '');
  }

  function prepareUser(user) {
    const u = Object.assign({}, user || {});
    u.username_html = sanitizeUser(u);
    u.username = text(u.username_html) || compactText(u.username || u.nickname || u.id || '');
    return u;
  }

  function fromUser(user) {
    const u = user || {};
    return u.username_html ? String(u.username_html).trim() : sanitizeUser(u);
  }

  function text(html) {
    if (!document) return compactText(String(html || '').replace(/<[^>]*>/g, ' '));
    const node = document.createElement('div');
    node.innerHTML = String(html || '');
    return compactText(node.textContent);
  }

  return { sanitize, sanitizeUser, prepareUser, fromUser, text };
});
