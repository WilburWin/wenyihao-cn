// Login credentials and the QR polling key never enter frontend JavaScript.
(()=>{
  const find=id=>document.getElementById(id);
  const dialog=find('login-dialog'),login=find('bili-login'),logout=find('bili-logout');
  const generate=find('login-generate'),message=find('login-status'),image=find('login-image');
  let state={configured:false,loggedIn:false},controller=null,timer=null,expiresAt=0,generation=0;
  function stop(){generation++;clearTimeout(timer);timer=null;controller?.abort();controller=null;}
  function hideQR(){find('login-qr').hidden=true;image.removeAttribute('src');}
  function render(){
    login.textContent=state.loggedIn?state.user?.name||'已登录 B站':'登录 B站';
    login.title=state.loggedIn?'查看 B站登录状态':'使用 B站 App 扫码登录';
    logout.hidden=!state.loggedIn;
  }
  async function api(action,signal){
    const response=await fetch('/api/music/auth/'+action,{method:action==='status'?'GET':'POST',credentials:'same-origin',cache:'no-store',signal});
    const data=await response.json();
    if(!response.ok)throw Error(data.message||'登录服务暂不可用。');
    return data;
  }
  async function refresh(){
    try{state=await api('status');render();return true;}
    catch{login.title='登录服务暂不可用，点击查看';return false;}
  }
  function changed(){window.dispatchEvent(new Event('music-auth-changed'));}
  function ready(text){stop();hideQR();message.textContent=text;generate.disabled=false;generate.hidden=false;generate.textContent='重新生成二维码';}
  async function poll(serial){
    if(serial!==generation||!dialog.open)return;
    if(Date.now()>=expiresAt){ready('二维码已过期，请重新生成。');return;}
    try{
      const result=await api('poll',controller.signal);
      if(serial!==generation||!dialog.open)return;
      if(result.state==='success'){
        stop();hideQR();state={configured:true,loggedIn:true,user:result.user,expiresAt:result.expiresAt};render();
        message.textContent='登录成功，已重新获取账号可用音质。';generate.hidden=true;changed();return;
      }
      if(result.state==='expired'){ready(result.message||'二维码已失效，请重新生成。');return;}
      message.textContent=result.state==='scanned'?'已扫码，请在 B站 App 中确认登录。':'等待扫码，请使用 B站 App 扫一扫。';
      timer=setTimeout(()=>poll(serial),3000);
    }catch(error){if(serial===generation&&error.name!=='AbortError')ready(error.message||'登录中断，请稍后重试。');}
  }
  login.addEventListener('click',async()=>{
    stop();hideQR();generate.disabled=true;generate.hidden=false;generate.textContent='同意并生成二维码';
    message.textContent='正在读取登录状态…';dialog.showModal();
    const serial=generation;
    const available=await refresh();
    if(!dialog.open||serial!==generation)return;
    if(!available){message.textContent='暂时无法连接登录服务，请稍后重新打开窗口。';return;}
    if(state.loggedIn){message.textContent=`已以 ${state.user?.name||'B站用户'} 登录。Hi-Res 仅在接口实际提供且浏览器支持时显示。`;generate.hidden=true;}
    else if(!state.configured){message.textContent=state.configurationMessage||'站点尚未开启扫码登录：请在 Cloudflare 设置 MUSIC_SESSION_KEY 并部署。访客播放仍可使用。';}
    else{message.textContent='登录后会重新获取音质列表；Hi-Res 取决于音源、账号权限和浏览器支持。';generate.disabled=false;}
  });
  generate.addEventListener('click',async()=>{
    stop();hideQR();controller=new AbortController();const serial=generation;
    generate.disabled=true;message.textContent='正在向 B站申请二维码…';
    try{
      const result=await api('start',controller.signal);
      if(serial!==generation||!dialog.open)return;
      if(typeof result.qrImage!=='string'||!result.qrImage.startsWith('data:image/gif;base64,')||!Number.isFinite(result.expiresAt))throw Error('二维码无效，请稍后再试。');
      expiresAt=result.expiresAt;image.src=result.qrImage;find('login-qr').hidden=false;generate.hidden=true;
      message.textContent='等待扫码，请使用 B站 App 扫一扫。';timer=setTimeout(()=>poll(serial),3000);
    }catch(error){if(serial===generation&&error.name!=='AbortError')ready(error.message||'二维码生成失败，请稍后重试。');}
  });
  find('login-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{stop();hideQR();});
  logout.addEventListener('click',async()=>{
    stop();logout.disabled=true;login.disabled=true;
    window.dispatchEvent(new Event('music-auth-changing'));
    try{await api('logout');state={configured:state.configured,loggedIn:false};render();}
    catch(error){message.textContent=error.message;generate.hidden=true;hideQR();if(!dialog.open)dialog.showModal();}
    finally{logout.disabled=false;login.disabled=false;changed();}
  });
  window.addEventListener('music-auth-expired',()=>{state={configured:true,loggedIn:false};render();});
  window.addEventListener('pagehide',()=>{stop();if(dialog.open)dialog.close();});
  window.addEventListener('pageshow',refresh);
  refresh();
})();
