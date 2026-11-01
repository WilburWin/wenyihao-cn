/* Same-origin adapter: existing game APIs now travel over one WebSocket. */
(() => {
  const nativeFetch=window.fetch.bind(window), game=location.pathname.split('/')[2];
  let socket=null, room='', opening=null, serial=0, rtt=0;
  const pending=new Map();
  async function connect(code) {
    if(socket?.readyState===1&&room===code)return;
    if(opening&&room===code)return opening;
    if(socket)socket.close();room=code;
    const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/realtime/${game}/${code}`);
    socket=ws;
    opening=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ws.close();reject(Error('连接超时，请检查网络后重试'));},10000);
      ws.onopen=()=>{clearTimeout(timer);resolve();};
      ws.onerror=()=>{clearTimeout(timer);reject(Error('无法连接联机服务'));};
    });
    ws.onmessage=e=>{
      const data=JSON.parse(e.data), p=pending.get(data.id);if(!p)return;
      pending.delete(data.id);clearTimeout(p.timer);p.resolve(data);
    };
    ws.onclose=()=>{for(const [id,p] of pending){if(p.ws===ws){clearTimeout(p.timer);p.reject(Error('连接已断开，正在重连'));pending.delete(id);}}};
    return opening;
  }
  async function rpc(path,body,code) {
    await connect(code);
    return new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('服务响应超时'));},15000);
      pending.set(id,{resolve,reject,timer,ws:socket});
      socket.send(JSON.stringify({id,path,body,query:`room=${code}`}));
    });
  }
  window.fetch=async(input,opts={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    const prefix=`/relay/${game}`;
    if(url.origin!==location.origin||!url.pathname.startsWith(prefix+'/'))return nativeFetch(input,opts);
    const path=url.pathname.slice(prefix.length)+url.search;
    const body=opts.body?JSON.parse(opts.body):{};
    let data;
    if(path.startsWith('/api/ping')){
      const start=performance.now();
      data=await rpc('/api/ping',{},room||'100');
      rtt=Math.round(performance.now()-start);
      window.dispatchEvent(new CustomEvent('game-latency',{detail:rtt}));
    }else if(path==='/api/create'){
      for(let tries=0;tries<12;tries++){
        const code=String(100+Math.floor(Math.random()*900));
        data=await rpc(path,{...body,room:code},code);
        if(data.message!=='ROOM_EXISTS')break;
      }
    }else{
      const code=String(body.room||url.searchParams.get('room')||room);
      data=await rpc(path,body,code);
    }
    return new Response(JSON.stringify(data),{status:data.ok?200:400,headers:{'content-type':'application/json'}});
  };
  window.addEventListener('pagehide',()=>socket?.close());
  const home=document.createElement('a');home.href='/games/';home.textContent='返回游戏大厅 / Games';
  home.style.cssText='position:fixed;bottom:8px;left:8px;z-index:9999;padding:5px 10px;border-radius:5px;background:#ffffffed;color:#293e4b;font:12px system-ui;text-decoration:none;box-shadow:0 1px 5px #0002';
  document.addEventListener('DOMContentLoaded',()=>document.body.append(home));
  window.addEventListener('game-latency',e=>{const n=document.getElementById('netStatus');if(n)n.textContent=`联机往返 ${e.detail} ms`;});
  setInterval(()=>{if(socket?.readyState===1)window.fetch(`${location.origin}/relay/${game}/api/ping`).catch(()=>{});},8000);
  window.gameRealtimeRTT=()=>rtt;
})();
