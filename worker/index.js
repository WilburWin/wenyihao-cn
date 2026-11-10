import {Guestbook, repositories, json} from './community.js';
import {createMusicRouter,dispatchMusic} from './music-router.js';
import {allowedGameOrigin} from './game-network.js';
import {siteNetworkRequest} from './site-network.js';
import {serverStatusRequest} from './server-status.js';
import {downloadRequest} from './downloads.js';
export {DownloadBridge} from './downloads.js';
export {ServerStatus} from './server-status.js';
export {Guestbook};
const games = new Set(['go', 'mahjong', 'billiards']);
const localMusic=createMusicRouter();
export default {
  async fetch(request, env, ctx) {
    return siteNetworkRequest(request,env,ctx,application);
  }
};
async function application(request, env, ctx) {
    const url = new URL(request.url);
    if(url.pathname.startsWith('/api/tools/')||url.pathname.startsWith('/_backend/'))return downloadRequest(request,env);
    if(url.pathname==='/api/status'||url.pathname.startsWith('/api/status/'))return serverStatusRequest(request,env);
    // Photo wall is paused; keep its source files for the next redesign.
    if(url.pathname==='/photos'||url.pathname.startsWith('/photos/')){
      return new Response(request.method==='HEAD'?null:'照片墙暂未开放。',{
        status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
      });
    }
    if(url.pathname==='/network/ping'){
      if(!['GET','HEAD'].includes(request.method))return json({message:'Read-only endpoint'},405);
      return json({ok:true,nonce:(url.searchParams.get('nonce')||'').slice(0,100),colo:request.cf?.colo||null},200,{'X-Content-Type-Options':'nosniff'});
    }
    if(url.pathname.startsWith('/api/music/')){
      return dispatchMusic(request,env,ctx,localMusic);
    }
    if(url.pathname==='/api/github')return repositories(request,ctx);
    if(url.pathname==='/api/guestbook'){
      if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({message:'来源验证失败。'},403);
      if(request.method==='DELETE'&&(!env.GUESTBOOK_ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.GUESTBOOK_ADMIN_TOKEN}`))return json({message:'无权移除便签。'},403);
      if(Number(request.headers.get('Content-Length'))>4096)return json({message:'提交内容过长。'},413);
      return env.GUESTBOOK.get(env.GUESTBOOK.idFromName('public-wall')).fetch(request);
    }
    if (url.pathname.startsWith('/realtime/')) {
      const [, , game, room] = url.pathname.split('/');
      if (!games.has(game) || !/^[1-9]\d{2}$/.test(room || '')) return new Response('Invalid room', {status:400});
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status:426});
      if (!allowedGameOrigin(request,env)) return new Response('Origin rejected', {status:403});
      const id = env.ROOMS.idFromName(`${game}:${room}`);
      return env.ROOMS.get(id, {locationHint:'apac'}).fetch(request);
    }
    return env.ASSETS.fetch(request);
}

export {GameRoom} from './game-room.js';
