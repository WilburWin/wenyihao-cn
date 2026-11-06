import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteRouter,publicRouteRequest,mirrorOrigins} from '../public/shared/site-network-core.js';
import {siteNetworkRequest} from '../worker/site-network.js';

const origin='https://example.com',edge='https://rt.example.com';
const config={enabled:true,enabledFor:[origin],endpoints:[edge]};
function setup({edgeLatency=50,ownLatency=300,disabled=false,failed=false,stored=null}={}){
  let clock=100000,save=null;const calls=[];
  const router=createSiteRouter({origin,now:()=>clock,store:{load:async()=>stored,save:async value=>{save=structuredClone(value);}},
    fetcher:async(value,options)=>{
      const url=new URL(typeof value==='string'?value:value.url);calls.push({value,options,url});
      if(url.pathname==='/shared/site-network-config.json')return Response.json({...config,enabled:!disabled});
      if(url.pathname==='/network/ping'){
        await new Promise(resolve=>setTimeout(resolve,url.origin===origin?ownLatency:edgeLatency));
        return Response.json({ok:true,nonce:url.searchParams.get('nonce')});
      }
      if(url.origin===edge&&failed)throw Error('Network unavailable');
      return new Response(url.origin===edge?'mirrored':'original',{headers:{'Content-Type':'text/plain','Content-Encoding':'gzip','Content-Length':'100'}});
    }});
  return {router,calls,advance:ms=>{clock+=ms;},saved:()=>save};
}

test('site probes compare routes, prefer a meaningful improvement and reuse completed measurements',async()=>{
  const f=setup();await f.router.prepare();
  assert.equal(f.router.status().origin,edge);
  assert.equal(f.calls.filter(call=>call.url.pathname==='/network/ping').length,6);
  const count=f.calls.length;await f.router.prepare();assert.equal(f.calls.length,count);
  assert.equal(f.saved().origin,edge);
  const close=setup({edgeLatency:290});await close.router.prepare();assert.equal(close.router.status().origin,origin);
});

test('site routing streams a fresh same-origin response and omits cookies and authorization on the mirror',async()=>{
  const f=setup();await f.router.prepare();
  const request=new Request(origin+'/photos/wall.css?version=1',{headers:{Cookie:'private-cookie','X-Private':'never-forward',Accept:'text/css'}});
  const response=await f.router.handle(request);assert.equal(await response.text(),'mirrored');
  assert.equal(response.url,'');assert.equal(response.type,'default');
  assert.equal(response.headers.get('X-Site-Network-Route'),edge);
  assert.equal(response.headers.has('Content-Encoding'),false);assert.equal(response.headers.has('Content-Length'),false);
  const call=f.calls.at(-1);assert.equal(call.url.href,edge+'/photos/wall.css?version=1');
  assert.equal(call.options.credentials,'omit');assert.equal(call.options.mode,'cors');
  assert.equal(call.options.headers.get('Cookie'),null);assert.equal(call.options.headers.get('X-Private'),null);
});

test('mirror failure replays only public GETs at the original origin and backs off',async()=>{
  const f=setup({failed:true});await f.router.prepare();
  const request=new Request(origin+'/photos/');
  assert.equal(await (await f.router.handle(request)).text(),'original');
  assert.equal(f.router.status().origin,origin);
  const count=f.calls.length;await f.router.handle(request);assert.equal(f.calls.length,count+1);
  assert.equal(f.calls.at(-1).value,request);
});

test('first visits fetch the original page without waiting for background measurements',async()=>{
  const f=setup();const request=new Request(origin+'/');
  assert.equal(await (await f.router.handle(request)).text(),'original');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].value,request);
});

test('login, audio, writes, external sites and route control scripts always retain original transport',async()=>{
  const f=setup();await f.router.prepare();
  for(const request of [
    new Request(origin+'/api/music/auth/status'),new Request(origin+'/api/music/resolve?id=one'),new Request(origin+'/api/music/audio?id=one'),
    new Request(origin+'/api/guestbook',{method:'POST',body:'message'}),new Request(origin+'/api/github',{headers:{Authorization:'private'}}),
    new Request('https://external.test/pic.jpg'),new Request(origin+'/realtime/go/123'),new Request(origin+'/relay/go/api/poll?token=secret'),
    new Request(origin+'/site-network-sw.js'),new Request(origin+'/shared/site-network-core.js'),
    new Request(origin+'/asset',{headers:{Range:'bytes=0-10,20-30'}})
  ]){
    assert.equal(publicRouteRequest(request,origin),false,request.url);
    await f.router.handle(request);assert.equal(f.calls.at(-1).value,request);
  }
  for(const path of ['/','/photos/','/music/music.js','/api/github','/api/guestbook?cursor=one','/api/music/cover?id=one','/api/music/uploaders?uid=11']){
    assert.equal(publicRouteRequest(new Request(origin+path),origin),true,path);
  }
});

test('disabled config and stale or foreign saved routes do not activate a mirror',async()=>{
  assert.deepEqual(mirrorOrigins({...config,endpoints:['http://rt.example.com','https://evil.test','https://user@rt.example.com',edge+'/path',edge,edge]},origin),[edge]);
  assert.deepEqual(mirrorOrigins(config,'https://preview.test'),[]);
  const f=setup({disabled:true,stored:{origin:'https://evil.test',expires:100100}});
  await f.router.initialize();assert.equal(f.router.status().origin,origin);
  await f.router.prepare();assert.equal(f.router.status().origin,origin);
  assert.equal(f.calls.some(call=>call.url.pathname==='/network/ping'),false);
  const restored=setup({stored:{origin:edge,expires:100100,measurements:[]}});
  await restored.router.prepare();assert.equal(restored.calls.length,0);assert.equal(restored.router.status().origin,edge);
});

test('public mirror CORS validates callers, strips credentials and limits API and method access',async()=>{
  const env={GAME_SITE_ORIGIN:origin,SITE_EDGE_ORIGINS:edge},calls=[];
  const application=async request=>{calls.push(request);return new Response('public',{headers:{'Set-Cookie':'should-never-be-forwarded'}});};
  const request=(path,init={})=>new Request(edge+path,{...init,headers:{Origin:origin,...init.headers}});
  const response=await siteNetworkRequest(request('/api/music/cover?id=one',{headers:{Cookie:'session','Authorization':'secret'}}),env,{},application);
  assert.equal(response.status,200);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(response.headers.has('Set-Cookie'),false);assert.equal(response.headers.has('Access-Control-Allow-Credentials'),false);
  assert.equal(calls.at(-1).headers.get('Cookie'),null);assert.equal(calls.at(-1).headers.get('Authorization'),null);
  assert.equal(calls.at(-1).headers.get('Origin'),edge);
  for(const path of ['/api/music/auth/status','/api/music/auth/start','/api/music/resolve','/api/music/audio']){
    assert.equal((await siteNetworkRequest(request(path),env,{},application)).status,403);
  }
  assert.equal((await siteNetworkRequest(request('/api/guestbook',{method:'POST'}),env,{},application)).status,405);
  assert.equal((await siteNetworkRequest(request('/api/github',{headers:{Origin:'https://evil.test'}}),env,{},application)).status,403);
  assert.equal((await siteNetworkRequest(request('/api/github',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'range'}}),env,{},application)).status,204);
  assert.equal((await siteNetworkRequest(request('/api/github',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}}),env,{},application)).status,403);
  const canonical=new Request(origin+'/api/music/auth/status');
  await siteNetworkRequest(canonical,env,{},application);assert.equal(calls.at(-1),canonical);
});
