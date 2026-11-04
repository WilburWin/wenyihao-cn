import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicAuthHandler,sealMusicSession,openMusicSession,readMusicSession} from '../worker/music-auth.js';

const origin='https://wenyihao.cn';
const env={MUSIC_SESSION_KEY:Buffer.alloc(32,7).toString('base64url')};
const request=(action,headers={},method=action==='status'?'GET':'POST')=>new Request(origin+'/api/music/auth/'+action,{method,headers:{Origin:origin,...headers}});
const cookieFrom=(response,name)=>response.headers.getSetCookie().find(value=>value.startsWith(name+'=')).split(';')[0];

test('encrypted session rejects tampering, expiry, another origin and QR/session purpose confusion',async()=>{
  const req=request('status'),payload={scope:crypto.randomUUID(),cookie:'SESSDATA=fake-test-only',expiresAt:Date.now()+10000};
  const token=await sealMusicSession(payload,req,env);
  assert.ok(!token.includes('SESSDATA'));
  assert.deepEqual(await openMusicSession(token,req,env),payload);
  assert.equal(await openMusicSession('a'+token.slice(1),req,env),null);
  assert.equal(await openMusicSession(token,req,env,'qr'),null);
  assert.equal(await openMusicSession(token,new Request('https://other.test'),env),null);
  assert.equal(await openMusicSession(token,req,env,'session',payload.expiresAt),null);
  const cookies={Cookie:'__Host-wyh_bili='+token};
  assert.deepEqual(await readMusicSession(request('status',cookies),env),payload);
  const bad=await sealMusicSession({...payload,cookie:'SESSDATA=bad\r\nX: bad'},req,env);
  assert.equal(await readMusicSession(request('status',{Cookie:'__Host-wyh_bili='+bad}),env),null);
});

test('QR flow hides polling key, verifies login, and stores only a sealed browser session',async()=>{
  let now=Date.now(),pollCode=86101;const calls=[];
  const handler=createMusicAuthHandler({now:()=>now,fetcher:async(value,init)=>{
    calls.push({value,init});
    if(value.endsWith('/generate'))return Response.json({code:0,data:{url:'https://account.bilibili.com/h5/account-h5/auth/scan-web?test=placeholder',qrcode_key:'fake-test-qr-key'}});
    if(value.includes('/poll?')){
      const headers=new Headers();
      if(pollCode===0){headers.append('Set-Cookie','SESSDATA=fake-test-session; Path=/; HttpOnly');headers.append('Set-Cookie','unrelated=ignored; Path=/');}
      return Response.json({code:0,data:{code:pollCode}},{headers});
    }
    assert.equal(new Headers(init.headers).get('Cookie'),'SESSDATA=fake-test-session');
    return Response.json({code:0,data:{isLogin:true,uname:'Test user',vipStatus:1}});
  }});
  const start=await handler(request('start'),env);assert.equal(start.status,200);
  const startData=await start.json();assert.match(startData.qrImage,/^data:image\/gif;base64,/);
  assert.equal(startData.qrcode_key,undefined);assert.ok(!JSON.stringify(startData).includes('fake-test-qr-key'));
  const qrCookie=cookieFrom(start,'__Host-wyh_bili_qr');
  assert.match(start.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax; Max-Age=180; Secure/);
  assert.equal(start.headers.get('Cache-Control'),'private, no-store');
  const poll=()=>handler(request('poll',{Cookie:qrCookie}),env);
  assert.equal((await (await poll()).json()).state,'waiting');
  now+=3000;pollCode=86090;assert.equal((await (await poll()).json()).state,'scanned');
  now+=3000;pollCode=0;const success=await poll();assert.equal(success.status,200);
  const data=await success.json();assert.equal(data.state,'success');assert.equal(data.user.vip,true);
  assert.ok(!JSON.stringify(data).includes('SESSDATA'));assert.ok(!JSON.stringify(data).includes('fake-test-session'));
  const sessionCookie=cookieFrom(success,'__Host-wyh_bili');assert.ok(!sessionCookie.includes('fake-test-session'));
  const session=await readMusicSession(request('status',{Cookie:sessionCookie}),env);
  assert.equal(session.cookie,'SESSDATA=fake-test-session');assert.equal(session.user.name,'Test user');
  const status=await handler(request('status',{Cookie:sessionCookie}),env);
  assert.equal((await status.json()).loggedIn,true);
  const logout=await handler(request('logout',{Cookie:sessionCookie}),env);
  assert.equal(logout.headers.getSetCookie().length,2);assert.ok(logout.headers.getSetCookie().every(value=>value.includes('Max-Age=0')));
  assert.equal(calls.filter(call=>call.value.includes('/logout')).length,0);
});

test('login enforces origin, HTTPS, method, optional config, QR expiry and request throttling',async()=>{
  let now=Date.now(),fetches=0;
  const handler=createMusicAuthHandler({now:()=>now,fetcher:async()=>{fetches++;return Response.json({code:0,data:{url:'https://passport.bilibili.com/test',qrcode_key:'test'}});}});
  assert.equal((await handler(request('start',{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handler(request('start',{},'GET'),env)).status,405);
  assert.equal((await handler(new Request('http://wenyihao.cn/api/music/auth/start',{method:'POST',headers:{Origin:'http://wenyihao.cn'}}),env)).status,400);
  assert.equal((await handler(request('start'),{})).status,503);
  assert.equal((await (await handler(request('status'),{})).json()).configured,false);
  assert.equal((await handler(request('start'),env)).status,200);
  assert.equal((await handler(request('start'),env)).status,429);assert.equal(fetches,1);
  assert.equal((await (await handler(request('poll'),env)).json()).state,'expired');
  now+=31000;
  const start=await handler(request('start'),env),cookie=cookieFrom(start,'__Host-wyh_bili_qr');
  now+=181000;
  assert.equal((await (await handler(request('poll',{Cookie:cookie}),env)).json()).state,'expired');assert.equal(fetches,2);
});

test('errors never expose upstream credentials or untrusted QR locations',async()=>{
  for(const fetcher of [async()=>{throw Error('SESSDATA=fake-test-only');},async()=>Response.json({code:0,data:{url:'https://evil.test/qr',qrcode_key:'secret'}})]){
    const handler=createMusicAuthHandler({fetcher});const response=await handler(request('start'),env);
    assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/SESSDATA|fake-test|evil.test|secret/);
  }
});
