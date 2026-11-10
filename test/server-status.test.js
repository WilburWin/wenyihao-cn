import test from 'node:test';
import assert from 'node:assert/strict';
import {maskVisitorIP,publicSnapshot,serverStatusRequest,ServerStatus} from '../worker/server-status.js';

test('visitor masks remove full IPv4 and IPv6 addresses and reject malformed values',()=>{
  assert.equal(maskVisitorIP('123.45.67.89'),'123.45.67.*');
  assert.equal(maskVisitorIP('2001:db8:abcd:1234::1'),'2001:db8:abcd::*');
  assert.equal(maskVisitorIP('2001:db8::1'),'2001:db8:0::*');
  for(const value of ['999.1.1.1','bad','1:2','https://127.0.0.1'])assert.equal(maskVisitorIP(value),null);
});
function fixture(){
  const rows=new Map();
  const storage={get:async k=>rows.get(k),put:async(k,v)=>{if(typeof k==='string')rows.set(k,structuredClone(v));else for(const [key,value]of Object.entries(k))rows.set(key,structuredClone(value));},delete:async k=>rows.delete(k),transaction:async fn=>fn(storage)};
  const status=new ServerStatus({storage});
  const env={SERVER_STATUS_TOKEN:'private-token',STATUS:{idFromName:()=>0,get:()=>({fetch:r=>status.fetch(typeof r==='string'?new Request(r):r)})}};
  return{rows,env,status};
}
test('public status whitelist drops server identity, secrets, logs and arbitrary fields',()=>{
  const value=publicSnapshot({updatedAt:new Date().toISOString(),hostname:'private-host',ip:'10.0.0.1',token:'secret',cpuPercent:500,traffic:{monthlyBytes:1,budgetBytes:1e9,price:1},game:{online:true,players:['name']}});
  assert.equal(value.cpuPercent,100);
  for(const text of ['private-host','10.0.0.1','secret','players','price'])assert.equal(JSON.stringify(value).includes(text),false);
});
test('only authenticated ingest writes snapshots; public endpoint remains read only',async()=>{
  const {env,rows}=fixture(),url='https://example.com/api/status';
  const body={updatedAt:new Date().toISOString(),cpuPercent:1,traffic:{budgetBytes:1e9,monthlyBytes:25}};
  assert.equal((await serverStatusRequest(new Request(url+'/ingest',{method:'POST',body:JSON.stringify(body)}),env)).status,401);
  assert.equal((await serverStatusRequest(new Request(url,{method:'DELETE'}),env)).status,405);
  assert.equal(rows.size,0);
  assert.equal((await serverStatusRequest(new Request(url+'/ingest',{method:'POST',headers:{Authorization:'Bearer private-token'},body:JSON.stringify(body)}),env)).status,200);
  const response=await serverStatusRequest(new Request(url),env),data=await response.json();
  assert.equal(data.snapshot.cpuPercent,1);assert.equal(data.stale,false);
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=30');
});
test('visit collection stores only masked network and city, coalesces repeated observations, expires after 24 hours',async()=>{
  const {env,rows,status}=fixture();
  const make=()=>{const r=new Request('https://example.com/api/status/visit',{method:'POST',headers:{Origin:'https://example.com','CF-Connecting-IP':'123.45.67.89',Cookie:'name=secret'}});Object.defineProperty(r,'cf',{value:{city:'Chengdu',country:'CN'}});return r;};
  await serverStatusRequest(make(),env);await serverStatusRequest(make(),env);
  const data=await (await serverStatusRequest(new Request('https://example.com/api/status'),env)).json();
  assert.deepEqual(data.visitors.rows,[{ip:'123.45.67.*',city:'Chengdu',country:'CN',visits:1}]);
  assert.equal(JSON.stringify([...rows.values()]).includes('123.45.67.89'),false);
  assert.equal(JSON.stringify([...rows.values()]).includes('secret'),false);
  rows.get('visitors').rows[0].last=Date.now()-25*3600000;
  rows.get('visitors').buckets[0].at=Date.now()-25*3600000;
  assert.equal((await (await status.fetch(new Request('https://status/summary'))).json()).visitors.rows.length,0);
});
