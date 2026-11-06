/* Existing game APIs travel over one WebSocket; choose a route before joining. */
(() => {
  const nativeFetch=window.fetch.bind(window), game=location.pathname.split('/')[2];
  let socket=null, room='', opening=null, serial=0, rtt=0,endpoint=location.origin;
  const pending=new Map();
  const socketUrl=(origin,code)=>origin.replace(/^http/,'ws')+`/realtime/${game}/${code}`;
  // Probes use ping only, always the same object, and never create or join a game.
  function probe(origin){
    return new Promise(resolve=>{
      let ws,done=false,start=0;const samples=[];
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);if(ws)ws.close();resolve(value);};
      const timer=setTimeout(()=>finish(null),3500);
      try{
        ws=new WebSocket(socketUrl(origin,'100'));
        const ping=()=>{start=performance.now();ws.send(JSON.stringify({id:'route-'+samples.length,path:'/api/ping',body:{}}));};
        ws.onopen=ping;
        ws.onmessage=event=>{
          try{
            const data=JSON.parse(event.data);if(!data.ok||data.id!=='route-'+samples.length){finish(null);return;}
            samples.push(performance.now()-start);
            if(samples.length<3)ping();else finish({origin,rtt:Math.max(samples[1],samples[2])});
          }catch{finish(null);}
        };
        ws.onerror=()=>finish(null);ws.onclose=()=>finish(null);
      }catch{finish(null);}
    });
  }
  async function chooseEndpoint(){
    try{
      const response=await nativeFetch('/shared/realtime-config.json',{cache:'no-cache',signal:AbortSignal.timeout(1500)});
      if(!response.ok)return location.origin;
      const config=await response.json();if(!config.enabledFor?.includes(location.origin))return location.origin;
      const origins=[...new Set([location.origin,...(config.endpoints||[]).filter(value=>{
        try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password;}catch{return false;}
      }).slice(0,2)])];
      const available=(await Promise.all(origins.map(probe))).filter(Boolean);
      available.sort((a,b)=>a.rtt-b.rtt);
      const own=available.find(value=>value.origin===location.origin),best=available[0];
      // Avoid changing endpoints for measurement noise of only a few ms.
      return best&&(!own||best.rtt+20<own.rtt)?best.origin:location.origin;
    }catch{return location.origin;}
  }
  const selection=chooseEndpoint().then(value=>{endpoint=value;return value;});
  function openSocket(origin,code){
    const ws=new WebSocket(socketUrl(origin,code));socket=ws;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const fail=message=>{if(settled)return;settled=true;clearTimeout(timer);ws.close();reject(Error(message));};
      const timer=setTimeout(()=>fail('连接超时，请检查网络后重试'),5000);
      ws.onopen=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
      ws.onerror=()=>fail('无法连接联机服务');
      ws.onmessage=e=>{
        let data;try{data=JSON.parse(e.data);}catch{return;}
        const p=pending.get(data.id);if(!p||p.ws!==ws)return;
        pending.delete(data.id);clearTimeout(p.timer);
        if(p.ping){rtt=Math.round(performance.now()-p.start);window.dispatchEvent(new CustomEvent('game-latency',{detail:rtt}));}
        p.resolve(data);
      };
      ws.onclose=()=>{
        fail('连接已断开，正在重连');
        for(const [id,p] of pending){if(p.ws===ws){clearTimeout(p.timer);p.reject(Error('连接已断开，正在重连'));pending.delete(id);}}
      };
    });
  }
  async function connect(code) {
    await selection;
    if(socket?.readyState===1&&room===code)return;
    if(opening?.code===code&&socket?.readyState===0)return opening.promise;
    if(socket)socket.close();room=code;
    const attempt={code};
    attempt.promise=(async()=>{
      try{await openSocket(endpoint,code);}
      catch(error){if(room!==code||endpoint===location.origin)throw error;endpoint=location.origin;await openSocket(endpoint,code);}
      window.dispatchEvent(new CustomEvent('game-route',{detail:{origin:endpoint,optimized:endpoint!==location.origin}}));
    })().finally(()=>{if(opening===attempt)opening=null;});
    opening=attempt;return attempt.promise;
  }
  async function rpc(path,body,code) {
    await connect(code);
    return new Promise((resolve,reject)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('服务响应超时'));},15000);
      pending.set(id,{resolve,reject,timer,ws:socket,start:performance.now(),ping:path==='/api/ping'});
      try{socket.send(JSON.stringify({id,path,body,query:`room=${code}`}));}
      catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
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
      data=await rpc('/api/ping',{},room||'100');
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
  window.gameRealtimeRoute=()=>endpoint;
})();
