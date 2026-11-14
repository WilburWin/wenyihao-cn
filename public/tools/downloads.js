import {initPayments,choosePaidFile,clearPaymentSelection,startPaidSession} from './payments.js';
import {audience,setAudience,showWorkspace,showTask,closeTask,visibleRows,setBusy} from './workspace.js';
const $=id=>document.getElementById(id);
let access='',path='/',page=1,busy=false,selected=null,guest=false,entries=[],total=0,offset=0;
function size(bytes){if(!bytes)return '—';const unit=Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)));return (bytes/1024**unit).toFixed(unit?1:0)+' '+['B','KB','MB','GB'][unit];}
function status(message){$('library-status').textContent=message;$('library-status').title=message;if(audience()==='friend'&&!access)$('friend-status').textContent=message;}
const displayPath=value=>value.replace(/^\/链接导入(?=\/|$)/,'/链接文件');
async function api(action,body={}){
  const response=await fetch('/api/tools/downloads/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Download-Code':access},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(action==='import'?95000:25000)});
  const data=await response.json();if(!response.ok){if(response.status===401)lock();throw Error(data.message||'请求失败，请稍后重试。');}return data;
}
function lock(){
  access='';selected=null;guest=false;entries=[];total=0;offset=0;path='/';page=1;clearPaymentSelection();closeTask();
  $('download-detail').hidden=true;$('library-content').hidden=true;$('files-empty').hidden=false;$('library-unlock').hidden=false;$('friend-unlocked').hidden=true;
  $('access-code').value='';$('file-list').replaceChildren();$('friend-status').textContent='';
}
function capacity(){return visibleRows($('file-list'),'--file-row-height',5);}
function renderFiles(){
  const count=capacity();offset=Math.min(offset,Math.max(0,entries.length-1));
  const nodes=entries.slice(offset,offset+count).map(file=>{
    const name=file.isDir&&file.path==='/链接导入'?'链接文件':file.name;
    const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='file-row';button.title=name;
    const icon=document.createElement('span');icon.className='file-symbol';icon.textContent=file.isDir?'▰':'↓';icon.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='file-name';title.textContent=name;
    const meta=document.createElement('span');meta.className='file-size';meta.textContent=file.isDir?'文件夹':size(file.size);
    const action=document.createElement('span');action.className='file-action';action.textContent=file.isDir?'打开 →':guest?'选择并支付 →':'获取下载地址 ↗';
    button.append(icon,title,meta,action);button.disabled=busy;button.addEventListener('click',()=>file.isDir?load(file.path):select(file));row.append(button);return row;
  });
  $('file-list').replaceChildren(...nodes);
  $('page-prev').disabled=busy||(page===1&&offset===0);$('page-next').disabled=busy||((page-1)*100+offset+count>=total);
  const first=(page-1)*100+offset+1,last=Math.min((page-1)*100+offset+count,(page-1)*100+entries.length);
  $('page-label').textContent=total?`${first}–${last} / ${total} 项`:'0 项';
}
async function load(nextPath='/',nextPage=1,propagate=false,fromEnd=false){
  if(busy)return;busy=true;setBusy('files',true);$('file-list').setAttribute('aria-busy','true');status('正在读取文件…');
  try{
    const data=await api('list',{path:nextPath,page:nextPage});path=nextPath;page=nextPage;selected=null;clearPaymentSelection();closeTask();$('download-detail').hidden=true;$('folder-refresh').disabled=false;
    $('library-unlock').hidden=true;$('friend-unlocked').hidden=!access;$('access-code').removeAttribute('aria-invalid');$('friend-status').textContent='';$('library-content').hidden=false;$('files-empty').hidden=true;
    $('folder-path').textContent=path==='/'?'共享文件':displayPath(path);$('folder-path').title=displayPath(path);
    $('folder-up').disabled=path==='/'||(guest&&/^\/链接导入\/share-[a-f0-9]{12}$/.test(path));
    entries=data.files;total=data.total;offset=0;showWorkspace('files');
    if(fromEnd)offset=Math.max(0,Math.floor((entries.length-1)/capacity())*capacity());
    status(total?`共 ${total} 项，${guest?'选择文件后再支付，解析链接不收费。':'点击文件即可获取下载地址。'}`:'这个目录暂时没有文件，可返回上一级或解析分享链接。');
    return data;
  }catch(error){const message=error.name==='TimeoutError'?'连接超时，请稍后刷新。':error.message;status(message);if(audience()==='friend')$('friend-status').textContent=message;if(propagate)throw error;}
  finally{busy=false;setBusy('files',false);$('file-list').removeAttribute('aria-busy');renderFiles();}
}
async function select(file){
  if(busy)return;
  if(guest&&!access){selected=null;$('download-detail').hidden=true;choosePaidFile(file);return;}
  busy=true;setBusy('files',true);selected=null;$('download-detail').hidden=true;status('正在获取下载地址…');
  try{displayDownload(await api('link',{path:file.path}));}
  catch(error){status(error.message);}finally{busy=false;setBusy('files',false);}
}
$('library-unlock').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;access=$('access-code').value.trim();if(!access){status('请输入朋友访问码。');return;}
  const button=event.currentTarget.querySelector('button');button.disabled=true;$('friend-status').textContent='正在验证访问码…';
  try{await load();}finally{button.disabled=false;}
});
$('library-lock').addEventListener('click',()=>{lock();status('已退出朋友访问。');$('access-code').focus();});
document.addEventListener('tools:audience',()=>{lock();status(audience()==='paid'?'准备就绪，粘贴分享链接即可开始。':'请输入本站访问码，验证后免费使用。');showWorkspace('import');if(audience()==='friend')$('access-code').focus();});
$('folder-up').addEventListener('click',()=>load(path.slice(0,path.lastIndexOf('/'))||'/'));
$('folder-refresh').addEventListener('click',()=>{if(path)load(path,page);});
$('page-prev').addEventListener('click',()=>{if(busy)return;if(offset>0){offset=Math.max(0,offset-capacity());renderFiles();}else if(page>1)load(path,page-1,false,true);});
$('page-next').addEventListener('click',()=>{if(busy)return;if(offset+capacity()<entries.length){offset+=capacity();renderFiles();}else if(page*100<total)load(path,page+1);});
new ResizeObserver(()=>renderFiles()).observe($('file-list'));
document.addEventListener('tools:view',event=>{if(event.detail==='files')renderFiles();});
async function copy(value){try{await navigator.clipboard.writeText(value);status('已复制。');$('download-feedback').textContent='已复制。';}catch{status('无法复制，请使用下载按钮或重试。');$('download-feedback').textContent='无法复制，请使用下载按钮或重试。';}}
$('copy-direct').addEventListener('click',()=>{if(selected)copy(selected.url);});
$('copy-command').addEventListener('click',()=>{
  if(!selected)return;const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const name=selected.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'')||'download';
  copy('curl.exe --location --fail --user-agent '+quote('pan.baidu.com')+' --output '+quote('.\\'+name)+' '+quote(selected.url));
});
window.addEventListener('pagehide',lock);
function displayDownload(data){
  const url=new URL(data.url);if(url.protocol!=='https:'||url.port||url.username||url.password||!['baidupcs.com','baidu.com'].some(h=>url.hostname.endsWith('.'+h)))throw Error('下载地址无效。');
  selected=data;$('download-title').textContent=data.name;$('direct-download').href=url.href;$('download-feedback').textContent='';status('下载地址已准备好，文件由百度直接提供。');showTask('download');$('direct-download').focus();
}
const paymentReady=initPayments({onGuest(){
  setAudience('paid',{silent:true});access='';guest=true;path='';selected=null;entries=[];total=0;offset=0;
  $('access-code').value='';$('library-unlock').hidden=true;$('friend-unlocked').hidden=true;$('library-content').hidden=true;$('files-empty').hidden=false;
  $('file-list').replaceChildren();$('folder-path').textContent='请先粘贴自己的分享链接';$('folder-up').disabled=true;$('folder-refresh').disabled=true;
  status('按次下载已开启。解析链接不收费，选择文件后再创建 ¥0.50 订单。');
},onDownload:displayDownload});
export async function importShare(share){
  if(!access&&!guest){
    if(audience()==='friend'){$('access-code').focus();throw Error('请先填写本站访问码并点击“进入”。');}
    await paymentReady;await startPaidSession();
  }
  if(busy)throw Error('正在处理文件请求，请稍后再试。');
  busy=true;setBusy('files',true);status('正在验证分享并准备文件…');
  let result;try{result=await api('import',{link:share.link,code:share.code});}catch(error){status(error.message);throw error;}finally{busy=false;setBusy('files',false);}
  let files;try{files=await load(result.path,1,true);}catch{throw Error('文件已就绪，但暂时无法读取文件列表，请稍后刷新。');}
  if(files.files.length===1&&!files.files[0].isDir)await select(files.files[0]);
  return result;
}
