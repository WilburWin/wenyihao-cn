import {createMusicRouter} from './music-router.js';
import {json} from './community.js';

export function createRegionalMusicBackend({routeMusic=createMusicRouter()}={}){
  return async function regionalMusic(request,env,ctx){
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/music/'))return json({message:'Not found'},404);
    if(!env.SITE_SUPPORT)return json({message:'Music site support is unavailable'},503);
    // This private binding reads only the site's current published playlist and
    // performs session crypto with the existing key. No second copy of a key.
    const response=await routeMusic(request,{
      ...env,ASSETS:env.SITE_SUPPORT,MUSIC_SESSION_CRYPTO:env.SITE_SUPPORT
    },ctx);
    response.headers.set('X-Music-Backend','regional');
    return response;
  };
}

const handle=createRegionalMusicBackend();
export default {fetch:handle};
