import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploaderHandler} from '../worker/music-uploaders.js';
import {uploaderTrackId,requestedTrack,trackQuery} from '../worker/music-catalog.js';
import {createUploaderLibrary} from '../public/music/uploader-library.js';

const owner={id:'up-11',uid:'11',title:'UP',source:'live',trackIds:[]};
const catalog={tracks:[],playlists:[owner]};
function setup({blocked=false}={}){
  const calls=[],cache=new Map();
  const handler=createUploaderHandler({cacheStore:()=>({match:async key=>cache.get(key.url)?.clone(),put:async(key,value)=>{cache.set(key.url,value.clone());}}),fetcher:async(url,options)=>{
    calls.push({url,options});
    if(new URL(url).pathname.endsWith('/spi'))return Response.json({code:0,data:{b_3:'public-device'}});
    if(blocked)return new Response('blocked',{status:412});
    return Response.json({code:0,data:{page:{total:1,size:100},archives:[{bvid:'BV1B34y1h78S',title:'Live upload',duration:100}]}});
  }});
  const env={ASSETS:{fetch:async()=>Response.json(catalog)}};
  return {calls,request:(query='uid=11&page=1',init={})=>handler(new Request('https://example.com/api/music/uploaders?'+query,init),env)};
}

test('live pages use the configured uploader allowlist, cache completed results and never take browser credentials',async()=>{
  const {request,calls}=setup();
  assert.equal((await request('uid=22')).status,404);assert.equal(calls.length,0);
  assert.equal((await request('uid=11&page=-1')).status,400);
  assert.equal((await request('uid=11',{headers:{Origin:'https://other.test'}})).status,403);
  const result=await request(undefined,{headers:{Cookie:'SESSDATA=never-forward'}});
  const data=await result.json();
  assert.equal(data.total,1);assert.equal(data.tracks[0].mid,'11');assert.equal(data.tracks[0].uploadIndex,0);
  assert.equal(data.tracks[0].id,uploaderTrackId('11','BV1B34y1h78S'));
  assert.ok(!JSON.stringify(calls).includes('never-forward'));
  const hit=await request();hit.headers.set('X-Music-Api-Transport','socket');
  assert.equal(calls.length,2);assert.equal(hit.status,200);
});

test('live page risk control returns a retryable failure without repeated upstream attempts',async()=>{
  const {request,calls}=setup({blocked:true});
  assert.equal((await request()).status,429);const count=calls.length;
  assert.equal((await request()).status,429);assert.equal(calls.length,count);
});

test('dynamic track selection binds the song ID, video and configured uploader together',()=>{
  const track={id:uploaderTrackId('11','BV1B34y1h78S'),mid:'11',bvid:'BV1B34y1h78S',dynamic:true};
  const url=new URL('https://example.com/api/music/resolve?'+trackQuery(track));
  assert.equal(requestedTrack(url,catalog).mid,'11');
  url.searchParams.set('uid','22');assert.equal(requestedTrack(url,catalog),null);
  url.searchParams.set('uid','11');url.searchParams.set('id','0000000000000000');assert.equal(requestedTrack(url,catalog),null);
});

test('opening uploader library does not fetch anything; random play jumps to an unloaded page from the live response total',async()=>{
  const calls=[],items=[];
  const library=createUploaderLibrary([owner],{random:()=>.999,onTracks:tracks=>items.push(...tracks),fetcher:async value=>{
    calls.push(value);const page=Number(new URL(value,'https://example.com').searchParams.get('page'));
    const index=page===1?0:200;
    return Response.json({uid:'11',total:201,pageSize:100,tracks:[{id:String(index).padStart(16,'0'),bvid:'BV1B34y1h78S',dynamic:true,mid:'11',uploadIndex:index}]});
  }});
  assert.equal(calls.length,0);assert.equal(library.get('up-11').total,null);
  const random=await library.randomTrack('up-11');
  assert.equal(random.uploadIndex,200);assert.equal(calls.length,2);
  assert.ok(calls[1].includes('page=3'));
  await library.randomTrack('up-11');assert.equal(calls.length,2,'already loaded pages are reused');
  assert.equal(library.nextPage('up-11'),2);
});

test('failed live pages remain retryable and do not poison the loaded-page cache',async()=>{
  let success=false;
  const library=createUploaderLibrary([owner],{fetcher:async()=>success?Response.json({uid:'11',total:0,pageSize:100,tracks:[]}):Response.json({message:'blocked'},{status:429})});
  await assert.rejects(library.load('up-11'),/blocked/);assert.equal(library.get('up-11').pending.size,0);
  success=true;await library.load('up-11');assert.equal(library.nextPage('up-11'),null);
});
