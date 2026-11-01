import {Guestbook, repositories, json} from './community.js';
export {Guestbook};
const games = new Set(['go', 'mahjong', 'billiards']);
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if(url.pathname==='/api/github')return repositories(request,ctx);
    if(url.pathname==='/api/guestbook'){
      if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({message:'来源验证失败。'},403);
      if(request.method==='DELETE'&&(!env.GUESTBOOK_ADMIN_TOKEN||request.headers.get('Authorization')!==`Bearer ${env.GUESTBOOK_ADMIN_TOKEN}`))return json({message:'无权移除便签。'},403);
      if(Number(request.headers.get('Content-Length'))>4096)return json({message:'提交内容过长。'},413);
      return env.GUESTBOOK.get(env.GUESTBOOK.idFromName('public-wall')).fetch(request);
    }
    if (url.pathname.startsWith('/realtime/')) {
      const [, , game, room] = url.pathname.split('/');
      if (!games.has(game) || !/^[1-9]\d{2}$/.test(room || '')) return new Response('Invalid room', {status:400});
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status:426});
      if (request.headers.get('Origin') !== url.origin) return new Response('Origin rejected', {status:403});
      const id = env.ROOMS.idFromName(`${game}:${room}`);
      return env.ROOMS.get(id, {locationHint:'apac'}).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(ctx) {
    this.ctx=ctx; this.sockets=new Map(); this.pending=new Map(); this.game='';
    ctx.blockConcurrencyWhile(async()=>{ this.room=await ctx.storage.get('room') || null; });
  }
  async fetch(request) {
    this.game=new URL(request.url).pathname.split('/')[2];
    const pair=new WebSocketPair(); const [client,server]=Object.values(pair);
    server.accept(); this.sockets.set(server,null);
    server.addEventListener('message',e=>this.message(server,e.data));
    const close=()=>{
      const role=this.sockets.get(server);this.sockets.delete(server);this.pending.delete(server);
      if(role&&this.room&&!this.online(role)){
        const seat=this.room.players.findIndex(p=>p?.role===role);
        this.emit(role,'peer-left',{seat});this.persist();
      }
      this.wake();
    };
    server.addEventListener('close',close); server.addEventListener('error',close);
    return new Response(null,{status:101,webSocket:client});
  }
  online(role) { return [...this.sockets.values()].some(x=>x===role); }
  persist() { this.ctx.waitUntil(this.ctx.storage.put('room',this.room)); }
  emit(from,type,payload,to) {
    const r=this.room; r.events.push({id:++r.seq,from,type,payload,to});
    while(r.events.length>128||JSON.stringify(r.events).length>60000)r.events.shift();
  }
  status(role,since) {
    const r=this.room;
    if(!r)throw Error('房间不存在或已过期');
    return {ok:true,events:r.events.filter(e=>e.id>since&&e.from!==role&&(!e.to||e.to===role)),
      peerOnline:this.online(role==='host'?'guest':'host'),ownerRole:r.owner,
      ownerOnline:this.online(r.owner),players:r.players.map(p=>p?{name:p.name,online:this.online(p.role)}:{online:false})};
  }
  reply(ws,id,value) { if(ws.readyState===1)ws.send(JSON.stringify({id,...value})); }
  wake() { for(const [ws,p] of this.pending) { this.pending.delete(ws); try{this.reply(ws,p.id,this.status(p.role,p.since));}catch(e){this.reply(ws,p.id,{ok:false,message:e.message});} } }
  async message(ws,raw) {
    let m;
    try {
      if(typeof raw!=='string'||raw.length>400000)throw Error('消息过大');
      m=JSON.parse(raw); const b=m.body||{},path=m.path.split('?')[0];
      if(path==='/api/ping'){this.reply(ws,m.id,{ok:true,db:true,transport:'websocket'});return;}
      if(path==='/api/create') {
        if(this.room&&Date.now()-this.room.updated<3600000)throw Error('ROOM_EXISTS');
        this.room={players:[],owner:'host',seq:0,events:[],checkpoint:null,ruleset:b.ruleset,updated:Date.now()};
        const p={role:'host',name:String(b.name||'玩家').slice(0,24),token:crypto.randomUUID()};
        this.room.players[0]=p;this.sockets.set(ws,'host');this.persist();
        this.reply(ws,m.id,{ok:true,room:new URLSearchParams(m.query).get('room')||b.room,role:'host',seat:0,token:p.token,ruleset:b.ruleset,features:{batch:true}});return;
      }
      const r=this.room;if(!r)throw Error('房间不存在或已过期');
      if(path==='/api/join') {
        if(!this.online(r.owner))throw Error('主机已离线');
        const limit=this.game==='mahjong'?4:2;
        let seat=-1;for(let i=1;i<limit;i++)if(r.players[i]?.role!==r.owner&&(!r.players[i]||!this.online(r.players[i].role))){seat=i;break;}
        if(seat<0)throw Error('房间已满');
        const role=this.game==='mahjong'?`guest${seat}`:'guest';
        const p={role,name:String(b.name||'玩家').slice(0,24),token:crypto.randomUUID()};
        r.players[seat]=p;this.sockets.set(ws,role);const since=r.seq;
        this.emit(role,'peer-joined',{name:p.name,seat});r.updated=Date.now();this.persist();this.wake();
        this.reply(ws,m.id,{ok:true,room:b.room,role,seat,token:p.token,since,hostName:r.players.find(x=>x?.role===r.owner)?.name||'房主',features:{batch:true}});return;
      }
      const q=new URLSearchParams(m.path.split('?')[1]);
      const role=b.role||q.get('role'),token=b.token||q.get('token');
      const p=r.players.find(x=>x?.role===role&&x.token===token);
      if(!p)throw Error('会话已失效');
      this.sockets.set(ws,role);r.updated=Date.now();
      if(path==='/api/poll') {
        const since=Number(q.get('since'))||0;
        const status=this.status(role,since);
        if(status.events.length){this.reply(ws,m.id,status);return;}
        this.pending.set(ws,{id:m.id,role,since});
        setTimeout(()=>{if(this.pending.get(ws)?.id===m.id){this.pending.delete(ws);this.reply(ws,m.id,this.status(role,since));}},1000);return;
      }
      if(path==='/api/send') {
        const batch=b.batch||[b];if(!Array.isArray(batch)||batch.length>20)throw Error('无效消息批次');
        for(const e of batch){
          if(e.type==='checkpoint'){if(role!==r.owner)throw Error('无权备份');r.checkpoint=e.payload?.game;continue;}
          if(this.game==='mahjong'){
            if(['snapshot','notice'].includes(e.type)&&role!==r.owner)throw Error('无权发送');
            if(e.type==='intent'||e.type==='sync-request')e.to=r.owner;
          }
          this.emit(role,e.type,e.payload,e.to);
        }
        this.persist();this.wake();this.reply(ws,m.id,{ok:true});return;
      }
      if(path==='/api/takeover') {
        const first=r.players.find(x=>x&&x.role!==r.owner&&this.online(x.role));
        if(this.online(r.owner)||first?.role!==role||!r.checkpoint)throw Error('暂不能接管');
        r.owner=role;this.persist();this.wake();this.reply(ws,m.id,{ok:true,game:r.checkpoint,players:this.status(role,0).players});return;
      }
      if(path==='/api/leave') {
        const seat=r.players.indexOf(p);this.sockets.set(ws,null);r.players[seat]=null;
        this.emit(role,'peer-left',{seat});this.persist();this.wake();this.reply(ws,m.id,{ok:true});return;
      }
      throw Error('接口不存在');
    }catch(e){this.reply(ws,m?.id,{ok:false,message:e.message});}
  }
}
