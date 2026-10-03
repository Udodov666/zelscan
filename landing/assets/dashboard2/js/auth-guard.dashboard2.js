(() => {
'use strict';
const root=document.documentElement;
const legacyKeys=['lzt_token','lzt_token_expires','lzt_user_id','lzt_user','lzt_user_ts'];
let state='pending';
let session=null;
let checkPromise=null;

function clearLegacy(){
  try{legacyKeys.forEach(key=>localStorage.removeItem(key));}catch(_){}
}
function emit(next,detail){
  state=next;
  root.dataset.zsAuth=next;
  root.classList.toggle('zs-auth-ok',next==='authenticated');
  document.dispatchEvent(new CustomEvent('zs:auth-state',{detail:Object.assign({state:next},detail||{})}));
  if(next==='authenticated')document.dispatchEvent(new CustomEvent('zs:auth-ok',{detail:{state:next,session:session,user:session}}));
}
function setMessage(title,copy){
  const titleEl=document.getElementById('zsAuthTitle');
  const copyEl=document.getElementById('zsAuthCopy');
  if(titleEl)titleEl.textContent=title;
  if(copyEl)copyEl.textContent=copy;
}
function guest(){
  session=null;
  clearLegacy();
  setMessage('Войдите в Zelscan','Для доступа к панели нужна активная сессия Lolzteam.');
  emit('guest');
}
function error(){
  session=null;
  setMessage('Не удалось проверить сессию','Проверьте соединение и попробуйте ещё раз.');
  emit('error');
}
async function check(){
  if(checkPromise)return checkPromise;
  emit('pending');
  checkPromise=fetch('/api/auth/session',{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}})
    .then(async response=>{
      if(response.status===401){guest();return null;}
      if(!response.ok){error();return null;}
      const data=await response.json();
      session=data&&data.user?data.user:data;
      emit('authenticated',{session:session});
      return session;
    })
    .catch(()=>{error();return null;})
    .finally(()=>{checkPromise=null;});
  return checkPromise;
}
function retry(){return check();}
function handle401(){guest();}

window.ZSAuthGuard={check,retry,clearLegacy,getState:()=>state,getSession:()=>session,isAuthenticated:()=>state==='authenticated'};
document.addEventListener('zs:auth-401',handle401);
document.addEventListener('click',event=>{
  const retryButton=event.target.closest&&event.target.closest('[data-zs-auth-retry]');
  if(retryButton){event.preventDefault();retry();return;}
  const loginButton=event.target.closest&&event.target.closest('[data-action="open-oauth"]');
  if(loginButton&&typeof window.openOAuth==='function'){event.preventDefault();window.openOAuth();}
});
check();
})();
