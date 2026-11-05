import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoverLoader} from '../public/music/cover-loader.js';

function setup(){
  const requests=[];let observer;
  class ImageClass {set src(url){this.url=url;requests.push(this);}}
  class ObserverClass {
    constructor(callback){this.callback=callback;this.targets=new Set();observer=this;}
    observe(image){this.targets.add(image);}
    unobserve(image){this.targets.delete(image);}
    visible(){this.callback([...this.targets].map(target=>({target,isIntersecting:true})));}
  }
  const loader=createCoverLoader({ImageClass,ObserverClass,placeholder:'/placeholder.svg'});
  const tile=()=>({isConnected:true});
  return {loader,requests,tile,visible:()=>observer.visible()};
}

test('a viewport full of songs uses at most two cover connections, leaving room for audio',()=>{
  const {loader,requests,tile,visible}=setup();
  const images=Array.from({length:178},()=>tile());
  images.forEach((image,index)=>loader.set(image,'/cover/'+index));
  assert.equal(requests.length,0);visible();assert.equal(requests.length,2);
  loader.pause(true);requests[0].onload();requests[1].onload();
  assert.equal(requests.length,2,'resolving or buffering audio must not start queued covers');
  loader.pause(false);assert.equal(requests.length,4);
});

test('duplicate covers share a request and selection changes never apply stale artwork',()=>{
  const {loader,requests,tile}=setup();const a=tile(),b=tile();
  loader.set(a,'/cover/shared',{priority:true});loader.set(b,'/cover/shared',{priority:true});
  assert.equal(requests.length,1);
  loader.set(a,'/cover/new',{priority:true});requests[0].onload();
  assert.equal(b.src,'/cover/shared');assert.equal(a.src,'/placeholder.svg');
  requests[1].onerror();assert.equal(a.src,'/placeholder.svg');
  const c=tile();loader.set(c,'/cover/shared',{priority:true});
  assert.equal(requests.length,2);assert.equal(c.src,'/cover/shared');
});

test('removed rows are skipped and current artwork jumps ahead of queued rows',()=>{
  const {loader,requests,tile,visible}=setup();
  const rows=Array.from({length:6},()=>tile());
  rows.forEach((image,index)=>loader.set(image,'/row/'+index));visible();
  rows[2].isConnected=false;
  const current=tile();loader.set(current,'/playing',{priority:true});
  requests[0].onload();assert.equal(requests[2].url,'/playing');
  requests[1].onload();assert.equal(requests[3].url,'/row/3');
});
