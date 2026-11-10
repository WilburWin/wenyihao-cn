// Native <audio> requests need no fetch/CORS access to media bytes. Keep
// crossOrigin unset and use the music document's no-referrer policy.
export function directAudioSources(choice){
  return [...new Set((choice?.urls||[]).filter(value=>{
    try{
      const url=new URL(value);
      return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&
        ['bilivideo.com','bilivideo.cn','bilivideo.net'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host));
    }catch{return false;}
  }))].slice(0,3);
}

export function playbackSources(data,choice,origin){
  if(data.delivery==='direct'){
    const urls=directAudioSources(choice);
    if(!urls.length)throw Error('音频直连地址无效。');
    return urls;
  }
  if(data.delivery!=='relay')throw Error('播放接口版本已更新，请刷新页面。');
  const url=new URL(data.streamUrl,origin);
  if(url.origin!==origin||url.pathname!=='/api/music/audio')throw Error('音频地址无效。');
  url.searchParams.set('quality',String(choice.id));
  return [url.href];
}
