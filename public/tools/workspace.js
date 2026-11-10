const $=id=>document.getElementById(id);
const busyReasons=new Set();
export const audience=()=>document.body.dataset.audience;
export function setAudience(value,{silent=false}={}){
  if(!['paid','friend'].includes(value))return;
  const changed=audience()!==value;document.body.dataset.audience=value;
  for(const button of document.querySelectorAll('[data-audience-choice]'))button.setAttribute('aria-pressed',String(button.dataset.audienceChoice===value));
  $('payment-entry').hidden=value!=='paid';$('friend-entry').hidden=value!=='friend';
  for(const el of document.querySelectorAll('[data-paid-copy]'))el.hidden=value!=='paid';
  for(const el of document.querySelectorAll('[data-friend-copy]'))el.hidden=value!=='friend';
  $('files-empty-action').textContent=value==='paid'?'去导入链接 →':'输入访问码 →';
  if(changed&&!silent)document.dispatchEvent(new CustomEvent('tools:audience',{detail:value}));
}
export function setBusy(reason,value){
  if(value)busyReasons.add(reason);else busyReasons.delete(reason);
  for(const button of document.querySelectorAll('[data-audience-choice]'))button.disabled=busyReasons.size>0;
}
export function showWorkspace(value){
  if(!['import','files','orders'].includes(value))return;
  for(const panel of document.querySelectorAll('[data-workspace-view]'))panel.hidden=panel.dataset.workspaceView!==value;
  for(const tab of document.querySelectorAll('[data-workspace-tab]')){const selected=tab.dataset.workspaceTab===value;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;}
  document.dispatchEvent(new CustomEvent('tools:view',{detail:value}));
}
export function showTask(value){
  const dialog=$('task-dialog');$('payment-checkout').hidden=value!=='payment';$('download-detail').hidden=value!=='download';$('share-detail').hidden=value!=='share';
  if(value==='share')$('share-detail').append($('share-result'));else restoreShare();
  $('task-heading').textContent=value==='payment'?'订单与支付':value==='share'?'分享详情':'获取下载地址';
  if(!dialog.open)dialog.showModal();
}
function restoreShare(){if($('share-detail').contains($('share-result')))document.querySelector('.import-guide').insertBefore($('share-result'),document.querySelector('.guide-foot'));}
export function closeTask(){if($('task-dialog').open)$('task-dialog').close();}
export function visibleRows(container,property,fallback){
  if(!container.clientHeight)return fallback;
  return Math.max(1,Math.floor(container.clientHeight/(Number.parseFloat(getComputedStyle(document.body).getPropertyValue(property))||60)));
}
for(const button of document.querySelectorAll('[data-audience-choice]'))button.addEventListener('click',()=>setAudience(button.dataset.audienceChoice));
for(const button of document.querySelectorAll('[data-workspace-tab]'))button.addEventListener('click',()=>showWorkspace(button.dataset.workspaceTab));
for(const button of document.querySelectorAll('[data-view-shortcut]'))button.addEventListener('click',()=>showWorkspace(button.dataset.viewShortcut));
const tabs=[...document.querySelectorAll('[data-workspace-tab]')];
document.querySelector('.workspace-tabs').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const index=tabs.indexOf(document.activeElement);if(index<0)return;event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].focus();showWorkspace(tabs[next].dataset.workspaceTab);
});
$('close-task').addEventListener('click',closeTask);
$('task-dialog').addEventListener('close',restoreShare);
$('share-details').addEventListener('click',()=>showTask('share'));
$('task-dialog').addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeTask();});
$('files-empty-action').addEventListener('click',()=>{if(audience()==='friend')$('access-code').focus();else{showWorkspace('import');$('share-input').focus();}});
if(location.hash==='#file-library')showWorkspace('files');
