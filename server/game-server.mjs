import http from 'node:http';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {GameRoom} from '../worker/game-room.js';

// One process owns every room. Do not run multiple independent replicas.
export async function createGameServer({
  host='127.0.0.1',port=8788,dataDir='.game-data',
  origins=['http://localhost:8787','http://127.0.0.1:8787'],maxConnections=256,maxRooms=256,
  logger=console,
}={}) {
  dataDir=resolve(dataDir);
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const rooms=new Map(),writes=new Set(),allowedOrigins=new Set(origins);
  let closing=false,upgrades=0;
  function track(promise){
    writes.add(promise);
    promise.catch(error=>logger.error('Room persistence failed:',error)).finally(()=>writes.delete(promise));
  }
  async function loadRoom(game,code){
    const key=`${game}-${code}`;
    if(rooms.has(key))return rooms.get(key).ready;
    if(rooms.size>=maxRooms){
      // Only evict idle rooms once their writes have completed.
      for(const [name,entry] of rooms){
        if(entry.room&&!entry.room.sockets.size&&!entry.pending){rooms.delete(name);break;}
      }
      if(rooms.size>=maxRooms)throw Error('Room capacity reached');
    }
    const entry={room:null,pending:0,ready:null};
    const file=join(dataDir,`${key}.json`);
    let queue=Promise.resolve(),initialization;
    const ctx={
      blockConcurrencyWhile(fn){initialization=fn();},
      waitUntil:track,
      storage:{
        async get(){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
        put(_key,value){
          const snapshot=JSON.stringify(value);entry.pending++;
          const job=queue.then(async()=>{await writeFile(`${file}.tmp`,snapshot,{mode:0o600});await rename(`${file}.tmp`,file);});
          queue=job.catch(()=>{});
          return job.finally(()=>{entry.pending--;});
        },
      },
    };
    rooms.set(key,entry);
    entry.ready=(async()=>{
      const room=new GameRoom(ctx);await initialization;
      room.game=game;entry.room=room;return room;
    })().catch(error=>{rooms.delete(key);throw error;});
    return entry.ready;
  }
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='GET'&&req.url==='/healthz'){
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true,transport:'websocket',rooms:rooms.size,connections:wss.clients.size}));
    }else{res.writeHead(404);res.end('Not found');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:400000,perMessageDeflate:false});
  const reject=(socket,status)=>{socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
  server.on('upgrade',async(req,socket,head)=>{
    socket.on('error',()=>{});
    let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{reject(socket,'400 Bad Request');return;}
    const match=/^\/realtime\/(go|mahjong|billiards)\/([1-9]\d{2})$/.exec(pathname);
    if(!match){reject(socket,'404 Not Found');return;}
    if(!allowedOrigins.has(req.headers.origin)){reject(socket,'403 Forbidden');return;}
    if(closing||wss.clients.size+upgrades>=maxConnections){reject(socket,'503 Service Unavailable');return;}
    upgrades++;
    const timeout=setTimeout(()=>socket.destroy(),5000);
    try{
      const room=await loadRoom(match[1],match[2]);
      if(socket.destroyed)return;
      if(closing){reject(socket,'503 Service Unavailable');return;}
      wss.handleUpgrade(req,socket,head,ws=>{
        ws.alive=true;ws.on('pong',()=>{ws.alive=true;});
        room.attachSocket(ws);
      });
    }catch(error){logger.error('Room initialization failed:',error);reject(socket,'503 Service Unavailable');}
    finally{clearTimeout(timeout);upgrades--;}
  });
  const heartbeat=setInterval(()=>{
    for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}
  },30000);
  heartbeat.unref();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {
    server,rooms,
    async close(){
      closing=true;clearInterval(heartbeat);
      const closed=new Promise(resolve=>server.close(resolve));
      for(const ws of wss.clients)ws.terminate();
      await new Promise(resolve=>wss.close(resolve));
      await closed;
      await Promise.allSettled([...writes]);
    },
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=await createGameServer({
    host:process.env.GAME_HOST||'127.0.0.1',port:Number(process.env.GAME_PORT||8788),
    dataDir:process.env.GAME_DATA_DIR||'.game-data',
    origins:(process.env.GAME_ORIGINS||'http://localhost:8787,http://127.0.0.1:8787').split(',').map(x=>x.trim()).filter(Boolean),
  });
  console.log(`Game backend listening on ${JSON.stringify(app.server.address())}`);
  let stopping=false;
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{
    if(stopping)return;stopping=true;
    const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
    app.close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
  });
}
