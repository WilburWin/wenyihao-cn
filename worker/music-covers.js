import {json} from './community.js';
import {requestedTrack} from './music-catalog.js';

const API='https://api.bilibili.com';
const TTL=6*60*60;
const MAX_IMAGE_BYTES=2*1024*1024;
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);

class CoverError extends Error {
  constructor(message,status=502,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter;}
}

// Only public video artwork from Bilibili's image hosts, never a caller URL.
export function videoCoverUrl(value){
  try{
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||
      !/^i[0-2]\.hdslb\.com$/.test(url.hostname)||!url.pathname.startsWith('/bfs/'))return null;
    const path=url.pathname.replace(/@.*$/,'');
    if(!/\.(jpe?g|png|webp)$/i.test(path))return null;
    url.protocol='https:';url.search='';url.hash='';
    url.pathname=path+'@640w_640h_1c.webp';
    return url.href;
  }catch{return null;}
}

export function createMusicCoverHandler({fetcher=(...args)=>fetch(...args),imageFetch=(...args)=>fetch(...args),
  cacheStore=()=>globalThis.caches?.default,now=()=>Date.now()}={}){
  const playlists=new Map();
  let device=null,blockedUntil=0;
  // Workers I/O belongs to its originating request. Share completed data only;
  // never queue or await another request's socket, stream, or pending promise.
  async function api(path,headers={}){
    if(blockedUntil>now())throw new CoverError('B站暂时限制封面读取。',429,Math.ceil((blockedUntil-now())/1000));
    const response=await fetcher(API+path,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/',...headers},
      redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status===412||response.status===429){
      const seconds=Math.min(600,Math.max(10,Number(response.headers.get('Retry-After'))||10));
      blockedUntil=now()+seconds*1000;await response.body?.cancel();
      throw new CoverError('B站暂时限制封面读取。',429,seconds);
    }
    if(!response.ok){await response.body?.cancel();throw new CoverError('视频封面暂不可用。');}
    const body=await response.json();
    if([-412,-352].includes(body.code)){blockedUntil=now()+10000;throw new CoverError('B站暂时限制封面读取。',429,10);}
    if(body.code!==0)throw new CoverError('视频封面暂不可用。',404);
    return body.data;
  }
  async function deviceCookie(){
    if(device?.expires>now())return device.cookie;
    const data=await api('/x/frontend/finger/spi');
    const cookies=[['buvid3',data?.b_3],['buvid4',data?.b_4]]
      .filter(([,value])=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value))
      .map(([name,value])=>name+'='+value).join('; ');
    if(!cookies)throw new CoverError('视频封面暂不可用。');
    device={cookie:cookies,expires:now()+12*3600000};return cookies;
  }
  async function tracksFor(request,env){
    const origin=new URL(request.url).origin,cached=playlists.get(origin);
    if(cached?.expires>now())return cached.catalog;
    const response=await env.ASSETS.fetch(new Request(new URL('/music/playlist.json',origin)));
    if(!response.ok)throw new CoverError('歌单暂不可用。');
    const data=await response.json();
    const tracks=(data.tracks||[]).filter(t=>t.confirmed&&/^[a-f0-9]{16}$/.test(t.id)&&/^BV[\da-zA-Z]{10}$/.test(t.bvid));
    const catalog={tracks,playlists:data.playlists||[]};
    playlists.set(origin,{catalog,expires:now()+30000});return catalog;
  }
  async function load(track){
    const bvid=track.bvid;
    const cookie=await deviceCookie();
    const video=await api('/x/web-interface/view?bvid='+encodeURIComponent(bvid),{Cookie:cookie});
    if(track.dynamic&&String(video.owner?.mid)!==track.mid)throw new CoverError('视频不属于所选优选 UP 主。',403);
    const source=videoCoverUrl(video?.pic);
    if(!source)throw new CoverError('视频封面地址不可用。');
    const response=await imageFetch(source,{headers:{Referer:'https://www.bilibili.com/','User-Agent':'Mozilla/5.0'},
      redirect:'manual',signal:AbortSignal.timeout(15000)});
    const type=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if(!response.ok||!IMAGE_TYPES.has(type)||Number(response.headers.get('Content-Length'))>MAX_IMAGE_BYTES){
      await response.body?.cancel();throw new CoverError('视频封面暂不可用。');
    }
    const reader=response.body?.getReader();
    if(!reader)throw new CoverError('视频封面暂不可用。');
    const chunks=[];let size=0;
    try{
      while(true){
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>MAX_IMAGE_BYTES){await reader.cancel();throw new CoverError('视频封面过大。');}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
    if(!size)throw new CoverError('视频封面暂不可用。');
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new Response(bytes,{headers:{'Content-Type':type,'Content-Length':String(size),
      'Cache-Control':`public, max-age=3600, s-maxage=${TTL}`,'X-Content-Type-Options':'nosniff'}});
  }
  return async function coverRequest(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname!=='/api/music/cover')return json({message:'接口不存在。'},404);
    if(!['GET','HEAD'].includes(request.method))return json({message:'不支持的操作。'},405,{Allow:'GET, HEAD'});
    const origin=request.headers.get('Origin');
    if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({message:'请从本站读取封面。'},403);
    try{
      const catalog=await tracksFor(request,env),track=requestedTrack(url,catalog);
      if(!track||(url.searchParams.has('v')&&url.searchParams.get('v')!==track.bvid))throw new CoverError('歌曲未发布或已变更。',404);
      // Cache by video rather than song ID: two songs may use the same video.
      const key=new Request(new URL('/api/music/_cover/v1/'+track.bvid+(track.dynamic?'/'+track.mid:''),url.origin));
      const cache=cacheStore();
      let response=await cache?.match(key);
      if(!response){
        response=await load(track);
        if(cache){
          const write=cache.put(key,response.clone()).catch(()=>{});
          if(ctx?.waitUntil)ctx.waitUntil(write);else await write;
        }
      }
      if(request.method==='HEAD'){response.body?.cancel().catch(()=>{});return new Response(null,{status:response.status,headers:response.headers});}
      // Cache API responses have immutable headers in Workers. The router adds
      // the transport diagnostic header, so expose a mutable streaming wrapper.
      return new Response(response.body,{status:response.status,headers:response.headers});
    }catch(error){
      return json({message:error instanceof CoverError?error.message:'视频封面暂不可用。'},error.status||502,
        error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
    }
  };
}
