(function () {
  const bootDone = () => {
    if (window.ZSSkeleton && typeof window.ZSSkeleton.bootDone === 'function') window.ZSSkeleton.bootDone();
    else document.documentElement.classList.add('zs-boot-done');
  };
  bootDone();

  // Успех — фрагмент после # (по докам OAuth2 Lolzteam).
  const hash  = new URLSearchParams(window.location.hash.slice(1));
  // Ошибки — query-параметры после ? (по докам).
  const query = new URLSearchParams(window.location.search);

  const token = hash.get('access_token');
  const err   = query.get('error_description') || query.get('error')
             || hash.get('error_description') || hash.get('error');
  const state = hash.get('state') || query.get('state') || '';

  let saved = null;
  try { saved = sessionStorage.getItem('lzt_oauth_state'); } catch (_e) {}
  try { sessionStorage.removeItem('lzt_oauth_state'); } catch (_e) {}

  const txt = document.getElementById('txt');
  const openerOrigin = window.location.origin;
  const trustedOpener = window.opener && !window.opener.closed ? window.opener : null;

  function notifyOpener(payload) {
    if (!trustedOpener) return false;
    trustedOpener.postMessage(Object.assign({ state: state }, payload), openerOrigin);
    return true;
  }

  function fail(msg) {
    document.getElementById('oauthCore').style.display = 'none';
    txt.className = 'err';
    txt.textContent = msg;
    if (notifyOpener({ type: 'lzt_auth_error', error: msg })) {
      setTimeout(() => window.close(), 2000);
    }
  }

  if (!token) return fail(err || 'Авторизация отклонена');

  // CSRF/login-CSRF: state is mandatory, exact-match and single-use.
  if (!saved || !state || state !== saved) return fail('Ошибка безопасности (state). Попробуй войти снова.');

  async function exchangeToken() {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Сервер отклонил авторизацию');
      }
      history.replaceState(null, document.title, window.location.pathname);
      ['lzt_token', 'lzt_token_expires', 'lzt_user_id'].forEach((key) => localStorage.removeItem(key));
      txt.textContent = 'Готово! Переходим в приложение...';
      window.location.replace('/app');
    } catch (error) {
      history.replaceState(null, document.title, window.location.pathname);
      fail('Не удалось создать безопасную сессию: ' + (error.message || 'ошибка сервера'));
    }
  }

  exchangeToken();
})();
