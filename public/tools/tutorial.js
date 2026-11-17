const dialog=document.getElementById('download-tutorial');
let opener=null;
for(const button of document.querySelectorAll('[data-tutorial-open]'))button.addEventListener('click',()=>{
  opener=button;dialog.showModal();document.getElementById('tutorial-title').focus({preventScroll:true});dialog.scrollTop=0;
});
for(const id of ['close-tutorial','tutorial-done'])document.getElementById(id).addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>opener?.focus({preventScroll:true}));
