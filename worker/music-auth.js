import qrcode from 'qrcode-generator';
import {json} from './community.js';

const SESSION_SECONDS=8*3600,QR_SECONDS=180;
const PASSPORT='https://passport.bilibili.com';
const SESSION_KEYS=new Set(['SESSDATA','bili_jct','DedeUserID','DedeUserID__ckMd5','sid','buvid3','buvid4']);
const encoder=new TextEncoder(),decoder=new TextDecoder();
const keyCache=new Map();
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function unb64(text){return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),char=>char.charCodeAt(0));}
function cookieName(request,pending=false){return (new URL(request.url).protocol==='https:'?'__Host-':'')+'wyh_bili'+(pending?'_qr':'');}
function cookieValue(request,pending=false){const name=cookieName(request,pending)+'=';return request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name))?.slice(name.length)||'';}
function setCookie(request,value,seconds,pending=false){return `${cookieName(request,pending)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
function sessionKeyConfig(env){
  // Clipboard pipelines and dashboard inputs can add surrounding whitespace.
  const raw=typeof env.MUSIC_SESSION_KEY==='string'?env.MUSIC_SESSION_KEY.trim():'';
  if(!raw)return {issue:'missing',message:'线上尚未读到 MUSIC_SESSION_KEY，请在当前 Worker 的变量和机密中添加并部署。'};
  if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return {issue:'invalid_format',message:'线上已读到 MUSIC_SESSION_KEY，但格式不正确。请重新生成并替换为 43 位密钥，不要包含引号或命令文本，然后部署。'};
  return {raw,issue:null,message:null};
}
async function encryptionKey(env){
  const {raw,issue}=sessionKeyConfig(env);
  if(issue)return null;
  if(!keyCache.has(raw)){
    keyCache.clear();
    keyCache.set(raw,crypto.subtle.importKey('raw',unb64(raw),{name:'AES-GCM'},false,['encrypt','decrypt']));
  }
  return keyCache.get(raw);
}
export async function sealMusicSession(payload,request,env,purpose='session'){
  const key=await encryptionKey(env);
  if(!key)throw Error('Music session encryption is not configured');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const aad=encoder.encode(`${new URL(request.url).origin}:music:${purpose}:v1`);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,encoder.encode(JSON.stringify(payload))));
  return b64(iv)+'.'+b64(cipher);
}
export async function openMusicSession(token,request,env,purpose='session',now=Date.now()){
  try{
    const key=await encryptionKey(env);
    if(!key||!token||token.length>3800)return null;
    const [iv,cipher,...extra]=token.split('.');if(!iv||!cipher||extra.length)return null;
    const aad=encoder.encode(`${new URL(request.url).origin}:music:${purpose}:v1`);
    const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:aad},key,unb64(cipher));
    const payload=JSON.parse(decoder.decode(bytes));
    return payload.expiresAt>now?payload:null;
  }catch{return null;}
}
export async function readMusicSession(request,env){
  const session=await openMusicSession(cookieValue(request),request,env);
  if(!session||!/^[a-f\d-]{36}$/.test(session.scope)||typeof session.cookie!=='string'||session.cookie.length>2000||/[\r\n]/.test(session.cookie))return null;
  return session;
}
export function clearMusicSessionCookie(request){return setCookie(request,'',0);}

// Store only the encrypted session in this browser. Never put login cookies in
// shared caches, durable storage, localStorage, a response body, or log output.
export function createMusicAuthHandler({fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}){
  const attempts=new Map();
  async function upstream(path){
    const response=await fetcher(PASSPORT+path,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/'},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('passport unavailable');
    const data=await response.json();if(data.code!==0||!data.data)throw Error('passport rejected');
    return {response,data:data.data};
  }
  function reply(value,status=200,cookies=[],extra={}){
    const response=json(value,status,{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer',...extra});
    for(const cookie of cookies)response.headers.append('Set-Cookie',cookie);
    return response;
  }
  return async function musicAuth(request,env){
    const url=new URL(request.url),action=url.pathname.split('/').at(-1);
    if(!['status','start','poll','logout'].includes(action))return reply({message:'接口不存在。'},404);
    const expected=action==='status'?'GET':'POST';
    if(request.method!==expected)return reply({message:'不支持的操作。'},405,[],{Allow:expected});
    if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(action!=='status'&&request.headers.get('Origin')!==url.origin))return reply({message:'请从本站发起登录操作。'},403);
    if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))return reply({message:'登录需要 HTTPS。'},400);
    const config=sessionKeyConfig(env),configured=Boolean(await encryptionKey(env));
    if(action==='logout')return reply({loggedIn:false},200,[setCookie(request,'',0),setCookie(request,'',0,true)]);
    if(action==='status'){
      const session=await readMusicSession(request,env);
      return reply({configured,configurationIssue:config.issue,configurationMessage:config.message,loggedIn:Boolean(session),user:session?.user||null,expiresAt:session?.expiresAt||null});
    }
    if(!configured)return reply({message:config.message,configurationIssue:config.issue},503);
    try{
      if(action==='start'){
        const address=request.headers.get('CF-Connecting-IP')||'local';
        const hash=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(address))));
        const key='start:'+hash,last=attempts.get(key)||0;
        if(now()-last<30000)return reply({message:'二维码刚刚生成，请稍后再试。'},429,[],{'Retry-After':'30'});
        attempts.set(key,now());
        for(const [k,t] of attempts)if(now()-t>5*60000)attempts.delete(k);
        while(attempts.size>2000)attempts.delete(attempts.keys().next().value);
        const {data}=await upstream('/x/passport-login/web/qrcode/generate');
        const target=new URL(data.url);
        if(target.protocol!=='https:'||!['passport.bilibili.com','account.bilibili.com'].includes(target.hostname)||typeof data.qrcode_key!=='string'||data.qrcode_key.length>256)throw Error('invalid QR');
        const expiresAt=now()+QR_SECONDS*1000;
        const token=await sealMusicSession({key:data.qrcode_key,expiresAt},request,env,'qr');
        const qr=qrcode(0,'M');qr.addData(data.url);qr.make();
        return reply({qrImage:qr.createDataURL(5,16),expiresAt},200,[setCookie(request,token,QR_SECONDS,true)]);
      }
      const pending=await openMusicSession(cookieValue(request,true),request,env,'qr',now());
      if(!pending)return reply({state:'expired',message:'二维码已过期，请重新生成。'},200,[setCookie(request,'',0,true)]);
      const key='poll:'+pending.key,last=attempts.get(key)||0;
      if(now()-last<2500)return reply({state:'waiting'},200);
      attempts.set(key,now());
      const {response,data}=await upstream('/x/passport-login/web/qrcode/poll?qrcode_key='+encodeURIComponent(pending.key));
      if(data.code===86101)return reply({state:'waiting'});
      if(data.code===86090)return reply({state:'scanned'});
      if(data.code===86038)return reply({state:'expired',message:'二维码已失效，请重新生成。'},200,[setCookie(request,'',0,true)]);
      if(data.code!==0)throw Error('unknown QR state');
      const values=new Map();
      const setCookies=response.headers.getSetCookie?.()||[];
      for(const header of setCookies){
        const pair=header.split(';')[0],at=pair.indexOf('=');
        if(at>0&&SESSION_KEYS.has(pair.slice(0,at)))values.set(pair.slice(0,at),pair.slice(at+1));
      }
      // Some passport responses deliver cookies through the confirmed redirect.
      // Parse only Bilibili URLs; never follow a redirect containing credentials.
      if(data.url){
        const redirect=new URL(data.url);
        if(redirect.protocol==='https:'&&(redirect.hostname==='bilibili.com'||redirect.hostname.endsWith('.bilibili.com'))){
          for(const name of SESSION_KEYS){const value=redirect.searchParams.get(name);if(value&&!values.has(name))values.set(name,encodeURIComponent(value));}
        }
      }
      if(!values.get('SESSDATA'))throw Error('missing session');
      const cookie=[...values].map(([key,value])=>`${key}=${value}`).join('; ');
      if(cookie.length>2000||/[\r\n]/.test(cookie))throw Error('invalid session');
      const profile=await fetcher('https://api.bilibili.com/x/web-interface/nav',{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/',Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(!profile.ok)throw Error('profile unavailable');
      const result=await profile.json();
      if(result.code!==0||!result.data?.isLogin)throw Error('login not verified');
      const user={name:String(result.data.uname||'B站用户').slice(0,64),vip:Boolean(result.data.vipStatus||result.data.vip?.status)};
      const expiresAt=now()+SESSION_SECONDS*1000;
      const token=await sealMusicSession({scope:crypto.randomUUID(),cookie,user,expiresAt},request,env);
      if(token.length>3800)throw Error('session too large');
      attempts.delete(key);
      return reply({state:'success',user,expiresAt},200,[setCookie(request,token,SESSION_SECONDS),setCookie(request,'',0,true)]);
    }catch{return reply({message:'B站登录暂不可用，请稍后重试。'},502);}
  };
}
export const musicAuthRequest=createMusicAuthHandler();
