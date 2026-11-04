const $=selector=>document.querySelector(selector);
const audio=$('#audio');
let tracks=[],current=null,resolved=null,requestSerial=0,controller=null,loadedId=null;
let singleRepeat=false,shuffle=false,loading=false,recoveries=0,pendingSeek=0;
let authPlayback=null;
let libraryView='all',playbackQueue=[],shuffledNext=[],toastTimer;
const ICONS='/music/assets/icons.svg#',DEFAULT_COVER='/music/artwork/collection.webp';
function readList(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(id=>typeof id==='string').slice(0,500):[];}catch{return [];}}
const liked=new Set(readList('wenyihao.music.liked'));
let recent=readList('wenyihao.music.recent');
function saveList(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');svg.classList.add('icon');svg.setAttribute('aria-hidden','true');use.setAttribute('href',ICONS+name);svg.append(use);return svg;}
function setIcon(element,name){const use=element.querySelector('use');if(use)use.setAttribute('href',ICONS+name);}
function coverOf(track){return typeof track?.cover==='string'&&/^\/music\/artwork\/[a-f\d]{16}\.webp$/.test(track.cover)?track.cover:DEFAULT_COVER;}
function coverImage(track,className=''){const img=document.createElement('img');img.src=coverOf(track);img.alt='';img.loading='lazy';img.decoding='async';img.className=className;img.addEventListener('error',()=>{if(img.getAttribute('src')!==DEFAULT_COVER)img.src=DEFAULT_COVER;},{once:true});return img;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2400);}
function libraryTracks(){return libraryView==='liked'?tracks.filter(track=>liked.has(track.id)):libraryView==='recent'?recent.map(id=>tracks.find(track=>track.id===id)).filter(Boolean):tracks;}
function launch(track){playbackQueue=[...libraryTracks()];if(!playbackQueue.some(item=>item.id===track.id))playbackQueue=[...tracks];resetShuffle();playTrack(track);}
function syncLikes(){for(const id of ['#dock-like','#now-like']){const button=$(id),saved=Boolean(current&&liked.has(current.id));button.disabled=!current;button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',saved?'取消喜欢当前歌曲':'喜欢当前歌曲');}$('#liked-count').textContent=String(tracks.filter(track=>liked.has(track.id)).length);}
function toggleLike(track){if(!track)return;const focusedRow=document.activeElement.closest('.track-row')?.dataset.id;const saved=!liked.has(track.id);if(saved)liked.add(track.id);else liked.delete(track.id);saveList('wenyihao.music.liked',[...liked]);render();if(focusedRow){const replacement=document.querySelector(`.track-row[data-id="${focusedRow}"] .like-button`);if(replacement)replacement.focus();else document.querySelector(`[data-view="${libraryView}"]`).focus();}toast(saved?'已添加到我喜欢的音乐':'已从我喜欢的音乐移除');}
function compactTrack(track){const button=document.createElement('button');button.type='button';button.className='compact-track';button.setAttribute('aria-label','播放 '+track.title);button.setAttribute('aria-current',String(track.id===current?.id));const copy=document.createElement('span'),title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist||track.author||'Bilibili';copy.append(title,artist);button.append(coverImage(track),copy);button.addEventListener('click',()=>{if(!queueSource().some(item=>item.id===track.id))playbackQueue=[...tracks];playTrack(track);});return button;}
function renderRecent(){const songs=recent.map(id=>tracks.find(track=>track.id===id)).filter(Boolean).slice(0,5);$('#recent-tracks').replaceChildren(...songs.map(compactTrack));if(!songs.length){const empty=document.createElement('p');empty.className='sidebar-empty';empty.textContent='听过的歌，会留在这里。';$('#recent-tracks').append(empty);}}
function queueSource(){return playbackQueue.length?playbackQueue:tracks;}
function resetShuffle(){shuffledNext=queueSource().filter(track=>track.id!==current?.id);for(let i=shuffledNext.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffledNext[i],shuffledNext[j]]=[shuffledNext[j],shuffledNext[i]];}}
function renderQueue(){const queue=queueSource(),index=queue.findIndex(track=>track.id===current?.id);const next=singleRepeat&&current?[current]:shuffle?shuffledNext.slice(0,3):Array.from({length:Math.min(3,Math.max(0,queue.length-1))},(_,i)=>queue[(index+i+1)%queue.length]);$('#up-next').replaceChildren(...next.map(compactTrack));$('#queue-mode').textContent=singleRepeat?'单曲循环':shuffle?'随机播放':'按歌单顺序';}
const durationOf=()=>Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:(resolved?.duration||0);
const clock=value=>{const seconds=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
const videoUrl=track=>`https://www.bilibili.com/video/${encodeURIComponent(track.bvid)}/?p=${Number(track.page)||1}`;
function status(message){$('#connection-label').textContent=message;}
function fail(message){loading=false;loadedId=null;audio.pause();$('#progress').disabled=true;$('#quality').disabled=true;document.body.classList.remove('is-loading','is-playing');$('#playback-error').hidden=false;$('#playback-error').textContent=message;status('播放暂不可用');syncControls();}
function updateCurrent(track){
  const changed=current?.id!==track.id;
  current=track;
  $('#dock-title').textContent=track.title;
  $('#dock-artist').textContent=[track.artist,track.author].filter(Boolean).join(' · ');
  $('#now-playing-copy').textContent=[track.title,track.artist].filter(Boolean).join(' — ');
  $('#mv').hidden=false;$('#mv').href=videoUrl(track);
  $('#source-mv').href=videoUrl(track);$('#source-author').textContent=track.author||'Bilibili';$('#source-title').textContent=track.videoTitle||track.title;
  $('#now-title').textContent=track.title;$('#now-artist').textContent=track.artist||track.author||'';
  $('#dock-cover').src=coverOf(track);$('#now-cover').src=coverOf(track);$('#now-cover').alt=track.title+' · 视频封面';
  if(changed)resetShuffle();
  if('mediaSession' in navigator&&'MediaMetadata' in window){navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:track.artist||'',album:'文艺淏的音乐收藏',artwork:[{src:new URL(coverOf(track),location.origin).href,sizes:'640x640',type:'image/webp'}]});}
  render();
}
function syncControls(){
  const playing=!audio.paused&&!audio.ended&&loadedId===current?.id;
  setIcon($('#play'),playing?'pause':'play');
  $('#play').setAttribute('aria-label',loading?'取消载入':playing?'暂停':'播放');
  $('#play').setAttribute('aria-pressed',String(playing));
  $('#play').setAttribute('aria-busy',String(loading));
  setIcon($('#featured-play'),playing?'pause':'play');$('#featured-play').setAttribute('aria-label',loading?'取消载入':playing?'暂停播放':'播放歌单');
  document.body.classList.toggle('is-playing',playing&&!loading);
  document.body.classList.toggle('is-loading',loading);
  for(const row of document.querySelectorAll('.track-row')){const active=row.dataset.id===current?.id;setIcon(row.querySelector('.row-play'),active&&playing?'pause':'play');for(const button of row.querySelectorAll('.row-number,.row-song'))button.setAttribute('aria-label',(active&&playing?'暂停 ':'播放 ')+(tracks.find(track=>track.id===row.dataset.id)?.title||''));}
  for(const card of document.querySelectorAll('.song-card'))setIcon(card,card.dataset.id===current?.id&&playing?'pause':'play');
}
function render(){
  const query=$('#search').value.trim().toLocaleLowerCase();
  const collection=libraryTracks(),visible=collection.filter(track=>`${track.title} ${track.artist} ${track.author||''}`.toLocaleLowerCase().includes(query));
  $('#tracks').replaceChildren();$('#count').textContent=String(visible.length).padStart(2,'0');$('#side-count').textContent=String(tracks.length).padStart(2,'0');$('#empty').hidden=visible.length>0;
  $('#empty').textContent=query?'没有找到匹配的曲目，换个关键词试试。':libraryView==='liked'?'点一下歌曲旁的爱心，把喜欢留在这里。':libraryView==='recent'?'播放一首歌，就会出现在这里。':'歌单还没有歌曲。';
  $('#playlist-title').textContent=libraryView==='liked'?'我喜欢的音乐':libraryView==='recent'?'最近播放':'我的音乐收藏';
  $('#playlist-description').textContent=libraryView==='liked'?'一颗爱心，留住喜欢的旋律。':libraryView==='recent'?'重逢那些，刚刚听过的声音。':'喜欢的旋律，值得一听再听。';
  $('#playlist-total').textContent=collection.length+' 首歌曲';
  const totalSeconds=collection.reduce((sum,track)=>sum+(track.seconds||0),0);
  $('#playlist-duration').textContent=totalSeconds>=3600?`${Math.floor(totalSeconds/3600)} 小时 ${Math.floor(totalSeconds%3600/60)} 分钟`:`约 ${Math.floor(totalSeconds/60)} 分钟`;
  $('#collection-title').firstChild.textContent=(libraryView==='liked'?'喜欢的歌曲':libraryView==='recent'?'听过的歌曲':'全部歌曲')+' ';
  $('#filter-description').hidden=libraryView==='all';$('#filter-description').textContent='仅保存在当前浏览器，不会修改 B站收藏夹。';
  for(const button of document.querySelectorAll('[data-view]')){const active=button.dataset.view===libraryView;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('#picks-section').hidden=Boolean(query)||libraryView!=='all';
  $('#quick-picks').replaceChildren(...tracks.slice(0,4).map(track=>{
    const card=document.createElement('button');card.className='song-card';card.type='button';card.dataset.id=track.id;card.setAttribute('aria-current',String(track.id===current?.id));card.setAttribute('aria-label','播放 '+track.title);
    const art=document.createElement('span');art.className='card-cover';const play=document.createElement('span');play.className='card-play';play.append(icon('play'));art.append(coverImage(track),play);
    const title=document.createElement('strong'),artist=document.createElement('small');title.textContent=track.title;artist.textContent=track.artist||track.author||'Bilibili';card.append(art,title,artist);card.addEventListener('click',()=>track.id===current?.id&&loadedId===track.id?togglePlayback():launch(track));return card;
  }));
  for(const track of visible){
    const row=document.createElement('div');row.className='track-row';row.dataset.id=track.id;row.setAttribute('aria-current',String(track.id===current?.id));
    const numberButton=document.createElement('button');numberButton.type='button';numberButton.className='row-number';
    const number=document.createElement('span');number.className='row-no';number.textContent=String(tracks.indexOf(track)+1).padStart(2,'0');
    const action=document.createElement('span');action.className='row-play';action.append(icon('play'));numberButton.append(number,action);
    const song=document.createElement('button');song.type='button';song.className='row-song';const songCopy=document.createElement('span');
    const title=document.createElement('strong');title.textContent=track.title;
    const artist=document.createElement('small');artist.textContent=track.artist||'';songCopy.append(title,artist);song.append(coverImage(track,'row-cover'),songCopy);
    const author=document.createElement('span');author.className='row-source';author.textContent=track.author||'Bilibili';
    const duration=document.createElement('span');duration.className='row-length';duration.textContent=track.seconds?clock(track.seconds):(track.duration||'—');
    const like=document.createElement('button');like.type='button';like.className='icon-button like-button';like.setAttribute('aria-pressed',String(liked.has(track.id)));like.setAttribute('aria-label',(liked.has(track.id)?'取消喜欢 ':'喜欢 ')+track.title);like.append(icon('heart'));like.addEventListener('click',()=>toggleLike(track));
    const play=()=>track.id===current?.id&&loadedId===track.id?togglePlayback():launch(track);numberButton.addEventListener('click',play);song.addEventListener('click',play);
    row.append(numberButton,song,author,like,duration);$('#tracks').append(row);
  }
  syncControls();syncLikes();renderRecent();renderQueue();
}
function updateProgress(){
  const duration=durationOf();$('#elapsed').textContent=clock(audio.currentTime);$('#duration').textContent=duration?clock(duration):'—:—';
  $('#progress').disabled=!duration||loadedId!==current?.id;
  $('#progress').value=duration?String(Math.round(audio.currentTime/duration*1000)):'0';
  $('#progress').style.setProperty('--fill',`${Number($('#progress').value)/10}%`);
  $('#progress').setAttribute('aria-valuetext',`${clock(audio.currentTime)} / ${clock(duration)}`);
}
async function startAudio(){
  const serial=requestSerial;
  try{await audio.play();}
  catch(error){
    if(serial!==requestSerial)return;
    if(error.name==='AbortError')return;
    if(error.name==='NotAllowedError'){loading=false;status('点击播放继续');syncControls();return;}
    fail('音频未能播放，请重试或通过 MV 打开原视频。');
  }
}
async function playTrack(track,{position=0,quality='',resume=true,recovery=false}={}){
  if(!track)return;
  const serial=++requestSerial;controller?.abort();controller=new AbortController();
  audio.pause();audio.removeAttribute('src');audio.load();loadedId=null;resolved=null;pendingSeek=position;
  if(!recovery)recoveries=0;
  updateCurrent(track);loading=true;$('#playback-error').hidden=true;$('#quality').disabled=true;$('#progress').disabled=true;$('#elapsed').textContent=clock(position);$('#duration').textContent='—:—';status('正在连接音频…');syncControls();
  try{
    const response=await fetch('/api/music/resolve?id='+encodeURIComponent(track.id),{signal:controller.signal,cache:'no-store'});
    const data=await response.json();
    if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('music-auth-expired'));throw Error(data.message||'无法读取歌曲资源。');}
    if(serial!==requestSerial)return;
    const choices=(data.qualities||[]).filter(choice=>audio.canPlayType(choice.mime));
    if(!choices.length)throw Error('当前浏览器不支持这首歌的音频编码。');
    resolved=data;track.seconds=data.duration;
    $('#quality').replaceChildren(...choices.map(choice=>{const option=document.createElement('option');option.value=String(choice.id);option.textContent=choice.label;return option;}));
    const chosen=choices.find(choice=>String(choice.id)===String(quality))||choices[0];
    $('#quality').value=String(chosen.id);$('#quality').disabled=false;
    const source=new URL(data.streamUrl,location.origin);
    if(source.origin!==location.origin||source.pathname!=='/api/music/audio')throw Error('音频地址无效。');
    source.searchParams.set('quality',String(chosen.id));
    loadedId=track.id;audio.src=source.pathname+source.search;audio.load();render();
    if(resume)await startAudio();else{loading=false;status('已暂停');syncControls();}
  }catch(error){if(serial!==requestSerial||error.name==='AbortError')return;fail(error instanceof SyntaxError?'音乐接口尚未启动，请使用支持 Worker 的预览服务。':error.message);}
}
function cancelLoading(){requestSerial++;controller?.abort();audio.pause();audio.removeAttribute('src');audio.load();loadedId=null;loading=false;status('已停止');syncControls();}
function togglePlayback(){
  if(loading){cancelLoading();return;}
  if(!current||loadedId!==current.id){playTrack(current||tracks[0]);return;}
  if(audio.paused)startAudio();else audio.pause();
}
function move(direction){
  const queue=queueSource();if(!queue.length)return;
  if(shuffle&&direction>0&&shuffledNext.length){playTrack(shuffledNext[0]);return;}
  const index=queue.findIndex(track=>track.id===current?.id);
  playTrack(queue[(index+direction+queue.length)%queue.length]);
}

// Clear buffered account audio before logout, then resolve in the new session.
function prepareAuthChange(){
  authPlayback=current?{track:current,position:audio.currentTime||pendingSeek,resume:!audio.paused||loading}:null;
  cancelLoading();resolved=null;$('#quality').disabled=true;$('#progress').disabled=true;
}
window.addEventListener('music-auth-changing',prepareAuthChange);
window.addEventListener('music-auth-changed',()=>{
  if(!authPlayback)prepareAuthChange();
  const previous=authPlayback;authPlayback=null;
  if(previous)playTrack(previous.track,{position:previous.position,resume:previous.resume});
});
audio.addEventListener('playing',()=>{loading=false;$('#playback-error').hidden=true;status('正在播放');if(current){recent=[current.id,...recent.filter(id=>id!==current.id)].slice(0,50);saveList('wenyihao.music.recent',recent);renderRecent();}syncControls();});
audio.addEventListener('pause',()=>{if(!loading)status('已暂停');syncControls();});
audio.addEventListener('waiting',()=>{if(loadedId){loading=true;status('正在缓冲…');syncControls();}});
audio.addEventListener('loadedmetadata',()=>{if(pendingSeek>0){audio.currentTime=Math.min(pendingSeek,Math.max(0,durationOf()-.1));pendingSeek=0;}updateProgress();});
audio.addEventListener('timeupdate',updateProgress);
audio.addEventListener('durationchange',updateProgress);
audio.addEventListener('ended',()=>{if(singleRepeat){audio.currentTime=0;startAudio();}else move(1);});
audio.addEventListener('error',()=>{
  if(!loadedId)return;
  if(recoveries<1){recoveries++;playTrack(current,{position:audio.currentTime,quality:$('#quality').value,recovery:true});}
  else fail('音频线路暂不可用。请稍后重试，或点击 MV 在B站播放。');
});
$('#search').addEventListener('input',render);
$('#featured-play').addEventListener('click',()=>{if(loading||loadedId===current?.id&&!audio.paused){togglePlayback();return;}const collection=libraryTracks();if(!collection.length){toast('这个列表还没有歌曲');return;}playbackQueue=[...collection];resetShuffle();if(collection.some(track=>track.id===current?.id))togglePlayback();else launch(collection[0]);});
$('#play').addEventListener('click',togglePlayback);
$('#prev').addEventListener('click',()=>move(-1));$('#next').addEventListener('click',()=>move(1));
function setShuffle(value){shuffle=value;$('#shuffle').checked=value;$('#dock-shuffle').setAttribute('aria-pressed',String(value));resetShuffle();renderQueue();}
$('#shuffle').addEventListener('change',()=>setShuffle($('#shuffle').checked));
$('#dock-shuffle').addEventListener('click',()=>setShuffle(!shuffle));
$('#repeat').addEventListener('click',()=>{singleRepeat=!singleRepeat;for(const id of ['#repeat','#mobile-repeat']){setIcon($(id),singleRepeat?'repeat-1':'repeat');$(id).setAttribute('aria-label',singleRepeat?'单曲循环，点击切换列表循环':'列表循环，点击切换单曲循环');$(id).setAttribute('aria-pressed',String(singleRepeat));}renderQueue();});
$('#mobile-repeat').addEventListener('click',()=>$('#repeat').click());
$('#progress').addEventListener('input',()=>{if(durationOf())audio.currentTime=Number($('#progress').value)/1000*durationOf();});
$('#quality').addEventListener('change',()=>playTrack(current,{position:audio.currentTime,quality:$('#quality').value,resume:!audio.paused}));
$('#volume').addEventListener('input',()=>{audio.volume=Number($('#volume').value);$('#volume').style.setProperty('--fill',`${audio.volume*100}%`);try{localStorage.setItem('wenyihao.music.volume',String(audio.volume));}catch{}});
try{const saved=localStorage.getItem('wenyihao.music.volume');if(saved!==null&&Number.isFinite(Number(saved)))$('#volume').value=String(Math.min(1,Math.max(0,Number(saved))));}catch{}
audio.volume=Number($('#volume').value);
$('#volume').style.setProperty('--fill',`${audio.volume*100}%`);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{libraryView=button.dataset.view;$('#search').value='';render();$('.music-content').scrollTop=0;});
$('#dock-like').addEventListener('click',()=>toggleLike(current));$('#now-like').addEventListener('click',()=>toggleLike(current));
let queueOpen=matchMedia('(min-width:1321px)').matches;
function setQueueOpen(open){queueOpen=open;document.body.classList.toggle('queue-open',open);document.body.classList.toggle('queue-hidden',!open);$('#queue-toggle').setAttribute('aria-expanded',String(open));setIcon($('#queue-toggle'),open?'panel-right-close':'panel-right-open');$('#now-panel').inert=!open;}
$('#queue-toggle').addEventListener('click',()=>setQueueOpen(!queueOpen));$('#queue-close').addEventListener('click',()=>{setQueueOpen(false);$('#queue-toggle').focus();});setQueueOpen(queueOpen);
matchMedia('(min-width:1321px)').addEventListener('change',event=>setQueueOpen(event.matches));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&queueOpen&&!$('#login-dialog').open){setQueueOpen(false);$('#queue-toggle').focus();}if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('#login-dialog').open){event.preventDefault();$('#search').focus();}});
if('mediaSession' in navigator){for(const [action,handler] of Object.entries({play:()=>audio.paused&&togglePlayback(),pause:()=>audio.pause(),previoustrack:()=>move(-1),nexttrack:()=>move(1),seekto:details=>{if(Number.isFinite(details.seekTime))audio.currentTime=details.seekTime;}})){try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}}
fetch('/music/playlist.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{
  tracks=(data.tracks||[]).filter(track=>track.confirmed&&/^BV[\da-zA-Z]{10}$/.test(track.bvid));
  playbackQueue=[...tracks];if(tracks.length)updateCurrent(tracks[0]);render();
}).catch(()=>{render();fail('暂时无法读取已发布歌单。');});
