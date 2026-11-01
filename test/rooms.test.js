import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../worker/index.js';
async function fixture(game='go'){
 const storage=new Map(),jobs=[];
 const ctx={storage:{get:async k=>storage.get(k),put:async(k,v)=>storage.set(k,structuredClone(v))},waitUntil:p=>jobs.push(p),blockConcurrencyWhile:fn=>jobs.push(fn())};
 const room=new GameRoom(ctx);await Promise.all(jobs);room.game=game;
 const socket=()=>{const messages=[];const ws={readyState:1,send:s=>messages.push(JSON.parse(s))};room.sockets.set(ws,null);return{ws,messages};};
 let id=0;async function call(s,path,body){await room.message(s.ws,JSON.stringify({id:++id,path,body,query:'room=123'}));return s.messages.at(-1);}
 return{room,socket,call};
}
test('two players: create, join, token authentication and isolated delivery',async()=>{
 const f=await fixture(),h=f.socket(),g=f.socket();
 const host=await f.call(h,'/api/create',{name:'H',room:'123'});
 const guest=await f.call(g,'/api/join',{name:'G',room:'123'});
 assert.equal(guest.role,'guest');assert.equal(guest.hostName,'H');
 assert.equal((await f.call(g,'/api/send',{role:'guest',token:'wrong',type:'state'})).ok,false);
 await f.call(h,'/api/send',{role:'host',token:host.token,type:'state',payload:{move:1}});
 const status=f.room.status('guest',guest.since);assert.equal(status.events[0].payload.move,1);
 assert.equal(f.room.status('host',guest.since).events.filter(e=>e.type==='state').length,0);
 const third=f.socket();assert.equal((await f.call(third,'/api/join',{name:'third'})).ok,false);
});
test('mahjong: four seats, private hands and authenticated checkpoint takeover',async()=>{
 const f=await fixture('mahjong'),h=f.socket(),host=await f.call(h,'/api/create',{name:'H',room:'123',ruleset:'standard'});
 const guests=[];
 for(let i=1;i<=3;i++){const s=f.socket();const p=await f.call(s,'/api/join',{name:`G${i}`});assert.equal(p.seat,i);guests.push({s,p});}
 await f.call(h,'/api/send',{role:'host',token:host.token,type:'snapshot',to:'guest1',payload:{hand:[1,2,3]}});
 assert.ok(f.room.status('guest1',0).events.some(e=>e.type==='snapshot'));
 assert.ok(!f.room.status('guest2',0).events.some(e=>e.type==='snapshot'));
 assert.equal((await f.call(guests[0].s,'/api/send',{role:'guest1',token:guests[0].p.token,type:'checkpoint',payload:{game:{bad:true}}})).ok,false);
 await f.call(h,'/api/send',{role:'host',token:host.token,type:'checkpoint',payload:{game:{revision:9}}});
 f.room.sockets.delete(h.ws);
 const result=await f.call(guests[0].s,'/api/takeover',{role:'guest1',token:guests[0].p.token});
 assert.equal(result.game.revision,9);assert.equal(f.room.room.owner,'guest1');
});
test('game rooms are independent and event buffers stay bounded',async()=>{
 const a=await fixture(),b=await fixture();const h=a.socket();await a.call(h,'/api/create',{room:'123'});
 for(let i=0;i<300;i++)a.room.emit('host','state',{i});
 assert.ok(a.room.room.events.length<=128);assert.equal(b.room.room,null);
});
