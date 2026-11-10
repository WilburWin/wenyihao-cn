const nav=document.querySelector('.site-header nav');
if(nav){for(const link of nav.querySelectorAll('a')){if(new URL(link.href).pathname===location.pathname)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}}
// Anonymous observation: no browser identifier, URL, user name or payload.
// Server stores only a masked network prefix and approximate exit city.
if(nav&&!location.pathname.startsWith('/admin')){
  fetch('/api/status/visit',{method:'POST',credentials:'omit',keepalive:true}).catch(()=>{});
}
