/* Short layered ceramic-and-wood tile sounds, synthesized locally with Web Audio. */
(function(root){
"use strict";
let context;
function play(kind="tile",volume=.65){
  const Audio=root.AudioContext||root.webkitAudioContext;
  if(!Audio||volume<=0)return;
  try{
    context??=new Audio();
    if(context.state==="suspended")context.resume().catch(()=>{});
    const t=context.currentTime,level=Math.min(2,Math.max(0,volume));
    function impact(delay,weight){
      const start=t+delay,length=.09,buffer=context.createBuffer(1,Math.ceil(context.sampleRate*length),context.sampleRate),samples=buffer.getChannelData(0);
      for(let i=0;i<samples.length;i++){const x=i/context.sampleRate;samples[i]=(Math.random()*2-1)*Math.exp(-x*80);}
      const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
      source.buffer=buffer;filter.type="bandpass";filter.frequency.value=kind==="meld"?1180:1550;filter.Q.value=.65;
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(level*.46*weight,start+.002);gain.gain.exponentialRampToValueAtTime(.0001,start+.085);
      source.connect(filter).connect(gain).connect(context.destination);source.start(start);source.stop(start+length);
    }
    function body(delay,frequency,weight){
      const start=t+delay,osc=context.createOscillator(),gain=context.createGain();osc.type="sine";
      osc.frequency.setValueAtTime(frequency,start);osc.frequency.exponentialRampToValueAtTime(frequency*.57,start+.09);
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(level*.11*weight,start+.003);gain.gain.exponentialRampToValueAtTime(.0001,start+.13);
      osc.connect(gain).connect(context.destination);osc.start(start);osc.stop(start+.14);
    }
    impact(0,1);body(0,kind==="meld"?275:340,1);
    impact(kind==="meld"?.043:.028,.43);body(kind==="meld"?.043:.028,kind==="meld"?210:255,.48);
  }catch{/* Unsupported or restricted audio context: keep the game playable. */}
}
let victoryPlayer,victorySource,victoryGain,victoryBufferPromise,musicSerial=0;
function ensureContext(){const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)return null;context??=new Audio();return context;}
function loadVictory(){
  const ctx=ensureContext();if(!ctx||!root.fetch)return Promise.reject(Error("Web Audio 不可用"));
  victoryBufferPromise??=root.fetch("victory.mp3",{cache:"force-cache"}).then(r=>{if(!r.ok)throw Error("音乐文件不可用");return r.arrayBuffer();}).then(bytes=>ctx.decodeAudioData(bytes)).catch(e=>{victoryBufferPromise=null;throw e});
  return victoryBufferPromise;
}
function unlock(){try{const ctx=ensureContext();if(ctx?.state==="suspended")ctx.resume().catch(()=>{});loadVictory().catch(()=>{});}catch{}}
function stopVictory(){
  musicSerial++;
  if(victoryPlayer){victoryPlayer.pause();victoryPlayer.currentTime=0;victoryPlayer=null;}
  try{victorySource?.stop();}catch{}
  try{victorySource?.disconnect();victoryGain?.disconnect();}catch{}
  victorySource=null;victoryGain=null;
}
function setVolume(volume){const level=Math.min(2,Math.max(0,volume));if(victoryGain)victoryGain.gain.value=level;else if(victoryPlayer)victoryPlayer.volume=Math.min(1,level);}
function fallbackVictory(level,serial){
  if(serial!==musicSerial||!root.Audio)return;
  try{const audio=new root.Audio("victory.mp3");victoryPlayer=audio;audio.volume=Math.min(1,level);audio.play().catch(()=>{});audio.addEventListener("ended",()=>{if(victoryPlayer===audio)stopVictory();},{once:true});}catch{}
}
function victory(volume=.65){
  if(volume<=0)return;stopVictory();const serial=musicSerial,level=Math.min(2,Math.max(0,volume));
  loadVictory().then(buffer=>{
    if(serial!==musicSerial)return;
    const ctx=ensureContext(),source=ctx.createBufferSource(),gain=ctx.createGain();
    source.buffer=buffer;gain.gain.value=level;victorySource=source;victoryGain=gain;
    source.connect(gain).connect(ctx.destination);
    source.onended=()=>{if(victorySource===source)stopVictory();};
    source.start();
  }).catch(()=>fallbackVictory(level,serial));
}
root.MahjongSound={play,victory,unlock,stopVictory,setVolume};
})(window);
