import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilibiliFetch,musicApiTransport,BILIBILI_USER_AGENT} from '../worker/music-transport.js';

function socketResponse(status=200,rawHeaders=[['content-type','application/json']],body='{"code":0}'){
  return {status,statusText:'',rawHeaders,body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(body));controller.close();}})};
}

test('socket response preserves multiple login cookies, status, and abort signal without retrying',async()=>{
  const controller=new AbortController();let call;
  const fetcher=createBilibiliFetch({socketRequest:async(url,options)=>{
    call={url,options};return socketResponse(200,[['set-cookie','SESSDATA=test-only; HttpOnly; Expires=Wed, 01 Jan 2030 00:00:00 GMT'],['set-cookie','bili_jct=test-only'],['content-type','application/json']]);
  },nativeFetch:()=>assert.fail('API must use sockets')});
  const response=await fetcher('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?test=1',{signal:controller.signal,headers:{Cookie:'buvid3=test-device','CF-Worker':'remove-me','X-Forwarded-For':'remove-me'}});
  assert.equal(response.ok,true);assert.deepEqual(await response.json(),{code:0});
  assert.equal(response.headers.getSetCookie().length,2);
  assert.match(response.headers.getSetCookie()[0],/Expires=Wed, 01 Jan/);
  assert.equal(call.options.signal,controller.signal);assert.equal(call.options.retry,false);assert.equal(call.options.redirect,'manual');
  assert.equal(call.options.timeout,15000);
  assert.equal(call.options.headers.cookie,'buvid3=test-device');
  assert.equal(call.options.headers['user-agent'],BILIBILI_USER_AGENT);
  assert.equal(call.options.headers.referer,'https://www.bilibili.com/');
  assert.equal(call.options.headers['cf-worker'],undefined);assert.equal(call.options.headers['x-forwarded-for'],undefined);
});

test('412 stays a failed response with Retry-After and is never retried or silently sent via fetch',async()=>{
  let calls=0;
  const fetcher=createBilibiliFetch({socketRequest:async()=>{calls++;return socketResponse(412,[['retry-after','10']],'blocked');},nativeFetch:()=>assert.fail('No automatic fallback')});
  const response=await fetcher('https://api.bilibili.com/x/web-interface/nav');
  assert.equal(response.status,412);assert.equal(response.ok,false);assert.equal(response.headers.get('Retry-After'),'10');
  assert.equal(await response.text(),'blocked');assert.equal(calls,1);
});

test('media uses native streaming fetch with Range and never accepts account credentials',async()=>{
  let call;
  const fetcher=createBilibiliFetch({socketRequest:()=>assert.fail('Media must not use socket JSON transport'),nativeFetch:async(url,options)=>{call={url,options};return new Response('data',{status:206,headers:{'Content-Range':'bytes 0-3/100'}});}});
  const response=await fetcher('https://test.bilivideo.com/a.m4s',{headers:{Range:'bytes=0-3',Referer:'https://www.bilibili.com/'}});
  assert.equal(response.status,206);assert.equal(await response.text(),'data');assert.equal(call.options.headers.get('Range'),'bytes=0-3');assert.equal(call.options.redirect,'manual');
  await assert.rejects(fetcher('https://test.bilivideo.com/a.m4s',{headers:{Cookie:'SESSDATA=test-only'}}),/credentials/);
});

test('destination validation prevents arbitrary sockets and refuses POST bodies',async()=>{
  const fetcher=createBilibiliFetch({socketRequest:()=>assert.fail('Disallowed request'),nativeFetch:()=>assert.fail('Disallowed request')});
  for(const url of ['http://api.bilibili.com/x','https://api.bilibili.com.evil.test/x','https://127.0.0.1/x','https://user@api.bilibili.com/x','https://api.bilibili.com:8080/x'])await assert.rejects(fetcher(url),/destination/);
  await assert.rejects(fetcher('https://api.bilibili.com/x',{method:'POST',body:'data'}),/method/);
});

test('fetch rollback retains application headers and does not load socket client',async()=>{
  let call;
  const fetcher=createBilibiliFetch({transport:'fetch',socketRequest:()=>assert.fail('Fetch override'),nativeFetch:async(url,options)=>{call={url,options};return Response.json({code:0});}});
  assert.equal((await fetcher('https://api.bilibili.com/x/web-interface/nav',{headers:{Cookie:'SESSDATA=test-only'}})).ok,true);
  assert.equal(call.options.headers.get('Cookie'),'SESSDATA=test-only');assert.equal(call.options.headers.get('User-Agent'),BILIBILI_USER_AGENT);
  assert.equal(musicApiTransport({}), 'socket');assert.equal(musicApiTransport({MUSIC_API_TRANSPORT:'fetch'}),'fetch');
});

test('null-body responses cancel the socket stream instead of leaking it',async()=>{
  let cancelled=false;
  const fetcher=createBilibiliFetch({socketRequest:async()=>({status:204,rawHeaders:[],body:new ReadableStream({cancel(){cancelled=true;}})})});
  const response=await fetcher('https://api.bilibili.com/x/web-interface/nav');
  assert.equal(response.status,204);assert.equal(response.body,null);assert.equal(cancelled,true);
});
