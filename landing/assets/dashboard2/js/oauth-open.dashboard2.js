(() => {
'use strict';
window.openOAuth=async function openOAuth(){
  let cfg=null;
  try{
    const response=await fetch('/api/oauth/config',{credentials:'same-origin',cache:'no-store'});
    if(response.ok)cfg=await response.json();
  }catch(_){}
  if(!cfg||!cfg.client_id){
    alert('OAuth-вход не настроен. Обратитесь к администратору.');
    return;
  }
  const state=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(36)).join('');
  try{sessionStorage.setItem('lzt_oauth_state',state);}catch(_){}
  try{
    const authorizeUrl=new URL(String(cfg.authorize_url||''));
    if(authorizeUrl.protocol!=='https:'||!['lolz.team','lolz.live'].includes(authorizeUrl.hostname))throw new Error('bad OAuth origin');
    const redirectUrl=new URL(String(cfg.redirect_uri||''),location.href);
    if(redirectUrl.origin!==location.origin||!/^\/oauth\/callback\/?$/i.test(redirectUrl.pathname))throw new Error('bad redirect');
    authorizeUrl.searchParams.set('client_id',String(cfg.client_id));
    authorizeUrl.searchParams.set('response_type','token');
    authorizeUrl.searchParams.set('scope',String(cfg.scope||'basic'));
    authorizeUrl.searchParams.set('redirect_uri',redirectUrl.href);
    authorizeUrl.searchParams.set('state',state);
    location.assign(authorizeUrl.href);
  }catch(_){
    alert('OAuth-вход настроен небезопасно. Обратитесь к администратору.');
  }
};

try{
  const url=new URL(location.href);
  if(url.searchParams.get('oauth_start')==='1'){
    url.searchParams.delete('oauth_start');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    setTimeout(()=>window.openOAuth(),0);
  }
}catch(_){}
})();
