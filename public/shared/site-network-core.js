const PUBLIC_APIS=new Set(['/api/github','/api/guestbook','/api/music/cover','/api/music/uploaders']);
const CONTROL_PATHS=new Set(['/site-network-sw.js','/shared/site-network.js','/shared/site-network-core.js','/shared/site-network-config.json','/shared/realtime-config.json']);
const ROUTE_TTL=5*60000;

export function mirrorOrigins(config,origin){
  if(!config?.enabled||!config.enabledFor?.includes(origin))return [];
  const own=new URL(origin);
  return [...new Set((config.endpoints||[]).filter(value=>{
    try{
      const url=new URL(value);
      return url.origin===value&&url.protocol==='https:'&&!url.username&&!url.password&&url.hostname.endsWith('.'+own.hostname);
    }catch{return false;}
  }))].slice(0,2);
}

export function publicRouteRequest(request,origin){
  const url=new URL(request.url);
  if(url.origin!==origin||!['GET','HEAD'].includes(request.method)||request.headers.has('Authorization')||request.cache==='only-if-cached')return false;
  if(CONTROL_PATHS.has(url.pathname)||url.pathname.startsWith('/network/')||url.pathname.startsWith('/realtime/')||url.pathname.startsWith('/relay/'))return false;
  if(url.pathname.startsWith('/api/')&&!PUBLIC_APIS.has(url.pathname))return false;
  const range=request.headers.get('Range');
  return !range||/^bytes=(?:\d+-\d*|-\d+)$/.test(range);
}

export function createSiteRouter({origin,fetcher=fetch,now=Date.now,timer=()=>performance.now(),store}={}){
  let selected=origin,expires=0,refreshing=null,initialized=null,measurements=[];
  const validEndpoint=value=>value===origin||mirrorOrigins({enabled:true,enabledFor:[origin],endpoints:[value]},origin).length===1;
  async function timedFetch(value,options={},timeout=6000){
    const controller=new AbortController(),abort=()=>controller.abort();
    if(options.signal?.aborted)controller.abort();else options.signal?.addEventListener('abort',abort,{once:true});
    const timeoutId=setTimeout(abort,timeout);
    try{return await fetcher(value,{...options,signal:controller.signal});}
    finally{clearTimeout(timeoutId);options.signal?.removeEventListener('abort',abort);}
  }
  const persist=async()=>{try{await store?.save({origin:selected,expires,measurements});}catch{}};
  function initialize(){
    return initialized||=(async()=>{
      try{
        const saved=await store?.load();
        if(saved&&validEndpoint(saved.origin)&&saved.expires>now()&&saved.expires<=now()+ROUTE_TTL){
          selected=saved.origin;expires=saved.expires;measurements=saved.measurements||[];
        }
      }catch{}
    })();
  }
  async function probe(endpoint){
    const samples=[];
    try{
      for(let index=0;index<3;index++){
        const nonce=String(now())+'-'+Math.random().toString(36).slice(2),start=timer();
        const response=await timedFetch(endpoint+'/network/ping?nonce='+nonce,{mode:'cors',credentials:'omit',cache:'no-store',redirect:'error'},2200);
        if(!response.ok)throw Error('Probe unavailable');
        const data=await response.json();if(!data.ok||data.nonce!==nonce)throw Error('Unexpected probe response');
        if(index)samples.push(timer()-start);
      }
      return {origin:endpoint,rtt:Math.round(Math.max(...samples))};
    }catch{return null;}
  }
  async function prepare(){
    await initialize();if(expires>now())return;
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      try{
        const response=await timedFetch(origin+'/shared/site-network-config.json',{cache:'no-store',credentials:'omit'},2500);
        if(!response.ok)throw Error('Configuration unavailable');
        const mirrors=mirrorOrigins(await response.json(),origin);
        if(!mirrors.length){selected=origin;expires=now()+ROUTE_TTL;measurements=[];await persist();return;}
        measurements=(await Promise.all([origin,...mirrors].map(probe))).filter(Boolean).sort((a,b)=>a.rtt-b.rtt);
        const own=measurements.find(value=>value.origin===origin),best=measurements[0];
        selected=best&&(!own||best.rtt+20<own.rtt)?best.origin:origin;
        expires=now()+ROUTE_TTL;await persist();
      }catch{selected=origin;expires=now()+30000;await persist();}
    })().finally(()=>{refreshing=null;});
    return refreshing;
  }
  async function handle(request){
    await initialize();
    // Selection runs in the background. First visits never wait for a test.
    if(selected===origin||!publicRouteRequest(request,origin))return fetcher(request);
    const chosen=selected,url=new URL(request.url),target=chosen+url.pathname+url.search;
    const headers=new Headers();
    for(const name of ['Accept','Range'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
    try{
      const response=await timedFetch(target,{method:request.method,headers,mode:'cors',credentials:'omit',redirect:'error',cache:request.cache,signal:request.signal});
      if(!response.ok||response.type==='opaque'){
        await response.body?.cancel();throw Error('Mirror unavailable');
      }
      // A fresh Response preserves the visible URL and relative import bases,
      // and is valid for same-origin and navigation requests handled by a SW.
      const resultHeaders=new Headers(response.headers);
      for(const name of ['Set-Cookie','Content-Encoding','Content-Length'])resultHeaders.delete(name);
      resultHeaders.set('X-Site-Network-Route',chosen);
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers:resultHeaders});
    }catch(error){
      if(request.signal?.aborted)throw error;
      // Back off for this browser. A failing route cannot trap page loads.
      if(selected===chosen){selected=origin;expires=now()+30000;await persist();}
      return fetcher(request);
    }
  }
  return {prepare,handle,initialize,status:()=>({origin:selected,expires,measurements})};
}
