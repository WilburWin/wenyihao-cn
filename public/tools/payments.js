import {showWorkspace,showTask,visibleRows,setBusy} from './workspace.js';
const $=id=>document.getElementById(id);
let settings={enabled:false,configured:false},callbacks={},active=null,file=null,poll,busy=false,delivering=false;
let orders=[],orderOffset=0,guestRequest=null,restoring=false;
const status=text=>{$('payment-status').textContent=text;};
async function api(action,body={}){
 const response=await fetch('/api/tools/payments/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok)throw Error(data.message||'订单请求失败。');return data;
}
function stop(){clearInterval(poll);poll=null;}
function showCheckout(value){
 $('alipay-checkout').hidden=true;$('alipay-checkout').removeAttribute('href');
 if(!value)return;const url=new URL(value);if(url.origin!==location.origin||url.pathname!=='/api/tools/payments/checkout'||!/^DL[a-f0-9]{32}$/.test(url.searchParams.get('id')||''))throw Error('支付地址未通过校验。');$('alipay-checkout').href=url.href;$('alipay-checkout').hidden=false;
}
export function clearPaymentSelection(){stop();active=null;file=null;$('payment-checkout').hidden=true;}
export function choosePaidFile(value){
 clearPaymentSelection();file=value;$('payment-file').textContent=value.name;$('payment-checkout').hidden=false;
 $('create-order').hidden=false;$('create-order').disabled=false;$('alipay-checkout').hidden=true;$('check-order').hidden=true;$('retrieve-order').hidden=true;
 $('payment-order-number').textContent='';status('支付前会先核对文件能否取得下载地址。');showTask('payment');
}
function showOrder(order,reveal=true){
 const index=orders.findIndex(value=>value.id===order.id);if(index<0)orders.unshift(order);else orders[index]=order;renderOrders();
 active=order;$('payment-file').textContent=order.name;
 $('payment-order-number').textContent='订单号：'+order.id;$('create-order').hidden=true;
 const paid=['paid','fulfilled'].includes(order.status)&&!order.refundPending,closed=['closed','refunded'].includes(order.status)||order.refundPending;
 $('retrieve-order').hidden=!paid;$('check-order').hidden=paid||closed;
 if(paid||closed){stop();$('alipay-checkout').hidden=true;$('alipay-checkout').removeAttribute('href');}
 status(order.refundPending?'退款正在确认中，请稍后找回订单查看结果。':paid?'已确认到账，可获取下载地址。':closed?(order.status==='refunded'?'订单已退款。':'订单已关闭。'):Date.now()>order.expiresAt?'付款窗口已结束；若已经付款，请查询结果或联系站长。':'订单待支付；请前往支付宝完成付款，再查询结果。');
 if(reveal)showTask('payment');
}
async function retrieve(){
 if(!active||delivering)return;delivering=true;const id=active.id;$('retrieve-order').disabled=true;status('正在获取已购文件的下载地址…');
 try{const data=await api('download',{id});if(active?.id!==id)return;active={...active,status:'fulfilled'};const index=orders.findIndex(value=>value.id===id);if(index>=0)orders[index]=active;renderOrders();callbacks.onDownload(data);status('下载地址已准备好；文件由百度直接提供。');stop();}
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
 if(values){orders=values;orderOffset=0;}
 $('recent-orders').hidden=orders.length===0;$('orders-empty').hidden=orders.length>0;
 const count=visibleRows($('order-list'),'--order-row-height',4);orderOffset=Math.min(orderOffset,Math.max(0,orders.length-1));
 $('order-list').replaceChildren(...orders.slice(orderOffset,orderOffset+count).map(order=>{
  const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='order-reopen';button.title=order.name;
  const description=document.createElement('span');description.className='order-description';
  const name=document.createElement('strong');name.textContent=order.name;
  const meta=document.createElement('small');meta.textContent='¥0.50 · '+order.id;description.append(name,meta);
  const state=document.createElement('span');state.className='order-state';state.textContent=({pending:'待支付',paid:'已支付',fulfilled:'已取地址',closed:'已关闭',refunded:'已退款'}[order.status]||order.status)+' ↗';
  button.append(description,state);button.addEventListener('click',()=>{stop();file=null;$('alipay-checkout').hidden=true;showOrder(order);check(false);});item.append(button);return item;
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
 $('guest-start').addEventListener('click',()=>{showWorkspace('import');$('share-input').focus();});
 $('restore-orders').addEventListener('click',restoreOrders);
 $('orders-prev').addEventListener('click',()=>{orderOffset=Math.max(0,orderOffset-visibleRows($('order-list'),'--order-row-height',4));renderOrders();});
 $('orders-next').addEventListener('click',()=>{orderOffset+=visibleRows($('order-list'),'--order-row-height',4);renderOrders();});
 new ResizeObserver(()=>renderOrders()).observe($('order-list'));
 document.addEventListener('tools:view',event=>{if(event.detail==='orders'){renderOrders();restoreOrders();}});
 $('create-order').addEventListener('click',async()=>{
  if(!file||busy)return;busy=true;const chosen=file;const button=$('create-order');button.disabled=true;status('正在核对文件并创建订单…');
  try{
   const data=await api('order',{path:chosen.path,requestId:crypto.randomUUID(),mobile:matchMedia('(max-width:700px)').matches});if(file!==chosen)return;
   showOrder(data.order);
   showCheckout(data.checkout);
  }catch(error){if(file===chosen)status(error.message);}finally{busy=false;button.disabled=false;}
 });
 $('alipay-checkout').addEventListener('click',startPolling);
 $('check-order').addEventListener('click',()=>check(true));$('retrieve-order').addEventListener('click',retrieve);
 window.addEventListener('pagehide',stop);
 try{
  const response=await fetch('/api/tools/payments/config',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();settings=await response.json();
  $('guest-start').disabled=!settings.enabled;$('guest-start').textContent=settings.enabled?'粘贴链接开始 →':'收款尚未开通';$('restore-orders').hidden=!settings.configured;
  $('payment-availability').textContent=settings.sandbox?'当前为支付宝沙箱测试，不收取真实资金。':settings.enabled?'¥0.50 / 文件 · 导入不收费，付款后获取地址。':settings.message;
  const id=new URL(location.href).searchParams.get('payment_order');if(id&&/^DL[a-f0-9]{32}$/.test(id)&&settings.configured){const data=await session(true),order=data.orders.find(x=>x.id===id);showWorkspace('orders');if(order){showOrder(order);await check(true);}history.replaceState(null,'',location.pathname+location.hash);}
 }catch{$('payment-availability').textContent='暂时无法读取收款状态，朋友访问码仍可使用。';}
}
