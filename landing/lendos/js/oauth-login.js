(function () {
  'use strict';

  var button = document.querySelector('.hdr-login');
  if (!button) return;

  var config = document.documentElement.dataset;
  var productionAppOrigin = config.oauthAppOrigin || 'https://app.zelscan.xyz';
  var localAppOrigin = config.oauthLocalAppOrigin || 'http://localhost:8080';
  var appOrigin = isLocalHost(window.location.hostname) ? localAppOrigin : productionAppOrigin;

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  }

  function validatedAppOrigin(value) {
    var url = new URL(value);
    var local = isLocalHost(url.hostname);
    if (local) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid local app protocol');
    } else if (url.origin !== 'https://app.zelscan.xyz') {
      throw new Error('Unexpected app origin');
    }
    return url.origin;
  }

  function validatedLolzAuthorizeUrl(value) {
    var url = new URL(value);
    var allowedHosts = ['lolz.team', 'lolz.live', 'zelenka.guru'];
    if (url.protocol !== 'https:' || allowedHosts.indexOf(url.hostname) === -1) {
      throw new Error('Unexpected OAuth provider');
    }
    return url;
  }

  function randomState() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  button.addEventListener('click', async function () {
    try {
      var origin = validatedAppOrigin(appOrigin);

      var response = await fetch(origin + '/api/oauth/config', {
        method: 'GET',
        mode: window.location.origin === origin ? 'same-origin' : 'cors',
        credentials: 'omit',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('OAuth config unavailable');

      var oauth = await response.json();
      if (!oauth.client_id || !oauth.redirect_uri) throw new Error('OAuth is not configured');

      var authorizeUrl = validatedLolzAuthorizeUrl(oauth.authorize_url);
      var callbackUrl = new URL(oauth.redirect_uri);
      if (callbackUrl.origin !== origin) throw new Error('Unexpected callback app origin');
      if (!isLocalHost(callbackUrl.hostname) && callbackUrl.protocol !== 'https:') {
        throw new Error('OAuth callback must use HTTPS');
      }

      var state = randomState();
      sessionStorage.setItem('lzt_oauth_state', state);
      authorizeUrl.searchParams.set('client_id', oauth.client_id);
      authorizeUrl.searchParams.set('redirect_uri', callbackUrl.href);
      authorizeUrl.searchParams.set('response_type', 'token');
      authorizeUrl.searchParams.set('scope', oauth.scope || 'basic');
      authorizeUrl.searchParams.set('state', state);
      window.location.assign(authorizeUrl.href);
    } catch (error) {
      console.error('OAuth start failed:', error);
    }
  });
})();
