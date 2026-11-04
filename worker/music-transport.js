// Only Bilibili JSON APIs use sockets. Media remains on native streaming fetch.
// Keep this module importable in Node tests; load the Workers-only client lazily.
export const BILIBILI_USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_HOSTS=new Set(['api.bilibili.com','passport.bilibili.com']);
const MEDIA_SUFFIXES=['bilivideo.com','bilivideo.cn','bilivideo.net'];

async function requestSocket(url,options){
  const {request}=await import('stealth-fetch/lite');
  return request(url,options);
}

export function musicApiTransport(env){
  return env?.MUSIC_API_TRANSPORT==='fetch'?'fetch':'socket';
}

export function createBilibiliFetch({transport='socket',socketRequest=requestSocket,nativeFetch=(...args)=>fetch(...args)}={}){
  if(!['socket','fetch'].includes(transport))throw Error('Invalid music API transport');
  return async function bilibiliFetch(value,options={}){
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw Error('Invalid Bilibili destination');
    if(!API_HOSTS.has(url.hostname)){
      if(!MEDIA_SUFFIXES.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw Error('Invalid Bilibili destination');
      const headers=new Headers(options.headers);
      if(headers.has('Cookie')||headers.has('Authorization'))throw Error('Account credentials cannot be sent to media hosts');
      return nativeFetch(url.href,{...options,headers,redirect:'manual'});
    }
    const method=(options.method||'GET').toUpperCase();
    if(!['GET','HEAD'].includes(method)||options.body)throw Error('Unsupported Bilibili API method');
    const headers=new Headers(options.headers);
    // Both transports send identical application headers for comparison.
    for(const name of [...headers.keys()]){
      if(name.startsWith('cf-')||['host','connection','content-length','transfer-encoding','forwarded','x-forwarded-for','x-real-ip'].includes(name))headers.delete(name);
    }
    headers.set('User-Agent',BILIBILI_USER_AGENT);
    headers.set('Referer','https://www.bilibili.com/');
    headers.set('Accept','application/json, text/plain, */*');
    // Avoid Brotli and preserve byte/length consistency across both transports.
    headers.set('Accept-Encoding','identity');
    if(transport==='fetch')return nativeFetch(url.href,{...options,method,headers,redirect:'manual'});
    const response=await socketRequest(url.href,{
      method,headers:Object.fromEntries(headers),redirect:'manual',retry:false,
      timeout:15000,headersTimeout:15000,bodyTimeout:15000,
      signal:options.signal,decompress:true,
    });
    // The library returns HttpResponse, not Response. Preserve separate cookies
    // (not comma splitting: Expires itself can contain commas).
    const resultHeaders=new Headers();
    const rawHeaders=response.rawHeaders?.length?response.rawHeaders:Object.entries(response.headers||{});
    for(const [name,value] of rawHeaders)resultHeaders.append(name,value);
    const noBody=method==='HEAD'||[204,205,304].includes(response.status);
    if(noBody)await response.body?.cancel();
    try{
      return new Response(noBody?null:response.body,{status:response.status,statusText:response.statusText,headers:resultHeaders});
    }catch(error){
      if(!noBody)await response.body?.cancel().catch(()=>{});
      throw error;
    }
  };
}
