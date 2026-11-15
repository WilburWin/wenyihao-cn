import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolFeedback,validateFeedback} from '../worker/tool-feedback.js';
import {DownloadBridge} from '../worker/downloads.js';
const origin='https://example.com',secret='feedback-operator-secret-at-least-32-characters';
function memory(){
 const rows=new Map();let queue=Promise.resolve();
 const storage={async get(key){return structuredClone(rows.get(key));},async put(key,value){rows.set(key,structuredClone(value));},async list({prefix='',reverse=false,limit=1000,end}={}){return new Map([...rows].filter(([key])=>key.startsWith(prefix)&&(!end||key<end)).sort(([a],[b])=>reverse?b.localeCompare(a):a.localeCompare(b)).slice(0,limit));},async setAlarm(){},transaction(fn){const result=queue.then(()=>fn(storage));queue=result.catch(()=>{});return result;}};return {storage,rows};
}
const valid=(patch={})=>({requestId:crypto.randomUUID(),kind:'download',message:'下载中途出错，请帮忙检查。',contact:'user@example.com',orderId:'DL'+'a'.repeat(32),...patch});
const request=(action,data={},headers={})=>new Request(origin+'/api/tools/feedback/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
function fixture(){const {storage,rows}=memory();let now=Date.now();const env={TOOLS_FEEDBACK_ADMIN_KEY:secret},service=new ToolFeedback({storage,env,now:()=>now});return {storage,rows,env,service,advance:ms=>now+=ms};}
const admin=(action,data={},key=secret)=>request('admin/'+action,data,{Authorization:'Bearer '+key});

test('feedback validates private fields and keeps untrusted content as data',()=>{
 const result=validateFeedback(valid({message:' <script>alert(1)</script> '}));assert.equal(result.message,'<script>alert(1)</script>');
 for(const patch of [{kind:'unknown'},{message:' '},{message:'x'.repeat(3001)},{message:'hello\u0000world'},{contact:'x'.repeat(121)},{orderId:'foreign-order'},{website:'spam'},{requestId:'bad'}])assert.throws(()=>validateFeedback(valid(patch)));
});

test('feedback persists privately, retries are idempotent and public users cannot list or alter it',async()=>{
 const f=fixture(),data=valid();const first=await f.service.handle(request('submit',data));assert.equal(first.status,201);const {receipt}=await first.json();assert.match(receipt.id,/^FB\d{13}[a-f0-9]{32}$/);
 assert.deepEqual(Object.keys(receipt).sort(),['createdAt','id']);assert.equal(JSON.stringify(receipt).includes(data.contact),false);
 const repeated=await f.service.handle(request('submit',data));assert.deepEqual((await repeated.json()).receipt,receipt);
 assert.equal((await f.service.handle(request('submit',{...data,message:'不同内容不能覆盖原始反馈'}))).status,409);
 assert.equal((await f.service.handle(admin('list',{},'bad'))).status,403);assert.equal((await f.service.handle(request('admin/list'))).status,403);assert.equal((await f.service.handle(request('list'))).status,404);
 const listed=await(await f.service.handle(admin('list'))).json();assert.equal(listed.items.length,1);const row=listed.items[0];assert.equal(row.message,data.message);assert.equal(row.contact,data.contact);assert.equal(row.status,'open');assert.ok(row.until-row.createdAt===180*86400000);assert.ok(!JSON.stringify([...f.rows]).includes('198.51.100.1'));
 const response=await f.service.handle(admin('update',{id:receipt.id,status:'processing',note:'正在核对文件'}));assert.equal(response.status,200);assert.equal((await response.json()).item.note,'正在核对文件');
 assert.equal((await f.service.handle(admin('update',{id:receipt.id,status:'refunded'}))).status,400);
 await f.service.handle(admin('update',{id:receipt.id,status:'resolved',note:'用户确认已下载'}));assert.equal((await(await f.service.handle(admin('list'))).json()).items[0].status,'resolved');
 f.advance(180*86400000+1);assert.equal((await(await f.service.handle(admin('list'))).json()).items.length,0);assert.equal((await f.service.handle(admin('update',{id:receipt.id,status:'open'}))).status,404);
});

test('feedback requires same-origin JSON, limits body size and works when the file agent and payments are unavailable',async()=>{
 const f=fixture();
 assert.equal((await f.service.handle(request('submit',valid(),{Origin:'https://evil.example'}))).status,403);
 assert.equal((await f.service.handle(request('submit',valid(),{'Content-Type':'text/plain'}))).status,415);
 const huge=new Request(origin+'/api/tools/feedback/submit',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'x'.repeat(16385)});assert.equal((await f.service.handle(huge)).status,413);
 assert.equal((await f.service.handle(new Request(origin+'/api/tools/feedback/admin/list'))).status,405);
 const bridge=new DownloadBridge({storage:f.storage,getWebSockets:()=>[]},f.env);assert.equal((await bridge.fetch(request('submit',valid()))).status,201);
 assert.equal((await bridge.fetch(request('admin/list'))).status,403);
});

test('feedback throttles repeated submissions and concurrent retries retain one receipt',async()=>{
 const f=fixture(),data=valid();const replies=await Promise.all(Array.from({length:5},()=>f.service.handle(request('submit',data))));
 const receipts=await Promise.all(replies.map(response=>response.json()));assert.equal(new Set(receipts.map(data=>data.receipt.id)).size,1);
 assert.equal((await f.service.handle(request('submit',valid()))).status,429);f.advance(60001);assert.equal((await f.service.handle(request('submit',valid()))).status,201);
});

test('feedback management paginates without duplicates and never exposes notes without its dedicated key',async()=>{
 const f=fixture();for(let i=0;i<27;i++){f.advance(1);assert.equal((await f.service.handle(request('submit',valid(),{'CF-Connecting-IP':'visitor-'+i}))).status,201);}
 const first=await(await f.service.handle(admin('list'))).json();assert.equal(first.items.length,25);assert.ok(first.cursor);
 const second=await(await f.service.handle(admin('list',{cursor:first.cursor}))).json();assert.equal(second.items.length,2);assert.equal(second.cursor,null);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,27);
 assert.equal((await f.service.handle(admin('list',{cursor:'invalid'}))).status,400);
 f.env.TOOLS_FEEDBACK_ADMIN_KEY='';assert.equal((await f.service.handle(admin('list'))).status,403);
});
