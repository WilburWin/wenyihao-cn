import {createMusicHandler} from './music.js';
import {createMusicAuthHandler} from './music-auth.js';
import {createMusicCoverHandler} from './music-covers.js';
import {createUploaderHandler} from './music-uploaders.js';
import {createBilibiliFetch,musicApiTransport} from './music-transport.js';
import {json} from './community.js';

export function createMusicRouter({makeFetcher=createBilibiliFetch}={}){
  const handlers=new Map();
  return async function routeMusic(request,env,ctx){
    const url=new URL(request.url),transport=musicApiTransport(env);
    if(!handlers.has(transport)){
      const fetcher=makeFetcher({transport});
      handlers.set(transport,{
        audio:createMusicHandler({fetcher}),auth:createMusicAuthHandler({fetcher}),
        cover:createMusicCoverHandler({fetcher}),uploaders:createUploaderHandler({fetcher})
      });
    }
    const selected=handlers.get(transport);
    const response=await (url.pathname.startsWith('/api/music/auth/')?selected.auth(request,env):
      url.pathname==='/api/music/uploaders'?selected.uploaders(request,env,ctx):
      url.pathname==='/api/music/cover'?selected.cover(request,env,ctx):selected.audio(request,env,ctx));
    response.headers.set('X-Music-Api-Transport',transport);
    return response;
  };
}

// Keep the public request URL, Origin, encrypted cookies and Range unchanged.
// Do not retry a failed regional request: QR actions may already have completed.
export async function dispatchMusic(request,env,ctx,local){
  const {hostname,pathname}=new URL(request.url);
  const development=['localhost','127.0.0.1','[::1]'].includes(hostname);
  const localSession=['/api/music/auth/status','/api/music/auth/logout'].includes(pathname);
  if(env.MUSIC_BACKEND_MODE!=='regional'||development||localSession){
    const response=await local(request,env,ctx);
    response.headers.set('X-Music-Backend','local');
    return response;
  }
  try{
    if(!env.MUSIC_BACKEND?.fetch)throw Error('Music service unavailable');
    return await env.MUSIC_BACKEND.fetch(request);
  }catch{
    return json({message:'音乐服务暂时无法连接，请稍后重试。'},503,{
      'Cache-Control':'private, no-store','Retry-After':'10','X-Music-Backend':'regional-unavailable'
    });
  }
}
