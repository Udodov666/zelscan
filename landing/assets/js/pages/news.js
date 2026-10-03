(()=>{
  const API=(window.zsAccountApi)||'';
  const ADMIN_UID=638074;
  const MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const VERIFIED_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#12ce90" d="M12 1.5l2.4 1.83 3-.32 1.2 2.77 2.77 1.2-.32 3L23 12l-1.83 2.4.32 3-2.77 1.2-1.2 2.77-3-.32L12 22.5l-2.4-1.83-3 .32-1.2-2.77-2.77-1.2.32-3L1 12l1.83-2.4-.32-3 2.77-1.2 1.2-2.77 3 .32L12 1.5z"/><path d="M8.4 12.3l2.5 2.5 4.7-5.4" fill="none" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const MENU_HTML='<button class="news-menu-btn" type="button" aria-label="Действия"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button><div class="news-menu-pop"><button class="news-menu-item" data-news-edit type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Редактировать</button><button class="news-menu-item danger" data-news-delete type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Удалить</button></div>';

  const token=()=>localStorage.getItem('lzt_token')||'';
  const currentUser=()=>{try{return JSON.parse(localStorage.getItem('lzt_user')||'null')}catch(_){return null}};
  const headers=()=>{const h={'Content-Type':'application/json'};const t=token();if(t)h.Authorization='Bearer '+t;return h};
  const apiFetch=(path,options={})=>fetch(API+path,{credentials:'same-origin',...options,headers:{...headers(),...(options.headers||{})}});
  const isAdmin=()=>{const u=currentUser();return !!(u&&Number(u.user_id)===ADMIN_UID)};

  const feed=document.getElementById('newsFeed');
  const stateEl=document.getElementById('newsState');
  const createBtn=document.getElementById('newsCreateBtn');
  const overlay=document.getElementById('newsCreateModal');
  const modalTitle=document.getElementById('ncModalTitle');
  const closeBtn=document.getElementById('ncClose');
  const cancelBtn=document.getElementById('ncCancel');
  const publishBtn=document.getElementById('ncPublish');
  const titleInput=document.getElementById('ncTitle');
  const bodyInput=document.getElementById('ncBody');
  const tagInput=document.getElementById('ncTagInput');
  const tagBox=document.getElementById('ncTagBox');

  let posts=[];
  let editing=null;      // id редактируемого поста или null
  const tags=[];

  const esc=s=>{const d=document.createElement('div');d.textContent=String(s==null?'':s);return d.innerHTML};
  const fmtDate=ts=>{const d=new Date((ts||0)*1000);return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear()};

  const bodyToHtml=body=>{
    const lines=String(body||'').split(/\n/).map(l=>l.trim()).filter(Boolean);
    let html='';let list=[];
    const flush=()=>{if(!list.length)return;html+='<ul>'+list.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>';list=[]};
    lines.forEach(line=>{const m=line.match(/^[*-]\s+(.+)$/);if(m){list.push(m[1]);return}flush();html+='<p>'+esc(line)+'</p>'});
    flush();return html;
  };

  const authorName=p=>String(p.author_name||'Автор');
  const authorInitial=p=>Array.from(authorName(p).trim())[0]||'А';
  const postHtml=p=>{
    const admin=isAdmin();
    const tagsHtml=(p.tags&&p.tags.length)?'<div class="news-tags">'+p.tags.map(t=>'<span class="news-tag">'+esc(t)+'</span>').join('')+'</div>':'';
    const menuHtml=admin?'<div class="news-menu">'+MENU_HTML+'</div>':'';
    const liked=p.liked?' liked':'';
    const heart=p.liked?'fa-solid':'fa-regular';
    return '<article class="news-row" data-id="'+esc(p.id)+'">'
      +'<header class="news-author"><span class="news-avatar" data-news-avatar data-avatar="'+esc(p.author_avatar||'')+'">'+esc(authorInitial(p))+'</span><span class="news-author-copy"><span class="news-author-line"><span class="news-author-name">'+esc(authorName(p))+'</span><span class="news-verified" aria-label="Подтверждено">'+VERIFIED_SVG+'</span></span><time class="news-date">'+esc(fmtDate(p.created_at))+'</time></span></header>'
      +menuHtml
      +'<h2 class="news-title">'+esc(p.title||'Без заголовка')+'</h2>'
      +tagsHtml
      +'<div class="news-body">'+bodyToHtml(p.body)+'</div>'
      +'<footer class="news-footer"><button class="news-like'+liked+'" type="button" data-like aria-pressed="'+(p.liked?'true':'false')+'"><i class="'+heart+' fa-heart" aria-hidden="true"></i><span>'+(p.like_count||0)+'</span></button></footer>'
      +'</article>';
  };

  const paintAvatars=()=>{
    feed.querySelectorAll('[data-news-avatar]').forEach(av=>{
      const src=av.getAttribute('data-avatar');
      if(!src)return;
      const fallback=av.textContent;
      const img=document.createElement('img');img.src=src;img.alt='';img.referrerPolicy='no-referrer';
      img.addEventListener('error',()=>{av.textContent=fallback});av.replaceChildren(img);
    });
  };

  const render=()=>{
    if(!posts.length){feed.innerHTML='<div class="news-state">Пока нет новостей.</div>';return}
    feed.innerHTML=posts.map(postHtml).join('');
    paintAvatars();
  };

  const load=async()=>{
    const skeleton=window.ZSSkeleton;
    const startedAt=skeleton?skeleton.mount(feed,skeleton.newsFeed(3)):performance.now();
    const settle=content=>skeleton
      ?skeleton.settle(feed,content,startedAt)
      :Promise.resolve().then(()=>{const html=typeof content==='function'?content():content;if(html!==undefined)feed.innerHTML=html;feed.removeAttribute('aria-busy')});
    try{
      const r=await apiFetch('/api/news',{headers:headers(),cache:'no-store'});
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||'Не удалось загрузить новости');
      posts=Array.isArray(data.posts)?data.posts:[];
      await settle(()=>{render();return feed.innerHTML});
    }catch(e){
      await settle('<div class="news-state">Не удалось загрузить новости. Попробуйте обновить страницу.</div>');
    }
    createBtn.style.display=isAdmin()?'inline-flex':'none';
  };

  // ── теги в модалке ──
  const renderTags=()=>{
    tagBox.querySelectorAll('.news-tag').forEach(el=>el.remove());
    tags.forEach((tag,i)=>{
      const chip=document.createElement('span');chip.className='news-tag';chip.textContent=tag;
      const x=document.createElement('button');x.type='button';x.className='nc-tag-x';x.setAttribute('aria-label','Удалить тег');x.textContent='×';
      x.addEventListener('click',()=>{tags.splice(i,1);renderTags();tagInput.focus()});
      chip.appendChild(x);tagBox.insertBefore(chip,tagInput);
    });
  };
  const addTag=raw=>{const v=(raw||'').trim();if(v&&!tags.includes(v)){tags.push(v);renderTags()}};
  tagInput.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===','){e.preventDefault();addTag(tagInput.value);tagInput.value=''}
    else if(e.key==='Backspace'&&!tagInput.value&&tags.length){tags.pop();renderTags()}
  });
  tagInput.addEventListener('blur',()=>{if(tagInput.value.trim()){addTag(tagInput.value);tagInput.value=''}});
  tagBox.addEventListener('click',e=>{if(e.target===tagBox)tagInput.focus()});

  const resetForm=()=>{titleInput.value='';bodyInput.value='';tagInput.value='';tags.length=0;renderTags()};
  const setForm=p=>{titleInput.value=p.title||'';bodyInput.value=bodyToText(p);tags.length=0;(p.tags||[]).forEach(t=>tags.push(t));tagInput.value='';renderTags()};
  const bodyToText=p=>String(p.body||'');

  function onEsc(e){if(e.key==='Escape')closeModal()}
  const openModal=()=>{overlay.classList.add('open');document.addEventListener('keydown',onEsc);setTimeout(()=>titleInput.focus(),0)};
  const closeModal=()=>{overlay.classList.remove('open');document.removeEventListener('keydown',onEsc)};

  createBtn.addEventListener('click',()=>{
    if(!isAdmin())return;
    editing=null;modalTitle.textContent='Создать пост';publishBtn.textContent='Опубликовать';resetForm();openModal();
  });
  closeBtn.addEventListener('click',closeModal);
  cancelBtn.addEventListener('click',()=>{closeModal();resetForm()});
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeModal()});

  publishBtn.addEventListener('click',async()=>{
    if(!isAdmin())return;
    const title=titleInput.value.trim();
    const body=bodyInput.value.trim();
    if(!title&&!body)return;
    publishBtn.disabled=true;
    const payload={title,body,tags:tags.slice()};
    try{
      let r;
      if(editing){
        r=await apiFetch('/api/news/'+encodeURIComponent(editing),{method:'PUT',body:JSON.stringify(payload)});
      }else{
        r=await apiFetch('/api/news',{method:'POST',body:JSON.stringify(payload)});
      }
      if(!r.ok){const d=await r.json().catch(()=>({}));alert(d.error||'Ошибка сохранения');return}
      closeModal();resetForm();editing=null;await load();
    }catch(e){alert('Сеть недоступна');}
    finally{publishBtn.disabled=false;}
  });

  // ── делегирование кликов по ленте: меню, лайк ──
  feed.addEventListener('click',async e=>{
    const likeBtn=e.target.closest('[data-like]');
    const menuBtn=e.target.closest('.news-menu-btn');
    const editBtn=e.target.closest('[data-news-edit]');
    const delBtn=e.target.closest('[data-news-delete]');
    const row=e.target.closest('.news-row');
    const id=row&&row.getAttribute('data-id');

    if(likeBtn){
      likeBtn.disabled=true;
      try{
        const r=await apiFetch('/api/news/'+encodeURIComponent(id)+'/like',{method:'POST',headers:headers()});
        if(r.status===401){
          alert('Войдите, чтобы ставить лайки');
          return;
        }
        const d=await r.json().catch(()=>({}));
        if(!r.ok){alert(d.error||'Не удалось изменить лайк');return}
        const p=posts.find(x=>x.id===id);if(p){p.liked=d.liked;p.like_count=d.like_count;}
        likeBtn.classList.toggle('liked',d.liked);
        likeBtn.setAttribute('aria-pressed',String(d.liked));
        const icon=likeBtn.querySelector('i');if(icon){icon.classList.toggle('fa-solid',d.liked);icon.classList.toggle('fa-regular',!d.liked);}
        const span=likeBtn.querySelector('span');if(span)span.textContent=String(d.like_count);
      }catch(_){alert('Сеть недоступна');} finally{likeBtn.disabled=false;}
      return;
    }
    if(menuBtn){
      e.stopPropagation();
      const menu=menuBtn.closest('.news-menu');const was=menu.classList.contains('open');
      document.querySelectorAll('.news-menu.open').forEach(m=>m.classList.remove('open'));
      if(!was)menu.classList.add('open');
      return;
    }
    if(editBtn){
      const p=posts.find(x=>x.id===id);if(!p)return;
      editing=id;modalTitle.textContent='Редактировать пост';publishBtn.textContent='Сохранить';setForm(p);
      document.querySelectorAll('.news-menu.open').forEach(m=>m.classList.remove('open'));
      openModal();return;
    }
    if(delBtn){
      if(!id||!confirm('Удалить этот пост?'))return;
      try{
        const r=await apiFetch('/api/news/'+encodeURIComponent(id),{method:'DELETE'});
        if(r.ok){posts=posts.filter(x=>x.id!==id);render();}
        else{const d=await r.json().catch(()=>({}));alert(d.error||'Не удалось удалить');}
      }catch(_){alert('Сеть недоступна');}
      return;
    }
  });
  document.addEventListener('click',()=>{document.querySelectorAll('.news-menu.open').forEach(m=>m.classList.remove('open'))});

  load();
})();
