const PUBLIC_APIS=new Set(['/api/github','/api/guestbook','/api/music/cover','/api/music/uploaders']);

// Only the configured public mirror accepts credential-free, read-only CORS.
// Login, audio sessions and writes continue through the original same-origin APIs.
export async function siteNetworkRequest(request,env,ctx,application){
  const url=new URL(request.url);
  const mirrors=String(env.SITE_EDGE_ORIGINS||'').split(',').map(value=>value.trim());
  if(!mirrors.includes(url.origin))return application(request,env,ctx);
  if(url.pathname.startsWith('/realtime/'))return application(request,env,ctx);
  const origin=request.headers.get('Origin'),site=env.GAME_SITE_ORIGIN;
  const cors=response=>{
    const headers=new Headers(response.headers);headers.delete('Set-Cookie');
    headers.delete('Access-Control-Allow-Credentials');
    if(site){headers.set('Access-Control-Allow-Origin',site);headers.append('Vary','Origin');}
    headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, ETag, Last-Modified, X-Site-Edge');
    headers.set('X-Site-Edge',request.cf?.colo||'unknown');
    return new Response(response.body,{status:response.status,headers});
  };
  const reject=(message,status)=>cors(Response.json({message},{status,headers:{'Cache-Control':'no-store'}}));
  if(origin&&origin!==site&&origin!==url.origin)return reject('Origin rejected',403);
  if(url.pathname.startsWith('/api/')&&!PUBLIC_APIS.has(url.pathname))return reject('Use the original site for this API',403);
  if(request.method==='OPTIONS'){
    const method=request.headers.get('Access-Control-Request-Method');
    const headers=(request.headers.get('Access-Control-Request-Headers')||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(origin!==site||!['GET','HEAD'].includes(method)||headers.some(value=>!['accept','range'].includes(value)))return reject('Read-only endpoint',403);
    return cors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Accept, Range','Access-Control-Max-Age':'600'}}));
  }
  if(!['GET','HEAD'].includes(request.method))return reject('Read-only endpoint',405);
  const headers=new Headers(request.headers);
  headers.delete('Cookie');headers.delete('Authorization');
  // Existing handlers retain same-origin checks after the mirror boundary has
  // checked the actual caller. No account information reaches these handlers.
  if(origin)headers.set('Origin',url.origin);
  const sanitized=new Request(request,{headers,credentials:'omit'});
  return cors(await application(sanitized,env,ctx));
}
