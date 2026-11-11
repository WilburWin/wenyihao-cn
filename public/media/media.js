const $=selector=>document.querySelector(selector);
const gate=$('#gate'),library=$('#library'),grid=$('#grid'),errorBox=$('#error'),search=$('#search');
let currentPath='/',currentPage=1,total=0,items=[],playing=[],playerNode=null;
async function api(action,body,method='POST'){
  const response=await fetch('/api/tools/media/'+action,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await response.json().catch(()=>({message:'服务器返回了无效响应。'}));
  if(!response.ok)throw Error(data.message||'影音库暂时无法访问。');
  return data;
}
function showGate(message=''){
  library.hidden=true;gate.hidden=false;$('#login-message').textContent=message;$('#password').focus();
}
function showLibrary(){gate.hidden=true;library.hidden=false;}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;$('#login-message').textContent='正在验证…';
  try{await api('login',{password:$('#password').value});$('#password').value='';showLibrary();await loadDirectory('/',true);}
  catch(e){$('#login-message').textContent=e.message;}
  finally{button.disabled=false;}
});
function kindLabel(kind){return ({video:'影片',audio:'音频',image:'图片',folder:'文件夹'})[kind]||'媒体';}
function sizeLabel(value){if(!value)return '云端媒体';const units=['B','KB','MB','GB','TB'];let n=value,i=0;while(n>=1024&&i<units.length-1){n/=1024;i++;}return `${n.toFixed(i?1:0)} ${units[i]}`;}
function iconFor(kind){return ({video:'▶',audio:'♫',image:'▧',folder:'▰'})[kind]||'•';}
function render(){
  const query=search.value.trim().toLocaleLowerCase();const visible=items.filter(x=>!query||x.name.toLocaleLowerCase().includes(query));
  grid.replaceChildren();
  if(!visible.length){grid.innerHTML=`<div class="empty"><span>⌕</span><strong>${query?'没有找到匹配内容':'这里还没有支持的媒体'}</strong><small>${query?'试试其他关键词':'添加视频、音乐或图片后，刷新目录即可看到。'}</small></div>`;return;}
  for(const item of visible){
    const card=document.createElement('button');card.type='button';card.className='media-card '+(item.kind==='folder'?'folder-card':'');
    const art=document.createElement('span');art.className='media-art '+item.kind;art.setAttribute('aria-hidden','true');art.innerHTML=`<span class="art-grid"></span><span class="art-icon">${iconFor(item.kind)}</span><span class="art-kind">${kindLabel(item.kind)}</span>`;
    const text=document.createElement('span');text.className='card-copy';const title=document.createElement('strong');title.textContent=item.name;const meta=document.createElement('small');meta.textContent=item.kind==='folder'?'打开文件夹 · '+item.name+' 里的媒体':`${sizeLabel(item.size)} · ${kindLabel(item.kind)}`;text.append(title,meta);card.append(art,text);
    card.addEventListener('click',()=>item.kind==='folder'?loadDirectory(item.path,true):item.kind==='image'?openImage(item):playItem(item));grid.append(card);
  }
}
function setCrumbs(){
  const crumbs=$('#crumbs');crumbs.replaceChildren();const root=document.createElement('button');root.type='button';root.textContent='影音收藏';root.addEventListener('click',()=>loadDirectory('/',true));crumbs.append(root);
  const parts=currentPath.split('/').filter(Boolean);let path='';for(const part of parts){path+='/'+part;const button=document.createElement('button');button.type='button';button.textContent=part;button.addEventListener('click',()=>loadDirectory(path,true));crumbs.append(Object.assign(document.createElement('span'),{textContent:'/' }),button);}
  $('#folder-title').textContent=parts.at(-1)||'全部媒体';
}
async function loadDirectory(path,reset=false){
  if(reset){currentPath=path;currentPage=1;items=[];}errorBox.hidden=true;grid.innerHTML='<div class="loading"><span class="loader"></span>正在读取云端目录…</div>';setCrumbs();
  try{const data=await api('list',{path:currentPath,page:currentPage});items=reset?data.files:[...items,...data.files];total=data.total;$('#folder-count').textContent=`${items.length} 个媒体项目 · 位于 115 云端`;$('#load-more').hidden=items.length>=total||data.files.length===0;$('#shuffle').hidden=!items.some(x=>x.kind==='video'||x.kind==='audio');render();}
  catch(e){if(e.message.includes('请先登录')){showGate('登录已过期，请重新输入访问密码。');return;}grid.replaceChildren();errorBox.textContent=e.message;errorBox.hidden=false;$('#folder-count').textContent='暂时无法读取目录';}
}
function openPlayer(item,source,tag){
  closePlayer();const stage=$('#player-stage');const media=document.createElement(tag);media.controls=true;media.autoplay=true;media.preload='metadata';media.src=source;media.playsInline=true;media.className=tag==='video'?'video-element':'audio-element';stage.replaceChildren(media);$('#player').hidden=false;playerNode=media;$('#player-title').textContent=item.name;$('#player-size').textContent=`${sizeLabel(item.size)} · 直接连接 115`;$('#player-kind').textContent=tag==='video'?'NOW PLAYING · VIDEO':'NOW PLAYING · AUDIO';$('#player-backdrop').hidden=true;media.addEventListener('error',()=>{$('#player-size').textContent='浏览器无法播放此格式或 115 拒绝了直连请求。可回到 115 客户端播放。';});
}
async function playItem(item){
  try{errorBox.hidden=true;const data=await api('link',{path:item.path});playing=items.filter(x=>['video','audio'].includes(x.kind));openPlayer(data,data.url,data.kind==='audio'?'audio':'video');}
  catch(e){errorBox.textContent=e.message;errorBox.hidden=false;}
}
async function openImage(item){
  try{const data=await api('link',{path:item.path});closePlayer();const image=document.createElement('img');image.className='image-element';image.alt=item.name;image.src=data.url;image.referrerPolicy='no-referrer';$('#player-stage').replaceChildren(image);$('#player').hidden=false;$('#player-title').textContent=item.name;$('#player-size').textContent=`${sizeLabel(item.size)} · 直接连接 115`;$('#player-kind').textContent='PHOTO VIEW';playerNode=image;}
  catch(e){errorBox.textContent=e.message;errorBox.hidden=false;}
}
function closePlayer(){if(playerNode){playerNode.pause?.();playerNode.removeAttribute('src');playerNode.load?.();playerNode=null;}$('#player').hidden=true;}
$('#close-player').addEventListener('click',closePlayer);
$('#player-backdrop').addEventListener('click',closePlayer);
$('#root-button').addEventListener('click',()=>loadDirectory('/',true));
$('#refresh').addEventListener('click',()=>loadDirectory(currentPath,true));
$('#load-more').addEventListener('click',()=>{currentPage++;loadDirectory(currentPath,false);});
search.addEventListener('input',render);
$('#shuffle').addEventListener('click',()=>{const tracks=items.filter(x=>['video','audio'].includes(x.kind));if(!tracks.length)return;const item=tracks[Math.floor(Math.random()*tracks.length)];playItem(item);});
$('#logout').addEventListener('click',async()=>{closePlayer();try{await api('logout',{});}finally{items=[];showGate('');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#player').hidden)closePlayer();});
(async()=>{try{const status=await api('status',undefined,'GET');if(status.authenticated){showLibrary();await loadDirectory('/',true);}else showGate();}catch{showGate();}})();
