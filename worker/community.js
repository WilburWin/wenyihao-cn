export function json(data,status=200,headers={}) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
}
export function validateNote(body) {
  if(!body||typeof body!=='object'||typeof body.message!=='string')throw Error('请写下留言内容。');
  if(body.website)throw Error('无法提交，请稍后重试。');
  if(body.name!==undefined&&typeof body.name!=='string')throw Error('昵称格式不正确。');
  const name=(body.name||'').trim()||'匿名旅人',message=body.message.trim();
  if(name.length>24||!message||message.length>200)throw Error('昵称限 24 字，留言需为 1–200 字。');
  return {name,message};
}
export class Guestbook {
  constructor(ctx){this.ctx=ctx;}
  async fetch(request){
    const url=new URL(request.url),storage=this.ctx.storage;
    if(request.method==='DELETE'){
      const id=url.searchParams.get('id');
      if(!/^note:\d{13}:[a-f0-9-]{36}$/.test(id||''))return json({message:'便签编号无效。'},400);
      await storage.delete(id);return json({ok:true});
    }
    if(request.method==='GET'){
      const cursor=url.searchParams.get('cursor');
      if(cursor&&!/^note:\d{13}:[a-f0-9-]{36}$/.test(cursor))return json({message:'分页参数无效。'},400);
      const rows=await storage.list({prefix:'note:',reverse:true,limit:25,...(cursor?{end:cursor}:{})});
      const entries=[...rows];
      return json({notes:entries.map(([id,n])=>({id,...n})),cursor:entries.length===25?entries.at(-1)[0]:null});
    }
    if(request.method!=='POST')return json({message:'不支持的操作。'},405,{Allow:'GET, POST'});
    let note;
    try{
      if(!request.headers.get('Content-Type')?.includes('application/json'))return json({message:'请使用 JSON 提交。'},415);
      const reader=request.body?.getReader();
      let size=0;const chunks=[];
      if(reader){while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return json({message:'提交内容过长。'},413);}chunks.push(value);}}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const raw=new TextDecoder().decode(bytes);
      note=validateNote(JSON.parse(raw));
    }catch(e){return json({message:e instanceof SyntaxError?'提交格式不正确。':e.message},400);}
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${new Date().toISOString().slice(0,10)}:${ip}`));
    const key='rate:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const now=Date.now();
    const result=await storage.transaction(async tx=>{
      const last=await tx.get(key)||0;
      if(now-last<60000)return {limited:true};
      const count=await tx.get('daily');const day=new Date(now).toISOString().slice(0,10);
      if(count?.day===day&&count.total>=500)return {full:true};
      const id=`note:${now}:${crypto.randomUUID()}`;
      const entry={...note,createdAt:new Date(now).toISOString()};
      await tx.put({[key]:now,[id]:entry,daily:{day,total:count?.day===day?count.total+1:1}});
      return {id,...entry};
    });
    if(result.limited)return json({message:'刚刚收到你的便签，请等一分钟再写下一张。'},429,{'Retry-After':'60'});
    if(result.full)return json({message:'今天的便签已收满，请明天再来。'},429);
    // Remove expired rate keys periodically without storing raw IP addresses.
    this.ctx.waitUntil(storage.list({prefix:'rate:'}).then(async rows=>{const expired=[...rows].filter(([,v])=>now-v>86400000).map(([k])=>k);if(expired.length)await storage.delete(expired);}).catch(()=>{}));
    return json({note:result},201);
  }
}
export async function repositories(request,ctx){
  if(request.method!=='GET')return json({message:'不支持的操作。'},405,{Allow:'GET'});
  const cache=caches.default,key=new Request(new URL('/api/github',request.url));
  const hit=await cache.match(key);if(hit)return hit;
  try{
    const repos=[];
    for(let page=1;;page++){
      const response=await fetch(`https://api.github.com/users/WilburWin/repos?type=owner&sort=updated&per_page=100&page=${page}`,{headers:{'User-Agent':'wenyihao-cn','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('GitHub 暂时无法读取，请稍后重试。');
      const data=await response.json();
      if(!Array.isArray(data))throw Error('仓库数据暂不可用。');
      repos.push(...data.filter(r=>!r.private).map(r=>({name:r.name,description:r.description,url:r.html_url,language:r.language,stars:r.stargazers_count,forks:r.forks_count,fork:r.fork,archived:r.archived,updatedAt:r.updated_at})));
      if(data.length<100)break;
    }
    const response=json({repos,fetchedAt:new Date().toISOString()},200,{'Cache-Control':'public, max-age=600'});
    ctx.waitUntil(cache.put(key,response.clone()));return response;
  }catch{return json({message:'GitHub 暂时无法读取，请稍后重试，或直接访问 GitHub 主页。'},502);}
}
