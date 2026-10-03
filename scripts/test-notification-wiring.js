'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = [
  'landing/zelscan_dashboard.html',
  'landing/my_dossiers.html',
  'landing/public_dossiers.html',
  'landing/transactions.html',
  'landing/news.html',
  'landing/zelscan.html',
  'landing/zelscan_activity.html',
  'landing/zelscan_behavior.html',
  'landing/zelscan_psychology.html',
  'landing/zelscan_analysis.html',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

for (const file of htmlFiles) {
  const html = read(file);
  assert.strictEqual(count(html, 'assets/css/notifications-center.css'), 1, `${file}: common CSS count`);
  assert.strictEqual(count(html, 'assets/js/zs-notifications.js'), 1, `${file}: common JS count`);
  assert.strictEqual(count(html, 'notifications-center.dashboard2.css'), 0, `${file}: dashboard2 notification CSS`);
  assert.strictEqual(count(html, 'zs-notifications.dashboard2.js'), 0, `${file}: dashboard2 notification JS`);
}

const js = read('landing/assets/js/zs-notifications.js');
assert(js.includes("credentials: 'same-origin'"), 'common JS: same-origin credentials');
for (const name of ['renderLoading', 'renderEmpty', 'renderList', 'renderError']) {
  assert(new RegExp(`function\\s+${name}\\s*\\(`).test(js), `common JS: ${name}`);
}
assert(!js.includes('if (!token())'), 'common JS: forbidden token guard');

const css = read('landing/assets/css/notifications-center.css');
for (const selector of ['.zs-noti-empty', '.zs-noti-loading', '.zs-noti-item--error']) {
  assert(css.includes(selector), `common CSS: ${selector}`);
}

console.log(`notification wiring OK: ${htmlFiles.length} HTML files`);
