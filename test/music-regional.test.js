import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchMusic,createMusicRouter} from '../worker/music-router.js';
import {createRegionalMusicBackend} from '../worker/music-backend.js';
import {createMusicSiteSupport} from '../worker/music-site-support.js';
import {sealMusicSession,readMusicSession} from '../worker/music-auth.js';

const origin='https://example.com';
const key={MUSIC_SESSION_KEY:Buffer.alloc(32,11).toString('base64url')};

test('regional dispatch keeps URL, encrypted cookie, CSRF origin, Range and streaming response',async()=>{
  const request=new Request(origin+'/api/music/audio?id=123',{headers:{Origin:origin,Cookie:'__Host-wyh_bili=sealed',Range:'bytes=0-3'}});
  const headers=new Headers({'Content-Range':'bytes 0-3/100'});
  headers.append('Set-Cookie','__Host-wyh_bili=one; Secure; HttpOnly');headers.append('Set-Cookie','__Host-wyh_bili_qr=two; Secure; HttpOnly');
  const response=new Response('data',{status:206,headers});
  const result=await dispatchMusic(request,{MUSIC_BACKEND_MODE:'regional',MUSIC_BACKEND:{fetch(value){assert.equal(value,request);return response;}}},{},()=>assert.fail('No local duplicate'));
  assert.equal(result,response);assert.equal(result.status,206);assert.equal(result.headers.getSetCookie().length,2);
  assert.equal(await result.text(),'data');
});

test('regional failure does not repeat QR actions; development and rollback remain local',async()=>{
  let calls=0;
  const local=async()=>{calls++;return Response.json({ok:true});};
  const env={MUSIC_BACKEND_MODE:'regional',MUSIC_BACKEND:{fetch(){throw Error('Private details');}}};
  const req=new Request(origin+'/api/music/auth/start',{method:'POST',headers:{Origin:origin}});
  const failed=await dispatchMusic(req,env,{},local);
  assert.equal(failed.status,503);assert.equal(calls,0);assert.ok(!(await failed.text()).includes('Private details'));
  assert.equal((await dispatchMusic(req,{...env,MUSIC_BACKEND_MODE:'local'},{},local)).headers.get('X-Music-Backend'),'local');
  assert.equal((await dispatchMusic(new Request('http://localhost:8787/api/music/auth/status'),env,{},local)).status,200);
  assert.equal(calls,2);
});

test('existing encrypted login survives regional delegation and logout preserves cookie semantics',async()=>{
  const request=new Request(origin+'/api/music/auth/status');
  const payload={scope:crypto.randomUUID(),cookie:'SESSDATA=test-only',user:{name:'Test',vip:true},expiresAt:Date.now()+10000};
  const token=await sealMusicSession(payload,request,key);
  const support=createMusicSiteSupport(key),regionalEnv={SITE_SUPPORT:support};
  const handle=createRegionalMusicBackend();
  const loggedRequest=new Request(request,{headers:{Cookie:'__Host-wyh_bili='+token}});
  const response=await handle(loggedRequest,regionalEnv,{}),status=await response.json();
  assert.equal(status.configured,true);assert.equal(status.loggedIn,true);assert.equal(status.user.name,'Test');
  assert.equal(response.headers.get('X-Music-Backend'),'regional');
  assert.ok(!JSON.stringify(status).includes('SESSDATA'));assert.ok(!JSON.stringify(status).includes(key.MUSIC_SESSION_KEY));
  const remoteEnv={MUSIC_SESSION_CRYPTO:support};
  const remoteToken=await sealMusicSession(payload,request,remoteEnv);
  assert.deepEqual(await readMusicSession(new Request(request,{headers:{Cookie:'__Host-wyh_bili='+remoteToken}}),key),payload);
  assert.equal(await support.open(token,'https://different.test','session'),null);
  assert.equal(await support.open(token,origin,'qr'),null);
  await assert.rejects(support.seal(payload,origin,'unknown'),/purpose/);
  const logout=await handle(new Request(origin+'/api/music/auth/logout',{method:'POST',headers:{Origin:origin}}),regionalEnv,{});
  assert.equal(logout.status,200);assert.equal(logout.headers.getSetCookie().length,2);
  assert.ok(logout.headers.getSetCookie().every(value=>value.includes('Max-Age=0')&&value.includes('HttpOnly')));
  assert.equal((await handle(new Request(origin+'/api/music/auth/start',{method:'POST',headers:{Origin:'https://evil.test'}}),regionalEnv,{})).status,403);
});

test('private site support exposes only published playlist and never forwards account headers',async()=>{
  let calls=0;
  const support=createMusicSiteSupport({ASSETS:{fetch(request){calls++;assert.equal(new URL(request.url).pathname,'/music/playlist.json');assert.equal(request.headers.get('Cookie'),null);return Response.json({tracks:[]});}}});
  assert.equal((await support.fetch(new Request(origin+'/music/playlist.json',{headers:{Cookie:'secret'}}))).status,200);
  for(const path of ['/api/music/auth/status','/.env','/index.html'])assert.equal((await support.fetch(new Request(origin+path))).status,404);
  assert.equal((await support.fetch(new Request(origin+'/music/playlist.json',{method:'POST'}))).status,404);
  assert.equal(calls,1);
});

test('regional backend uses internal assets and refuses unrelated routes or missing bindings',async()=>{
  let supplied;
  const handle=createRegionalMusicBackend({routeMusic:async(request,env)=>{supplied=env;return Response.json({ok:true});}});
  const support={};
  const response=await handle(new Request(origin+'/api/music/resolve'),{SITE_SUPPORT:support},{});
  assert.equal(supplied.ASSETS,support);assert.equal(supplied.MUSIC_SESSION_CRYPTO,support);assert.equal(supplied.MUSIC_SESSION_KEY,undefined);
  assert.equal(response.headers.get('X-Music-Backend'),'regional');
  assert.equal((await handle(new Request(origin+'/index.html'),{SITE_SUPPORT:support},{})).status,404);
  assert.equal((await handle(new Request(origin+'/api/music/resolve'),{},{})).status,503);
});

test('anonymous playback skips crypto RPC and local status does not require the regional backend',async()=>{
  const {openMusicSession}=await import('../worker/music-auth.js');
  const remote={MUSIC_SESSION_CRYPTO:{open(){assert.fail('No token requires no remote I/O');}}};
  assert.equal(await openMusicSession('',new Request(origin),remote),null);
  assert.equal(await openMusicSession('x'.repeat(3801),new Request(origin),remote),null);
  const env={...key,MUSIC_BACKEND_MODE:'regional',MUSIC_BACKEND:{fetch(){assert.fail('No upstream Bilibili operation');}}};
  for(const action of ['status','logout']){
    const response=await dispatchMusic(new Request(origin+'/api/music/auth/'+action,{
      method:action==='status'?'GET':'POST',headers:{Origin:origin}
    }),env,{},createMusicRouter());
    assert.equal(response.status,200);assert.equal(response.headers.get('X-Music-Backend'),'local');
  }
});

test('same-origin checks and transport selection remain enforced by regional router',async()=>{
  const handle=createRegionalMusicBackend({routeMusic:createMusicRouter({makeFetcher:()=>()=>assert.fail('Rejected before Bilibili request')})});
  const support=createMusicSiteSupport(key);
  const response=await handle(new Request(origin+'/api/music/resolve',{headers:{Origin:'https://evil.test'}}),{SITE_SUPPORT:support},{});
  assert.equal(response.status,403);assert.equal(response.headers.get('X-Music-Api-Transport'),'socket');
});
