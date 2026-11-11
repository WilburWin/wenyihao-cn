// Metadata-only bridge. This service must never fetch or relay file contents.
import {ToolPayments} from './tool-payments.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{...headers,...extra}});
const IMPORT_ERRORS={
  SHARE_INVALID:'请使用百度网盘 /s/ 分享链接或 share/init 链接。',
  SHARE_CODE_INVALID:'分享提取码不正确，请检查后重试。',SHARE_CODE_REQUIRED:'该分享需要四位提取码。',
  SHARE_UNAVAILABLE:'无法读取分享，链接可能已失效或不可访问。',SHARE_VERIFICATION_REQUIRED:'百度要求额外验证，请在百度网盘检查分享后再试。',
  SHARE_RATE_LIMITED:'百度暂时限制了请求，请稍后再试。',SHARE_TOO_MANY_FILES:'分享根目录超过 100 项，请使用范围更小的分享。',
  IMPORT_NOT_CONFIGURED:'站长尚未配置分享转存授权。',IMPORT_AUTH_EXPIRED:'转存授权已失效或缺少权限，请联系站长更新授权。',
  IMPORT_DIRECTORY_FAILED:'无法创建导入目录，请联系站长检查授权和网盘空间。',IMPORT_QUOTA_EXCEEDED:'百度网盘空间或转存额度不足。',
  IMPORT_BUSY:'另一个转存任务正在处理，请稍后再试。',IMPORT_PENDING:'上一次转存结果尚待确认，请稍后重试；不会重复提交转存。',
  IMPORT_STATE_UNAVAILABLE:'转存记录暂时不可用，请联系站长检查服务。',IMPORT_FAILED:'百度未完成转存，请检查分享后重试。'
};
export async function equalSecret(a,b){
  if(!a||!b)return false;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export function safePath(value){
  if(typeof value!=='string'||value.length>1024||!value.startsWith('/')||/[\\\x00-\x1f\x7f%]/.test(value)||value.split('/').some(x=>x==='.'||x==='..')||value.includes('//'))throw Error('文件路径无效。');
  return value.length>1?value.replace(/\/$/,''):value;
}
export function safeDownload(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['baidupcs.com','baidu.com'].some(h=>u.hostname.endsWith('.'+h))||[...u.searchParams.keys()].some(k=>/^(access_token|refresh_token|bduss|sessdata)$/i.test(k)))throw Error('下载地址未通过校验。');
  return u.href;
}
export async function downloadRequest(request,env){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/_backend/'))return new Response('Not found',{status:404});
  if(url.pathname==='/api/tools/agent-release'){
    if(request.method!=='GET'||!await equalSecret(request.headers.get('Authorization'),env.DOWNLOAD_BRIDGE_KEY?`Bearer ${env.DOWNLOAD_BRIDGE_KEY}`:''))return reply({message:'无权访问。'},403);
    const manifest=await env.ASSETS.fetch(new Request(new URL('/_backend/manifest.json',url)));
    const code=await env.ASSETS.fetch(new Request(new URL('/_backend/download-agent.mjs',url)));
    if(!manifest.ok||!code.ok)return reply({message:'服务版本未就绪。'},503);
    return reply({...await manifest.json(),source:await code.text()});
  }
  return env.DOWNLOADS.get(env.DOWNLOADS.idFromName('share-library'),{locationHint:'apac'}).fetch(request);
}
export class DownloadBridge{
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=new Map();
    if(typeof WebSocketRequestResponsePair!=='undefined')ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  payments(){return new ToolPayments({storage:this.ctx.storage,env:this.env,callAgent:message=>this.agent(message),safePath,safeDownload});}
  agentOnline(){return this.ctx.getWebSockets().some(w=>w.readyState===1);}
  agent(message){
    const ws=this.ctx.getWebSockets().find(w=>w.readyState===1);
    if(!ws)return Promise.reject(Error('Agent offline'));
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Agent timeout'));},message.action==='import'?90000:message.action?.startsWith('media-')?45000:20000);
      this.pending.set(id,{resolve,reject,timer});
      try{ws.send(JSON.stringify({id,...message}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/api/tools/bridge'){
      const protocols=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(x=>x.trim());
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket'||protocols[0]!=='website-download-agent'||!await equalSecret(protocols[1],this.env.DOWNLOAD_BRIDGE_KEY))return reply({message:'无权访问。'},403);
      for(const old of this.ctx.getWebSockets())try{old.close(1012,'Agent replaced');}catch{}
      const pair=new WebSocketPair();this.ctx.acceptWebSocket(pair[1]);
      return new Response(null,{status:101,webSocket:pair[0],headers:{'Sec-WebSocket-Protocol':'website-download-agent'}});
    }
    if(path.startsWith('/api/tools/payments/')){
      // Provider callbacks have their own RSA verification and do not depend on
      // a browser Origin or visitor cookie. Other writes remain same-origin.
      if(!path.endsWith('/notify')&&!path.endsWith('/config')){
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(request.headers.get('CF-Connecting-IP')||'local'));
        if(!await this.allow('payment-rate:'+Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join(''),360))return reply({message:'订单请求较多，请稍后重试。'},429);
      }
      return this.payments().handle(request);
    }
    if(path.startsWith('/api/tools/media/'))return this.media(request,path);
    if(!['/api/tools/downloads/status','/api/tools/downloads/list','/api/tools/downloads/link','/api/tools/downloads/import'].includes(path))return reply({message:'Not found'},404);
    if(request.method!=='POST')return reply({message:'请使用 POST。'},405);
    if(request.headers.get('Origin')!==new URL(request.url).origin)return reply({message:'来源验证失败。'},403);
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
    const bucket='rate:'+Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
    if(!await this.allow(bucket,180))return reply({message:'请求较多，请稍后再试。'},429);
    const friend=await equalSecret(request.headers.get('X-Download-Code'),this.env.DOWNLOAD_ACCESS_CODE),payments=this.payments();
    if(!friend){
      if(!payments.cfg.enabled)return reply({message:'访问码不正确。'},401);
      try{await payments.buyer(request);}catch{return reply({message:'请先输入访问码或开启按次下载。'},401);}
    }
    if(path.endsWith('/status'))return reply({online:this.agentOnline()});
    if(!await this.allow('global',2000))return reply({message:'今日服务额度已用完。'},429);
    let body;
    try{
      const reader=request.body?.getReader();let text='',bytes=0;
      if(reader){const decoder=new TextDecoder();for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return reply({message:'内容过长。'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
      body=JSON.parse(text);
      if(path.endsWith('/import')){
        const u=new URL(body.link);
        if(!['https:','http:'].includes(u.protocol)||!['pan.baidu.com','yun.baidu.com'].includes(u.hostname)||u.port||u.username||u.password||typeof body.code!=='string'||(body.code&&!/^[a-zA-Z0-9]{4}$/.test(body.code)))throw Error('Invalid share');
      }else body.path=safePath(body.path);
      if(body.page!==undefined&&(!Number.isInteger(body.page)||body.page<1||body.page>1000))throw Error('页码无效。');
    }catch{return reply({message:'文件路径或页码无效。'},400);}
    if(!this.agentOnline())return reply({message:'下载服务暂未连接，请稍后再试。'},503);
    const action=path.endsWith('/import')?'import':path.endsWith('/list')?'list':'link';
    if(!friend){
      if(action==='link')return reply({message:'此文件需要先购买下载授权。'},402);
      if(action==='list'&&!await payments.allowed(request,body.path))return reply({message:'仅可查看当前浏览器导入的文件。'},403);
    }
    try{
      const data=await this.agent(action==='import'?{action,link:body.link,code:body.code}:{action,path:body.path,page:body.page||1});
      if(action==='link')data.url=safeDownload(data.url);
      if(action==='import'&&(!safePath(data.path).startsWith('/链接导入/share-')||!/^\/链接导入\/share-[a-f0-9]{12}$/.test(data.path)))throw Error('Invalid import result');
      if(action==='import'&&!friend)await payments.rememberImport(request,data.path);
      return reply(data);
    }catch(error){return reply({message:IMPORT_ERRORS[error.code]||'网盘服务暂时无法完成请求，请稍后重试。',...(IMPORT_ERRORS[error.code]?{code:error.code}:{})},error.code==='IMPORT_PENDING'||error.code==='IMPORT_BUSY'?409:502);}
  }
  async media(request,path){
    const url=new URL(request.url),origin=url.origin;
    if(request.method!=='GET'&&request.method!=='POST')return reply({message:'请使用 GET 或 POST。'},405);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==origin)return reply({message:'来源验证失败。'},403);
    if(request.method==='POST'&&request.headers.get('Origin')!==origin)return reply({message:'来源验证失败。'},403);
    const cookie=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('media_session='))?.slice('media_session='.length)||'';
    const sessionKey=async()=>cookie?`media-session:${await this.hash(cookie)}`:null;
    if(path==='/api/tools/media/status'){
      const key=await sessionKey(),session=key?await this.ctx.storage.get(key):null;
      if(session&&session.until>Date.now())return reply({authenticated:true});
      return reply({authenticated:false});
    }
    if(path==='/api/tools/media/login'){
      if(request.method!=='POST')return reply({message:'请使用 POST。'},405);
      if(Number(request.headers.get('Content-Length'))>512)return reply({message:'请求无效。'},413);
      const ip=request.headers.get('CF-Connecting-IP')||'local',bucket='media-login:'+await this.hash(ip);
      if(!await this.allow(bucket,8))return reply({message:'尝试次数过多，请稍后重试。'},429);
      if(!this.env.MEDIA_ACCESS_CODE)return reply({message:'影音库登录尚未配置。'},503);
      let body;try{const text=await request.text();if(text.length>512)return reply({message:'请求无效。'},413);body=JSON.parse(text);}catch{return reply({message:'请求无效。'},400);}
      if(typeof body?.password!=='string'||body.password.length>128||!await equalSecret(body.password,this.env.MEDIA_ACCESS_CODE))return reply({message:'密码不正确。'},401);
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''),until=Date.now()+12*60*60*1000;
      await this.ctx.storage.put(`media-session:${await this.hash(token)}`,{until});
      return reply({authenticated:true},200,{'Set-Cookie':`media_session=${token}; Path=/api/tools/media; Max-Age=43200; Secure; HttpOnly; SameSite=Strict`});
    }
    if(path==='/api/tools/media/logout'){
      if(request.method!=='POST')return reply({message:'请使用 POST。'},405);
      const key=await sessionKey();if(key)await this.ctx.storage.delete(key);
      return reply({authenticated:false},200,{'Set-Cookie':'media_session=; Path=/api/tools/media; Max-Age=0; Secure; HttpOnly; SameSite=Strict'});
    }
    if(path!=='/api/tools/media/list')return reply({message:'Not found'},404);
    if(request.method!=='POST')return reply({message:'请使用 POST。'},405);
    const key=await sessionKey(),session=key?await this.ctx.storage.get(key):null;
    if(!session||session.until<=Date.now())return reply({message:'请先登录影音库。'},401,{'Set-Cookie':'media_session=; Path=/api/tools/media; Max-Age=0; Secure; HttpOnly; SameSite=Strict'});
    if(!this.agentOnline())return reply({message:'服务器暂未连接，请稍后重试。'},503);
    if(!await this.allow('media-requests',240))return reply({message:'影音库请求较多，请稍后重试。'},429);
    let body;try{body=await request.json();body.path=safePath(body.path);if(body.page!==undefined&&(!Number.isInteger(body.page)||body.page<1||body.page>1000))throw Error();}catch{return reply({message:'目录或页码无效。'},400);}
    try{return reply(await this.agent({action:'media-list',path:body.path,page:body.page||1}));}
    catch{return reply({message:'无法读取115影音文件，请稍后重试。'},502);}
  }
  async hash(value){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));return Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');}
  async allow(key,limit){
    const now=Date.now(),window=key==='global'?86400000:3600000;
    return this.ctx.storage.transaction(async txn=>{
      let row=await txn.get(key);if(!row||now>=row.until)row={count:0,until:now+window};
      if(row.count>=limit)return false;
      row.count++;await txn.put(key,row);const alarm=await txn.getAlarm?.();if(!alarm||alarm>now+3600000)await txn.setAlarm(now+3600000);return true;
    });
  }
  async alarm(){
    // Keep payment recovery running when the buyer closes the browser.
    try{await this.payments().reconcile();}finally{
      for(const [key,row]of await this.ctx.storage.list())if(row.until<Date.now())await this.ctx.storage.delete(key);
      if((await this.ctx.storage.list({limit:1})).size){const alarm=await this.ctx.storage.getAlarm?.();if(!alarm||alarm>Date.now()+3600000)await this.ctx.storage.setAlarm(Date.now()+3600000);}
    }
  }
  webSocketMessage(ws,message){
    if(typeof message!=='string'||message.length>262144)return;
    try{const data=JSON.parse(message),pending=this.pending.get(data.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(data.id);data.ok?pending.resolve(data.data):pending.reject(Object.assign(Error('Upstream failed'),{code:IMPORT_ERRORS[data.error?.code]?data.error.code:undefined}));
    }catch{}
  }
  webSocketClose(ws){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Agent disconnected'));}this.pending.clear();try{ws.close();}catch{}}
  webSocketError(ws){this.webSocketClose(ws);}
}
