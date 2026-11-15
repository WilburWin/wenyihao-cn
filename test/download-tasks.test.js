import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {prepareTask,windowsTask,aria2Task} from '../public/tools/download-tasks.js';
const grant={path:'/share',token:'a'.repeat(64),endpoint:'/api/tools/payments/file',expiresAt:Date.now()+86400000};
const build=files=>prepareTask(grant,files,'https://example.com','Downloads-test');
const file=(path,size=3)=>({path:'/share/'+path,name:path.split('/').at(-1),size});

test('batch artifacts preserve subfolders, safely map Windows names and keep task data out of shell code',()=>{
 const names=['nested/中文.pdf','a".txt','a?.txt','CON','nul.txt','x.','x','A.TXT','a.txt',"$(Write-Host 'oops') %PATH% & ^ ` .txt",'_Download_parts/a'];
 const task=build(names.map(p=>file(p))),cmd=windowsTask(task),aria=aria2Task(task);
 assert.equal(task.entries.length,names.length);assert.equal(new Set(task.entries.map(f=>f.relative.toLowerCase())).size,names.length);
 assert.ok(task.entries.some(f=>f.relative==='nested\\中文.pdf'));assert.ok(task.entries.some(f=>f.relative==='_CON'));
 assert.ok(task.entries.some(f=>f.relative==='_Download_parts (2)\\a'));
 const code=cmd.split('DOWNLOAD_SCRIPT:\r\n')[1].split('\r\nDOWNLOAD_TASK_DATA:')[0];
 assert.ok(!code.includes('oops'));assert.ok(!code.includes(grant.token));assert.ok(!code.includes('https://example.com'));
 assert.ok(code.includes("'--user-agent','pan.baidu.com'"));assert.ok(code.includes("'--continue-at','-'"));assert.ok(!code.includes('ExecutionPolicy'));
 assert.ok(cmd.split('\r\n').find(line=>line.startsWith('powershell.exe')).length<8191);
 const payload=JSON.parse(Buffer.from(cmd.split('DOWNLOAD_TASK_DATA:\r\n')[1].trim(),'base64').toString('utf8'));assert.deepEqual(payload,task);
 assert.equal(aria.match(/^https:/gm).length,names.length);assert.equal(aria.match(/^  user-agent=pan.baidu.com$/gm).length,names.length);
 assert.ok(!aria.includes('baidupcs.com'));assert.ok(aria.includes('  dir=Downloads-test/nested'));
 for(const entry of task.entries){const url=new URL(entry.url);assert.equal(url.searchParams.get('task'),grant.token);assert.equal(url.origin,'https://example.com');}
});

test('task generation rejects partial/duplicate/unsafe manifest entries and supports one file or whole root',()=>{
 for(const files of [[],[file('../escape')],[file('a/./b')],[file('a\nb')],[file('a\\b')],[file('a'),file('a')],[file('a',-1)],[{path:'/different/file',size:1}]])assert.throws(()=>build(files));
 assert.throws(()=>prepareTask({...grant,token:'x'},[file('a')],'https://example.com'));
 assert.throws(()=>prepareTask({...grant,endpoint:'https://evil.example'},[file('a')],'https://example.com'));
 const single=prepareTask({...grant,path:'/share/nested/a',kind:'file'},[file('nested/a')],'https://example.com');assert.equal(single.entries[0].relative,'a');
 const root=prepareTask({...grant,path:'/'},[file('nested/a')],'https://example.com');assert.equal(root.entries[0].relative,'share\\nested\\a');
});

test('Windows progress runner uses real curl, resumes partial files, counts skipped files and protects existing data', {skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'download-task-')),task=build([file('nested/中文.txt'),file("$(oops)' %PATH% &.txt"),file('a.part'),file('empty.txt',0)]);
 const calls=[];let fail=true;
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').searchParams.get('path');calls.push({path,agent:req.headers['user-agent'],range:req.headers.range});
  if(fail&&path.endsWith('/a.part')){res.writeHead(403);res.end();return;}
  const data=path.endsWith('/empty.txt')?Buffer.alloc(0):Buffer.from('ABC'),start=Number(/^bytes=(\d+)-/.exec(req.headers.range||'')?.[1]||0);
  const headers={'Content-Length':data.length-start};if(start)headers['Content-Range']=`bytes ${start}-${data.length-1}/${data.length}`;
  res.writeHead(start?206:200,headers);res.end(data.subarray(start));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 for(const entry of task.entries){const url=new URL(entry.url);entry.url='http://127.0.0.1:'+server.address().port+url.pathname+url.search;}
 // Local fixture only: permit HTTP for the loopback server. Published tasks remain HTTPS only.
 const taskPath=join(dir,'任务 % &.cmd'),cmd=windowsTask(task).replaceAll("'=https'","'=http,https'");await writeFile(taskPath,cmd);
 const code=cmd.split('\r\n').find(line=>line.startsWith('powershell.exe')).slice('powershell.exe -NoProfile -Command "'.length,-1);
 const run=()=>new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-Command',code],{env:{...process.env,DOWNLOAD_TASK:taskPath},windowsHide:true});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Runner timeout'));},30000);
  child.stdout.setEncoding('utf8').on('data',data=>stdout+=data);child.stderr.setEncoding('utf8').on('data',data=>stderr+=data);
  child.on('error',reject);child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});child.stdin.end('\n');
 });
 try{
  const partialIndex=task.entries.findIndex(entry=>entry.relative==='a.part')+1;await mkdir(join(dir,task.folder,task.partFolder),{recursive:true});await writeFile(join(dir,task.folder,task.partFolder,partialIndex+'.part'),'A');
  const first=await run();assert.equal(first.status,1,first.stdout+first.stderr);assert.equal((await stat(join(dir,task.folder,task.partFolder,partialIndex+'.part'))).size,1);
  assert.match(first.stdout,/批量下载/);assert.match(first.stdout,/已下载：1 B \/ 3 B/);assert.match(first.stdout,/总进度：11%/);assert.match(first.stdout,/失败：1/);
  assert.ok(!first.stdout.includes('% Total'));assert.ok(!first.stdout.includes('Resuming transfer'));assert.ok(!first.stdout.includes('example.com'));
  const log=await readFile(join(dir,task.folder,task.partFolder,'errors.txt'),'utf8');assert.match(log,/代码 22/);
  fail=false;const next=await run();assert.equal(next.status,0,next.stdout+next.stderr);assert.match(next.stdout,/已完成：4\/4/);assert.match(next.stdout,/总进度：100%/);
  assert.ok(calls.some(call=>call.path.endsWith('/a.part')&&call.range==='bytes=1-'));assert.ok(calls.every(call=>call.agent==='pan.baidu.com'));
  for(const entry of task.entries)assert.equal(await readFile(join(dir,task.folder,entry.relative),'utf8'),entry.size?'ABC':'');
  const count=calls.length,again=await run();assert.equal(again.status,0,again.stdout+again.stderr);assert.equal(calls.length,count);
  await writeFile(join(dir,task.folder,task.entries[0].relative),'existing-file');
  const protectedRun=await run();assert.equal(protectedRun.status,1);assert.equal(await readFile(join(dir,task.folder,task.entries[0].relative),'utf8'),'existing-file');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
