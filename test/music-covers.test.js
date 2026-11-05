import test from 'node:test';
import assert from 'node:assert/strict';
import {createMusicCoverHandler,videoCoverUrl} from '../worker/music-covers.js';
import {uploaderTrackId} from '../worker/music-catalog.js';

const track={id:'0123456789abcdef',bvid:'BV1B34y1h78S',confirmed:true};
const second={...track,id:'fedcba9876543210'};
function setup({apiStatus=200,pic='http://i0.hdslb.com/bfs/archive/cover.jpg',imageStatus=200,type='image/webp',body=new Uint8Array([1,2,3]),length,
  beforeView=async()=>{},cache=true,live=false,ownerMid='11'}={}){
  const calls=[],stored=new Map();let time=1000000;
  const cacheStore={
    async match(key){const entry=stored.get(key.url);return entry?.expires>time?entry.response.clone():null;},
    async put(key,response){stored.set(key.url,{response:response.clone(),expires:time+6*3600000});}
  };
  const env={ASSETS:{fetch:async()=>Response.json({tracks:[track,second],playlists:live?[{uid:'11',source:'live'}]:[]})}};
  const handler=createMusicCoverHandler({now:()=>time,cacheStore:()=>cache?cacheStore:null,
    fetcher:async(url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/spi'))return Response.json({code:0,data:{b_3:'device-3',b_4:'device-4'}});
      await beforeView();
      return Response.json({code:apiStatus===200?0:-412,data:{pic,owner:{mid:ownerMid}}},{status:apiStatus,headers:apiStatus===429?{'Retry-After':'20'}:{}});
    },imageFetch:async(url,options)=>{
      calls.push({url,options});return new Response(body,{status:imageStatus,headers:{'Content-Type':type,...(length?{'Content-Length':String(length)}:{})}});
    }});
  const request=(id=track.id,init={},extra='')=>handler(new Request('https://example.com/api/music/cover?id='+id+extra,init),env);
  return {request,calls,advance:ms=>{time+=ms;}};
}

test('cover URLs accept only Bilibili image hosts and produce a bounded square thumbnail',()=>{
  assert.equal(videoCoverUrl('http://i1.hdslb.com/bfs/archive/a.jpg'),'https://i1.hdslb.com/bfs/archive/a.jpg@640w_640h_1c.webp');
  for(const value of ['https://evil.test/a.jpg','https://i0.hdslb.com.evil.test/bfs/a.jpg','https://a@i0.hdslb.com/bfs/a.jpg',
    'https://i0.hdslb.com:8080/bfs/a.jpg','https://127.0.0.1/bfs/a.jpg','https://i0.hdslb.com/bfs/a.svg','https://i0.hdslb.com/other/a.jpg'])assert.equal(videoCoverUrl(value),null,value);
});

test('public covers use device cookies only, share edge cache by video and refresh after TTL',async()=>{
  const {request,calls,advance}=setup();
  const response=await request(track.id,{headers:{Cookie:'SESSDATA=never-forward-this',Authorization:'Bearer never-forward-this'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/webp');
  assert.match(response.headers.get('Cache-Control'),/s-maxage=21600/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);
  const view=calls.find(call=>call.url.includes('/view?'));
  assert.equal(view.options.headers.Cookie,'buvid3=device-3; buvid4=device-4');
  const image=calls.at(-1);assert.equal(image.options.redirect,'manual');
  assert.equal(image.options.headers.Cookie,undefined);assert.equal(image.options.headers.Authorization,undefined);
  const head=await request(second.id,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(calls.length,3);
  advance(6*3600000+1);assert.equal((await request()).status,200);
  assert.equal(calls.filter(call=>call.url.includes('/view?')).length,2);
});

test('requests own their I/O: a blocked cover does not hold up another request',async()=>{
  let release,entered;const ready=new Promise(resolve=>{entered=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  let viewCalls=0;
  const {request,calls}=setup({beforeView:async()=>{if(++viewCalls===1){entered();await blocked;}}});
  const a=request();await ready;
  const b=await request(second.id);
  assert.equal(b.status,200);assert.equal((await b.arrayBuffer()).byteLength,3);
  release();const first=await a;
  assert.equal(first.status,200);assert.equal((await first.arrayBuffer()).byteLength,3);
  assert.equal(calls.filter(call=>call.url.includes('/view?')).length,2);
});

test('cached covers allow router diagnostics even when cache headers are immutable',async()=>{
  const handler=createMusicCoverHandler({fetcher:()=>assert.fail('Cache hit must not query Bilibili'),
    cacheStore:()=>({match:()=>fetch('data:image/webp;base64,AQID')})});
  const env={ASSETS:{fetch:async()=>Response.json({tracks:[track]})}};
  const response=await handler(new Request('https://example.com/api/music/cover?id='+track.id),env);
  assert.equal(response.status,200);
  response.headers.set('X-Music-Api-Transport','socket');
  assert.equal((await response.arrayBuffer()).byteLength,3);
});

test('cover endpoint rejects cross-site requests, unpublished songs and changed video versions',async()=>{
  const {request,calls}=setup();
  assert.equal((await request('unknown')).status,404);
  assert.equal((await request(track.id,{},'&v=BV0000000000')).status,404);
  assert.equal((await request(track.id,{method:'POST'})).status,405);
  assert.equal((await request(track.id,{headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await request(track.id,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal(calls.length,0);
});

test('risk control stops requests without retries or account fallback and recovers after the wait',async()=>{
  const {request,calls,advance}=setup({apiStatus:429});
  const response=await request();assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'20');
  const count=calls.length;assert.equal((await request()).status,429);assert.equal(calls.length,count);
  advance(20001);await request();assert.equal(calls.length,count+1);
});

test('untrusted metadata, redirects, non-images and oversized bodies never enter the image cache',async()=>{
  for(const options of [{pic:'https://evil.test/a.jpg'},{imageStatus:302},{type:'text/html'},{length:3*1024*1024},{body:new Uint8Array(2*1024*1024+1)}]){
    const {request,calls}=setup(options);
    const response=await request();assert.equal(response.status,502,JSON.stringify(options).slice(0,100));
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    await request();assert.equal(calls.filter(call=>call.url.includes('/view?')).length,2);
  }
});

test('live uploader covers validate ownership before querying the image CDN',async()=>{
  const id=uploaderTrackId('11',track.bvid),extra='&uid=11&bvid='+track.bvid;
  const accepted=setup({live:true});assert.equal((await accepted.request(id,{},extra)).status,200);
  const rejected=setup({live:true,ownerMid:'22'});
  assert.equal((await rejected.request(id,{},extra)).status,403);
  assert.equal(rejected.calls.some(call=>call.url.includes('hdslb.com')),false);
});
