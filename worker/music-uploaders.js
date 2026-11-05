import {json} from './community.js';
import {createUploaderSource} from './uploader-source.js';
import {uploaderTrackId} from './music-catalog.js';

export function createUploaderHandler({fetcher=(...args)=>fetch(...args),cacheStore=()=>globalThis.caches?.default}={}){
  // Reuse only completed anonymous device data, never pending I/O.
  const source=createUploaderSource({fetcher});
  let blockedUntil=0;
  return async function uploaderRequest(request,env,ctx){
    const url=new URL(request.url);
    if(request.method!=='GET')return json({message:'不支持的操作。'},405);
    if((request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({message:'请从本站浏览歌单。'},403);
    const uid=url.searchParams.get('uid'),page=Number(url.searchParams.get('page')||1);
    if(!/^\d+$/.test(uid||'')||!Number.isSafeInteger(page)||page<1||page>10000)return json({message:'UID 或页码无效。'},400);
    try{
      const published=await env.ASSETS.fetch(new Request(new URL('/music/playlist.json',url.origin)));
      const catalog=await published.json();
      const owner=(catalog.playlists||[]).find(list=>list.uid===uid&&list.source==='live');
      if(!owner)return json({message:'UP 主不在优选名单中。'},404);
      const cache=cacheStore(),key=new Request(new URL(`/api/music/_uploader/v1/${uid}/${page}`,url.origin));
      const cached=await cache?.match(key);
      if(cached)return new Response(cached.body,{headers:cached.headers});
      if(blockedUntil>Date.now())return json({message:'B站暂时限制投稿读取，请稍后重试。'},429,{'Retry-After':String(Math.ceil((blockedUntil-Date.now())/1000))});
      // No cross-request pending I/O. Cache API stores only completed pages.
      const data=await source(uid,page);
      const tracks=data.videos.map((video,index)=>({...video,id:uploaderTrackId(uid,video.bvid),
        author:video.author||owner.title,artist:video.author||owner.title,videoTitle:video.title,confirmed:true,dynamic:true,
        uploadIndex:(page-1)*data.pageSize+index}));
      const result=json({uid,title:owner.title,page,pageSize:data.pageSize,total:data.total,tracks},200,{'Cache-Control':'public, max-age=60, s-maxage=600'});
      if(cache){const write=cache.put(key,result.clone()).catch(()=>{});if(ctx?.waitUntil)ctx.waitUntil(write);else await write;}
      return result;
    }catch(error){
      const risk=/HTTP (412|429)|风控/.test(error.message||'');if(risk)blockedUntil=Date.now()+10000;
      return json({message:risk?'B站暂时限制投稿读取，请稍后重试。':'暂时无法读取 UP 主投稿，请稍后重试。'},risk?429:502,risk?{'Retry-After':'10'}:{});
    }
  };
}
