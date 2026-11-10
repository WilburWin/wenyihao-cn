import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';

const base=process.argv[2]||'ws://127.0.0.1:8788';
const origin=process.argv[3]||'http://localhost:8787';
if(!/^wss?:\/\//.test(base))throw Error('Expected ws:// or wss:// endpoint');
const sockets=[];
async function connect(game,code){
  const ws=new WebSocket(`${base.replace(/\/$/,'')}/realtime/${game}/${code}`,{origin,handshakeTimeout:10000});
  sockets.push(ws);await once(ws,'open');let id=0;
  return {async call(path,body={}){
    const response=once(ws,'message',{signal:AbortSignal.timeout(10000)});
    ws.send(JSON.stringify({id:++id,path,body,query:`room=${code}`}));
    const [raw]=await response;return JSON.parse(raw);
  }};
}
function expect(result){if(!result.ok)throw Error(result.message||'Game request failed');return result;}
try{
  const probe=await connect('go','100'),samples=[];
  for(let i=0;i<9;i++){
    const start=performance.now();expect(await probe.call('/api/ping'));
    if(i>0)samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({endpoint:base,roundTripMs:{min:Math.round(samples[0]),median:Math.round((samples[3]+samples[4])/2),max:Math.round(samples.at(-1))}}));
  if(process.argv.includes('--rooms')){
    for(const game of ['go','mahjong','billiards']){
      let host,h,code;
      for(let i=0;i<12;i++){
        code=String(100+Math.floor(Math.random()*900));host=await connect(game,code);
        h=await host.call('/api/create',{room:code,name:'Connection test'});
        if(h.ok)break;if(h.message!=='ROOM_EXISTS')expect(h);
      }
      expect(h);
      const guest=await connect(game,code),g=expect(await guest.call('/api/join',{room:code,name:'Second test player'}));
      const auth={role:h.role,token:h.token};
      expect(await host.call('/api/send',{...auth,type:game==='mahjong'?'snapshot':'state',to:g.role,payload:{connectionTest:true}}));
      const status=expect(await guest.call(`/api/poll?role=${g.role}&token=${g.token}&since=${g.since}`));
      if(!status.events.some(e=>e.payload?.connectionTest))throw Error('Missing peer event');
      expect(await guest.call('/api/leave',{role:g.role,token:g.token}));
      expect(await host.call('/api/leave',auth));
      console.log(`${game}: create, join, private delivery and leave passed`);
    }
  }
}finally{
  for(const ws of sockets)ws.close();
}
