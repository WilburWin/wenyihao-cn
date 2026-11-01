const nav=document.querySelector('.site-header nav');
if(nav){for(const link of nav.querySelectorAll('a')){if(new URL(link.href).pathname===location.pathname)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}}
