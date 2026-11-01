(() => {
 const badge=document.createElement('span');badge.id='networkLatency';badge.className='network-latency';badge.textContent='网络 RTT · 未连接';badge.title='浏览器到 Cloudflare 房间服务的 WebSocket 往返时间，不含等待游戏事件的时间';
 document.getElementById('perfChip').append(badge);
 window.addEventListener('game-latency',e=>{const ms=Math.round(e.detail);badge.textContent=`网络 RTT · ${ms} ms`;badge.dataset.quality=ms<120?'fast':ms<250?'medium':'slow';});
})();
