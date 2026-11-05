// Bound requests before assigning src. Native loading=lazy alone can enqueue
// dozens of nearby rows and starve audio on HTTP/1.1's per-origin connections.
export function createCoverLoader({ImageClass=globalThis.Image,ObserverClass=globalThis.IntersectionObserver,
  placeholder='/music/assets/cover-placeholder.svg',concurrency=2}={}){
  const states=new WeakMap(),jobs=new Map(),queue=[];
  let active=0,paused=false;
  const observer=ObserverClass?new ObserverClass(entries=>{
    for(const entry of entries)if(entry.isIntersecting){
      observer.unobserve(entry.target);enqueue(entry.target);
    }
  },{rootMargin:'80px'}):null;
  function apply(image,state,source){
    if(states.get(image)===state&&image.isConnected)image.src=source;
  }
  function enqueue(image,priority=false){
    const state=states.get(image);if(!state||!image.isConnected)return;
    let job=jobs.get(state.url);
    if(job?.done){apply(image,state,job.source);return;}
    if(!job){job={url:state.url,subscribers:new Map(),done:false};jobs.set(state.url,job);queue.push(job);}
    job.subscribers.set(image,state);
    if(priority){const index=queue.indexOf(job);if(index>=0){queue.splice(index,1);queue.unshift(job);}}
    pump();
  }
  function pump(){
    while(!paused&&active<concurrency&&queue.length){
      const job=queue.shift();
      for(const [image,state] of job.subscribers)if(!image.isConnected||states.get(image)!==state)job.subscribers.delete(image);
      if(!job.subscribers.size){jobs.delete(job.url);continue;}
      active++;
      const loader=new ImageClass();let finished=false;
      const finish=source=>{
        if(finished)return;finished=true;loader.onload=null;loader.onerror=null;
        job.done=true;job.source=source;active--;
        for(const [image,state] of job.subscribers)apply(image,state,source);
        job.subscribers.clear();pump();
      };
      loader.onload=()=>finish(job.url);loader.onerror=()=>finish(placeholder);
      loader.decoding='async';loader.fetchPriority='low';loader.src=job.url;
    }
  }
  return {
    set(image,url,{priority=false}={}){
      const previous=states.get(image);
      if(previous?.url===url)return;
      observer?.unobserve(image);
      states.set(image,{url});image.src=placeholder;
      if(url===placeholder)return;
      if(priority||!observer)enqueue(image,priority);else observer.observe(image);
    },
    pause(value){paused=Boolean(value);if(!paused)pump();}
  };
}
