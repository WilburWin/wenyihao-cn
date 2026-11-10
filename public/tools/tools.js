import {parseBaiduShare} from './baidu-share.js';
import {importShare} from './downloads.js';
import {setBusy} from './workspace.js';

const $=id=>document.getElementById(id);
const form=$('share-form'),input=$('share-input'),code=$('share-code');
let current=null;
let importing=false;
function clearResult(){
  current=null;$('empty-result').hidden=false;$('share-result').hidden=true;
  $('share-details').hidden=true;
  $('result-label').textContent='等待输入';$('open-share').removeAttribute('href');
  $('result-link').textContent='';$('result-code').textContent='—';$('copy-status').textContent='';
}
function clearValidation(){
  input.removeAttribute('aria-invalid');code.removeAttribute('aria-invalid');
  $('access-code').removeAttribute('aria-invalid');
  $('form-status').textContent='';$('form-status').classList.remove('success');
}
form.addEventListener('submit',async event=>{
  event.preventDefault();if(importing)return;
  clearResult();clearValidation();
  try{
    current=parseBaiduShare(input.value,code.value);
    $('result-link').textContent=current.link;$('result-code').textContent=current.code||'未提供';
    $('open-share').href=current.openUrl;$('empty-result').hidden=true;$('share-result').hidden=false;
    $('share-details').hidden=false;
    $('result-label').textContent='正在转存';
    $('result-note').textContent='正在验证分享，转存完成后会打开对应文件。';
    // Keep the source and editable override distinct so a new pasted share cannot inherit an old code.
    $('form-status').textContent='正在解析并转存，请保持页面打开…';
    importing=true;setBusy('import',true);for(const field of form.querySelectorAll('button,input,textarea'))field.disabled=true;
    const result=await importShare(current);
    $('result-label').textContent=result.reused?'已找到导入文件':'转存完成';
    $('result-note').textContent='文件已放入“链接导入”目录，请在文件区下载。';
    $('form-status').textContent=result.reused?'已使用之前导入的文件，没有重复转存。':'转存完成，已打开导入目录。';
    $('form-status').classList.add('success');
  }catch(error){
    $('form-status').classList.remove('success');$('form-status').textContent=error.message;
    $('result-label').textContent='未完成转存';$('result-note').textContent=error.message;
    const field=/本站访问码|朋友访问码|访问码不正确/.test(error.message)?$('access-code'):/提取码/.test(error.message)?code:!current?input:null;
    field?.setAttribute('aria-invalid','true');
  }finally{importing=false;setBusy('import',false);for(const field of form.querySelectorAll('button,input,textarea'))field.disabled=false;document.querySelector('#main [aria-invalid="true"]')?.focus();}
});
for(const field of [input,code])field.addEventListener('input',()=>{clearResult();clearValidation();});
form.addEventListener('reset',()=>{clearResult();clearValidation();input.focus();});
$('paste').addEventListener('click',async()=>{
  clearValidation();
  try{
    const value=await navigator.clipboard.readText();
    if(!value.trim())throw Error();
    input.value=value;code.value='';clearResult();input.focus();
    $('form-status').textContent='已粘贴，请点击“解析并转存”。';
  }catch{
    $('form-status').classList.remove('success');
    $('form-status').textContent='无法读取剪贴板，请在输入框长按粘贴或使用 Ctrl / ⌘ + V。';input.focus();
  }
});
async function copy(value){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);return;}catch{}}
  const helper=document.createElement('textarea');helper.value=value;helper.readOnly=true;
  helper.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(helper);
  const previous=document.activeElement;helper.select();
  try{if(!document.execCommand('copy'))throw Error('Copy unavailable');}finally{helper.remove();previous?.focus();}
}
$('copy-share').addEventListener('click',async()=>{
  if(!current)return;
  try{await copy(current.shareText);$('copy-status').textContent='已复制链接'+(current.code?'和提取码':'')+'。';}
  catch{$('copy-status').textContent='复制失败，请选中上方地址后手动复制。';}
});
