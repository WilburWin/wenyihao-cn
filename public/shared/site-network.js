(() => {
  if(location.origin!=='https://wenyihao.cn'||!('serviceWorker' in navigator))return;
  const warm=()=>navigator.serviceWorker.controller?.postMessage({type:'site-network-warm'});
  navigator.serviceWorker.addEventListener('controllerchange',warm);
  window.addEventListener('online',warm);
  navigator.serviceWorker.register('/site-network-sw.js',{scope:'/',type:'module',updateViaCache:'none'})
    .then(()=>navigator.serviceWorker.ready).then(warm).catch(()=>{});
  window.siteNetworkStatus=()=>new Promise(resolve=>{
    const controller=navigator.serviceWorker.controller;if(!controller){resolve({origin:location.origin,active:false});return;}
    const channel=new MessageChannel(),timeout=setTimeout(()=>{channel.port1.close();resolve({origin:location.origin,active:false});},2000);
    channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve({...event.data,active:true});};
    controller.postMessage({type:'site-network-status'},[channel.port2]);
  });
})();
