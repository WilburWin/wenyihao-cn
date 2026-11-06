import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {allowedGameOrigin} from '../worker/game-network.js';

const source=await readFile(new URL('../public/shared/realtime.js',import.meta.url),'utf8');
async function browser({enabled=true,failAlternate=false,handshake=1}={}){
  const origin='https://example.com',alternative='https://rt.example.com',sockets=[],messages=[],events=[];
  class FakeSocket{
    constructor(url){
      this.url=new URL(url);this.readyState=0;sockets.push(this);
      setTimeout(()=>{
        if(this.readyState!==0)return;
        if(failAlternate&&this.url.hostname==='rt.example.com'&&!this.url.pathname.endsWith('/100')){this.onerror?.();return;}
        this.readyState=1;this.onopen?.();
      },handshake);
    }
    send(raw){
      if(this.readyState!==1)throw Error('Socket is not open');
      const data=JSON.parse(raw);messages.push({host:this.url.hostname,...data});
      setTimeout(()=>{if(this.readyState===1)this.onmessage?.({data:JSON.stringify({id:data.id,ok:true,room:data.body.room})});},this.url.hostname==='rt.example.com'?1:40);
    }
    close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
  }
  const window={fetch:async()=>Response.json({enabledFor:enabled?[origin]:[],endpoints:[alternative]}),addEventListener(){},dispatchEvent:event=>events.push(event)};
  vm.runInNewContext(source,{window,location:new URL(origin+'/games/go/'),WebSocket:FakeSocket,URL,Response,AbortSignal,Map,JSON,Math,performance,
    setTimeout,clearTimeout,setInterval(){},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
    document:{createElement:()=>({style:{}}),addEventListener(){},getElementById(){return null;}}});
  const call=(path,body={})=>window.fetch(origin+'/relay/go'+path,{body:JSON.stringify(body)});
  return {window,call,sockets,messages,events};
}

test('route selection measures game ping and sends gameplay only over the selected endpoint',async()=>{
  const b=await browser();
  const response=await b.call('/api/join',{room:'321',name:'Guest'});assert.equal(response.status,200);
  assert.equal(b.window.gameRealtimeRoute(),'https://rt.example.com');
  const joins=b.messages.filter(message=>message.path==='/api/join');
  assert.equal(joins.length,1);assert.equal(joins[0].host,'rt.example.com');assert.equal(joins[0].body.room,'321');
  assert.equal(b.messages.filter(message=>message.host==='example.com').every(message=>message.path==='/api/ping'),true);
  assert.equal(b.sockets.filter(socket=>socket.url.pathname.endsWith('/100')).every(socket=>socket.readyState===3),true);
});

test('unreachable optimized endpoint falls back before sending any gameplay request',async()=>{
  const b=await browser({failAlternate:true});
  assert.equal((await b.call('/api/join',{room:'321'})).status,200);
  assert.equal(b.window.gameRealtimeRoute(),'https://example.com');
  assert.equal(b.messages.filter(message=>message.path==='/api/join').length,1);
  assert.equal(b.messages.find(message=>message.path==='/api/join').host,'example.com');
});

test('preview origins do not probe production endpoints and closed connections can reconnect',async()=>{
  const b=await browser({enabled:false});
  await b.call('/api/join',{room:'321'});b.sockets.at(-1).close();
  assert.equal((await b.call('/api/ping')).status,200);
  assert.equal(b.sockets.length,2);assert.equal(b.sockets.every(socket=>socket.url.hostname==='example.com'),true);
});

test('RTT excludes the connection handshake and route selection time',async()=>{
  const b=await browser({enabled:false,handshake:150});
  await b.call('/api/ping');
  assert.ok(b.window.gameRealtimeRTT()<130,'Measured RTT should only include the ping round trip');
  assert.equal(b.events.some(event=>event.type==='game-latency'),true);
});

test('alternate game endpoint accepts only its own origin or the explicitly configured website',()=>{
  const request=origin=>new Request('https://rt.example.com/realtime/go/123',{headers:origin?{Origin:origin}:{}});
  const env={GAME_SITE_ORIGIN:'https://example.com'};
  assert.equal(allowedGameOrigin(request('https://example.com'),env),true);
  assert.equal(allowedGameOrigin(request('https://rt.example.com'),env),true);
  for(const origin of ['https://other.test','https://example.com.evil.test','null',null])assert.equal(allowedGameOrigin(request(origin),env),false);
  assert.equal(allowedGameOrigin(request('https://example.com')),false);
});
