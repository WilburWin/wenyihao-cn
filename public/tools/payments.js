import {showWorkspace,showTask,visibleRows,setBusy,workspace} from './workspace.js';
import {chooseOrderFiles,clearOrderFiles} from './order-files.js';
const $=id=>document.getElementById(id);
const mobileDevice=()=>/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const mobileTrial=new URL(location.href).searchParams.get('mobile_payment')==='try';
let settings={enabled:false,configured:false},callbacks={},active=null,file=null,poll,busy=false,delivering=false;
let orders=[],orderOffset=0,guestRequest=null,restoring=false,recovering=false;
let pendingDelete=null,deleting=false;
let returning=false,resumeOrderId=null;
let paymentWindow=null,paymentWindowOrder=null;
const hiddenOrders=new Set();
const money=value=>'¥'+(value/100).toFixed(2);
const rootFor=path=>/^\/链接导入\/share-[a-f0-9]{12}(?=\/|$)/.exec(path||'')?.[0];
function priceDisplay(amount,kind='file',details=''){
 $('checkout-price-label').textContent=kind==='selection'?'勾选文件下载授权':kind==='share'?'整条链接下载授权':'本次文件下载授权';
 $('checkout-amount').textContent=money(amount);$('create-order').textContent='确认金额 · '+money(amount);
 $('checkout-terms').textContent=(kind==='selection'?'付款后 24 小时内，可下载此订单勾选的文件；重新选择仅限已购范围。':kind==='share'?'付款后 24 小时内，当前浏览器可获取此链接内已核对文件的下载地址。':'付款后 24 小时内，当前浏览器可为同一文件重取地址。')+'失败重试不另收费，速度与地址有效期由百度决定。'+details;
}
const status=text=>{$('payment-status').textContent=text;};
async function api(action,body={}){
 const response=await fetch('/api/tools/payments/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(['quote','order'].includes(action)?95000:30000)});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.message||'订单请求失败。'),{status:response.status});return data;
}
export async function copyOrderId(id,feedback='orders-status'){
 try{
  try{await navigator.clipboard.writeText(id);}catch{
   const field=document.createElement('textarea'),previous=document.activeElement;field.value=id;field.readOnly=true;field.style.cssText='position:fixed;left:-9999px;top:0';
   (previous?.closest('dialog')||document.body).append(field);field.select();
   try{if(!document.execCommand('copy'))throw Error();}finally{field.remove();previous?.focus({preventScroll:true});}
  }
  $(feedback).textContent='订单号已复制。';
 }catch{$(feedback).textContent='复制失败，请选中订单号手动复制。';}
}
function askDelete(order){
 if(deleting)return;pendingDelete=order;$('delete-order-file').textContent=order.name;$('delete-order-id').textContent=order.id;
 $('delete-order-note').textContent=order.status==='pending'?'若已打开支付宝收银台，删除记录后仍可能完成付款；请先核对支付状态。':'同一文件在 24 小时授权期内再次解析，仍可复用原订单，不会重复收费。';
 $('delete-order-error').textContent='';$('delete-order-dialog').showModal();$('cancel-delete-order').focus();
}
async function deleteOrder(){
 if(!pendingDelete||deleting)return;const id=pendingDelete.id;deleting=true;setBusy('delete-order',true);
 $('confirm-delete-order').disabled=true;$('cancel-delete-order').disabled=true;$('confirm-delete-order').textContent='正在删除…';$('delete-order-error').textContent='';
 try{
  await api('delete',{id});hiddenOrders.add(id);orders=orders.filter(order=>order.id!==id);
  if(active?.id===id)clearPaymentSelection();renderOrders();$('delete-order-dialog').close();pendingDelete=null;
  $('orders-status').textContent='订单记录已从列表删除；付款状态和已购授权不变。';
  ($('order-list').querySelector('.order-reopen')||$('restore-orders')).focus({preventScroll:true});
 }catch(error){$('delete-order-error').textContent=error.message;}
 finally{deleting=false;setBusy('delete-order',false);$('confirm-delete-order').disabled=false;$('cancel-delete-order').disabled=false;$('confirm-delete-order').textContent='确认删除记录';}
}
function stop(){clearInterval(poll);poll=null;}
function showCheckout(value){
 $('alipay-checkout').hidden=true;$('alipay-checkout').removeAttribute('href');
 if(!value)return;const url=new URL(value);if(url.origin!==location.origin||url.pathname!=='/api/tools/payments/checkout'||!/^DL[a-f0-9]{32}$/.test(url.searchParams.get('id')||''))throw Error('支付地址未通过校验。');$('alipay-checkout').href=url.href;$('alipay-checkout').target='_blank';$('alipay-checkout').textContent=active?.checkoutKind==='wap'?'打开支付宝付款 ↗':'打开支付小窗口 ↗';$('alipay-checkout').hidden=false;
}
function openPaymentWindow(event){
 if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 event.preventDefault();if(!active||!$('alipay-checkout').hasAttribute('href'))return;
 try{
  if(!paymentWindow||paymentWindow.closed||paymentWindowOrder!==active.id){
   const width=Math.min(520,screen.availWidth||520),height=Math.min(740,screen.availHeight||740);
   const left=Math.round((screen.availLeft||0)+((screen.availWidth||width)-width)/2),top=Math.round((screen.availTop||0)+((screen.availHeight||height)-height)/2);
   const popup=window.open('about:blank','_blank',`popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`);
   if(!popup)throw Error('popup blocked');
   // The cashier must not be able to navigate the original tools page.
   popup.opener=null;popup.location.replace($('alipay-checkout').href);paymentWindow=popup;paymentWindowOrder=active.id;
  }
  paymentWindow.focus();resumeOrderId=active.id;startPolling();
  status('请在支付窗口完成付款，本页会自动核对结果。窗口关闭后也可点击“查询付款”。');
 }catch{status('支付窗口未能打开。请允许本站弹出窗口，再点击付款；当前订单和页面已保留。');}
}
export function clearPaymentSelection(){stop();clearOrderFiles();active=null;file=null;$('payment-checkout').hidden=true;$('create-order').hidden=true;$('retry-quote').hidden=true;$('reselect-order').hidden=true;}
export function choosePaidFile(value){
 const covering=orders.find(order=>order.kind==='share'&&value.path.startsWith(order.path+'/')&&!order.refundPending&&((['paid','fulfilled'].includes(order.status)&&order.retryUntil>Date.now())||(order.status==='pending'&&order.expiresAt>Date.now())));
 if(covering){clearPaymentSelection();file=value;showOrder(covering);if(['paid','fulfilled'].includes(covering.status))retrieve({choose:true,preferredPath:value.path});else check(false);return;}
 clearPaymentSelection();file=value;$('payment-file').textContent=value.name;$('payment-checkout').hidden=false;
 priceDisplay(50);$('buy-whole-link').hidden=!rootFor(value.path);$('buy-whole-link').disabled=false;
 $('create-order').hidden=false;$('create-order').disabled=false;$('alipay-checkout').hidden=true;$('check-order').hidden=true;$('retrieve-order').hidden=true;
 $('payment-order-number').textContent='';$('payment-order-reference').hidden=true;$('payment-copy-status').textContent='';status('支付前会先核对文件能否取得下载地址。');showTask('payment');
}
export async function choosePaidShare(path){
 return choosePaidSelection(path);
}
export async function choosePaidSelection(path,rules){
 if(busy)return;const root=rootFor(path);if(!root)throw Error('请先解析一条分享链接。');
 clearPaymentSelection();document.body.dataset.checkoutOrigin='selection';const chosen={kind:rules?'selection':'share',path:root,...(rules?{rules:structuredClone(rules)}:{})};file=chosen;
 $('payment-file').textContent='正在统计链接内的文件…';$('payment-checkout').hidden=false;$('create-order').hidden=true;$('alipay-checkout').hidden=true;$('check-order').hidden=true;$('retrieve-order').hidden=true;$('buy-whole-link').hidden=true;$('payment-order-reference').hidden=true;
 priceDisplay(0,'share');$('checkout-amount').textContent='核价中…';status('正在核对所选文件和金额，此时不会收费。');showTask('payment');
 try{
  const data=await api('quote',{path:root,...(rules?{rules}: {})});if(file!==chosen)return;
  const quote=data.quote;Object.assign(chosen,{quoteId:quote.id,name:quote.name,priceCents:quote.priceCents});
  $('payment-file').textContent=quote.name;priceDisplay(quote.priceCents,chosen.kind,` 本次${rules?'勾选':'购买'} ${quote.fileCount} 个文件，总大小 ${(quote.size/1e9).toLocaleString('zh-CN',{maximumFractionDigits:3})} GB。按 1GB＝10亿字节计算。`);
  $('file-selection-summary').textContent=`已选 ${quote.fileCount} 个文件 · ${(quote.size/1e9).toLocaleString('zh-CN',{maximumFractionDigits:3})} GB`;
  $('create-order').hidden=false;$('create-order').disabled=false;status('金额已核对。确认后创建订单，再前往支付宝付款。');
 }catch(error){if(file===chosen){$('checkout-amount').textContent='—';status(error.message+' 可重新核价，此时不会收费。');$('retry-quote').hidden=false;}}
}
function showOrder(order,reveal=true){
 if(hiddenOrders.has(order.id))return;
 const index=orders.findIndex(value=>value.id===order.id);if(index<0)orders.unshift(order);else orders[index]=order;renderOrders();
 active=order;$('payment-file').textContent=order.name;
 $('payment-mobile-help').hidden=!mobileDevice();
 $('payment-mobile-help').textContent=/MicroMessenger/i.test(navigator.userAgent)?'微信内可能无法打开支付宝，请用系统浏览器打开本站后付款。':order.checkoutKind==='wap'?'点击付款后由支付宝收银台尝试打开支付宝 App；未唤起时可继续网页支付。':settings.mobileMode==='disabled'?'当前使用网页收银台，支付宝 App 唤起尚未开通。':'此订单沿用创建时的网页支付方式。';
 priceDisplay(order.priceCents,order.kind,['share','selection'].includes(order.kind)?` 共 ${order.fileCount} 个文件，总大小 ${(order.size/1e9).toLocaleString('zh-CN',{maximumFractionDigits:3})} GB。`:'');$('buy-whole-link').hidden=true;
 $('payment-order-number').textContent=order.id;$('payment-order-reference').hidden=false;$('payment-copy-status').textContent='';$('create-order').hidden=true;
 const paid=['paid','fulfilled'].includes(order.status)&&!order.refundPending,closed=['closed','refunded'].includes(order.status)||order.refundPending,expired=paid&&order.retryUntil<=Date.now();
 $('retrieve-order').hidden=!paid||expired;$('check-order').hidden=paid||closed;
 $('reselect-order').hidden=!(paid&&!expired||order.status==='pending'&&order.expiresAt>Date.now()&&!order.refundPending);
 if(paid||closed){stop();$('alipay-checkout').hidden=true;$('alipay-checkout').removeAttribute('href');}
 status(order.refundPending?'退款正在确认中，请稍后刷新订单查看结果。':expired?'此订单付款后的 24 小时下载有效期已结束。':paid?'已确认到账，下载有效至 '+new Date(order.retryUntil).toLocaleString('zh-CN')+'。':closed?(order.status==='refunded'?'订单已退款。':'订单已关闭。'):Date.now()>order.expiresAt?'付款窗口已结束；若已经付款，请查询结果或联系站长。':'订单待支付；请前往支付宝完成付款，再查询结果。');
 if(reveal){document.body.dataset.checkoutOrigin='order';showTask('payment');}
}
export async function reselectPaidOrder(order){if(!order||delivering)return;showOrder(order,false);await retrieve({choose:true});}
async function retrieve({choose=false,preferredPath}={}){
 if(!active||delivering)return;delivering=true;const id=active.id;$('retrieve-order').disabled=true;status(choose?'正在读取已购文件，请稍候选择…':'正在准备全部已购文件的下载任务…');
 try{
  const files=[],seen=new Set();let total=null;
  for(let page=1;page<=5000;page++){
   const data=await api('files',{id,page});if(active?.id!==id)return;
   if(!Array.isArray(data.files)||!Number.isInteger(data.total)||data.total<1||data.total>50000||(total!==null&&total!==data.total)||!data.files.length)throw Error('文件清单不完整，请重试。');
   for(const item of data.files){if(seen.has(item.path))throw Error('文件清单重复，请重试。');seen.add(item.path);}
   total=data.total;files.push(...data.files);status(`正在读取已购文件：${files.length} / ${total} 个文件…`);
   if(files.length===total)break;if(files.length>total||page===5000)throw Error('文件清单不完整，请重试。');
  }
  if(active?.id!==id)return;
  const order=active;
  const generate=async chosen=>{
   const task=await api('task',{id});if(active?.id!==id)return;
   callbacks.onTask({task,files:chosen,name:order.name,order});status('所选文件的任务已准备好，请按下载说明使用。');stop();
  };
  if(choose){
   showTask('order-files');chooseOrderFiles({files,root:order.path,kind:order.kind,name:order.name,preferredPath,onGenerate:generate,onBack:()=>showOrder(order)});
   status('勾选需要的文件后生成任务，无需再次付款。');
 }else await generate(files);
 }
 catch(error){if(active?.id===id)status(error.message+' 请使用此订单重试，无需重新付款。');}
 finally{delivering=false;$('retrieve-order').disabled=false;}
}
async function check(auto=false){
 if(!active||busy)return;busy=true;const id=active.id;$('check-order').disabled=true;
 try{const data=await api('status',{id});if(active?.id!==id)return;showOrder(data.order,workspace()==='files'&&!$('payment-checkout').hidden);showCheckout(data.checkout);if(['paid','fulfilled'].includes(data.order.status)&&!data.order.refundPending&&data.order.retryUntil>Date.now()&&auto)await retrieve();}
 catch(error){if(active?.id===id)status(error.message);stop();}
 finally{busy=false;$('check-order').disabled=false;}
}
function startPolling(){stop();let attempts=0;poll=setInterval(()=>{if(document.hidden)return;if(++attempts>18){stop();return;}check(true);},5000);}
function renderOrders(values){
 if(values){orders=values.filter(order=>!hiddenOrders.has(order.id));orderOffset=0;}
 $('recent-orders').hidden=orders.length===0;$('orders-empty').hidden=orders.length>0;
 const count=visibleRows($('order-list'),'--order-row-height',4);orderOffset=Math.min(orderOffset,Math.max(0,orders.length-1));
 $('order-list').replaceChildren(...orders.slice(orderOffset,orderOffset+count).map(order=>{
  const item=document.createElement('li'),entry=document.createElement('div'),button=document.createElement('button');item.className='order-item';entry.className='order-entry';button.type='button';button.className='order-reopen';button.title=order.name;
  const description=document.createElement('span');description.className='order-description';
  const name=document.createElement('strong');name.textContent=order.name;
  description.append(name);
  const detail=document.createElement('small');detail.textContent=(order.kind==='selection'?'勾选文件':order.kind==='share'?'整条链接':'单个文件')+' · '+money(order.priceCents)+(order.retryUntil?' · '+(order.retryUntil>Date.now()?'有效至 '+new Date(order.retryUntil).toLocaleString('zh-CN'):'24 小时已到期'):'');description.append(detail);
  const valid=['paid','fulfilled'].includes(order.status)&&!order.refundPending&&order.retryUntil>Date.now(),pending=order.status==='pending'&&!order.refundPending&&order.expiresAt>Date.now();
  const state=document.createElement('span');state.className='order-state';state.textContent=order.refundPending?'退款确认中':['paid','fulfilled'].includes(order.status)&&!valid?'已过期':({pending:'待付款',paid:'已付款',fulfilled:'已付款',closed:'已关闭',refunded:'已退款'}[order.status]||order.status);
  button.append(description,state);button.addEventListener('click',()=>{stop();file=null;$('alipay-checkout').hidden=true;showOrder(order);check(false);});
  const copy=document.createElement('button');copy.type='button';copy.className='order-copy';copy.title='复制订单号';copy.setAttribute('aria-label','复制订单号 '+order.id);
  const caption=document.createElement('span');caption.className='order-id-caption';caption.textContent='订单号';const number=document.createElement('code');number.textContent=order.id;
  const hint=document.createElement('span');hint.className='order-copy-hint';hint.textContent='复制';copy.append(caption,number,hint);copy.addEventListener('click',()=>copyOrderId(order.id));
  const remove=document.createElement('button');remove.type='button';remove.className='order-delete';remove.textContent='删除';remove.setAttribute('aria-label','删除订单记录 '+order.id);remove.addEventListener('click',()=>askDelete(order));
  const actions=document.createElement('div');actions.className='order-main-actions';
  if(valid||pending){const main=document.createElement('button');main.type='button';main.className='primary-button';main.textContent=valid?'下载 →':'继续付款 →';main.addEventListener('click',()=>{stop();file=null;if(valid){showOrder(order,false);retrieve();}else{showOrder(order);check(false);}});actions.append(main);}
  if(valid){const reselect=document.createElement('button');reselect.type='button';reselect.className='text-button';reselect.textContent='重新选择文件';reselect.addEventListener('click',()=>reselectPaidOrder(order));actions.append(reselect);}
  const detailButton=document.createElement('button');detailButton.type='button';detailButton.className='text-button order-detail-action';detailButton.textContent='详情';detailButton.addEventListener('click',()=>button.click());actions.append(detailButton);
  entry.append(button,actions,copy);item.append(entry,remove);return item;
 }));
 $('orders-prev').disabled=orderOffset===0;$('orders-next').disabled=orderOffset+count>=orders.length;
 $('orders-page').textContent=orders.length?`${orderOffset+1}–${Math.min(orderOffset+count,orders.length)} / ${orders.length} 笔`:'0 笔';
}
async function session(restore=false){
 const data=await api('session',{restore});if(!restore)callbacks.onGuest();renderOrders(data.orders);return data;
}
async function restoreOrders(){
 if(restoring||recovering||returning||!settings.configured)return;restoring=true;const button=$('restore-orders');button.disabled=true;
 try{await session(true);$('orders-status').textContent=orders.length?'点击订单继续支付或重新选择文件下载。':'本浏览器没有订单记录，可在上方输入订单号恢复下载。';}
 catch(error){$('orders-status').textContent=error.message;}finally{restoring=false;button.disabled=false;}
}
async function recoverOrder(event){
 event.preventDefault();if(recovering||restoring||returning||busy||delivering||!settings.configured)return;
 const input=$('recover-order-id'),value=input.value.trim();input.removeAttribute('aria-invalid');
 if(!/^DL[a-f0-9]{32}$/i.test(value)){input.setAttribute('aria-invalid','true');$('recover-order-status').textContent='请填写本站 DL 开头的完整订单号，共 34 位。';input.focus();return;}
 recovering=true;setBusy('recover-order',true);$('recover-order-submit').disabled=true;$('restore-orders').disabled=true;$('recover-order-status').textContent='正在核对付款状态与下载有效期…';
 try{
  const {order}=await api('recover',{id:value});clearPaymentSelection();hiddenOrders.delete(order.id);
  showOrder(order);$('payment-checkout').hidden=false;
  $('recover-order-status').textContent='订单已恢复，有效至 '+new Date(order.retryUntil).toLocaleString('zh-CN')+'；恢复不会延长有效期。';
  await retrieve({choose:true});
 }catch(error){$('recover-order-status').textContent=error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name)?'网络连接失败，请稍后重试；订单号已保留。':error.message;}
 finally{recovering=false;setBusy('recover-order',false);$('recover-order-submit').disabled=false;$('restore-orders').disabled=false;}
}
async function resumePaymentReturn(id){
 if(returning)return;returning=true;resumeOrderId=null;setBusy('payment-return',true);stop();
 $('recover-order-id').value=id;$('recover-order-submit').disabled=true;$('restore-orders').disabled=true;
 showWorkspace('orders');$('recover-order-status').textContent='正在核对原订单的支付结果，请勿重复下单…';
 try{
  let order;
  try{const data=await session(true);order=data.orders.find(item=>item.id===id);}catch(error){if(error.status!==401)throw error;}
  // The return URL identifies an order; only verified server state grants access.
  // Recovery handles an App returning through a different browser without cookies.
  if(!order)({order}=await api('recover',{id}));
  hiddenOrders.delete(id);showOrder(order);await check(true);
  $('recover-order-status').textContent='已返回原订单，支付与下载状态以查询结果为准。';
  if(active?.id===id&&active.status==='pending'){startPolling();$('recover-order-status').textContent='正在等待付款确认。若已付款，请稍后查询原订单，请勿重复下单。';}
 }catch(error){
  $('recover-order-status').textContent=(error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name)?'暂时无法连接订单服务。':error.message)+' 已保留原订单号；若已付款，请稍后点击“恢复下载”重试，请勿重复下单。';
 }finally{
  const url=new URL(location.href);url.searchParams.delete('payment_order');history.replaceState(null,'',url.pathname+url.search+url.hash);
  returning=false;setBusy('payment-return',false);$('recover-order-submit').disabled=false;$('restore-orders').disabled=false;
 }
}
export async function startPaidSession(){
 if(!settings.enabled)throw Error(settings.message||'按次下载暂不可用，请稍后重试。');
 if(guestRequest)return guestRequest;
 setBusy('session',true);guestRequest=session();
 try{return await guestRequest;}finally{guestRequest=null;setBusy('session',false);}
}
export async function initPayments(options){
 callbacks=options;
 $('retry-quote').addEventListener('click',()=>{if(file)choosePaidSelection(file.path,file.rules);});
 $('buy-whole-link').addEventListener('click',()=>{if(file)choosePaidShare(file.path);});
 $('copy-payment-order').addEventListener('click',()=>{if(active)copyOrderId(active.id,'payment-copy-status');});
 $('cancel-delete-order').addEventListener('click',()=>{if(!deleting){pendingDelete=null;$('delete-order-dialog').close();}});
 $('confirm-delete-order').addEventListener('click',deleteOrder);
 $('delete-order-dialog').addEventListener('cancel',event=>{if(deleting)event.preventDefault();else pendingDelete=null;});
 $('guest-start').addEventListener('click',()=>{showWorkspace('import');$('share-input').focus();});
 $('restore-orders').addEventListener('click',restoreOrders);
 $('recover-order-form').addEventListener('submit',recoverOrder);
 $('orders-prev').addEventListener('click',()=>{orderOffset=Math.max(0,orderOffset-visibleRows($('order-list'),'--order-row-height',4));renderOrders();});
 $('orders-next').addEventListener('click',()=>{orderOffset+=visibleRows($('order-list'),'--order-row-height',4);renderOrders();});
 new ResizeObserver(()=>renderOrders()).observe($('order-list'));
 document.addEventListener('tools:view',event=>{if(event.detail==='orders'){renderOrders();restoreOrders();}});
 $('create-order').addEventListener('click',async()=>{
  if(!file||busy)return;busy=true;setBusy('payment',true);const chosen=file;const button=$('create-order');button.disabled=true;status('正在核对文件并创建订单…');
  try{
   const data=await api('order',{path:chosen.path,kind:chosen.kind||'file',...(chosen.quoteId?{quoteId:chosen.quoteId}:{}),requestId:crypto.randomUUID(),mobile:mobileDevice(),...(mobileTrial?{mobileTrial:true}:{})});if(file!==chosen)return;
   hiddenOrders.delete(data.order.id);showOrder(data.order);
   showCheckout(data.checkout);
  }catch(error){if(file===chosen)status(error.message);}finally{busy=false;setBusy('payment',false);button.disabled=false;}
 });
 $('alipay-checkout').addEventListener('click',openPaymentWindow);
 $('check-order').addEventListener('click',()=>check(true));$('retrieve-order').addEventListener('click',()=>retrieve());
 $('reselect-order').addEventListener('click',async()=>{
  if(!active)return;
  if(['paid','fulfilled'].includes(active.status)){await retrieve({choose:true});return;}
  const order=active;$('reselect-order').disabled=true;
  try{await callbacks.onReselect?.(order);}catch(error){status(error.message);}finally{$('reselect-order').disabled=false;}
 });
 window.addEventListener('pagehide',stop);
 window.addEventListener('focus',()=>{if(resumeOrderId&&active?.id===resumeOrderId&&active.status==='pending'&&!returning)check(true);});
 window.addEventListener('pageshow',event=>{if(event.persisted&&resumeOrderId&&!returning)resumePaymentReturn(resumeOrderId);});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&resumeOrderId&&active?.id===resumeOrderId&&active.status==='pending'&&!returning)check(true);});
 const loadSettings=async()=>{
 $('payment-config-retry').disabled=true;$('payment-config-retry').hidden=true;
 try{
  const response=await fetch('/api/tools/payments/config',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();settings=await response.json();
  $('guest-start').disabled=!settings.enabled;$('guest-start').textContent=settings.enabled?'粘贴链接开始 →':'收款尚未开通';$('restore-orders').hidden=!settings.configured;
  $('recover-order-submit').disabled=!settings.configured;
  $('payment-availability').textContent=settings.sandbox?'当前为支付宝沙箱测试，不收取真实资金。':settings.enabled?'':settings.message;
  const id=new URL(location.href).searchParams.get('payment_order');if(id&&/^DL[a-f0-9]{32}$/.test(id)&&settings.configured)await resumePaymentReturn(id);
 }catch{
  settings={enabled:false,configured:false,message:'下载服务未连接，请点击“重新连接服务”后重试。'};
  $('guest-start').disabled=true;$('guest-start').textContent='等待重新连接';
  $('payment-availability').textContent='暂时无法连接服务。请点击“重新连接服务”，分享文字会保留；朋友访问码仍可使用。';$('payment-config-retry').hidden=false;
 }finally{$('payment-config-retry').disabled=false;}
 };
 $('payment-config-retry').addEventListener('click',loadSettings);
 return loadSettings();
}
