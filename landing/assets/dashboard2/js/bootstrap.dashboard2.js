(() => {
'use strict';
const base=(window.ZS_DASHBOARD2_API_BASE||'').replace(/\/$/,'');
const inflight=new Map(),cache=new Map();
function headers(extra){return Object.assign({'Content-Type':'application/json'},extra||{});}
function safeUrl(value){try{const u=new URL(String(value||''),location.href);return /^(https?:)$/i.test(u.protocol)?u.href:'';}catch(_){return '';}}
async function apiFetch(path,opts={}){const guard=window.ZSAuthGuard;if(guard&&!guard.isAuthenticated()){await guard.check();if(!guard.isAuthenticated())return new Response(JSON.stringify({error:'auth_required'}),{status:401,headers:{'Content-Type':'application/json'}});}const method=(opts.method||'GET').toUpperCase();const key=method+' '+path;const ttl=opts.cacheTtl==null?1500:Number(opts.cacheTtl);if(method==='GET'){const hit=cache.get(key);if(hit&&Date.now()-hit.at<ttl)return hit.response.clone();if(inflight.has(key))return (await inflight.get(key)).clone();}
 const job=fetch(base+path,Object.assign({},opts,{credentials:'same-origin',headers:headers(opts.headers)})).then(r=>{if(r.status===401){cache.clear();document.dispatchEvent(new CustomEvent('zs:auth-401'));}if(method==='GET'&&r.ok)cache.set(key,{at:Date.now(),response:r.clone()});return r;}).finally(()=>inflight.delete(key));if(method==='GET')inflight.set(key,job);return (await job).clone();}
window.ZSDashboard2={apiBase:base,headers,safeUrl,apiFetch,invalidate(){cache.clear();}};
window.zsAccountApi=base;window.zsAuthHeaders=()=>headers();
})();
