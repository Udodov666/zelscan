/* ═══════════════════════════════════════
   FAQ accordion
   ═══════════════════════════════════════ */
document.querySelectorAll('.faq-item').forEach(function(item){
  item.addEventListener('click',function(){
    var wasOpen=item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(i){i.classList.remove('open');});
    if(!wasOpen) item.classList.add('open');
  });
});
