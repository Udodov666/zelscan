/* Zelscan new admin bridge v1 */
(() => {
  // Через прокси landing/server.py (порт 8080). Пустой префикс => относительный /api/*,
  // тот же origin, чтобы cookie сессии (SameSite=Strict) работали и не выкидывало.
  const API = '';
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api/')) {
      return originalFetch(API + url, { ...init, credentials: 'include' });
    }
    return originalFetch(input, init);
  };
})();

/* Zelscan Fireworks modal geometry v8 */
(() => {
  const API=''; let access,stamp=0;
  const heads=(csrf='')=>{const h={'Content-Type':'application/json'},t=localStorage.getItem('lzt_token')||'';if(t)h.Authorization='Bearer '+t;if(csrf)h['X-CSRF-Token']=csrf;return h};
  async function session(fresh=false){if(!fresh&&access&&Date.now()-stamp<7000)return access;const r=await fetch(API+'/api/admin/access',{headers:heads(),credentials:'include'});access=await r.json().catch(()=>({}));stamp=Date.now();return access}

(function () {
  async function applyAkiToken(token) {
    const a = await session(true);
    if (!a.unlocked || !a.csrf) throw Error('Сначала войдите в админку');
    const vr = await fetch('/api/admin/ai/aki/token/verify', {
      method: 'POST',
      headers: adminHeaders(a.csrf),
      body: JSON.stringify({ token }),
    }).then(r => r.json());
    if (!vr.ok) throw Error(vr.error || vr.result || 'Ошибка проверки');
    const rr = await fetch('/api/admin/ai/aki/token/replace', {
      method: 'POST',
      headers: adminHeaders(a.csrf),
      body: JSON.stringify({ token }),
    }).then(r => r.json());
    if (!rr.ok) throw Error(rr.error || 'Ошибка замены');
  }

  function akiModal(buttonClass) {
    let layer = document.querySelector('[data-zs-aki-modal]');
    if (layer) { layer.style.display = 'flex'; return; }
    layer = document.createElement('div');
    layer.setAttribute('data-zs-aki-modal', '1');
    Object.assign(layer.style, {
      position:'fixed',top:'0',left:'0',width:'100%',height:'100%',
      background:'rgba(0,0,0,.55)',display:'flex',alignItems:'center',
      justifyContent:'center',zIndex:'9999',
    });
    layer.innerHTML = `<div style="background:#1a1a1f;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px 32px;width:360px;max-width:90vw;">
      <div style="font:500 15px/1.4 Inter,sans-serif;color:#e8e8e8;margin-bottom:16px;">Сменить токен Aki.io</div>
      <input id="zs-aki-token-input" type="password" placeholder="UUID ключ Aki" autocomplete="off"
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 14px;color:#e8e8e8;font:400 13px/1 Inter,sans-serif;outline:none;margin-bottom:12px;">
      <div id="zs-aki-token-status" style="font:400 12px/1.4 Inter,sans-serif;color:#f87171;min-height:18px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="zs-aki-token-cancel" style="background:rgba(255,255,255,.06);border:0;border-radius:8px;padding:8px 18px;color:#b5b6bb;font:500 13px Inter,sans-serif;cursor:pointer;">Отмена</button>
        <button id="zs-aki-token-apply" style="background:#34D399;border:0;border-radius:8px;padding:8px 18px;color:#0a0a0f;font:500 13px Inter,sans-serif;cursor:pointer;">Проверить и применить</button>
      </div>
    </div>`;
    document.body.appendChild(layer);
    layer.querySelector('#zs-aki-token-cancel').onclick = () => layer.style.display = 'none';
    layer.querySelector('#zs-aki-token-apply').onclick = async () => {
      const t = layer.querySelector('#zs-aki-token-input').value.trim();
      const st = layer.querySelector('#zs-aki-token-status');
      st.style.color = '#b5b6bb'; st.textContent = 'Проверяем…';
      try {
        await applyAkiToken(t);
        st.style.color = '#34D399'; st.textContent = 'Токен применён ✓';
        setTimeout(() => layer.style.display = 'none', 1200);
      } catch(e) { st.style.color = '#f87171'; st.textContent = e.message; }
    };
  }

  /* inject button after page load */
  function injectAkiBtn() {
    if (document.getElementById('zs-aki-change-btn')) return;
    /* look for the Fireworks token button as anchor */
    const anchor = document.getElementById('zs-fw-change-btn') ||
                   document.querySelector('[data-zs-fw-btn]') ||
                   document.querySelector('.zs-fw-token-btn');
    if (!anchor) return;
    const btn = document.createElement('button');
    btn.id = 'zs-aki-change-btn';
    btn.textContent = 'Сменить токен Aki';
    btn.className = anchor.className;
    btn.style.marginTop = '8px';
    btn.addEventListener('click', () => akiModal(btn.className));
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAkiBtn);
  } else {
    injectAkiBtn();
    setTimeout(injectAkiBtn, 1500);
  }
})();

/* Zelscan Aki token button v1 */
(() => {
  const API = '';
  const heads = (csrf = '') => {
    const h = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('lzt_token') || '';
    if (token) h.Authorization = 'Bearer ' + token;
    if (csrf) h['X-CSRF-Token'] = csrf;
    return h;
  };
  async function request(url, options = {}) {
    const response = await fetch(API + url, { credentials: 'include', headers: heads(), ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.result || 'Ошибка запроса');
    return data;
  }
  async function applyAkiToken(token) {
    if (!token) throw new Error('Вставьте токен Aki.io');
    const access = await request('/api/admin/access');
    if (!access.unlocked || !access.csrf) throw new Error('Сначала войдите в админку');
    await request('/api/admin/ai/aki/token/verify', { method: 'POST', headers: heads(access.csrf), body: JSON.stringify({ token }) });
    return request('/api/admin/ai/aki/token/replace', { method: 'POST', headers: heads(access.csrf), body: JSON.stringify({ token }) });
  }
  function openAkiModal(buttonClass) {
    let layer = document.querySelector('[data-zs-aki-modal]');
    if (layer) { layer.style.display = 'flex'; layer.querySelector('input').focus(); return; }
    layer = document.createElement('div');
    layer.dataset.zsAkiModal = '1';
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.8)';
    layer.innerHTML = '<section role="dialog" aria-modal="true" style="width:420px;max-width:100%;padding:20px;border:1px solid hsl(var(--border));border-radius:12px;background:hsl(var(--background));color:hsl(var(--foreground))"><h2 style="margin:0 0 8px;font-size:16px">Сменить токен Aki.io</h2><p style="margin:0 0 16px;color:hsl(var(--muted-foreground));font-size:12px">Токен будет заменён только после успешной проверки.</p><input type="password" autocomplete="off" placeholder="UUID ключ Aki" style="width:100%;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid hsl(var(--input));border-radius:7px;background:transparent;color:inherit"><div data-status style="min-height:18px;margin-top:8px;font-size:12px"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" data-cancel>Отмена</button><button type="button" data-apply>Проверить и применить</button></div></section>';
    document.body.append(layer);
    const input = layer.querySelector('input');
    const status = layer.querySelector('[data-status]');
    const apply = layer.querySelector('[data-apply]');
    layer.querySelectorAll('button').forEach(button => { button.className = buttonClass || ''; });
    const close = () => layer.remove();
    layer.querySelector('[data-cancel]').onclick = close;
    layer.onclick = event => { if (event.target === layer) close(); };
    apply.onclick = async () => {
      apply.disabled = true;
      status.style.color = '';
      status.textContent = 'Проверяем…';
      try {
        await applyAkiToken(input.value.trim());
        input.value = '';
        status.style.color = '#34d399';
        status.textContent = 'Токен применён ✓';
      } catch (error) {
        status.style.color = '#f87171';
        status.textContent = error.message || 'Ошибка';
      } finally {
        apply.disabled = false;
      }
    };
    input.focus();
  }
  function injectAkiButton() {
    if (document.querySelector('[data-zs-aki-change]')) return;
    const tests = [...document.querySelectorAll('button')].filter(button => /(?:Тест|Проверить)/i.test((button.textContent || '').trim()));
    for (const test of tests) {
      let card = test.parentElement;
      while (card && card !== document.body && !/Aki(?:\.io)?/i.test(card.textContent || '')) card = card.parentElement;
      if (!card || card === document.body) continue;
      const button = test.cloneNode(false);
      button.type = 'button';
      button.removeAttribute('disabled');
      button.dataset.zsAkiChange = '1';
      button.textContent = 'Сменить токен';
      button.onclick = () => openAkiModal(test.className);
      test.insertAdjacentElement('afterend', button);
      return;
    }
  }
  document.addEventListener('DOMContentLoaded', injectAkiButton);
  setInterval(injectAkiButton, 700);
})();

  async function applyToken(token){const a=await session(true);if(!a.unlocked||!a.csrf)throw Error('Сначала войдите в админку');const r=await fetch(API+'/api/admin/ai/fireworks/token/replace',{method:'POST',credentials:'include',headers:heads(a.csrf),body:JSON.stringify({token})}),d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw Error(d.error||'Токен не прошёл проверку');return d}
  function ensureGeometry(){if(document.querySelector('#zs-fw-geometry'))return;const s=document.createElement('style');s.id='zs-fw-geometry';s.textContent='[data-zs-fw-layer]{position:fixed!important;inset:0!important;z-index:2147483000!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:20px!important;box-sizing:border-box!important;background:rgba(0,0,0,.80)!important}[data-zs-fw-dialog]{position:relative!important;width:440px!important;max-width:calc(100vw - 40px)!important;max-height:calc(100vh - 40px)!important;overflow:auto!important;box-sizing:border-box!important;border:1px solid hsl(var(--border))!important;border-radius:12px!important;background:hsl(var(--background))!important;color:hsl(var(--foreground))!important;box-shadow:0 20px 48px rgba(0,0,0,.42)!important;padding:20px!important;font-family:Inter,system-ui,sans-serif!important}[data-zs-fw-dialog] input{height:36px!important;box-sizing:border-box!important;border:1px solid hsl(var(--input))!important;border-radius:7px!important;background:transparent!important;color:hsl(var(--foreground))!important;padding:0 10px!important;font:400 13px/1 Inter,system-ui,sans-serif!important;outline:none!important}[data-zs-fw-dialog] input:focus{border-color:hsl(var(--ring))!important;box-shadow:0 0 0 2px hsl(var(--ring)/.24)!important}';document.head.append(s)}
  function modal(buttonClass){let layer=document.querySelector('[data-zs-fw-layer]');if(layer)return layer;ensureGeometry();layer=document.createElement('div');layer.dataset.zsFwLayer='1';layer.innerHTML='<section data-zs-fw-dialog role="dialog" aria-modal="true" aria-labelledby="zs-fw-title"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px"><div><h2 id="zs-fw-title" style="margin:0;font-size:16px;font-weight:500;line-height:20px">Сменить токен Fireworks</h2><p style="margin:7px 0 0;color:hsl(var(--muted-foreground));font-size:12px;line-height:17px">Новый ключ будет применён в проекте только после успешного ответа Fireworks на тестовый запрос.</p></div><button type="button" data-close aria-label="Закрыть" style="width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:hsl(var(--muted-foreground));font-size:18px;cursor:pointer">×</button></div><div style="display:grid;gap:7px;margin-top:20px"><label for="zs-fw-input" style="font-size:12px;font-weight:500">Новый токен</label><input id="zs-fw-input" type="password" autocomplete="off" placeholder="Вставь новый токен Fireworks"><div id="zs-fw-note" style="min-height:17px;color:hsl(var(--muted-foreground));font-size:12px;line-height:17px">Старый токен остаётся активным, пока новый не пройдёт проверку.</div></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px"><button type="button" data-cancel>Отмена</button><button type="button" data-apply>Проверить и применить</button></div></section>';document.body.append(layer);const input=layer.querySelector('#zs-fw-input'),note=layer.querySelector('#zs-fw-note'),apply=layer.querySelector('[data-apply]'),cancel=layer.querySelector('[data-cancel]');[apply,cancel].forEach(b=>b.className=buttonClass);const say=(t,state='')=>{note.textContent=t;note.style.color=state==='err'?'hsl(var(--destructive))':state==='ok'?'hsl(var(--primary))':'hsl(var(--muted-foreground))'};const close=()=>layer.remove();cancel.onclick=close;layer.querySelector('[data-close]').onclick=close;layer.onclick=e=>{if(e.target===layer)close()};apply.onclick=async()=>{const token=input.value.trim();if(!token)return say('Вставь новый токен Fireworks.','err');apply.disabled=true;say('Проверяем Fireworks и применяем токен…');try{const d=await applyToken(token);input.value='';say(d.message||'Fireworks ответил успешно. Новый токен применён в проекте.','ok')}catch(e){say(e.message||'Проверка не прошла. Старый токен сохранён.','err')}finally{apply.disabled=false}};return layer}
  async function add(){const st=await session().catch(()=>null);if(!st||!st.unlocked)return;[...document.querySelectorAll('button')].filter(b=>/(?:Тест|Проверить)/i.test((b.textContent||'').trim())).forEach(test=>{let card=test.parentElement;while(card&&card!==document.body&&!/Fireworks AI/i.test(card.textContent||''))card=card.parentElement;if(!card||card.querySelector('[data-zs-fw-change]'))return;const b=test.cloneNode(false);b.type='button';b.removeAttribute('disabled');b.dataset.zsFwChange='1';b.textContent='Сменить токен';b.onclick=()=>modal(test.className).querySelector('#zs-fw-input').focus();test.insertAdjacentElement('afterend',b)})}
  document.addEventListener('DOMContentLoaded',add);setInterval(()=>add().catch(()=>{}),500);
})();


/* Zelscan independent AI model slots v1 */
(() => {
  const API = '';
  const SLOT_META = [
    ['lite', 'Lite', 'Быстрый первичный анализ'],
    ['max', 'Max', 'Детальный анализ поведения'],
    ['psychologist', 'Psychologist', 'Личностный профиль: Big Five и Тёмная триада']
  ];
  let loaded = false;
  let state = null;

  const adminHeaders = (csrf = '') => {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('lzt_token') || '';
    if (token) headers.Authorization = `Bearer ${token}`;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    return headers;
  };
  const request = async (url, options = {}) => {
    const response = await fetch(API + url, {
      credentials: 'include',
      headers: adminHeaders(),
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие');
    return data;
  };

  const currentSlotValue = (slot) => state?.config?.[`${slot}_model_id`] || state?.config?.model_id || '';
  const enabledModels = () => (state?.providers || []).flatMap(provider =>
    (provider.models || [])
      .filter(model => provider.enabled && model.enabled)
      .map(model => ({ id: model.id, name: model.label || model.model, provider: provider.name || provider.id }))
  );

  const optionMarkup = (selected) => enabledModels().map(model =>
    `<option value="${model.id}" ${model.id === selected ? 'selected' : ''}>${model.name} — ${model.provider}</option>`
  ).join('');

  function mount() {
    const labels = [...document.querySelectorAll('label')];
    const originalLabel = labels.find(label => label.textContent.trim() === 'Модель генерации');
    const originalGroup = originalLabel?.closest('.space-y-2');
    if (!originalGroup || originalGroup.dataset.zsModelSlotsHidden === '1') return;

    originalGroup.dataset.zsModelSlotsHidden = '1';
    originalGroup.style.display = 'none';

    const nativeTrigger = originalGroup.querySelector('[role="combobox"]');
    const selectClass = nativeTrigger?.className || 'flex w-full items-center rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm outline-none dark:bg-input/30';
    const slots = document.createElement('div');
    slots.dataset.zsAiModelSlots = '1';
    slots.className = 'space-y-3';
    slots.innerHTML = `
      <div class="space-y-1">
        <div class="text-sm font-medium">Модели формирования</div>
        <p class="text-xs text-muted-foreground">Настройки фиксируются при создании заказа и не меняют уже запущенные досье.</p>
      </div>
      ${SLOT_META.map(([slot, title, hint]) => `
        <div class="space-y-2" data-zs-ai-slot="${slot}">
          <label class="flex items-center gap-2 text-sm leading-none font-medium">${title}</label>
          <select class="${selectClass}" aria-label="Модель ${title}" data-zs-ai-select="${slot}">${optionMarkup(currentSlotValue(slot))}</select>
          <p class="text-xs text-muted-foreground">${hint}</p>
        </div>`).join('')}
      <div class="flex items-center gap-3 pt-1">
        <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50" data-zs-ai-save>Сохранить модели</button>
        <span class="text-xs text-muted-foreground" data-zs-ai-status></span>
      </div>`;
    originalGroup.insertAdjacentElement('afterend', slots);

    const save = slots.querySelector('[data-zs-ai-save]');
    const status = slots.querySelector('[data-zs-ai-status]');
    save.addEventListener('click', async () => {
      const payload = { reason: 'Изменение моделей генерации из админки' };
      SLOT_META.forEach(([slot]) => { payload[`${slot}_model_id`] = slots.querySelector(`[data-zs-ai-select="${slot}"]`).value; });
      save.disabled = true;
      status.textContent = 'Сохраняем…';
      try {
        const access = await request('/api/admin/access');
        if (!access.unlocked || !access.csrf) throw new Error('Сначала войдите в админку');
        const result = await request('/api/admin/ai/config', {
          method: 'POST', headers: adminHeaders(access.csrf), body: JSON.stringify(payload)
        });
        state.config = result.config || state.config;
        status.textContent = 'Модели сохранены';
      } catch (error) {
        status.textContent = error.message || 'Не удалось сохранить модели';
      } finally {
        save.disabled = false;
      }
    });
  }

  let loginLayer = null;
  async function ensureAdminLogin() {
    const access = await request('/api/admin/access');
    if (!access.eligible) throw new Error('Доступ разрешён только администратору');
    if (access.unlocked) return true;
    if (loginLayer) return false;
    loginLayer = document.createElement('div');
    loginLayer.style.cssText = 'position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.82)';
    loginLayer.innerHTML = '<section style="width:380px;max-width:100%;padding:24px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#111;color:#eee;font-family:Inter,system-ui"><h2 style="margin:0 0 8px;font-size:18px">Вход в админ-панель</h2><p style="margin:0 0 16px;color:#999;font-size:13px">Введите пароль администратора.</p><input type="password" autocomplete="current-password" placeholder="Пароль" style="box-sizing:border-box;width:100%;height:40px;padding:0 12px;border:1px solid #333;border-radius:8px;background:#191919;color:#eee"><div data-error style="min-height:18px;margin-top:8px;color:#f87171;font-size:12px"></div><button type="button" style="width:100%;height:40px;margin-top:8px;border:0;border-radius:8px;background:#34D399;color:#07120d;font-weight:600;cursor:pointer">Войти</button></section>';
    document.body.append(loginLayer);
    const input = loginLayer.querySelector('input');
    const button = loginLayer.querySelector('button');
    const error = loginLayer.querySelector('[data-error]');
    const submit = async () => {
      button.disabled = true; error.textContent = '';
      try {
        await request('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: input.value }) });
        loginLayer.remove(); loginLayer = null; loaded = false; await hydrate();
      } catch (e) { error.textContent = e.message || 'Не удалось войти'; }
      finally { button.disabled = false; }
    };
    button.onclick = submit;
    input.onkeydown = event => { if (event.key === 'Enter') submit(); };
    setTimeout(() => input.focus(), 0);
    return false;
  }

  async function hydrate() {
    if (loaded) return;
    try {
      if (!(await ensureAdminLogin())) return;
      state = await request('/api/admin/ai');
      loaded = true;
      mount();
    } catch (_) {}
  }

  const tick = () => { hydrate(); if (loaded) mount(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
  else tick();
  setInterval(tick, 700);
})();

/* Zelscan admin — превью уведомления («Демо»).
 * Показывает, как рассылаемое уведомление будет выглядеть у пользователя
 * (иконка + тон по типу, заголовок, текст) — 1:1 со стилем zs-notice/zs-noti.
 * Вызывается из кнопки «Демо» рядом с «Разослать».
 * API: window.__zsAdminDemoNotice({ type, title, body }).
 */
(() => {
  // Тип уведомления -> тон (совпадает с landing/assets/js/zs-notifications.js).
  const TONE = {
    dossier_ready: 'success',
    formation_error: 'error',
    balance_topup: 'info',
    news: 'info',
  };
  const COLOR = { success: '#34d399', error: '#e65062', warning: '#ecab27', info: '#5e9bf8' };
  const ICON = {
    success: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="m6.5 10 2.4 2.4 4.6-4.8"/></svg>',
    error:   '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="m7.3 7.3 5.4 5.4M12.7 7.3l-5.4 5.4"/></svg>',
    info:    '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="M10 9v4M10 6.6v.2"/></svg>',
    warning: '<svg viewBox="0 0 20 20"><path d="M10 3 2.5 16h15z"/><path d="M10 8.5v3M10 13.6v.2"/></svg>',
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function close(layer) {
    if (!layer || !layer.parentNode) return;
    layer.style.opacity = '0';
    setTimeout(() => { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 160);
  }

  window.__zsAdminDemoNotice = function (opts) {
    opts = opts || {};
    const tone = TONE[opts.type] || 'info';
    const color = COLOR[tone];
    const title = esc(opts.title || 'Заголовок уведомления');
    const body = opts.body ? esc(opts.body) : '';
    const svg = ICON[tone] || ICON.info;

    // Убираем предыдущий превью, если открыт.
    const prev = document.querySelector('[data-zs-demo-notice]');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    const layer = document.createElement('div');
    layer.setAttribute('data-zs-demo-notice', '1');
    Object.assign(layer.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', opacity: '0', transition: 'opacity .16s ease',
      fontFamily: 'Inter,Arial,sans-serif',
    });

    layer.innerHTML =
      '<div style="width:420px;max-width:92vw;background:#141418;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:22px 22px 20px;box-shadow:0 24px 62px rgba(0,0,0,.5);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
          '<div style="font:600 15px Inter,sans-serif;color:#f3f3f5;letter-spacing:-.02em;">Как увидит пользователь</div>' +
          '<button data-zs-demo-x type="button" aria-label="Закрыть" style="width:28px;height:28px;border:0;border-radius:8px;background:rgba(255,255,255,.06);color:#b5b6bb;cursor:pointer;font-size:16px;line-height:1;">&times;</button>' +
        '</div>' +
        '<div style="font:400 12px Inter,sans-serif;color:#8b8e93;margin-bottom:16px;">Предпросмотр — уведомление ещё не отправлено.</div>' +

        // Мини-«хедер» с колокольчиком (контекст, где появится уведомление).
        '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">' +
          '<span style="position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:999px;background:rgba(255,255,255,.05);color:#c7c8cc;">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' +
            '<span style="position:absolute;top:-2px;right:-1px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#e65062;color:#fff;font:600 10px/16px Inter,sans-serif;box-shadow:0 0 0 2px #141418;">1</span>' +
          '</span>' +
        '</div>' +

        // Сам элемент уведомления — в стиле .zs-noti-item / .zs-notice.
        '<div style="--tone:' + color + ';display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;padding:12px 12px;border-radius:12px;background:rgba(94,155,248,.08);">' +
          '<span style="width:20px;height:20px;display:grid;place-items:center;color:' + color + ';margin-top:1px;">' +
            '<span style="display:grid;place-items:center;width:16px;height:16px;">' +
              svg.replace('<svg ', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ') +
            '</span>' +
          '</span>' +
          '<div style="min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:7px;color:#f0f1f1;font:600 13px Inter,sans-serif;letter-spacing:-.01em;">' +
              '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</span>' +
              '<span style="margin-left:auto;flex:none;color:#6d7076;font:400 11px Inter,sans-serif;">только что</span>' +
            '</div>' +
            (body ? '<p style="margin:3px 0 0;color:#a7a9ad;font:400 12px/1.4 Inter,sans-serif;word-break:break-word;">' + body + '</p>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(layer);
    requestAnimationFrame(() => { layer.style.opacity = '1'; });

    layer.addEventListener('click', (e) => { if (e.target === layer) close(layer); });
    const x = layer.querySelector('[data-zs-demo-x]');
    if (x) x.addEventListener('click', () => close(layer));
    const onKey = (e) => { if (e.key === 'Escape') { close(layer); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  };

  // React-чанк админки скомпилирован, вставленная в него native-кнопка может
  // не иметь рабочего onClick после гидрации. Поэтому bridge сам создаёт
  // кнопку «Демо» рядом с «Разослать» и вешает обычный DOM-обработчик.
  const typeByLabel = {
    'Новость': 'news',
    'Досье готово': 'dossier_ready',
    'Пополнение': 'balance_topup',
    'Пополнение баланса': 'balance_topup',
    'Ошибка формирования': 'formation_error',
  };

  function readForm(root) {
    const scope = root || document;
    const titleInput = scope.querySelector('input[maxlength="120"]') ||
      document.querySelector('input[maxlength="120"]');
    const bodyInput = scope.querySelector('textarea[maxlength="600"]') ||
      document.querySelector('textarea[maxlength="600"]');
    const triggers = [...document.querySelectorAll('[role="combobox"]')];
    const typeTrigger = triggers.find((el) =>
      Object.prototype.hasOwnProperty.call(typeByLabel, (el.textContent || '').trim()));
    const type = typeByLabel[(typeTrigger && typeTrigger.textContent || '').trim()] || 'news';
    return {
      type,
      title: (titleInput && titleInput.value) || '',
      body: (bodyInput && bodyInput.value) || '',
    };
  }

  function findSendButton() {
    return [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      return t === 'Разослать' || t === 'Отправляем…' || t === 'Отправляем...';
    });
  }

  function injectDemoButton() {
    const send = findSendButton();
    if (!send) return;
    // Уже поставили нашу кнопку рядом?
    if (send.parentElement && send.parentElement.querySelector('[data-zs-demo-btn]')) return;

    const demo = document.createElement('button');
    demo.type = 'button';
    demo.dataset.zsDemoBtn = '1';
    demo.textContent = 'Демо';
    // Наследуем внешний вид от кнопки «Разослать», но делаем «вторичной».
    demo.className = send.className;
    demo.style.marginLeft = '8px';
    demo.style.background = 'transparent';
    demo.style.border = '1px solid rgba(255,255,255,.16)';
    demo.style.color = 'inherit';
    demo.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const data = readForm(send.closest('.rounded-xl') || send.closest('form') || document);
      window.__zsAdminDemoNotice(data);
    });
    send.insertAdjacentElement('afterend', demo);
  }

  // Также ловим клик по уже существующей «Демо» из чанка (на всякий случай).
  // Устойчивое совпадение: игнорируем иконки/пробелы/невидимые символы вокруг «Демо».
  const isDemoLabel = (el) =>
    /^\s*Демо\s*$/.test((el && el.textContent || '').replace(/\s+/g, ' ').trim());
  document.addEventListener('click', (event) => {
    const button = event.target.closest && event.target.closest('button');
    if (!button) return;
    if (button.dataset.zsDemoBtn) return; // нашу кнопку обрабатывает её собственный listener
    if (!isDemoLabel(button)) return;
    console.log('[zs-demo] click intercepted on chunk button:', JSON.stringify(button.textContent));
    event.preventDefault();
    event.stopImmediatePropagation();
    window.__zsAdminDemoNotice(readForm(button.closest('.rounded-xl') || document));
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDemoButton);
  } else {
    injectDemoButton();
  }
  setInterval(injectDemoButton, 800);
})();
