import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseSongs,rank,cleanVideo,liveUploaderCatalog} from './music-core.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dataDir=resolve(root,'.music-studio'),projectFile=resolve(dataDir,'project.json');await mkdir(dataDir,{recursive:true});
let project;try{project=JSON.parse(await readFile(projectFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;project={version:1,preferred:[],titleKeywords:['Hi-res'],...parseSongs(await readFile(resolve(root,'歌单.txt'),'utf8'))};}
if(!Array.isArray(project.preferred))project.preferred=[];
if(!Array.isArray(project.titleKeywords))project.titleKeywords=['Hi-res'];
delete project.searchControl;
const save=()=>writeFile(projectFile,JSON.stringify(project,null,2));await save();
let searchInProgress=false;
async function search(song,refresh=false){
  if(!refresh&&song.candidates?.length)return rank(song,song.candidates,project.preferred,project.titleKeywords);
  if(searchInProgress)throw Object.assign(Error('已有一个 B站搜索正在进行，请稍后再操作。'),{httpStatus:429});
  searchInProgress=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const url='https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=12&keyword='+encodeURIComponent(song.title+' '+song.artist);
    const res=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/','Accept':'application/json, text/plain, */*'},cache:'no-store'});
    if(res.status===412||res.status===429){
      const retry=res.headers.get('Retry-After');
      await res.body?.cancel();
      const message=res.status===412?'B站返回 HTTP 412，当前搜索已停止；工具未设置冷却，可手动重试或粘贴 BV号。':'B站返回 HTTP 429，当前搜索已停止'+(retry?'；上游建议等待 '+retry+' 后再试。':'；可稍后手动重试。');
      throw Object.assign(Error(message),{httpStatus:res.status});
    }
    if(!res.ok){await res.body?.cancel();throw Object.assign(Error('B站搜索返回 '+res.status+'；请使用网页搜索并手动粘贴 BV号。'),{httpStatus:502});}
    const json=await res.json();
    if(json.code===-412||json.code===-352)throw Object.assign(Error('B站返回 '+json.code+' 风控码，当前搜索已停止；工具未设置冷却，可手动重试或粘贴 BV号。'),{httpStatus:412});
    if(json.code!==0)throw Object.assign(Error('B站暂不允许搜索：'+(json.message||json.code)),{httpStatus:502});
    const items=(json.data?.result||[]).filter(x=>/^BV[\da-zA-Z]{10}$/.test(x.bvid)).map(x=>({bvid:x.bvid,title:String(x.title).replace(/<[^>]*>/g,''),author:x.author,mid:String(x.mid),duration:x.duration}));
    return rank(song,items,project.preferred,project.titleKeywords);
  }catch(e){
    if(!e.httpStatus)throw Object.assign(Error('B站搜索网络请求失败，请手动重试。'),{httpStatus:502});
    throw e;
  }finally{clearTimeout(timer);searchInProgress=false;}
}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1024*1024)throw Error('文件过大');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
function playlist(){
  // Keep known duration only while the selected video and part still match.
  let previous=[],title='我的歌单';try{const data=JSON.parse(readFileSync(resolve(root,'public/music/playlist.json'),'utf8'));previous=data.tracks||[];title=data.title||title;}catch{}
  const cached=new Map(previous.map(track=>[track.id,track]));
  const tracks=project.songs.filter(s=>s.locked&&s.selected).map(s=>{
    const old=cached.get(s.id),same=old?.bvid===s.selected.bvid&&(Number(old.page)||1)===(Number(s.selected.page)||1);
    const {cover,...selected}=s.selected;
    return {...selected,id:s.id,title:s.title,artist:s.artist,videoTitle:s.selected.title,confirmed:true,...(same&&old.seconds?{seconds:old.seconds}:{})};
  });
  return liveUploaderCatalog(project,{version:1,title,updatedAt:new Date().toISOString(),tracks});
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer(async(req,res)=>{const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};try{if(req.headers.host!=='127.0.0.1:8790'&&req.headers.host!=='localhost:8790')return send({message:'Host rejected'},403);if(req.method!=='GET'&&req.headers.origin!=='http://127.0.0.1:8790'&&req.headers.origin!=='http://localhost:8790')return send({message:'Origin rejected'},403);const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/project'&&req.method==='GET')return send(project);if(url.pathname==='/api/export'&&req.method==='GET')return send(playlist());if(req.method==='POST'){const b=await body(req);if(url.pathname==='/api/preferences'){project.preferred=String(b.value||'').split(/[\n,，]/).map(x=>x.trim()).filter(Boolean);project.titleKeywords=String(b.titleKeywords??project.titleKeywords.join('\n')).split(/[\n,，]/).map(x=>x.trim()).filter(Boolean);await save();return send(project);}if(url.pathname==='/api/import'){const parsed=parseSongs(String(b.text||''));const old=new Map(project.songs.map(s=>[s.id,s]));project.songs=parsed.songs.map(s=>old.get(s.id)||s);project.errors=parsed.errors;await save();return send(project);}if(url.pathname==='/api/publish'){await mkdir(resolve(root,'public/music'),{recursive:true});await writeFile(resolve(root,'public/music/playlist.json'),JSON.stringify(playlist(),null,2));return send({message:'已写入 public/music/playlist.json；推送 GitHub 后部署。'});}const song=project.songs.find(s=>s.id===b.id);if(!song)return send({message:'歌曲不存在'},404);if(url.pathname==='/api/search'){song.candidates=await search(song,Boolean(b.refresh));if(!song.locked){const preferred=new Set(project.preferred.map(String));const auto=song.candidates.find(c=>preferred.has(String(c.mid))||preferred.has(String(c.author)));song.selected=auto?{...auto,page:1}:null;song.locked=Boolean(auto);song.lockMode=auto?'preferred-up':null;}await save();return send(song);}if(url.pathname==='/api/select'){song.selected=b.bvid?{bvid:cleanVideo(b.bvid),title:String(b.title||song.title),author:String(b.author||''),page:Math.max(1,Math.min(999,parseInt(b.page)||1))}:null;song.locked=Boolean(song.selected);song.lockMode=song.locked?'manual':null;await save();return send(song);}}
const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};if(!paths[url.pathname])return send({message:'Not found'},404);const file=paths[url.pathname];res.writeHead(200,{'Content-Type':types[file.slice(file.lastIndexOf('.'))],'Cache-Control':'no-store'});res.end(await readFile(resolve(root,'tools/music-studio',file)));}catch(e){send({message:e.message},e.httpStatus||400);}});
server.listen(8790,'127.0.0.1',()=>console.log('Music studio: http://127.0.0.1:8790'));
