import {initPayments,choosePaidSelection,clearPaymentSelection,startPaidSession,copyOrderId,reselectPaidOrder} from './payments.js';
import {audience,setAudience,setFriendVerified,showWorkspace,showTask,closeTask,visibleRows,setBusy,workspace,openFriend,syncCheckout} from './workspace.js';
import {prepareTask,saveTask} from './download-tasks.js';
import {isSelected,selectionState,setSelection} from './file-selection.js';
const $=id=>document.getElementById(id);
const mobileDevice=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
let access='',path='/',page=1,busy=false,selected=null,guest=false,entries=[],total=0,offset=0;
let quoteTimer,quoteKey='',selectedOrder=null;
let selectionRoot='/',rules=[{path:'/',selected:true}];
const loadedFolders=new Map();
function resetSelection(root){if(root!==selectionRoot)loadedFolders.clear();selectionRoot=root;rules=[{path:root,selected:true}];}
function scheduleQuote(){
  if(!guest||busy||workspace()!=='files'||!/^\/链接导入\/share-[a-f0-9]{12}$/.test(selectionRoot)||document.body.dataset.checkoutOrigin==='order')return;
  const key=JSON.stringify([selectionRoot,rules]);if(key===quoteKey)return;
  clearTimeout(quoteTimer);clearPaymentSelection();$('selection-quote-status').textContent=anySelected(selectionRoot)?'核价中…':'未选文件。';
  if(!anySelected(selectionRoot)){quoteKey='';return;}
  quoteTimer=setTimeout(()=>{if(!guest||busy||workspace()!=='files')return;quoteKey=key;$('selection-quote-status').textContent='';choosePaidSelection(selectionRoot,structuredClone(rules)).catch(error=>status(error.message));},350);
}
function anySelected(folder){
  const known=loadedFolders.get(folder);
  if(!known||known.files.size!==known.total)return isSelected(rules,folder)||rules.some(rule=>rule.selected&&rule.path.startsWith(folder==='/'?'/':folder+'/'));
  for(const file of known.files.values())if(file.isDir?anySelected(file.path):isSelected(rules,file.path))return true;
  return false;
}
function updateSelection(){
  const visible=pageEntries(),state=selectionState(rules,path),count=visible.filter(file=>isSelected(rules,file.path)).length;
  const any=anySelected(path);$('file-select-all').checked=any&&state.checked;$('file-select-all').indeterminate=any&&state.indeterminate;
  if(!guest||JSON.stringify([selectionRoot,rules])!==quoteKey)$('file-selection-summary').textContent=`当前页勾选 ${count} / ${visible.length} 项，文件夹包含子文件。`;
  $('buy-share').disabled=busy||!anySelected(selectionRoot);$('download-all').disabled=busy||!anySelected(selectionRoot);
  scheduleQuote();
}
function size(bytes){if(!bytes)return '—';const unit=Math.min(3,Math.floor(Math.log(bytes)/Math.log(1024)));return (bytes/1024**unit).toFixed(unit?1:0)+' '+['B','KB','MB','GB'][unit];}
function status(message){$('library-status').textContent=message;$('library-status').title=message;if(audience()==='friend'&&!access)$('friend-status').textContent=message;}
const displayPath=value=>value.replace(/^\/链接导入\/share-[a-f0-9]{12}(?=\/|$)/,'全部文件').replace(/^\/链接导入(?=\/|$)/,'/链接文件');
async function api(action,body={}){
  const response=await fetch('/api/tools/downloads/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Download-Code':access},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(action==='import'?95000:25000)});
  const data=await response.json();if(!response.ok){if(response.status===401)lock();throw Error(data.message||'请求失败，请稍后重试。');}return data;
}
function lock(){
  clearTimeout(quoteTimer);quoteKey='';selectedOrder=null;setFriendVerified(false);
  access='';selected=null;guest=false;entries=[];total=0;offset=0;path='/';page=1;loadedFolders.clear();resetSelection('/');clearPaymentSelection();closeTask();
  $('download-detail').hidden=true;$('library-content').hidden=true;$('files-empty').hidden=false;$('library-unlock').hidden=false;$('friend-unlocked').hidden=true;
  $('access-code').value='';$('file-list').replaceChildren();$('friend-status').textContent='';
  $('download-empty').hidden=false;$('file-checkout').hidden=true;$('friend-checkout').hidden=true;$('file-browser').hidden=false;
  $('selection-quote-status').textContent='';
}
function capacity(){return visibleRows($('file-list'),'--file-row-height',5);}
function pageEntries(){return entries.slice(offset,offset+capacity());}
function renderFiles(){
  const count=capacity();offset=Math.min(offset,Math.max(0,entries.length-1));
  const nodes=pageEntries().map(file=>{
    const name=file.isDir&&file.path==='/链接导入'?'链接文件':file.name;
    const row=document.createElement('li'),container=document.createElement('div'),button=document.createElement('button'),checkbox=document.createElement('input');
    container.className='file-row';button.type='button';button.className='file-open';button.title=name;
    checkbox.type='checkbox';checkbox.className='file-checkbox';checkbox.setAttribute('aria-label','选择 '+name);checkbox.dataset.path=file.path;
    const state=selectionState(rules,file.path);checkbox.checked=state.checked;checkbox.indeterminate=file.isDir&&state.indeterminate;checkbox.disabled=busy;
    checkbox.addEventListener('change',()=>{rules=setSelection(rules,file.path,checkbox.checked);updateSelection();});
    const icon=document.createElement('span');icon.className='file-symbol';icon.textContent=file.isDir?'▰':'↓';icon.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='file-name';title.textContent=name;
    const meta=document.createElement('span');meta.className='file-size';meta.textContent=file.isDir?'文件夹':size(file.size);
    button.append(icon,title,meta);button.disabled=busy;
    if(file.isDir){
      button.setAttribute('aria-label','双击进入文件夹 '+name);button.addEventListener('dblclick',()=>load(file.path));
      button.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();load(file.path);}});
      const open=document.createElement('button');open.type='button';open.className='folder-open';open.textContent='进入 →';open.setAttribute('aria-label','进入文件夹 '+name);open.disabled=busy;open.addEventListener('click',()=>load(file.path));container.append(checkbox,button,open);
    }else{button.setAttribute('aria-label','选择文件 '+name);button.addEventListener('click',()=>{checkbox.checked=!checkbox.checked;checkbox.dispatchEvent(new Event('change'));});container.append(checkbox,button);}
    row.append(container);return row;
  });
  $('file-list').replaceChildren(...nodes);
  $('page-prev').disabled=busy||(page===1&&offset===0);$('page-next').disabled=busy||((page-1)*100+offset+count>=total);
  const first=(page-1)*100+offset+1,last=Math.min((page-1)*100+offset+count,(page-1)*100+entries.length);
  $('page-label').textContent=total?`${first}–${last} / ${total} 项`:'0 项';
  updateSelection();
}
async function load(nextPath='/',nextPage=1,propagate=false,fromEnd=false){
  if(busy)return;busy=true;setBusy('files',true);$('file-list').setAttribute('aria-busy','true');status('正在读取文件…');
  try{
    const data=await api('list',{path:nextPath,page:nextPage});path=nextPath;page=nextPage;closeTask();$('folder-refresh').disabled=false;
    $('library-unlock').hidden=true;$('friend-unlocked').hidden=!access;$('access-code').removeAttribute('aria-invalid');$('friend-status').textContent='';$('library-content').hidden=false;$('files-empty').hidden=true;
    $('folder-path').textContent=path==='/'?'共享文件':displayPath(path);$('folder-path').title=displayPath(path);
    $('folder-up').disabled=path==='/'||(guest&&/^\/链接导入\/share-[a-f0-9]{12}$/.test(path));
    entries=data.files;total=data.total;offset=0;
    const known=nextPage===1?{files:new Map(),total}:loadedFolders.get(path)||{files:new Map(),total};known.total=total;
    for(const file of entries)known.files.set(file.path,file);loadedFolders.set(path,known);document.body.dataset.checkoutOrigin='selection';$('file-browser').hidden=false;showWorkspace('files');
    if(!guest)clearPaymentSelection();$('file-checkout').hidden=false;syncCheckout();
    $('buy-share').hidden=!guest||!/^\/链接导入\/share-[a-f0-9]{12}(?:\/|$)/.test(path);
    $('download-all').hidden=guest||!access;$('download-all').disabled=!total;
    if(fromEnd)offset=Math.max(0,Math.floor((entries.length-1)/capacity())*capacity());
    status(total?`共 ${total} 项，默认全部勾选；双击文件夹进入，或点击“进入”。确认选择后${guest?'生成订单':'下载所选文件'}。`:'这个目录暂时没有文件，可返回上一级或解析分享链接。');
    return data;
  }catch(error){const message=error.name==='TimeoutError'?'连接超时，请稍后刷新。':error.message;status(message);if(audience()==='friend')$('friend-status').textContent=message;if(propagate)throw error;}
  finally{busy=false;setBusy('files',false);$('file-list').removeAttribute('aria-busy');renderFiles();}
}
$('library-unlock').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;const value=$('access-code').value.trim();if(!value){$('friend-status').textContent='请输入朋友访问码。';return;}
  setAudience('friend');access=value;
  const button=event.currentTarget.querySelector('button');button.disabled=true;$('friend-status').textContent='正在验证访问码…';
  try{const data=await load();if(data){setFriendVerified(true);$('friend-dialog').close();showWorkspace('import');status('朋友模式已启用。解析链接，选择文件，生成任务。');$('share-input').focus();}}finally{button.disabled=false;}
});
$('library-lock').addEventListener('click',()=>{setAudience('paid');$('friend-dialog').close();status('已退出朋友模式。');});
$('friend-browse').addEventListener('click',async()=>{resetSelection('/');await load('/');$('friend-dialog').close();});
document.addEventListener('tools:audience',()=>{lock();status(audience()==='paid'?'准备就绪，粘贴分享链接即可开始。':'请输入本站访问码，验证后免费使用。');showWorkspace('import');if(audience()==='friend')$('access-code').focus();});
$('folder-up').addEventListener('click',()=>load(path.slice(0,path.lastIndexOf('/'))||'/'));
$('folder-refresh').addEventListener('click',()=>{if(path)load(path,page);});
$('buy-share').addEventListener('click',()=>choosePaidSelection(selectionRoot,structuredClone(rules)));
$('download-all').addEventListener('click',()=>downloadFolder().catch(()=>{}));
$('file-select-all').addEventListener('change',event=>{rules=setSelection(rules,path,event.target.checked);renderFiles();});
$('file-select-none').addEventListener('click',()=>{rules=[{path:selectionRoot,selected:false}];renderFiles();});
$('file-select-everything').addEventListener('click',()=>{if(busy)return;for(const file of pageEntries())rules=setSelection(rules,file.path,true);renderFiles();});
$('page-prev').addEventListener('click',()=>{if(busy)return;if(offset>0){offset=Math.max(0,offset-capacity());renderFiles();}else if(page>1)load(path,page-1,false,true);});
$('page-next').addEventListener('click',()=>{if(busy)return;if(offset+capacity()<entries.length){offset+=capacity();renderFiles();}else if(page*100<total)load(path,page+1);});
new ResizeObserver(()=>renderFiles()).observe($('file-list'));
document.addEventListener('tools:view',event=>{if(event.detail==='files')renderFiles();});
$('direct-download').addEventListener('click',()=>{if(selected){saveTask(selected);$('download-feedback').textContent='已再次请求浏览器保存 '+selected.folder+'.cmd。请打开浏览器下载列表（Ctrl + J）查看；本站无法确认文件是否已保存。';}});
$('copy-download-order').addEventListener('click',()=>{const id=$('download-order-number').textContent;if(id)copyOrderId(id,'download-order-copy-status');});
$('download-reselect').addEventListener('click',()=>selectedOrder?reselectPaidOrder(selectedOrder):showWorkspace('files'));
$('aria2-download').addEventListener('click',()=>{if(selected){saveTask(selected,'aria2');$('download-feedback').textContent=mobileDevice()?'已保存 aria2 任务，请使用支持任务文件及自定义 User-Agent 的本地下载器打开；普通浏览器无法执行。':'已保存 aria2 任务。在任务文件所在目录运行：aria2c --input-file="'+selected.folder+'.aria2.txt"';}});
window.addEventListener('pagehide',lock);
function displayTask({task,files,name,order}){
  selectedOrder=order||null;$('download-kind').textContent=order?'已付款':'朋友任务';
  selected=prepareTask(task,files,location.origin);$('download-title').textContent=name;
  $('download-summary').textContent=`共 ${files.length} 个文件，保留子文件夹。文件由百度直达你的设备。`;
  const mobile=mobileDevice();
  $('download-feedback').textContent=mobile?'手机不能运行 CMD，请在 Windows 电脑继续。':`已请求浏览器保存 ${selected.folder}.cmd。未找到时点击“保存 CMD 任务”。本站无法确认文件是否已保存。`;
  $('download-order-reference').hidden=!order;$('download-order-number').textContent=order?.id||'';
  $('copy-download-order').hidden=!order;$('copy-download-order').className=mobile?'primary-button':'secondary-button';$('download-order-copy-status').textContent='';
  $('download-handoff').hidden=!mobile;$('windows-download-instructions').hidden=mobile;
  $('download-handoff-note').textContent=order?'订单已确认，请保留订单号。手机付款后可以在电脑恢复，无需再次付款。':'请在 Windows 10/11 电脑打开本站，使用朋友访问码重新进入，再选择文件下载。';
  $('download-handoff-steps').hidden=!order;$('download-site-address').textContent=location.origin+'/tools/';
  $('task-expiry').textContent='任务有效至 '+new Date(task.expiresAt).toLocaleString('zh-CN')+'。有效期内可重新生成，已购订单无需再次付款。';
  $('direct-download').hidden=mobile;$('direct-download').textContent='保存 CMD 任务 ↓';
  $('direct-download').className='primary-button';$('aria2-download').className='secondary-button';
  document.querySelector('.advanced-download-methods').open=false;
  document.querySelector('.mobile-download-help').open=mobile;
  status(mobile?'请在 Windows 电脑继续下载，手机订单可凭订单号恢复。':'下载任务已准备好，双击保存的 .cmd 文件即可批量下载。');showTask('download');if(!mobile)saveTask(selected);(mobile?(order?$('copy-download-order'):$('download-reselect')):$('direct-download')).focus({preventScroll:true});
}
async function downloadFolder(root=selectionRoot){
  if(busy||!access)return;busy=true;setBusy('files',true);const files=[],queue=[root],visited=new Set();let requests=0;
  try{
    while(queue.length){
      const folder=queue.shift();if(visited.has(folder))throw Error('目录重复，请重新加载。');visited.add(folder);
      let count=0,expected=null;
      for(let page=1;page<=1000;page++){
        if(++requests>2000)throw Error('文件夹过多，请选择较小范围下载。');
        const data=await api('list',{path:folder,page});
        if(!Array.isArray(data.files)||!Number.isInteger(data.total)||data.total<0||(expected!==null&&expected!==data.total))throw Error('文件清单已变化，请重试。');
        expected=data.total;count+=data.files.length;
        for(const file of data.files){if(!file.path.startsWith((folder==='/'?'':folder)+'/'))throw Error('文件路径无效。');if(file.isDir){if(isSelected(rules,file.path)||rules.some(rule=>rule.selected&&rule.path.startsWith(file.path+'/')))queue.push(file.path);}else if(isSelected(rules,file.path))files.push(file);}
        if(files.length>50000||queue.length>2000)throw Error('文件过多，请选择较小范围下载。');
        status(`正在准备全部文件，已找到 ${files.length} 个…`);
        if(count===expected)break;if(!data.files.length||count>expected||page===1000)throw Error('文件清单不完整，请重试。');
      }
    }
    if(!files.length)throw Error('当前文件夹没有可下载的文件。');
    const task=await api('task',{path:root});displayTask({task,files,name:'所选文件 · '+files.length+' 项'});
  }catch(error){status(error.message);throw error;}finally{busy=false;setBusy('files',false);}
}
const paymentReady=initPayments({onGuest(){
  setAudience('paid',{silent:true});access='';guest=true;path='';selected=null;entries=[];total=0;offset=0;
  $('access-code').value='';$('library-unlock').hidden=true;$('friend-unlocked').hidden=true;$('library-content').hidden=true;$('files-empty').hidden=false;
  $('file-list').replaceChildren();$('folder-path').textContent='请先粘贴自己的分享链接';$('folder-up').disabled=true;$('folder-refresh').disabled=true;
  status('解析链接不收费，请勾选文件后生成订单。');
},onTask:displayTask,async onReselect(order){
  const root=/^\/链接导入\/share-[a-f0-9]{12}(?=\/|$)/.exec(order.path||'')?.[0];
  if(!root)throw Error('请重新解析原分享链接后选择文件。');
  resetSelection(root);quoteKey='';
  if(order.kind==='selection'&&order.selectionRules)rules=structuredClone(order.selectionRules);
  else if((order.kind||'file')==='file')rules=[{path:root,selected:false},{path:order.path,selected:true}];
  guest=true;await load(root,1,true);status('已恢复原选择。调整勾选后生成订单，原待支付订单不会自动付款。');
}});
export async function importShare(share){
  if(!access&&!guest){
    if(audience()==='friend'){openFriend();throw Error('请先验证朋友访问码。');}
    await paymentReady;await startPaidSession();
  }
  if(busy)throw Error('正在处理文件请求，请稍后再试。');
  busy=true;setBusy('files',true);status('正在验证分享并准备文件…');
  let result;try{result=await api('import',{link:share.link,code:share.code});}catch(error){status(error.message);throw error;}finally{busy=false;setBusy('files',false);}
  resetSelection(result.path);quoteKey='';selected=null;selectedOrder=null;clearPaymentSelection();$('download-detail').hidden=true;$('download-empty').hidden=false;
  try{await load(result.path,1,true);}catch{throw Error('文件已就绪，但暂时无法读取文件列表，请稍后刷新。');}
  return result;
}
