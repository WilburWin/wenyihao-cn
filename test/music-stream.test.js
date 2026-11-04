import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicHandler,isAudioHost,audioChoices} from '../worker/music.js';
import {sealMusicSession} from '../worker/music-auth.js';

const track={id:'0123456789abcdef',bvid:'BV1B34y1h78S',title:'Test song',artist:'Artist',page:2,confirmed:true};
function setup({rejectFirstStream=false,blocked=false,expiredLogin=false,cacheStore=()=>null}={}){
  const requests=[];let streamCalls=0;
  const env={MUSIC_SESSION_KEY:Buffer.alloc(32,8).toString('base64url'),ASSETS:{fetch:async()=>Response.json({tracks:[track]})}};
  const handler=createMusicHandler({cacheStore,fetcher:async(value,options)=>{
    const url=new URL(value);requests.push({url,options});
    if(url.hostname.endsWith('.bilivideo.com')){
      streamCalls++;
      if(rejectFirstStream&&streamCalls===1)return new Response('expired',{status:403});
      return new Response(options.method==='HEAD'?null:new Uint8Array([1,2,3,4]),{status:206,headers:{'Content-Range':'bytes 10-13/100','Content-Length':'4','Accept-Ranges':'bytes'}});
    }
    if(url.pathname.endsWith('/spi'))return Response.json({code:0,data:{b_3:'public-session',b_4:'public-session-4'}});
    if(url.pathname.endsWith('/view')){
      if(blocked)return Response.json({code:-412},{status:412});
      return Response.json({code:0,data:{cid:100,bvid:track.bvid,title:'Video',pages:[{cid:100,duration:12},{cid:200,duration:24}],owner:{name:'UP'}}});
    }
    const account=new Headers(options.headers).get('Cookie')?.includes('SESSDATA=');
    if(url.pathname.endsWith('/nav'))return Response.json({code:account?0:-101,data:{isLogin:account&&!expiredLogin,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',sub_url:'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png'}}});
    if(url.pathname.endsWith('/playurl'))return Response.json({code:0,data:{dash:{audio:[
      {id:30216,bandwidth:64000,codecs:'mp4a.40.2',mimeType:'audio/mp4',baseUrl:'https://test.bilivideo.com/low.m4s'},
      {id:30280,bandwidth:192000,codecs:'mp4a.40.2',mimeType:'audio/mp4',baseUrl:'https://test.bilivideo.com/high.m4s'}
    ],...(account?{flac:{audio:{id:30251,bandwidth:900000,codecs:'fLaC',mimeType:'audio/mp4',baseUrl:'https://test.bilivideo.com/flac.m4s'}}}:{})}}});
    throw Error('Unexpected fetch '+url);
  }});
  const request=(path='/resolve',init={})=>handler(new Request('https://wenyihao.cn/api/music'+path,init),env,{});
  const accountCookie=async name=>{
    const scope=crypto.randomUUID();
    return '__Host-wyh_bili='+await sealMusicSession({scope,cookie:'SESSDATA='+name,expiresAt:Date.now()+60000},new Request('https://wenyihao.cn'),env);
  };
  return {requests,request,accountCookie};
}
test('CDN validation rejects arbitrary, credentialled, insecure and redirected destinations',()=>{
  assert.equal(isAudioHost('https://test.bilivideo.com/a.m4s'),true);
  for(const value of ['http://test.bilivideo.com/a','https://bilivideo.com.evil.test/a','https://127.0.0.1/a','https://name@test.bilivideo.com/a','https://test.bilivideo.com:8080/a'])assert.equal(isAudioHost(value),false,value);
  assert.equal(audioChoices({dash:{audio:[{id:1,codecs:'mp4a.40.2',baseUrl:'https://evil.test/a'}]}}).length,0);
});
test('actual extractor signs selected part, returns highest available audio, and reuses metadata cache',async()=>{
  const {request,requests}=setup();
  const response=await request('/resolve?id='+track.id);assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.duration,24);assert.equal(data.qualities[0].id,30280);assert.equal(data.audioUrl,undefined);
  const signed=requests.find(r=>r.url.pathname.endsWith('/playurl'));
  assert.equal(signed.url.searchParams.get('cid'),'200');assert.match(signed.url.searchParams.get('w_rid'),/^[a-f0-9]{32}$/);
  assert.equal(signed.url.searchParams.get('fnval'),'4048');
  for(const r of requests.filter(r=>['/x/web-interface/view','/x/web-interface/nav'].includes(r.url.pathname))){
    assert.equal(new Headers(r.options.headers).get('Cookie'),'buvid3=public-session; buvid4=public-session-4');
    assert.equal(new Headers(r.options.headers).get('Cookie').includes('SESSDATA'),false);
  }
  await request('/resolve?id='+track.id);assert.equal(requests.filter(r=>r.url.pathname.endsWith('/playurl')).length,1);
});
test('audio forwards Range and required headers, preserves 206 and streams only the chosen track',async()=>{
  const {request,requests}=setup();
  const response=await request('/audio?id='+track.id+'&quality=30216',{headers:{Range:'bytes=10-13'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 10-13/100');assert.equal(response.headers.get('Content-Type'),'audio/mp4');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4]);
  const stream=requests.at(-1);assert.ok(stream.url.pathname.endsWith('/low.m4s'));assert.equal(stream.options.headers.Range,'bytes=10-13');assert.equal(stream.options.headers.Referer,'https://www.bilibili.com/');assert.equal(stream.options.redirect,'manual');
});
test('expired CDN link is resolved again once before playback resumes',async()=>{
  const {request,requests}=setup({rejectFirstStream:true});
  assert.equal((await request('/audio?id='+track.id)).status,206);
  assert.equal(requests.filter(r=>r.url.pathname.endsWith('/playurl')).length,2);
});
test('limits requests to published songs and same origin, and stops after risk control',async()=>{
  const {request,requests}=setup({blocked:true});
  assert.equal((await request('/resolve?id=unknown')).status,404);
  assert.equal((await request('/resolve?id='+track.id,{headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await request('/resolve?id='+track.id,{method:'POST'})).status,405);
  const response=await request('/resolve?id='+track.id);assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'10');
  const count=requests.length;assert.equal((await request('/resolve?id='+track.id)).status,429);assert.equal(requests.length,count);
});

test('account streams stay isolated from other accounts and anonymous persistent cache',async()=>{
  const writes=[];
  const {request,requests,accountCookie}=setup({cacheStore:()=>({match:async()=>null,put:async(key,value)=>writes.push(await value.json())})});
  const cookieA=await accountCookie('account-A'),cookieB=await accountCookie('account-B');
  const resolve=async Cookie=>(await request('/resolve?id='+track.id,{headers:Cookie?{Cookie}:{}})).json();
  assert.equal((await resolve()).qualities[0].id,30280);
  const dataA=await resolve(cookieA);assert.equal(dataA.authenticated,true);assert.equal(dataA.qualities[0].id,30251);
  assert.equal((await resolve(cookieB)).qualities[0].id,30251);
  assert.equal((await resolve()).qualities[0].id,30280);
  await resolve(cookieA);
  assert.equal(requests.filter(r=>r.url.pathname.endsWith('/playurl')).length,3);
  assert.equal(writes.length,1);assert.equal(writes[0].authenticated,false);
  assert.ok(!JSON.stringify(writes).includes('account-A'));
  const signed=requests.filter(r=>r.url.pathname.endsWith('/playurl'));
  assert.match(new Headers(signed[1].options.headers).get('Cookie'),/SESSDATA=account-A/);
  assert.match(new Headers(signed[2].options.headers).get('Cookie'),/SESSDATA=account-B/);
  const stream=await request('/audio?id='+track.id+'&quality=30251',{headers:{Cookie:cookieA}});
  assert.equal(stream.status,206);assert.equal(stream.headers.get('Cache-Control'),'private, no-store');
  assert.equal(new Headers(requests.at(-1).options.headers).has('Cookie'),false);
  assert.equal((await request('/audio?id='+track.id+'&quality=30251')).status,422);
});

test('revoked account stops resolution and clears this site session cookie',async()=>{
  const {request,requests,accountCookie}=setup({expiredLogin:true});
  const response=await request('/resolve?id='+track.id,{headers:{Cookie:await accountCookie('revoked')}});
  assert.equal(response.status,401);assert.match(response.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal(requests.some(r=>r.url.pathname.endsWith('/playurl')),false);
});
