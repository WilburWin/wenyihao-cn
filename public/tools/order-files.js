const $=id=>document.getElementById(id);
const pageSize=30;
let current=null,page=0,query='',saving=false,version=0;
const size=bytes=>bytes>=1e9?(bytes/1e9).toFixed(2)+' GB':bytes>=1e6?(bytes/1e6).toFixed(2)+' MB':bytes>=1e3?(bytes/1e3).toFixed(1)+' KB':bytes+' B';
export function clearOrderFiles(){version++;current=null;saving=false;$('order-file-list').replaceChildren();}
function render(){
 if(!current)return;
 const filtered=current.files.filter(file=>file.label.toLocaleLowerCase().includes(query));
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,pages-1);
 $('order-file-list').replaceChildren(...filtered.slice(page*pageSize,(page+1)*pageSize).map(file=>{
  const row=document.createElement('li'),label=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span'),meta=document.createElement('small');
  input.type='checkbox';input.checked=current.selected.has(file.path);input.disabled=saving;input.dataset.filePath=file.path;
  name.textContent=file.label;name.className='order-file-name';meta.textContent=size(file.size);
  input.addEventListener('change',()=>{if(input.checked)current.selected.add(file.path);else current.selected.delete(file.path);summary();});
  label.append(input,name,meta);row.append(label);return row;
 }));
 $('order-file-empty').hidden=filtered.length>0;$('order-file-page').textContent=`${page+1} / ${pages} 页 · ${filtered.length} 个文件`;
 $('order-file-prev').disabled=saving||page===0;$('order-file-next').disabled=saving||page===pages-1;
 for(const id of ['order-file-search','order-file-all','order-file-none','order-file-back'])$(id).disabled=saving;
 summary();
}
function summary(){
 if(!current)return;let bytes=0;for(const file of current.files)if(current.selected.has(file.path))bytes+=file.size;
 $('order-file-summary').textContent=`已选 ${current.selected.size} / ${current.files.length} 个文件 · ${size(bytes)}`;
 $('order-file-generate').disabled=saving||current.selected.size===0;
 $('order-file-generate').textContent=saving?'正在生成任务…':`生成下载任务（${current.selected.size} 个文件）`;
}
export function chooseOrderFiles({files,root,kind,name,preferredPath,onGenerate,onBack}){
 clearOrderFiles();page=0;query='';$('order-file-search').value='';$('order-file-status').textContent='';$('order-file-title').textContent=name;
 current={files:files.map(file=>({...file,label:kind==='share'?file.path.slice(root.length+1):file.name})),selected:new Set(files.filter(file=>!preferredPath||file.path===preferredPath).map(file=>file.path)),onGenerate,onBack};
 render();$('order-file-search').focus();
}
$('order-file-search').addEventListener('input',()=>{query=$('order-file-search').value.trim().toLocaleLowerCase();page=0;render();});
$('order-file-all').addEventListener('click',()=>{if(current&&!saving){current.selected=new Set(current.files.map(file=>file.path));render();}});
$('order-file-none').addEventListener('click',()=>{if(current&&!saving){current.selected.clear();render();}});
$('order-file-prev').addEventListener('click',()=>{page--;render();});
$('order-file-next').addEventListener('click',()=>{page++;render();});
$('order-file-back').addEventListener('click',()=>{if(!saving)current?.onBack();});
$('order-file-generate').addEventListener('click',async()=>{
 if(!current||saving||!current.selected.size)return;
 const chosen=current,request=version,files=chosen.files.filter(file=>chosen.selected.has(file.path));saving=true;render();$('order-file-status').textContent='';
 try{await chosen.onGenerate(files);}
 catch(error){if(request===version)$('order-file-status').textContent=error.message+' 请重试，无需再次付款。';}
 finally{if(request===version){saving=false;render();}}
});
