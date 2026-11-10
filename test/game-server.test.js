import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGameServer} from '../server/game-server.mjs';

const origin='http://localhost:8787';
async function client(app,game='go',code='123'){
  const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/realtime/${game}/${code}`,{origin});
  await once(ws,'open');let id=0;
  return {ws,async call(path,body={}){
    const response=once(ws,'message',{signal:AbortSignal.timeout(3000)});
    ws.send(JSON.stringify({id:++id,path,body,query:`room=${code}`}));
    const [raw]=await response;return JSON.parse(raw);
  }};
}
async function fixture(t,options={}){
  const dataDir=await mkdtemp(join(tmpdir(),'game-server-'));
  let app=await createGameServer({port:0,dataDir,origins:[origin],...options});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  return {get app(){return app;},async restart(){await app.close();app=await createGameServer({port:0,dataDir,origins:[origin],...options});}};
}

test('standalone service uses the existing protocol for all three games and isolates game rooms',async t=>{
  const f=await fixture(t);
  for(const game of ['go','billiards','mahjong']){
    const host=await client(f.app,game),guest=await client(f.app,game);
    assert.equal((await host.call('/api/ping')).transport,'websocket');
    const h=await host.call('/api/create',{room:'123',name:'H'});
    const g=await guest.call('/api/join',{room:'123',name:'G'});
    assert.equal(g.ok,true);assert.equal(g.seat,1);
    const auth={role:h.role,token:h.token};
    assert.equal((await host.call('/api/send',{...auth,type:'state',payload:{game}})).ok,true);
    const poll=await guest.call(`/api/poll?role=${g.role}&token=${g.token}&since=${g.since}`);
    assert.equal(poll.events.at(-1).payload.game,game);
    assert.equal((await host.call('/api/send',{...auth,token:'bad',type:'state'})).ok,false);
  }
  const health=await fetch(`http://127.0.0.1:${f.app.server.address().port}/healthz`).then(r=>r.json());
  assert.equal(health.rooms,3);assert.equal(health.connections,6);
});

test('atomic room persistence survives restart and preserves tokens and checkpoint',async t=>{
  const f=await fixture(t),host=await client(f.app);
  const h=await host.call('/api/create',{room:'123'});
  await host.call('/api/send',{role:h.role,token:h.token,type:'checkpoint',payload:{game:{move:42}}});
  await f.restart();
  const restored=await client(f.app);
  const poll=await restored.call(`/api/poll?role=${h.role}&token=${h.token}&since=0`);
  assert.equal(poll.ok,true);
  assert.deepEqual([...f.app.rooms.values()][0].room.room.checkpoint,{move:42});
  assert.equal((await restored.call('/api/create',{room:'123'})).message,'ROOM_EXISTS');
});

test('standalone mahjong keeps hands private and supports owner takeover after disconnection',async t=>{
  const f=await fixture(t),host=await client(f.app,'mahjong');
  const h=await host.call('/api/create',{room:'123'}),guests=[];
  for(let i=0;i<3;i++){
    const c=await client(f.app,'mahjong');guests.push({c,p:await c.call('/api/join',{name:`G${i}`})});
  }
  const extra=await client(f.app,'mahjong');assert.equal((await extra.call('/api/join')).ok,false);
  await host.call('/api/send',{role:h.role,token:h.token,batch:[
    {type:'snapshot',to:'guest1',payload:{hand:[1,2,3]}},
    {type:'checkpoint',payload:{game:{revision:9}}},
  ]});
  for(let i=0;i<2;i++){
    const {c,p}=guests[i],result=await c.call(`/api/poll?role=${p.role}&token=${p.token}&since=0`);
    assert.equal(result.events.some(e=>e.type==='snapshot'),i===0);
  }
  const room=[...f.app.rooms.values()][0].room;
  const serverClosed=once([...room.sockets.keys()][0],'close');
  host.ws.close();await serverClosed;
  const {c,p}=guests[0],takeover=await c.call('/api/takeover',{role:p.role,token:p.token});
  assert.equal(takeover.ok,true);assert.equal(takeover.game.revision,9);
});

test('rejects untrusted origins, invalid routes and excess connections before upgrading',async t=>{
  const f=await fixture(t,{maxConnections:1});
  const base=`ws://127.0.0.1:${f.app.server.address().port}`;
  async function rejected(path,source,status){
    const ws=new WebSocket(base+path,{origin:source});
    ws.on('error',()=>{});
    const [,res]=await once(ws,'unexpected-response');
    assert.equal(res.statusCode,status);res.resume();ws.terminate();
  }
  await rejected('/realtime/go/123','https://untrusted.example',403);
  await rejected('/realtime/go/../secret',origin,404);
  await client(f.app);
  await rejected('/realtime/go/124',origin,503);
});
