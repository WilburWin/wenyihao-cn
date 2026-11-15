const $=id=>document.getElementById(id);
let sending=false,pending=null,receipt='';
function openFeedback(button){
 const order=button.hasAttribute('data-feedback-order')&&!$('payment-order-reference').hidden?$('payment-order-number').textContent.trim():'';
 if(order)$('feedback-order').value=order;
 $('feedback-dialog').showModal();$('feedback-kind').focus();
}
for(const button of document.querySelectorAll('[data-feedback-open]'))button.addEventListener('click',()=>openFeedback(button));
$('feedback-close').addEventListener('click',()=>{if(!sending)$('feedback-dialog').close();});
$('feedback-dialog').addEventListener('cancel',event=>{if(sending)event.preventDefault();});
$('feedback-form').addEventListener('input',()=>{pending=null;});
$('feedback-form').addEventListener('submit',async event=>{
 event.preventDefault();if(sending||!$('feedback-form').reportValidity())return;
 const values={kind:$('feedback-kind').value,orderId:$('feedback-order').value.trim(),contact:$('feedback-contact').value.trim(),message:$('feedback-message').value.trim(),website:$('feedback-website').value};
 pending??=crypto.randomUUID();sending=true;$('feedback-submit').disabled=true;$('feedback-close').disabled=true;$('feedback-status').textContent='正在提交…';
 for(const field of $('feedback-form').elements)field.disabled=true;
 try{
  const response=await fetch('/api/tools/feedback/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,requestId:pending}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw Error(data.message||'提交失败，请重试。');
  receipt=data.receipt.id;$('feedback-receipt').textContent=receipt;$('feedback-form').hidden=true;$('feedback-success').hidden=false;$('feedback-status').textContent='';
  $('feedback-receipt-copy').focus();pending=null;
 }catch(error){$('feedback-status').textContent=error.name==='TimeoutError'?'连接超时，内容已保留，可重试提交。':error instanceof TypeError?'网络连接失败，内容已保留，请稍后重试。':error.message;}
 finally{sending=false;for(const field of $('feedback-form').elements)field.disabled=false;$('feedback-close').disabled=false;}
});
$('feedback-receipt-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(receipt);$('feedback-copy-status').textContent='反馈编号已复制。';}catch{$('feedback-copy-status').textContent='请选中上方编号手动复制。';}
});
$('feedback-again').addEventListener('click',()=>{$('feedback-form').reset();$('feedback-form').hidden=false;$('feedback-success').hidden=true;$('feedback-copy-status').textContent='';receipt='';pending=null;$('feedback-kind').focus();});
