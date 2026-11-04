import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicAuthHandler,sealMusicSession,openMusicSession,readMusicSession} from '../worker/music-auth.js';

const origin='https://wenyihao.cn';
const env={MUSIC_SESSION_KEY:Buffer.alloc(32,7).toString('base64url')};
const request=(action,headers={},method=action==='status'?'GET':'POST')=>new Request(origin+'/api/music/auth/'+action,{method,headers:{Origin:origin,...headers}});
const cookieFrom=(response,name)=>response.headers.getSetCookie().find(value=>value.startsWith(name+'=')).split(';')[0];

test('dashboard copy whitespace is tolerated without changing the encryption key',async()=>{
  const padded={MUSIC_SESSION_KEY:' \r\n'+env.MUSIC_SESSION_KEY+'\r\n\t'},req=request('status');
  const payload={scope:crypto.randomUUID(),cookie:'SESSDATA=test-only',expiresAt:Date.now()+10000};
  const token=await sealMusicSession(payload,req,padded);
  assert.deepEqual(await openMusicSession(token,req,env),payload);
  const status=await (await createMusicAuthHandler()(req,padded)).json();
  assert.equal(status.configured,true);assert.equal(status.configurationIssue,null);
  assert.ok(!JSON.stringify(status).includes(env.MUSIC_SESSION_KEY));
});

test('configuration diagnostics distinguish missing and invalid values without exposing them',async()=>{
  const handler=createMusicAuthHandler();
  for(const [value,issue] of [['','missing'],[' \r\n','missing'],['not-a-valid-key','invalid_format'],['"'+env.MUSIC_SESSION_KEY+'"','invalid_format']]){
    const invalid={MUSIC_SESSION_KEY:value};
    const status=await (await handler(request('status'),invalid)).json();
    assert.equal(status.configured,false);assert.equal(status.configurationIssue,issue);
    assert.ok(status.configurationMessage.includes('MUSIC_SESSION_KEY'));
    const response=await handler(request('start'),invalid),body=await response.json();
    assert.equal(response.status,503);assert.equal(body.configurationIssue,issue);
    if(value.trim())assert.ok(!JSON.stringify(body).includes(value.trim()));
  }
});

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

test('failed generation retains upstream diagnostics and has a short honest cooldown',async()=>{
  let now=Date.now(),calls=0;
  const handler=createMusicAuthHandler({now:()=>now,fetcher:async()=>{calls++;return new Response('private-upstream-body',{status:412});}});
  const first=await handler(request('start'),env),body=await first.json();
  assert.equal(first.status,502);assert.equal(body.authIssue,'bilibili_http_412');
  assert.equal(body.retryAfter,10);assert.ok(body.message.includes('HTTP 412'));
  assert.ok(!JSON.stringify(body).includes('private-upstream-body'));
  now+=3000;
  const second=await handler(request('start'),env),retry=await second.json();
  assert.equal(second.status,429);assert.equal(retry.retryAfter,7);assert.equal(retry.authIssue,'qr_previous_request_failed');
  assert.ok(!retry.message.includes('已申请过'));assert.equal(calls,1);
  now+=7001;
  assert.equal((await handler(request('start'),env)).status,502);assert.equal(calls,2);
});

test('pending browser QR can be reopened across isolates without another upstream call',async()=>{
  const fetcher=async()=>Response.json({code:0,data:{url:'https://account.bilibili.com/test?challenge=fake-only',qrcode_key:'test-only'}});
  const first=await createMusicAuthHandler({fetcher})(request('start'),env),data=await first.json();
  const Cookie=cookieFrom(first,'__Host-wyh_bili_qr');
  const second=await createMusicAuthHandler({fetcher:async()=>{throw Error('must reuse pending QR');}})(request('start',{Cookie}),env);
  const reused=await second.json();assert.equal(second.status,200);assert.equal(reused.reused,true);
  assert.equal(reused.qrImage,data.qrImage);assert.equal(reused.expiresAt,data.expiresAt);
  assert.ok(!JSON.stringify(reused).includes('challenge=fake-only'));assert.ok(!JSON.stringify(reused).includes('test-only'));
});

test('upstream timeout, malformed JSON and API rejection have safe distinct error codes',async()=>{
  const cases=[
    [async()=>{throw new DOMException('private secret','TimeoutError');},'bilibili_timeout',504],
    [async()=>new Response('<html>private content</html>'),'bilibili_invalid_response',502],
    [async()=>Response.json({code:-352,message:'private-upstream-error'}),'bilibili_code_-352',502]
  ];
  for(const [fetcher,issue,status] of cases){
    const response=await createMusicAuthHandler({fetcher})(request('start'),env),body=await response.json();
    assert.equal(response.status,status);assert.equal(body.authIssue,issue);assert.doesNotMatch(JSON.stringify(body),/private/);
  }
});
