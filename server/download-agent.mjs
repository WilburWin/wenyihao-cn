import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function normalizePath(value){
  if(typeof value!=='string'||!value.startsWith('/')||value.length>1024||/[\\\x00-\x1f\x7f%]/.test(value)||value.includes('//')||value.split('/').some(x=>x==='.'||x==='..'))throw Error('Invalid path');
  return value.length>1?value.replace(/\/$/,''):value;
}
export function downloadURL(value){
  const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!['baidupcs.com','baidu.com'].some(h=>u.hostname.endsWith('.'+h))||[...u.searchParams.keys()].some(k=>/^(access_token|refresh_token|bduss|sessdata)$/i.test(k)))throw Error('Invalid download URL');return u.href;
}
export class ImportFailure extends Error{constructor(code){super(code);this.code=code;}}
export function shareInput(link,code=''){
  let u;try{u=new URL(link);}catch{throw new ImportFailure('SHARE_INVALID');}
  if(!['https:','http:'].includes(u.protocol)||!['pan.baidu.com','yun.baidu.com'].includes(u.hostname)||u.port||u.username||u.password)throw new ImportFailure('SHARE_INVALID');
  const match=/^\/s\/1([a-zA-Z0-9_-]{4,100})\/?$/.exec(u.pathname);
  const short=match?.[1]||(u.pathname==='/share/init'?u.searchParams.get('surl'):null);
  if(!short||!/^[a-zA-Z0-9_-]{4,100}$/.test(short))throw new ImportFailure('SHARE_INVALID');
  code=String(code||u.searchParams.get('pwd')||'').trim();if(code&&!/^[a-zA-Z0-9]{4}$/.test(code))throw new ImportFailure('SHARE_CODE_INVALID');
  return {short,code,url:'https://pan.baidu.com/s/1'+short};
}
// All writes use a root-owned configuration, never a destination from the browser.
export function createShareImporter(auth,{statePath,fetcher=fetch,now=Date.now}={}){
  const root=normalizePath(auth.root);
  if(root==='/'||!root.endsWith('/链接导入'))throw Error('Invalid import root');
  const jobs=new Map(),active=new Map();let loaded=false,accessToken=auth.accessToken||'',expiresAt=auth.expiresAt||0,refreshPromise;
  async function save(){
    if(!statePath)return;await mkdir(statePath,{recursive:true,mode:0o700});
    const path=statePath+'/imports.json',temp=path+'.tmp';
    await writeFile(temp,JSON.stringify({accessToken,expiresAt,refreshToken:auth.refreshToken,jobs:[...jobs].slice(-200)}),{mode:0o600});await rename(temp,path);
  }
  async function load(){
    if(loaded)return;if(!statePath){loaded=true;return;}
    try{const data=JSON.parse(await readFile(statePath+'/imports.json','utf8'));if(!Array.isArray(data.jobs)||data.jobs.some(row=>!Array.isArray(row)||row.length!==2||!/^[a-f0-9]{12}$/.test(row[0])||!['pending','done','failed'].includes(row[1]?.status)||!Number.isFinite(row[1]?.when)))throw Error('Invalid import journal');if(data.accessToken){accessToken=data.accessToken;expiresAt=data.expiresAt;auth.refreshToken=data.refreshToken||auth.refreshToken;}for(const [k,v]of data.jobs)jobs.set(k,v);}catch(error){if(error.code!=='ENOENT')throw new ImportFailure('IMPORT_STATE_UNAVAILABLE');}
    loaded=true;
  }
  async function refresh(){
    if(!refreshPromise)refreshPromise=(async()=>{
      const response=await fetcher('https://openapi.baidu.com/oauth/2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refreshToken,client_id:auth.clientId,client_secret:auth.clientSecret}),signal:AbortSignal.timeout(15000),redirect:'error'});
      const data=await response.json();if(!response.ok||!data.access_token)throw new ImportFailure('IMPORT_AUTH_EXPIRED');
      accessToken=data.access_token;expiresAt=now()+Number(data.expires_in||3600)*1000-60000;auth.refreshToken=data.refresh_token||auth.refreshToken;await save();
    })().finally(()=>{refreshPromise=null;});return refreshPromise;
  }
  async function api(method,query={},body,allowRefresh=true){
    if(!accessToken||now()>=expiresAt)await refresh();
    const url=new URL('https://pan.baidu.com/rest/2.0/xpan/'+method);url.search=new URLSearchParams({...query,access_token:accessToken});
    const response=await fetcher(url,{method:body?'POST':'GET',headers:{'User-Agent':'pan.baidu.com','Referer':'https://pan.baidu.com/','Content-Type':'application/x-www-form-urlencoded'},body:body?new URLSearchParams(body):undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
    if([403,412,429].includes(response.status))throw new ImportFailure('SHARE_RATE_LIMITED');
    const data=await response.json();if([110,111].includes(data.errno)&&allowRefresh&&!body){await refresh();return api(method,query,body,false);}return data;
  }
  async function shareFiles(input){
    const cookies=new Map();let referer=input.url;
    async function web(path,body){
      let url=new URL(path,'https://pan.baidu.com');
      for(let hops=0;hops<5;hops++){
        if(url.origin!=='https://pan.baidu.com')throw new ImportFailure('SHARE_UNAVAILABLE');
        const response=await fetcher(url,{method:body?'POST':'GET',headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',Referer:referer,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'Content-Type':'application/x-www-form-urlencoded'},body:body?new URLSearchParams(body):undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
        for(const cookie of response.headers.getSetCookie()){const part=cookie.split(';')[0],at=part.indexOf('=');if(at>0)cookies.set(part.slice(0,at),part.slice(at+1));}
        if([403,412,429].includes(response.status))throw new ImportFailure('SHARE_RATE_LIMITED');
        if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('Location'),url);await response.body?.cancel();continue;}
        if(!response.ok)throw new ImportFailure('SHARE_UNAVAILABLE');return response;
      }throw new ImportFailure('SHARE_UNAVAILABLE');
    }
    const page=await web(input.url+(input.code?'?pwd='+encodeURIComponent(input.code):''));referer=page.url||input.url;await page.body?.cancel();
    let sekey='';
    if(input.code){const data=await(await web('/share/verify?surl='+input.short,{pwd:input.code,vcode:'',vcode_str:''})).json();
      if(data.errno===-9)throw new ImportFailure('SHARE_CODE_INVALID');if(data.errno!==0||!data.randsk)throw new ImportFailure('SHARE_VERIFICATION_REQUIRED');sekey=decodeURIComponent(data.randsk);cookies.set('BDCLND',data.randsk);}
    const query=new URLSearchParams({shorturl:input.short,root:'1',page:'1',num:'100',order:'name'});
    const data=await(await web('/share/list?'+query)).json();
    if(data.errno===-9)throw new ImportFailure('SHARE_CODE_REQUIRED');if(data.errno!==0||!Array.isArray(data.list)||!data.list.length)throw new ImportFailure('SHARE_UNAVAILABLE');
    if(Number(data.cur_total)>data.list.length||data.list.length>100)throw new ImportFailure('SHARE_TOO_MANY_FILES');
    if(!data.share_id||!data.uk||data.list.some(f=>!Number.isSafeInteger(Number(f.fs_id))||typeof f.server_filename!=='string'||/[\\/\x00-\x1f%]/.test(f.server_filename)||['.','..'].includes(f.server_filename)))throw new ImportFailure('SHARE_UNAVAILABLE');
    return {files:data.list,shareId:String(data.share_id),uk:String(data.uk),sekey};
  }
  async function directory(path){
    const data=await api('file',{method:'list',dir:path,start:'0',limit:'100',order:'name'});
    if(data.errno===0&&Array.isArray(data.list))return data.list;
    if([110,111,-6].includes(data.errno)||data.error_code)throw new ImportFailure('IMPORT_AUTH_EXPIRED');
    // Baidu uses -9 / 31066 for a directory that does not exist yet.
    if([-9,31066].includes(data.errno))return [];
    throw new ImportFailure('IMPORT_FAILED');
  }
  function matches(expected,actual){return expected.every(f=>actual.some(x=>x.server_filename===f.server_filename&&!!Number(x.isdir)===!!Number(f.isdir)&&(Number(f.isdir)||Number(x.size)===Number(f.size))));}
  async function perform(input,key){
    await load();const share=await shareFiles(input),target=root+'/share-'+key,relative='/链接导入/share-'+key;
    const existing=await directory(target);if(matches(share.files,existing))return {path:relative,reused:true};
    const job=jobs.get(key);if(job?.status==='pending'&&now()-job.when<900000)throw new ImportFailure('IMPORT_PENDING');
    for(const path of [root,target]){
      const result=await api('file',{method:'create'},{path,size:'0',isdir:'1',rtype:'0'});
      if(![0,-8].includes(result.errno))throw new ImportFailure([110,111,-6].includes(result.errno)?'IMPORT_AUTH_EXPIRED':'IMPORT_DIRECTORY_FAILED');
    }
    jobs.set(key,{status:'pending',when:now()});await save();
    let result;
    try{result=await api('share',{method:'transfer',shareid:share.shareId,from:share.uk,ondup:'fail'},{sekey:share.sekey,fsidlist:JSON.stringify(share.files.map(f=>Number(f.fs_id))),path:target,async:'0'});}
    catch{throw new ImportFailure('IMPORT_PENDING');}
    if(result.errno!==0){jobs.set(key,{status:'failed',when:now()});await save();
      if([110,111,-6].includes(result.errno)||result.error_code)throw new ImportFailure('IMPORT_AUTH_EXPIRED');
      if([31034,42000,111,110].includes(result.errno))throw new ImportFailure('SHARE_RATE_LIMITED');
      if([120,130,-33,10].includes(result.errno))throw new ImportFailure('IMPORT_QUOTA_EXCEEDED');
      throw new ImportFailure('IMPORT_FAILED');
    }
    // An accepted transfer may still be running in Baidu. A later submission
    // checks the destination first and never automatically repeats this write.
    if(!matches(share.files,await directory(target)))throw new ImportFailure('IMPORT_PENDING');
    jobs.set(key,{status:'done',when:now()});await save();return {path:relative,reused:false};
  }
  return async message=>{
    const input=shareInput(message.link,message.code),key=createHash('sha256').update(input.short).digest('hex').slice(0,12);
    if(active.has(key))return active.get(key);
    // Serialize writes so persistent state and cloud transfers cannot race.
    if(active.size)throw new ImportFailure('IMPORT_BUSY');
    const pending=perform(input,key).finally(()=>active.delete(key));active.set(key,pending);return pending;
  };
}
export function createLibrary(config){
  const mount=normalizePath(config.mountPath);
  if(mount==='/')throw Error('A dedicated shared mount is required');
  let token='',loginPromise,importer,mediaToken='',mediaLoginPromise;
  async function login(){
    if(!loginPromise)loginPromise=(async()=>{
      const response=await fetch('http://127.0.0.1:5244/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:config.username,password:config.password}),signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(data.code!==200||!data.data?.token)throw Error('Login failed');token=data.data.token;
    })().finally(()=>{loginPromise=null;});
    return loginPromise;
  }
  async function api(endpoint,body,retry=true){
    if(!token)await login();
    const response=await fetch('http://127.0.0.1:5244/api/fs/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(result.code===401&&retry){token='';await login();return api(endpoint,body,false);}
    if(result.code!==200)throw Error('Storage request failed');return result.data;
  }
  async function mediaLogin(){
    if(!config.mediaUsername||!config.mediaPassword)throw Error('Media account is not configured');
    if(!mediaLoginPromise)mediaLoginPromise=(async()=>{
      const response=await fetch('http://127.0.0.1:5244/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:config.mediaUsername,password:config.mediaPassword}),signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(data.code!==200||!data.data?.token)throw Error('Media login failed');mediaToken=data.data.token;
    })().finally(()=>{mediaLoginPromise=null;});
    return mediaLoginPromise;
  }
  async function mediaApi(endpoint,body,retry=true){
    if(!mediaToken)await mediaLogin();
    const response=await fetch('http://127.0.0.1:5244/api/fs/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:mediaToken},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    const result=await response.json();if(result.code===401&&retry){mediaToken='';await mediaLogin();return mediaApi(endpoint,body,false);}
    if(result.code!==200)throw Error('Media storage request failed');return result.data;
  }
  const mediaMount=normalizePath(config.mediaMountPath||'/115');
  if(mediaMount!=='/115')throw Error('Media mount is fixed to /115');
  const mediaKind=name=>{
    const ext=(/\.([a-z0-9]{1,10})$/i.exec(name)||[])[1]?.toLowerCase()||'';
    if(['mp4','m4v','mkv','mov','webm','avi','ts','m2ts','wmv','flv'].includes(ext))return 'video';
    if(['mp3','m4a','aac','flac','wav','ogg','opus','wma'].includes(ext))return 'audio';
    if(['jpg','jpeg','png','webp','gif','avif'].includes(ext))return 'image';
    return null;
  };
  return async message=>{
    if(message.action==='import'){
      if(!config.importAuthFile)throw new ImportFailure('IMPORT_NOT_CONFIGURED');
      if(!importer){let auth;try{auth=JSON.parse(await readFile(config.importAuthFile,'utf8'));}catch{throw new ImportFailure('IMPORT_NOT_CONFIGURED');}importer=createShareImporter(auth,{statePath:config.importStatePath||'/var/lib/website-downloads'});}
      const result=await importer(message);
      // Imports bypass AList; refresh this directory before the browser opens it.
      try{await api('list',{path:mount+result.path,password:'',page:1,per_page:100,refresh:true});}catch{}
      return result;
    }
    const path=normalizePath(message.path);
    if(message.action==='list'){
      const page=message.page||1;if(!Number.isInteger(page)||page<1||page>1000)throw Error('Invalid page');
      const data=await api('list',{path:mount+(path==='/'?'':path),password:'',page,per_page:100,refresh:false});
      return {path,page,total:Number(data.total)||0,files:(data.content||[]).slice(0,100).map(file=>{
        if(typeof file.name!=='string'||!file.name||/[\\/\x00-\x1f%]/.test(file.name)||['.','..'].includes(file.name))return null;
        return {name:file.name,path:normalizePath((path==='/'?'':path)+'/'+file.name),isDir:!!file.is_dir,size:Number(file.size)||0,modified:String(file.modified||'').slice(0,50)};
      }).filter(Boolean)};
    }
    if(message.action==='link'){
      const data=await api('get',{path:mount+(path==='/'?'':path),password:''});if(data.is_dir)throw Error('Not a file');
      if(data.provider&&data.provider!=='BaiduNetdisk')throw Error('Unsupported storage');
      return {name:String(data.name),size:Number(data.size)||0,url:downloadURL(data.raw_url),userAgent:'pan.baidu.com'};
    }
    if(message.action==='media-list'){
      const path=normalizePath(message.path),page=message.page||1;
      if(!Number.isInteger(page)||page<1||page>1000)throw Error('Invalid media page');
      const data=await mediaApi('list',{path:mediaMount+(path==='/'?'':path),password:'',page,per_page:100,refresh:false});
      const files=(data.content||[]).slice(0,100).flatMap(file=>{
        if(typeof file.name!=='string'||!file.name||/[\\/\x00-\x1f%]/.test(file.name)||['.','..'].includes(file.name))return [];
        const kind=file.is_dir?'folder':mediaKind(file.name);if(!kind)return [];
        return [{name:file.name,path:normalizePath((path==='/'?'':path)+'/'+file.name),kind,size:Number(file.size)||0,modified:String(file.modified||'').slice(0,50)}];
      });
      return {path,page,total:Number(data.total)||0,files};
    }
    throw Error('Unsupported action');
  };
}
async function main(){
  const config=JSON.parse(await readFile(process.env.DOWNLOAD_AGENT_CONFIG||'/etc/website-downloads/config.json','utf8'));
  const handle=createLibrary(config);let failures=0;
  for(;;){
    await new Promise(resolve=>{
      const url=new URL('/api/tools/bridge',config.origin);url.protocol='wss:';
      const ws=new WebSocket(url,['website-download-agent',config.bridgeKey]);let timer,alive=Date.now(),active=0,finished=false;
      const connectionTimeout=setTimeout(()=>{try{ws.close();}catch{}finish();},30000);
      const finish=()=>{if(finished)return;finished=true;clearTimeout(connectionTimeout);clearInterval(timer);console.warn('Download bridge disconnected; reconnecting');resolve();};
      ws.addEventListener('open',()=>{clearTimeout(connectionTimeout);failures=0;console.log('Download bridge connected');timer=setInterval(()=>{if(Date.now()-alive>90000){ws.close();return;}if(ws.readyState===1)ws.send('ping');},25000);});
      ws.addEventListener('message',async event=>{
        alive=Date.now();if(event.data==='pong')return;
        let message;try{message=JSON.parse(event.data);if(typeof message.id!=='string'||message.id.length>64)return;}catch{return;}
        if(active>=3){ws.send(JSON.stringify({id:message.id,ok:false}));return;}
        active++;try{const data=await handle(message);if(ws.readyState===1)ws.send(JSON.stringify({id:message.id,ok:true,data}));}
        catch(error){if(ws.readyState===1)ws.send(JSON.stringify({id:message.id,ok:false,error:{code:error instanceof ImportFailure?error.code:'UPSTREAM_FAILED'}}));console.warn('Metadata request failed');}
        finally{active--;}
      });
      ws.addEventListener('close',finish,{once:true});ws.addEventListener('error',()=>{try{ws.close();}catch{}finish();},{once:true});
    });
    failures++;await new Promise(r=>setTimeout(r,Math.min(60000,2000*2**Math.min(failures,5))+Math.random()*2000));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main().catch(()=>{console.error('Download agent startup failed');process.exitCode=1;});
