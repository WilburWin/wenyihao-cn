import {json} from './community.js';

const DAY=86400000;
export function maskVisitorIP(value=''){
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split('.').every(x=>Number(x)<=255))return value.split('.').slice(0,3).join('.')+'.*';
  if(value.includes(':')&&/^[a-f0-9:]+$/i.test(value)){
    try{
      const host=new URL('http://['+value+']/').hostname.slice(1,-1),parts=host.split('::');
      const left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[];
      const full=parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
      if(full.length===8)return full.slice(0,3).join(':')+'::*';
    }catch{}
  }
  return null;
}
const number=(value,max=1e16)=>Number.isFinite(value)&&value>=0?Math.min(value,max):null;
export function publicSnapshot(data){
  if(!data||!Number.isFinite(Date.parse(data.updatedAt)))throw Error('Invalid snapshot');
  return {
    updatedAt:new Date(data.updatedAt).toISOString(),
    cpuPercent:number(data.cpuPercent,100),memoryUsed:number(data.memoryUsed),memoryTotal:number(data.memoryTotal),
    diskUsed:number(data.diskUsed),diskTotal:number(data.diskTotal),uptimeSeconds:number(data.uptimeSeconds),
    traffic:{month:/^\d{4}-\d{2}$/.test(data.traffic?.month||'')?data.traffic.month:null,
      monthlyBytes:number(data.traffic?.monthlyBytes),dailyBytes:number(data.traffic?.dailyBytes),
      budgetBytes:number(data.traffic?.budgetBytes),outBytesPerSecond:number(data.traffic?.outBytesPerSecond),
      protected:Boolean(data.traffic?.protected),coverageStartedAt:Number.isFinite(Date.parse(data.traffic?.coverageStartedAt))?new Date(data.traffic.coverageStartedAt).toISOString():null},
    game:{online:Boolean(data.game?.online),connections:number(data.game?.connections,100000),rooms:number(data.game?.rooms,100000)},
  };
}
async function authorized(value,expected){
  if(!value||!expected)return false;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b]=await Promise.all([hash(value),hash('Bearer '+expected)]);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function serverStatusRequest(request,env){
  const url=new URL(request.url),ingest=url.pathname==='/api/status/ingest';
  if(!env.STATUS)return json({message:'监控数据尚未接入。'},503);
  const stub=env.STATUS.get(env.STATUS.idFromName('public-status'));
  if(ingest){
    if(request.method!=='POST')return json({message:'Method not allowed'},405);
    if(!await authorized(request.headers.get('Authorization'),env.SERVER_STATUS_TOKEN))return json({message:'Unauthorized'},401);
    try{
      const reader=request.body?.getReader();let size=0,raw='';const decoder=new TextDecoder();
      if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
        if(size>8192){await reader.cancel();return json({message:'Too large'},413);}raw+=decoder.decode(value,{stream:true});}}
      raw+=decoder.decode();
      return stub.fetch(new Request('https://status/snapshot',{method:'POST',body:JSON.stringify(publicSnapshot(JSON.parse(raw)))}));
    }catch{return json({message:'Invalid snapshot'},400);}
  }
  if(url.pathname==='/api/status/visit'){
    if(request.method!=='POST')return json({message:'Method not allowed'},405);
    if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({message:'Origin rejected'},403);
    // Only trust the platform connection metadata, never X-Forwarded-For/body.
    const ip=maskVisitorIP(request.headers.get('CF-Connecting-IP')||'');
    if(!ip)return new Response(null,{status:204});
    const clean=value=>String(value||'').replace(/[\p{C}<>]/gu,'').slice(0,60);
    const city=clean(request.cf?.city)||'未知城市',country=clean(request.cf?.country)||'';
    // Raw IP, URL, account identifiers and cookies never enter storage.
    return stub.fetch(new Request('https://status/visit',{method:'POST',body:JSON.stringify({ip,city,country})}));
  }
  if(url.pathname!=='/api/status')return json({message:'Not found'},404);
  if(!['GET','HEAD'].includes(request.method))return json({message:'Read only'},405,{Allow:'GET, HEAD'});
  const result=await stub.fetch('https://status/summary');
  return request.method==='HEAD'?new Response(null,{status:result.status,headers:result.headers}):result;
}

export class ServerStatus{
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    const {pathname}=new URL(request.url),s=this.ctx.storage,now=Date.now();
    if(pathname==='/snapshot'&&request.method==='POST'){
      const value=publicSnapshot(await request.json());
      await s.transaction(async tx=>{
        const previous=await tx.get('snapshot');
        if(!previous||Date.parse(value.updatedAt)>Date.parse(previous.updatedAt)){
          const history=await tx.get('history')||[];
          history.push({at:value.updatedAt,cpu:value.cpuPercent,out:value.traffic.outBytesPerSecond});
          await tx.put({snapshot:value,history:history.slice(-60)});
        }
      });
      return json({ok:true});
    }
    if(pathname==='/visit'&&request.method==='POST'){
      const visitor=await request.json();
      if(!visitor.ip?.includes('*'))return json({message:'Masked IP required'},400);
      await s.transaction(async tx=>{
        let data=await tx.get('visitors')||{startedAt:new Date(now).toISOString(),rows:[],buckets:[]};
        data.rows=data.rows.filter(r=>now-r.last<DAY);
        data.buckets=data.buckets.filter(b=>now-b.at<DAY);
        let row=data.rows.find(r=>r.ip===visitor.ip&&r.city===visitor.city&&r.country===visitor.country);
        // Collapse repeated collection events in the same network/city to one per minute.
        if(row&&now-row.last<60000)return;
        if(!row){row={...visitor,last:now,visits:0};data.rows.push(row);}
        row.last=now;row.visits++;
        if(data.rows.length>500)data.rows.sort((a,b)=>b.last-a.last).length=500;
        const hour=Math.floor(now/3600000)*3600000;
        let bucket=data.buckets.find(b=>b.at===hour);
        if(!bucket){bucket={at:hour,count:0};data.buckets.push(bucket);}bucket.count++;
        await tx.put('visitors',data);
      });
      if(this.ctx.storage.setAlarm)await this.ctx.storage.setAlarm(now+DAY);
      return new Response(null,{status:204});
    }
    if(pathname!=='/summary'||request.method!=='GET')return json({message:'Not found'},404);
    const [snapshot,history,visitors]=await Promise.all([s.get('snapshot'),s.get('history'),s.get('visitors')]);
    const rows=(visitors?.rows||[]).filter(r=>now-r.last<DAY).sort((a,b)=>b.last-a.last);
    return json({snapshot:snapshot||null,stale:!snapshot||now-Date.parse(snapshot.updatedAt)>180000,history:history||[],
      visitors:{windowHours:24,startedAt:visitors?.startedAt||null,
        observations:(visitors?.buckets||[]).filter(b=>now-b.at<DAY).reduce((sum,b)=>sum+b.count,0),
        networks:rows.length,rows:rows.slice(0,40).map(({ip,city,country,visits})=>({ip,city,country,visits}))}},200,{'Cache-Control':'public, max-age=30','X-Content-Type-Options':'nosniff'});
  }
  async alarm(){
    const s=this.ctx.storage,v=await s.get('visitors');if(!v)return;
    const now=Date.now();v.rows=v.rows.filter(r=>now-r.last<DAY);v.buckets=v.buckets.filter(b=>now-b.at<DAY);
    if(v.rows.length){await s.put('visitors',v);await s.setAlarm(now+DAY);}else await s.delete('visitors');
  }
}
