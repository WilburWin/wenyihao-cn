const $=id=>document.getElementById(id);
const kinds={parse:'链接解析',download:'下载问题',payment:'支付问题',refund:'退款申请',suggestion:'功能建议',other:'其他问题'};
const statuses={open:'待处理',processing:'处理中',resolved:'已解决'};
let key='',cursors=[null],page=0,next=null,busy=false,version=0;
async function api(action,body){
 const response=await fetch('/api/tools/feedback/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok)throw Error(data.message||'操作失败。');return data;
}
const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
function render(items){
 $('feedback-admin-empty').hidden=items.length>0;$('feedback-admin-count').textContent='本页 '+items.length+' 条';
 $('feedback-admin-list').replaceChildren(...items.map(item=>{
  const article=document.createElement('article');article.className='feedback-admin-item';
  article.append(element('h2',kinds[item.kind]||'其他问题'),element('p',item.id,'feedback-receipt'),element('p','提交：'+date(item.createdAt)+' · 更新：'+date(item.updatedAt)),element('p','订单号（用户填写）：'+(item.orderId||'未提供')),element('p','联系方式：'+(item.contact||'未提供')),element('p',item.message,'feedback-admin-message'));
  const label=document.createElement('label'),select=document.createElement('select');label.textContent='处理状态';
  for(const [value,text]of Object.entries(statuses)){const option=new Option(text,value);select.append(option);}select.value=item.status;label.append(select);
  const noteLabel=document.createElement('label'),note=document.createElement('textarea');noteLabel.textContent='内部处理备注';note.rows=3;note.maxLength=2000;note.value=item.note||'';note.placeholder='仅站长可见，不会自动发送给用户';noteLabel.append(note);
  const save=element('button','保存处理结果','primary-button');save.type='submit';const feedback=element('p','');feedback.setAttribute('role','status');
  const form=document.createElement('form');form.className='feedback-form';form.append(label,noteLabel,save,feedback);article.append(form);
  form.addEventListener('submit',async event=>{
   event.preventDefault();const request=version;save.disabled=true;feedback.textContent='正在保存…';
   try{await api('update',{id:item.id,status:select.value,note:note.value});if(request===version)feedback.textContent='已保存。';}
   catch(error){if(request===version)feedback.textContent=error.message;}
   finally{save.disabled=false;}
  });return article;
 }));
 $('feedback-admin-prev').disabled=page===0;$('feedback-admin-next').disabled=!next;$('feedback-admin-page').textContent='第 '+(page+1)+' 页';
}
async function load(){
 if(busy)return false;busy=true;const request=version;$('feedback-admin-status').textContent='正在读取…';
 for(const id of ['feedback-admin-refresh','feedback-admin-prev','feedback-admin-next'])$(id).disabled=true;
 try{
  const data=await api('list',{cursor:cursors[page]});if(request!==version)return false;
  next=data.cursor;render(data.items);$('feedback-admin-login').hidden=true;$('feedback-admin-content').hidden=false;$('feedback-admin-status').textContent='';return true;
 }catch(error){if(request===version)$('feedback-admin-status').textContent=error.message;return false;}
 finally{if(request===version){busy=false;$('feedback-admin-refresh').disabled=false;$('feedback-admin-prev').disabled=page===0;$('feedback-admin-next').disabled=!next;}}
}
$('feedback-admin-file').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 try{if(file.size>4096)throw Error();const config=JSON.parse(await file.text());if(typeof config.key!=='string'||config.key.length<32)throw Error();$('feedback-admin-key').value=config.key;$('feedback-admin-status').textContent='管理配置已读取，请点击“查看反馈”。';}
 catch{$('feedback-admin-status').textContent='配置文件无效，请选择本机反馈管理配置。';}finally{event.target.value='';}
});
$('feedback-admin-login').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;key=$('feedback-admin-key').value.trim();const ok=await load();if(ok)$('feedback-admin-key').value='';else key='';});
$('feedback-admin-refresh').addEventListener('click',()=>load());
$('feedback-admin-prev').addEventListener('click',async()=>{if(busy||page===0)return;const request=version;page--;if(!await load()&&request===version){page++;$('feedback-admin-prev').disabled=page===0;$('feedback-admin-next').disabled=!next;}});
$('feedback-admin-next').addEventListener('click',async()=>{if(busy||!next)return;const request=version;cursors[page+1]=next;page++;if(!await load()&&request===version){page--;$('feedback-admin-prev').disabled=page===0;$('feedback-admin-next').disabled=!next;}});
function logout(){version++;key='';busy=false;page=0;next=null;cursors=[null];$('feedback-admin-key').value='';$('feedback-admin-list').replaceChildren();$('feedback-admin-content').hidden=true;$('feedback-admin-login').hidden=false;$('feedback-admin-status').textContent='';}
$('feedback-admin-logout').addEventListener('click',logout);window.addEventListener('pagehide',logout);
