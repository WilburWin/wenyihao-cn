import {BilibiliAudioExtractor} from '@bryan-kuang/bilibili-audio-extractor';
import {json} from './community.js';
import {readMusicSession,clearMusicSessionCookie} from './music-auth.js';

const API_ORIGIN = 'https://api.bilibili.com';
const REFERER = 'https://www.bilibili.com/';
const USER_AGENT = 'Mozilla/5.0';
const QUALITY_NAMES = {30216:'AAC 64K',30232:'AAC 132K',30280:'AAC 192K',30250:'杜比音频',30251:'Hi-Res'};

class MusicError extends Error {
  constructor(message,status=502,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter;}
}

export function isAudioHost(value){
  try {
    const url = new URL(value);
    return url.protocol==='https:' && !url.username && !url.password && (!url.port || url.port==='443') &&
      ['bilivideo.com','bilivideo.cn','bilivideo.net'].some(host=>url.hostname===host || url.hostname.endsWith('.'+host));
  } catch { return false; }
}

export function audioChoices(data){
  const dash=data?.dash||{};
  const items=[...(dash.audio||[]),...(dash.flac?.audio?[dash.flac.audio]:[]),...(dash.dolby?.audio||[])];
  const choices=new Map();
  for(const item of items){
    const urls=[item.baseUrl,item.base_url,...(item.backupUrl||item.backup_url||[])].filter(isAudioHost);
    const codec=String(item.codecs||''),mime=String(item.mimeType||item.mime_type||'audio/mp4');
    if(!urls.length || !/^audio\/(mp4|webm)$/.test(mime) || !/^[\w., -]+$/.test(codec) || !Number.isSafeInteger(item.id))continue;
    const choice={id:item.id,label:QUALITY_NAMES[item.id]||`${codec} ${Math.round((item.bandwidth||0)/1000)}K`,
      mime:`${mime}; codecs="${codec}"`,contentType:mime,bandwidth:Number(item.bandwidth)||0,urls:[...new Set(urls)]};
    if(!choices.has(choice.id)||choices.get(choice.id).bandwidth<choice.bandwidth)choices.set(choice.id,choice);
  }
  return [...choices.values()].sort((a,b)=>b.bandwidth-a.bandwidth);
}

// The package handles WBI signing and anonymous session bootstrap. This adapter
// supplies the selected part, exposes available audio tracks, and relays Range
// requests on the server. Account access is bound to this browser's encrypted
// session; authenticated stream plans never enter a shared/persistent cache.
export function createMusicHandler({fetcher=(...args)=>fetch(...args),Extractor=BilibiliAudioExtractor,cacheStore=()=>globalThis.caches?.default,now=()=>Date.now()}={}){
  const playlists=new Map(),inflight=new Map(),plans=new Map(),bootstrapCache=new Map();
  let blockedUntil=0;

  async function publishedTracks(request,env){
    const origin=new URL(request.url).origin,cached=playlists.get(origin);
    if(cached&&cached.expires>now())return cached.tracks;
    const response=await env.ASSETS.fetch(new Request(new URL('/music/playlist.json',origin)));
    if(!response.ok)throw new MusicError('歌单暂时无法读取。');
    const data=await response.json();
    const tracks=(data.tracks||[]).filter(t=>t.confirmed&&/^[a-f0-9]{16}$/.test(t.id)&&/^BV[\da-zA-Z]{10}$/.test(t.bvid));
    playlists.set(origin,{tracks,expires:now()+30000});return tracks;
  }

  async function extract(track,session){
    if(blockedUntil>now())throw new MusicError('B站暂时限制取流，请稍后重试。',429,Math.ceil((blockedUntil-now())/1000));
    let page=null,video=null,streamData=null;
    const extractor=new Extractor({userAgent:USER_AGENT,timeoutMs:15000,...(session?{cookieHeader:session.cookie}:{}),fetchJson:async(value,init)=>{
      const url=new URL(value);
      if(url.origin!==API_ORIGIN)throw new MusicError('资源接口地址无效。');
      if(blockedUntil>now())throw new MusicError('B站暂时限制取流，请稍后重试。',429,Math.ceil((blockedUntil-now())/1000));
      const cachedBootstrap=!session&&bootstrapCache.get(url.pathname);
      if(cachedBootstrap?.expires>now())return cachedBootstrap.body;
      const headers=new Headers(init.headers);
      if(!session&&['/x/web-interface/view','/x/web-interface/nav'].includes(url.pathname))headers.delete('Cookie');
      const response=await fetcher(url.toString(),{headers,redirect:'manual',signal:AbortSignal.timeout(init.timeoutMs)});
      if(response.status===412||response.status===429){
        const delay=Math.min(600,Math.max(10,Number(response.headers.get('Retry-After'))||10));
        blockedUntil=now()+delay*1000;
        throw new MusicError('B站暂时限制取流，请稍后重试。',429,delay);
      }
      if(!response.ok)throw new MusicError('B站资源接口暂时不可用。');
      const body=await response.json();
      if([-412,-352].includes(body.code)){blockedUntil=now()+10000;throw new MusicError('B站暂时限制取流，请稍后重试。',429,10);}
      if(session&&url.pathname==='/x/web-interface/nav'&&!body.data?.isLogin)throw new MusicError('B站登录已失效，请重新登录或退出后以访客身份播放。',401);
      if(!session&&((url.pathname==='/x/web-interface/nav'&&body.data?.wbi_img)||(url.pathname==='/x/frontend/finger/spi'&&body.code===0))){
        bootstrapCache.set(url.pathname,{body,expires:now()+12*3600000});
      }
      if(url.pathname==='/x/web-interface/view'&&body.code===0){
        video=body.data;
        page=video.pages?.[(Number(track.page)||1)-1];
        if(!page)throw new MusicError('这个视频分P已不可用，请重新选择歌曲资源。',404);
        // The package defaults to the first part. Override cid in the response
        // rather than signing parameters again after the WBI signature is made.
        return {...body,data:{...video,cid:page.cid,duration:page.duration}};
      }
      if(url.pathname.endsWith('/playurl')&&body.code===0)streamData=body.data;
      return body;
    }});
    // This pinned package signs only its default DASH flags. Extend parameters
    // before signing so Bilibili may return FLAC/Dolby tracks for this account.
    if(typeof extractor.signWbiParams==='function'){
      const sign=extractor.signWbiParams.bind(extractor);
      extractor.signWbiParams=params=>sign({...params,fnval:4048,fourk:1});
    }
    const result=await extractor.extract(track.bvid);
    const choices=audioChoices(streamData);
    if(!choices.length)throw new MusicError('该曲目暂时没有可播放的音轨，可通过 MV 在B站打开。',422);
    // Signed URLs may expire sooner than the normal API cache TTL.
    const deadlines=choices.flatMap(c=>c.urls.map(value=>{
      const deadline=Number(new URL(value).searchParams.get('deadline'));return deadline?deadline*1000:Infinity;
    }));
    const expiresAt=Math.min(now()+10*60000,...deadlines)-30000;
    return {id:track.id,title:track.title,artist:track.artist,authenticated:Boolean(session),videoTitle:video?.title||result.title,
      duration:Number(page?.duration||result.duration)||0,cover:video?.pic||null,author:video?.owner?.name||track.author,
      choices,expiresAt};
  }

  async function planFor(request,track,ctx,session,force=false){
    const scope=(session?.scope||'public')+':'+track.id;
    const key=new Request(new URL('/api/music/_resolved/'+track.id,request.url)),cache=session?null:cacheStore();
    const local=plans.get(scope);
    if(!force&&local?.expiresAt>now())return local;
    if(!force&&cache){
      const hit=await cache.match(key);
      if(hit){const data=await hit.json();if(!data.authenticated&&data.expiresAt>now()){plans.set(scope,data);return data;}}
    }
    if(inflight.has(scope))return inflight.get(scope);
    const promise=extract(track,session).then(plan=>{
      for(const [id,entry] of plans)if(entry.expiresAt<=now())plans.delete(id);
      if(plans.size>=128)plans.delete(plans.keys().next().value);
      plans.set(scope,plan);
      if(cache){const write=cache.put(key,json(plan,200,{'Cache-Control':`public, max-age=${Math.max(1,Math.floor((plan.expiresAt-now())/1000))}`}));ctx?.waitUntil?.(write.catch(()=>{}));}
      return plan;
    }).finally(()=>inflight.delete(scope));
    inflight.set(scope,promise);return promise;
  }

  return async function musicRequest(request,env,ctx){
    const url=new URL(request.url);
    if(!['/api/music/resolve','/api/music/audio'].includes(url.pathname))return json({message:'接口不存在。'},404);
    if(!['GET','HEAD'].includes(request.method))return json({message:'不支持的操作。'},405,{Allow:'GET, HEAD'});
    const origin=request.headers.get('Origin');
    if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({message:'请从本站播放音乐。'},403);
    try {
      const tracks=await publishedTracks(request,env),track=tracks.find(t=>t.id===url.searchParams.get('id'));
      if(!track)throw new MusicError('歌曲未发布或不存在。',404);
      const session=await readMusicSession(request,env);
      let plan=await planFor(request,track,ctx,session);
      if(url.pathname.endsWith('/resolve')){
        const {choices,expiresAt,...info}=plan;
        return json({...info,expiresAt,qualities:choices.map(({id,label,mime,bandwidth})=>({id,label,mime,bandwidth})),
          streamUrl:'/api/music/audio?id='+track.id});
      }
      const range=request.headers.get('Range');
      if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))throw new MusicError('不支持的音频范围。',416);
      const requestedQuality=url.searchParams.get('quality');
      let response,selected;
      // Retry an expired/rejected URL once; ordinary playback never polls APIs.
      for(let attempt=0;attempt<2;attempt++){
        selected=requestedQuality?plan.choices.find(c=>String(c.id)===requestedQuality):plan.choices[0];
        if(!selected)throw new MusicError('所选音质暂不可用，请重新选择。',422);
        for(const source of selected.urls){
          try {
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
            try {
              response=await fetcher(source,{method:request.method,headers:{'User-Agent':USER_AGENT,Referer:REFERER,...(range?{Range:range}:{})},
                redirect:'manual',signal:controller.signal});
            } finally { clearTimeout(timer); }
            if(response.ok||response.status===416)break;
            await response.body?.cancel();
          }catch{response=null;}
        }
        if(response?.ok||response?.status===416)break;
        if(attempt===0)plan=await planFor(request,track,ctx,session,true);
      }
      if(!response?.ok&&response?.status!==416)throw new MusicError('音频线路暂不可用，请稍后重试或通过 MV 打开原视频。');
      const headers=new Headers({'Content-Type':selected.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      for(const name of ['Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']){
        if(response.headers.has(name))headers.set(name,response.headers.get(name));
      }
      return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
    }catch(error){
      if(!(error instanceof MusicError))console.warn('Music extraction failed');
      return json({message:error instanceof MusicError?error.message:'暂时无法读取音轨，请稍后重试或通过 MV 打开原视频。'},error.status||502,
        {...(error.retryAfter?{'Retry-After':String(error.retryAfter)}:{}),...(error.status===401?{'Set-Cookie':clearMusicSessionCookie(request)}:{})});
    }
  };
}

export const musicRequest=createMusicHandler();
