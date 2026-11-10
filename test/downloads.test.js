import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safePath,safeDownload,equalSecret,DownloadBridge,downloadRequest} from '../worker/downloads.js';
import {normalizePath,downloadURL,createLibrary,shareInput,createShareImporter} from '../server/download-agent.mjs';
test('download paths remain in the shared user root',()=>{
  for(const check of [safePath,normalizePath]){
    assert.equal(check('/文件/a.txt'),'/文件/a.txt');assert.equal(check('/'),'/');
    for(const path of ['../x','/../x','/a/./b','//server','/a\\b','/%2e%2e/x','/x\0y','https://example.com'])assert.throws(()=>check(path));
  }
});
test('download URLs only target HTTPS Baidu storage, without account tokens',()=>{
  for(const check of [safeDownload,downloadURL]){
    assert.equal(check('https://bjbgp01.baidupcs.com/file?sign=test'),'https://bjbgp01.baidupcs.com/file?sign=test');
    for(const url of ['http://a.baidupcs.com/a','https://baidupcs.com.evil.com/a','https://127.0.0.1/a','https://user:pass@a.baidu.com/a','https://a.baidu.com:5244/a','https://a.baidu.com/a?access_token=secret'])assert.throws(()=>check(url));
  }
});
test('constant-length secret digests reject missing credentials',async()=>{
  assert.equal(await equalSecret('abc','abc'),true);assert.equal(await equalSecret('abc','xyz'),false);assert.equal(await equalSecret('',''),false);
});
function bridge(){
  const map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),setAlarm:async()=>{},transaction:async fn=>fn(storage)};
  const sockets=[],ctx={storage,getWebSockets:()=>sockets};const b=new DownloadBridge(ctx,{DOWNLOAD_ACCESS_CODE:'friend',DOWNLOAD_BRIDGE_KEY:'agent'});
  return {b,sockets,map};
}
function request(action,body={},code='friend',origin='https://example.com'){
  return new Request('https://example.com/api/tools/downloads/'+action,{method:'POST',headers:{Origin:origin,'X-Download-Code':code,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
test('downloads require friend code and same-origin POST before reaching agent',async()=>{
  const {b}=bridge();assert.equal((await b.fetch(request('list',{path:'/'},'bad'))).status,401);
  assert.equal((await b.fetch(request('list',{path:'/'},'friend','https://evil.com'))).status,403);
  assert.equal((await b.fetch(request('list',{path:'/../secret'}))).status,400);
  assert.equal((await b.fetch(request('list',{path:'/'}))).status,503);
  assert.equal((await b.fetch(request('status'))).status,200);
  assert.equal((await b.fetch(request('delete',{path:'/'}))).status,404);
});
test('authenticated bridge sends metadata operations, never fetches the returned file',async()=>{
  const {b,sockets}=bridge();sockets.push({readyState:1,send(raw){const m=JSON.parse(raw);assert.equal(m.action,'link');b.webSocketMessage(null,JSON.stringify({id:m.id,ok:true,data:{name:'file',url:'https://a.baidupcs.com/file'}}));}});
  const response=await b.fetch(request('link',{path:'/file'}));assert.equal(response.status,200);assert.equal((await response.json()).url,'https://a.baidupcs.com/file');
});

test('an alternative metadata transport keeps the existing authenticated request flow',async()=>{
 const {b}=bridge();let calls=0;
 b.agentOnline=()=>true;b.agent=async message=>{calls++;assert.equal(message.action,'list');assert.equal(message.path,'/');return {files:[],total:0};};
 const status=await b.fetch(request('status'));assert.equal((await status.json()).online,true);
 assert.equal((await b.fetch(request('list',{path:'/'},'bad'))).status,401);assert.equal(calls,0);
 assert.equal((await b.fetch(request('list',{path:'/'}))).status,200);assert.equal(calls,1);
});
test('download rate limiting persists in storage',async()=>{
  const {b}=bridge();for(let i=0;i<180;i++)assert.equal((await b.fetch(request('status',{},'bad'))).status,401);
  assert.equal((await b.fetch(request('status'))).status,429);
});
test('backend source assets and release API stay private',async()=>{
  assert.equal((await downloadRequest(new Request('https://example.com/_backend/manifest.json'),{})).status,404);
  assert.equal((await downloadRequest(new Request('https://example.com/api/tools/agent-release'),{DOWNLOAD_BRIDGE_KEY:'secret'})).status,403);
});
test('agent exposes only safe file fields through its restricted AList account',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);const body=JSON.parse(options.body);
    if(url.endsWith('/auth/login'))return Response.json({code:200,data:{token:'private'}});
    assert.equal(options.headers.Authorization,'private');assert.equal(body.path,'/shared-mount');
    return Response.json({code:200,data:{total:2,content:[{name:'file.txt',size:12,is_dir:false,raw_url:'must-not-leak',sign:'private'},{name:'../escape',is_dir:false}]}});
  };
  try{const list=await createLibrary({username:'reader',password:'private',mountPath:'/shared-mount'})({action:'list',path:'/'});assert.equal(list.files.length,1);assert.deepEqual(Object.keys(list.files[0]),['name','path','isDir','size','modified']);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('http://127.0.0.1:5244/api/')));}
  finally{globalThis.fetch=original;}
});
test('share imports accept Baidu short links and cannot choose a destination or arbitrary host',()=>{
  assert.equal(shareInput('https://pan.baidu.com/s/1Example?pwd=Ab12').code,'Ab12');
  assert.equal(shareInput('https://yun.baidu.com/share/init?surl=Example','aB12').short,'Example');
  for(const link of ['https://evil.com/s/1Example','https://pan.baidu.com.evil.com/s/1Example','https://user:secret@pan.baidu.com/s/1Example','https://pan.baidu.com:5244/s/1Example','https://pan.baidu.com/s/1%2e%2e'])assert.throws(()=>shareInput(link));
});
function importFixture({wrongCode=false,uncertain=false,redirect=false,statePath}={}){
  const root='/网站分享/链接导入',file={fs_id:1234,server_filename:'Example.rar',size:123,isdir:0};let completed=false,transfers=0,writes=[];
  const fetcher=async(value,options={})=>{
    const url=new URL(value),body=new URLSearchParams(options.body||'');
    if(url.pathname.startsWith('/s/'))return redirect?new Response('',{status:302,headers:{Location:'http://127.0.0.1:5244/'}}):new Response('<html></html>');
    if(url.pathname==='/share/verify')return Response.json(wrongCode?{errno:-9}:{errno:0,randsk:'private%3D'});
    if(url.pathname==='/share/list')return Response.json({errno:0,share_id:123,uk:456,list:[file],cur_total:1});
    assert.equal(url.searchParams.get('access_token'),'private-oauth');
    const method=url.searchParams.get('method');
    if(method==='list')return Response.json({errno:0,list:completed?[file]:[]});
    if(method==='create'){writes.push(body.get('path'));assert.ok(body.get('path')===root||body.get('path').startsWith(root+'/share-'));assert.equal(body.get('rtype'),'0');return Response.json({errno:0});}
    if(method==='transfer'){
      assert.equal(url.searchParams.get('ondup'),'fail');
      transfers++;assert.ok(body.get('path').startsWith(root+'/share-'));assert.equal(body.get('fsidlist'),'[1234]');assert.equal(body.get('sekey'),'private=');
      if(uncertain)throw Error('Network lost after accepting write');completed=true;return Response.json({errno:0});
    }
    assert.fail('Unexpected request');
  };
  const importer=createShareImporter({root,accessToken:'private-oauth',expiresAt:Date.now()+600000},{fetcher,statePath});
  return {importer,stats:()=>({transfers,writes})};
}
test('cloud transfer stays under import root and reuses completed files without duplicate writes',async()=>{
  const {importer,stats}=importFixture();const input={link:'https://pan.baidu.com/s/1Example',code:'Ab12',path:'/outside'};
  const result=await importer(input);assert.match(result.path,/^\/链接导入\/share-[a-f0-9]{12}$/);assert.equal(result.reused,false);assert.equal(JSON.stringify(result).includes('private-oauth'),false);
  assert.equal((await importer(input)).reused,true);assert.equal(stats().transfers,1);assert.equal(stats().writes.length,2);
});
test('wrong extraction codes and redirected hosts are rejected before cloud writes',async()=>{
  for(const options of [{wrongCode:true},{redirect:true}]){
    const {importer,stats}=importFixture(options);await assert.rejects(importer({link:'https://pan.baidu.com/s/1Example',code:'Ab12'}));assert.equal(stats().writes.length,0);assert.equal(stats().transfers,0);
  }
});
test('uncertain transfer results do not automatically repeat a write',async()=>{
  const {importer,stats}=importFixture({uncertain:true});const message={link:'https://pan.baidu.com/s/1Example',code:'Ab12'};
  await assert.rejects(importer(message),e=>e.code==='IMPORT_PENDING');await assert.rejects(importer(message),e=>e.code==='IMPORT_PENDING');assert.equal(stats().transfers,1);
});

test('an uncertain transfer remains protected after restarting the importer',async()=>{
  const statePath=await mkdtemp(join(tmpdir(),'website-import-test-'));
  try{
    const message={link:'https://pan.baidu.com/s/1Example',code:'Ab12'};
    await assert.rejects(importFixture({uncertain:true,statePath}).importer(message),e=>e.code==='IMPORT_PENDING');
    assert.equal(JSON.parse(await readFile(join(statePath,'imports.json'),'utf8')).jobs[0][1].status,'pending');
    const restarted=importFixture({statePath});
    await assert.rejects(restarted.importer(message),e=>e.code==='IMPORT_PENDING');
    assert.equal(restarted.stats().transfers,0);assert.equal(restarted.stats().writes.length,0);
  }finally{await unlink(join(statePath,'imports.json'));await rmdir(statePath);}
});

test('a corrupt import journal fails closed on every attempt without cloud writes',async()=>{
  const statePath=await mkdtemp(join(tmpdir(),'website-import-test-'));
  try{
    await writeFile(join(statePath,'imports.json'),'{broken');
    const {importer,stats}=importFixture({statePath});
    for(let i=0;i<2;i++)await assert.rejects(importer({link:'https://pan.baidu.com/s/1Example',code:'Ab12'}),e=>e.code==='IMPORT_STATE_UNAVAILABLE');
    assert.equal(stats().transfers,0);assert.equal(stats().writes.length,0);
  }finally{await unlink(join(statePath,'imports.json'));await rmdir(statePath);}
});
test('worker forwards only share link and extraction code, maps safe errors and rejects remote roots',async()=>{
  const {b,sockets}=bridge();sockets.push({readyState:1,send(raw){const m=JSON.parse(raw);assert.equal(m.action,'import');assert.equal(m.path,undefined);b.webSocketMessage(null,JSON.stringify({id:m.id,ok:false,error:{code:'SHARE_CODE_INVALID',message:'private credentials'}}));}});
  const response=await b.fetch(request('import',{link:'https://pan.baidu.com/s/1Example',code:'Ab12',path:'/outside'}));assert.equal(response.status,502);const data=await response.json();assert.equal(data.code,'SHARE_CODE_INVALID');assert.equal(JSON.stringify(data).includes('private credentials'),false);
  assert.equal((await b.fetch(request('import',{link:'https://evil.com/s/1Example',code:'Ab12'}))).status,400);
});
