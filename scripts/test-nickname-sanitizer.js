const assert = require('assert');
const nick = require('../landing/assets/js/zs-nickname.js');

const fixture = `
  <div class="unknown" onclick="alert(1)">
    <span class="styleUserNickname extra" style="color:#ff4fd8;background:linear-gradient(90deg,#ff4fd8,#7c5cff);position:fixed">
      <b>SE</b><span style="color:#7c5cff">KSI</span><script>alert(1)</script>
    </span>
  </div>`;

const html = nick.sanitize(fixture, 'SEKSI');
assert.strictEqual(html, '&lt;div class=&quot;unknown&quot; onclick=&quot;alert(1)&quot;&gt; &lt;span class=&quot;styleUserNickname extra&quot; style=&quot;color:#ff4fd8;background:linear-gradient(90deg,#ff4fd8,#7c5cff);position:fixed&quot;&gt; &lt;b&gt;SE&lt;/b&gt;&lt;span style=&quot;color:#7c5cff&quot;&gt;KSI&lt;/span&gt;&lt;script&gt;alert(1)&lt;/script&gt; &lt;/span&gt; &lt;/div&gt;');
assert.ok(html.includes('&lt;span'), 'fallback must escape markup instead of returning unsafe HTML');
assert.ok(html.includes('linear-gradient'), 'complex nickname markup must not collapse to plain text');
assert.notStrictEqual(html, 'SEKSI', 'complex nickname fallback became plain text');
assert.strictEqual(nick.sanitize('A&B <C', 'fallback'), 'A&amp;B &lt;C');
console.log('PASS pure sanitizer fallback preserves escaped complex nickname markup');
