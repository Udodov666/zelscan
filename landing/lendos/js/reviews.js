/* Reviews: desktop scroll animation, static responsive cards below 1280px. */
(function(){
  const zone = document.querySelector('.b4-scroll-zone');
  const cards = Array.from(document.querySelectorAll('.b4-cards .rv-card'));
  if(!zone || !cards.length) return;

  const desktopQuery = window.matchMedia('(min-width: 1280px)');
  const STACK = [
    {x:-290,y:40,r:-8,z:1},
    {x:0,y:0,r:-1,z:3},
    {x:290,y:28,r:6,z:2}
  ];
  const SPREAD = [
    {x:-440,y:0,r:0,z:1},
    {x:0,y:0,r:0,z:2},
    {x:440,y:0,r:0,z:3}
  ];

  let desktop = desktopQuery.matches;

  function lerp(a,b,t){return a+(b-a)*t;}
  function easeInOut(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}

  function clearResponsiveTransforms(){
    zone.style.height='auto';
    cards.forEach(function(card){
      card.style.removeProperty('transform');
      card.style.removeProperty('z-index');
    });
  }

  function render(progress){
    if(!desktop) return;
    const eased=easeInOut(progress);
    cards.forEach(function(card,index){
      const start=STACK[index] || STACK[1];
      const end=SPREAD[index] || SPREAD[1];
      card.style.transform='translateX('+lerp(start.x,end.x,eased)+'px) translateY('+lerp(start.y,end.y,eased)+'px) rotate('+lerp(start.r,end.r,eased)+'deg)';
      card.style.zIndex=String(eased>.5?end.z:start.z);
    });
  }

  function measure(){
    desktop=desktopQuery.matches;
    if(!desktop){
      clearResponsiveTransforms();
      return;
    }
    zone.style.height=(window.innerHeight*2)+'px';
    onScroll();
  }

  function onScroll(){
    if(!desktop) return;
    const rect=zone.getBoundingClientRect();
    const scrollable=Math.max(1,zone.offsetHeight-window.innerHeight);
    render(Math.max(0,Math.min(1,-rect.top/scrollable)));
  }

  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  if(desktopQuery.addEventListener) desktopQuery.addEventListener('change',measure);
  else desktopQuery.addListener(measure);
  measure();
})();
