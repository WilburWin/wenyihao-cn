import {showWorkspace,showTask,visibleRows,setBusy} from './workspace.js';
import {chooseOrderFiles,clearOrderFiles} from './order-files.js';
const $=id=>document.getElementById(id);
let settings={enabled:false,configured:false},callbacks={},active=null,file=null,poll,busy=false,delivering=false;
let orders=[],orderOffset=0,guestRequest=null,restoring=false;
let pendingDelete=null,deleting=false;
const hiddenOrders=new Set();
const money=value=>'¥'+(value/100).toFixed(2);
const rootFor=path=>/^\/链接导入\/share-[a-f0-9]{12}(?=\/|$)/.exec(path||'')?.[0];
function priceDisplay(amount,kind='file',details=''){
 $('checkout-price-label').textContent=kind==='share'?'整条链接下载授权':'本次文件下载授权';
 $('checkout-amount').textContent=money(amount);$('create-order').textContent='创建订单 · '+money(amount);
 $('checkout-terms').textContent=(kind==='share'?'付款后 24 小时内，当前浏览器可获取此链接内已核对文件的下载地址。':'付款后 24 小时内，当前浏览器可为同一文件重取地址。')+'失败重试不另收费，速度与地址有效期由百度决定。'+details;
}
const status=text=>{$('payment-status').textContent=text;};
async function api(action,body={}){
 const response=await fetch('/api/tools/payments/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(['quote','order'].includes(action)?95000:30000)});
 const data=await response.json();if(!response.ok)throw Error(data.message||'订单请求失败。');return data;
}
async function copyOrderId(id,feedback='orders-status'){
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
 if(!value)return;const url=new URL(value);if(url.origin!==location.origin||url.pathname!=='/api/tools/payments/checkout'||!/^DL[a-f0-9]{32}$/.test(url.searchParams.get('id')||''))throw Error('支付地址未通过校验。');$('alipay-checkout').href=url.href;$('alipay-checkout').hidden=false;
}
export function clearPaymentSelection(){stop();clearOrderFiles();active=null;file=null;$('payment-checkout').hidden=true;}
export function choosePaidFile(value){
 const covering=orders.find(order=>order.kind==='share'&&value.path.startsWith(order.path+'/')&&!order.refundPending&&((['paid','fulfilled'].includes(order.status)&&order.retryUntil>Date.now())||(order.status==='pending'&&order.expiresAt>Date.now())));
 if(covering){clearPaymentSelection();file=value;showOrder(covering);if(['paid','fulfilled'].includes(covering.status))retrieve({choose:true,preferredPath:value.path});else check(false);return;}
 clearPaymentSelection();file=value;$('payment-file').textContent=value.name;$('payment-checkout').hidden=false;
 priceDisplay(50);$('buy-whole-link').hidden=!rootFor(value.path);$('buy-whole-link').disabled=false;
 $('create-order').hidden=false;$('create-order').disabled=false;$('alipay-checkout').hidden=true;$('check-order').hidden=true;$('retrieve-order').hidden=true;
 $('payment-order-number').textContent='';$('payment-order-reference').hidden=true;$('payment-copy-status').textContent='';status('支付前会先核对文件能否取得下载地址。');showTask('payment');
}
export async function choosePaidShare(path){
 if(busy)return;const root=rootFor(path);if(!root)throw Error('请先解析一条分享链接。');
 busy=true;clearPaymentSelection();const chosen={kind:'share',path:root};file=chosen;
 $('payment-file').textContent='正在统计链接内的文件…';$('payment-checkout').hidden=false;$('create-order').hidden=true;$('alipay-checkout').hidden=true;$('check-order').hidden=true;$('retrieve-order').hidden=true;$('buy-whole-link').hidden=true;$('payment-order-reference').hidden=true;
 priceDisplay(0,'share');status('正在统计全部文件及子文件夹，请稍候；此时不会收费。');showTask('payment');
 try{
  const data=await api('quote',{path:root});if(file!==chosen)return;
  const quote=data.quote;Object.assign(chosen,{quoteId:quote.id,name:quote.name,priceCents:quote.priceCents});
  $('payment-file').textContent=quote.name;priceDisplay(quote.priceCents,'share',` 共 ${quote.fileCount} 个文件，总大小 ${(quote.size/1e9).toLocaleString('zh-CN',{maximumFractionDigits:3})} GB。按 1GB＝10亿字节计算。`);
  $('create-order').hidden=false;$('create-order').disabled=false;status('已统计完整链接，确认金额后再创建订单。');
 }catch(error){status(error.message);}finally{busy=false;}
}
function showOrder(order,reveal=true){
 if(hiddenOrders.has(order.id))return;
 const index=orders.findIndex(value=>value.id===order.id);if(index<0)orders.unshift(order);else orders[index]=order;renderOrders();
 active=order;$('payment-file').textContent=order.name;
 priceDisplay(order.priceCents,order.kind,order.kind==='share'?` 共 ${order.fileCount} 个文件，总大小 ${(order.size/1e9).toLocaleString('zh-CN',{maximumFractionDigits:3})} GB。`:'');$('buy-whole-link').hidden=true;
 $('payment-order-number').textContent=order.id;$('payment-order-reference').hidden=false;$('payment-copy-status').textContent='';$('create-order').hidden=true;
 const paid=['paid','fulfilled'].includes(order.status)&&!order.refundPending,closed=['closed','refunded'].includes(order.status)||order.refundPending;
 $('retrieve-order').hidden=!paid;$('check-order').hidden=paid||closed;
 if(paid||closed){stop();$('alipay-checkout').hidden=true;$('alipay-checkout').removeAttribute('href');}
 status(order.refundPending?'退款正在确认中，请稍后找回订单查看结果。':paid?'已确认到账，可获取下载地址。':closed?(order.status==='refunded'?'订单已退款。':'订单已关闭。'):Date.now()>order.expiresAt?'付款窗口已结束；若已经付款，请查询结果或联系站长。':'订单待支付；请前往支付宝完成付款，再查询结果。');
 if(reveal)showTask('payment');
}
async function retrieve({choose=false,preferredPath}={}){
 if(!active||delivering)return;delivering=true;const id=active.id;$('retrieve-order').disabled=true;status(choose?'正在读取已购文件，请稍候选择…':'正在准备全部已购文件的下载任务…');
 try{
  const files=[],seen=new Set();let total=null;
  for(let page=1;page<=500;page++){
   const data=await api('files',{id,page});if(active?.id!==id)return;
   if(!Array.isArray(data.files)||!Number.isInteger(data.total)||data.total<1||data.total>50000||(total!==null&&total!==data.total)||!data.files.length)throw Error('文件清单不完整，请重试。');
   for(const item of data.files){if(seen.has(item.path))throw Error('文件清单重复，请重试。');seen.add(item.path);}
   total=data.total;files.push(...data.files);status(`正在读取已购文件：${files.length} / ${total} 个文件…`);
   if(files.length===total)break;if(files.length>total||page===500)throw Error('文件清单不完整，请重试。');
  }
  if(active?.id!==id)return;
  const order=active;
  const generate=async chosen=>{
   const task=await api('task',{id});if(active?.id!==id)return;
   callbacks.onTask({task,files:chosen,name:order.name});status('所选文件的任务已保存，双击任务即可开始下载。');stop();
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
 try{const data=await api('status',{id});if(active?.id!==id)return;showOrder(data.order,$('task-dialog').open&&!$('payment-checkout').hidden);showCheckout(data.checkout);if(['paid','fulfilled'].includes(data.order.status)&&!data.order.refundPending&&auto)await retrieve();}
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
  const detail=document.createElement('small');detail.textContent=(order.kind==='share'?'整条链接':'单个文件')+' · '+money(order.priceCents);description.append(detail);
  const state=document.createElement('span');state.className='order-state';state.textContent=({pending:'待支付',paid:'已支付',fulfilled:'已取地址',closed:'已关闭',refunded:'已退款'}[order.status]||order.status)+' ↗';
  button.append(description,state);button.addEventListener('click',()=>{stop();file=null;$('alipay-checkout').hidden=true;showOrder(order);check(false);});
  const copy=document.createElement('button');copy.type='button';copy.className='order-copy';copy.title='复制订单号';copy.setAttribute('aria-label','复制订单号 '+order.id);
  const caption=document.createElement('span');caption.className='order-id-caption';caption.textContent='订单号';const number=document.createElement('code');number.textContent=order.id;
  const hint=document.createElement('span');hint.className='order-copy-hint';hint.textContent='复制';copy.append(caption,number,hint);copy.addEventListener('click',()=>copyOrderId(order.id));
  const remove=document.createElement('button');remove.type='button';remove.className='order-delete';remove.textContent='删除';remove.setAttribute('aria-label','删除订单记录 '+order.id);remove.addEventListener('click',()=>askDelete(order));
  entry.append(button,copy);item.append(entry,remove);return item;
 }));
 $('orders-prev').disabled=orderOffset===0;$('orders-next').disabled=orderOffset+count>=orders.length;
 $('orders-page').textContent=orders.length?`${orderOffset+1}–${Math.min(orderOffset+count,orders.length)} / ${orders.length} 笔`:'0 笔';
}
async function session(restore=false){
 const data=await api('session',{restore});if(!restore)callbacks.onGuest();renderOrders(data.orders);return data;
}
async function restoreOrders(){
 if(restoring||!settings.configured)return;restoring=true;const button=$('restore-orders');button.disabled=true;
 try{await session(true);$('orders-status').textContent=orders.length?'点击订单继续支付或重取下载地址。':'本浏览器没有找到订单；请确认使用下单时的浏览器，且未清除 Cookie。';}
 catch(error){$('orders-status').textContent=error.message;}finally{restoring=false;button.disabled=false;}
}
export async function startPaidSession(){
 if(!settings.enabled)throw Error(settings.message||'按次下载暂不可用，请稍后重试。');
 if(guestRequest)return guestRequest;
 setBusy('session',true);guestRequest=session();
 try{return await guestRequest;}finally{guestRequest=null;setBusy('session',false);}
}
export async function initPayments(options){
 callbacks=options;
 $('buy-whole-link').addEventListener('click',()=>{if(file)choosePaidShare(file.path);});
 $('copy-payment-order').addEventListener('click',()=>{if(active)copyOrderId(active.id,'payment-copy-status');});
 $('cancel-delete-order').addEventListener('click',()=>{if(!deleting){pendingDelete=null;$('delete-order-dialog').close();}});
 $('confirm-delete-order').addEventListener('click',deleteOrder);
 $('delete-order-dialog').addEventListener('cancel',event=>{if(deleting)event.preventDefault();else pendingDelete=null;});
 $('guest-start').addEventListener('click',()=>{showWorkspace('import');$('share-input').focus();});
 $('restore-orders').addEventListener('click',restoreOrders);
 $('orders-prev').addEventListener('click',()=>{orderOffset=Math.max(0,orderOffset-visibleRows($('order-list'),'--order-row-height',4));renderOrders();});
 $('orders-next').addEventListener('click',()=>{orderOffset+=visibleRows($('order-list'),'--order-row-height',4);renderOrders();});
 new ResizeObserver(()=>renderOrders()).observe($('order-list'));
 document.addEventListener('tools:view',event=>{if(event.detail==='orders'){renderOrders();restoreOrders();}});
 $('create-order').addEventListener('click',async()=>{
  if(!file||busy)return;busy=true;const chosen=file;const button=$('create-order');button.disabled=true;status('正在核对文件并创建订单…');
  try{
   const data=await api('order',{path:chosen.path,kind:chosen.kind||'file',...(chosen.quoteId?{quoteId:chosen.quoteId}:{}),requestId:crypto.randomUUID(),mobile:matchMedia('(max-width:700px)').matches});if(file!==chosen)return;
   hiddenOrders.delete(data.order.id);showOrder(data.order);
   showCheckout(data.checkout);
  }catch(error){if(file===chosen)status(error.message);}finally{busy=false;button.disabled=false;}
 });
 $('alipay-checkout').addEventListener('click',startPolling);
 $('check-order').addEventListener('click',()=>check(true));$('retrieve-order').addEventListener('click',()=>retrieve({choose:true}));
 window.addEventListener('pagehide',stop);
 try{
  const response=await fetch('/api/tools/payments/config',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();settings=await response.json();
  $('guest-start').disabled=!settings.enabled;$('guest-start').textContent=settings.enabled?'粘贴链接开始 →':'收款尚未开通';$('restore-orders').hidden=!settings.configured;
  $('payment-availability').textContent=settings.sandbox?'当前为支付宝沙箱测试，不收取真实资金。':settings.enabled?'按文件 ¥0.50 · 按链接 ¥1–5，解析免费。':settings.message;
  const id=new URL(location.href).searchParams.get('payment_order');if(id&&/^DL[a-f0-9]{32}$/.test(id)&&settings.configured){const data=await session(true),order=data.orders.find(x=>x.id===id);showWorkspace('orders');if(order){showOrder(order);await check(true);}history.replaceState(null,'',location.pathname+location.hash);}
 }catch{$('payment-availability').textContent='暂时无法读取收款状态，朋友访问码仍可使用。';}
}
