const $=id=>document.getElementById(id);
const busyReasons=new Set();
export const audience=()=>document.body.dataset.audience;
export const workspace=()=>document.body.dataset.workspace||'import';
export function syncCheckout(){
  const friend=audience()==='friend'&&document.body.dataset.friendVerified==='true'&&document.body.dataset.checkoutOrigin!=='order';
  for(const el of document.querySelectorAll('[data-paid-copy]'))el.hidden=friend;
  for(const el of document.querySelectorAll('[data-friend-copy]'))el.hidden=!friend;
  $('friend-checkout').hidden=!friend||$('library-content').hidden;
}
export function setFriendVerified(value){
  document.body.dataset.friendVerified=String(value);
  $('friend-strip').hidden=!value;$('friend-toggle').textContent=value?'朋友模式':'朋友入口';
  const friend=value&&audience()==='friend';
  $('files-tab-label').textContent=friend?'选择文件':'选文件并支付';
  if(document.body.dataset.checkoutOrigin!=='order')$('library-title').textContent=friend?'选择文件':'选文件并支付';
  syncCheckout();
}
export function setAudience(value,{silent=false}={}){
  if(!['paid','friend'].includes(value))return;
  const changed=audience()!==value;document.body.dataset.audience=value;
  if(value==='paid')setFriendVerified(false);
  $('payment-entry').hidden=value!=='paid';
  $('files-empty-action').textContent=value==='paid'?'解析链接 →':'输入访问码 →';
  if(changed&&!silent)document.dispatchEvent(new CustomEvent('tools:audience',{detail:value}));
}
export function setBusy(reason,value){
  if(value)busyReasons.add(reason);else busyReasons.delete(reason);
  $('friend-toggle').disabled=busyReasons.size>0;$('friend-exit').disabled=busyReasons.size>0;
  $('file-browser').disabled=busyReasons.size>0;
}
export function showWorkspace(value){
  if(!['import','files','download','orders'].includes(value))return;
  const changed=workspace()!==value;document.body.dataset.workspace=value;
  for(const panel of document.querySelectorAll('[data-workspace-view]'))panel.hidden=panel.dataset.workspaceView!==value;
  for(const tab of document.querySelectorAll('[data-workspace-tab]')){const selected=tab.dataset.workspaceTab===value;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  document.dispatchEvent(new CustomEvent('tools:view',{detail:value}));
  if(changed){const top=document.querySelector('.workspace-tabs').getBoundingClientRect().top+scrollY-12;window.scrollTo({top:Math.max(0,top),behavior:'instant'});}
}
export function showTask(value){
  if(value==='payment'){
    closeTask();$('payment-checkout').hidden=false;$('file-checkout').hidden=false;
    const order=document.body.dataset.checkoutOrigin==='order';$('file-browser').hidden=order;syncCheckout();
    $('files-empty').hidden=order||!$('library-content').hidden;
    $('library-title').textContent=order?'订单与支付':audience()==='friend'?'选择文件':'选文件并支付';
    showWorkspace('files');return;
  }
  if(value==='download'){closeTask();$('download-empty').hidden=true;$('download-detail').hidden=false;showWorkspace('download');return;}
  const dialog=$('task-dialog');$('order-files').hidden=value!=='order-files';$('share-detail').hidden=value!=='share';
  if(value==='share')$('share-detail').append($('share-result'));else restoreShare();
  $('task-heading').textContent=value==='share'?'分享详情':'重新选择文件';
  if(!dialog.open)dialog.showModal();dialog.scrollTop=0;
}
function restoreShare(){if($('share-detail').contains($('share-result')))document.querySelector('.import-guide').insertBefore($('share-result'),document.querySelector('.guide-foot'));}
export function closeTask(){if($('task-dialog').open)$('task-dialog').close();$('order-files').hidden=true;$('share-detail').hidden=true;restoreShare();}
export function visibleRows(){return 12;}
export function openFriend(){const verified=document.body.dataset.friendVerified==='true';$('library-unlock').hidden=verified;$('friend-unlocked').hidden=!verified;if(!$('friend-dialog').open)$('friend-dialog').showModal();(verified?$('friend-continue'):$('access-code')).focus();}
for(const button of document.querySelectorAll('[data-friend-open]'))button.addEventListener('click',openFriend);
$('friend-close').addEventListener('click',()=>$('friend-dialog').close());
$('friend-exit').addEventListener('click',()=>setAudience('paid'));
$('friend-continue').addEventListener('click',()=>{$('friend-dialog').close();showWorkspace('import');$('share-input').focus();});
for(const button of document.querySelectorAll('[data-workspace-tab]'))button.addEventListener('click',()=>showWorkspace(button.dataset.workspaceTab));
for(const button of document.querySelectorAll('[data-view-shortcut]'))button.addEventListener('click',()=>showWorkspace(button.dataset.viewShortcut));
const tabs=[...document.querySelectorAll('[data-workspace-tab]')];
document.querySelector('.workspace-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].focus();showWorkspace(tabs[next].dataset.workspaceTab);
});
$('close-task').addEventListener('click',closeTask);$('task-dialog').addEventListener('close',restoreShare);
$('share-details').addEventListener('click',()=>showTask('share'));
$('files-empty-action').addEventListener('click',()=>{if(audience()==='friend')openFriend();else{showWorkspace('import');$('share-input').focus();}});
for(const button of document.querySelectorAll('[data-pricing-open]'))button.addEventListener('click',()=>$('pricing-dialog').showModal());
for(const button of document.querySelectorAll('[data-dialog-close]'))button.addEventListener('click',()=>button.closest('dialog').close());
if(location.hash==='#file-library')showWorkspace('files');
