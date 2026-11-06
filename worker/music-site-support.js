import {musicSessionConfiguration,sealMusicSession,openMusicSession} from './music-auth.js';

// Exposed only through a named service binding, never the site's HTTP router.
export function createMusicSiteSupport(env){
  function siteRequest(origin){
    const url=new URL(origin);
    if(url.origin!==origin||url.username||url.password||
      (url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Invalid music site origin');
    return new Request(url);
  }
  function purposeValue(purpose){
    if(!['session','qr'].includes(purpose))throw Error('Invalid music session purpose');
    return purpose;
  }
  return {
    configuration:()=>musicSessionConfiguration(env),
    async seal(payload,origin,purpose){
      if(JSON.stringify(payload).length>4000)throw Error('Music session is too large');
      return sealMusicSession(payload,siteRequest(origin),env,purposeValue(purpose));
    },
    open:(token,origin,purpose)=>openMusicSession(token,siteRequest(origin),env,purposeValue(purpose)),
    fetch(request){
      const url=new URL(request.url);
      if(url.pathname!=='/music/playlist.json'||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
      // Browser cookies must never be forwarded to the asset service.
      return env.ASSETS.fetch(new Request(url,{method:request.method}));
    }
  };
}
