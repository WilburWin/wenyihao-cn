(async()=>{
 const root=document.querySelector('[data-portrait-carousel]');if(!root)return;
 try{
  const response=await fetch('/photos/data.json');if(!response.ok)throw Error('load');
  const photos=(await response.json()).filter(p=>p.featured);if(!photos.length)return;
  const stack=root.querySelector('[data-portrait-stack]');
  const layers=photos.map((p,i)=>{const img=document.createElement('img');img.className='portrait-layer';img.src=p.src;img.alt=p.title;img.decoding='async';if(i===0)img.fetchPriority='high';return img;});stack.replaceChildren(...layers);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let index=0,timer,hovered=false,focused=false,suppressClick=false;
  function show(i){index=(i+photos.length)%photos.length;root.dataset.activeSlide=String(index);layers.forEach((img,n)=>{img.className='portrait-layer';img.setAttribute('aria-hidden',String(n!==index));if(n===index)img.classList.add('is-front');else if(n===(index+photos.length-1)%photos.length)img.classList.add('is-left');else if(n===(index+1)%photos.length)img.classList.add('is-right');});}
  function schedule(){clearInterval(timer);if(!reduced.matches&&!document.hidden&&!hovered&&!focused)timer=setInterval(()=>show(index+1),1000);}
  root.querySelector('[data-slide-prev]').onclick=()=>{show(index-1);schedule();};root.querySelector('[data-slide-next]').onclick=()=>{show(index+1);schedule();};
  root.addEventListener('mouseenter',()=>{hovered=true;schedule();});root.addEventListener('mouseleave',()=>{hovered=false;schedule();});
  root.addEventListener('focusin',()=>{focused=true;schedule();});root.addEventListener('focusout',e=>{if(!root.contains(e.relatedTarget)){focused=false;schedule();}});
  root.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();show(index+(e.key==='ArrowRight'?1:-1));schedule();}});
  let x=0,y=0;root.addEventListener('touchstart',e=>{x=e.changedTouches[0].clientX;y=e.changedTouches[0].clientY;clearInterval(timer);},{passive:true});root.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-x,dy=e.changedTouches[0].clientY-y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)){suppressClick=true;show(index+(dx<0?1:-1));setTimeout(()=>{suppressClick=false;},400);}schedule();},{passive:true});
  root.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();}},true);
  document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);
  show(0);schedule();
 }catch{root.querySelectorAll('.portrait-edge').forEach(button=>{button.hidden=true;});}
})();
