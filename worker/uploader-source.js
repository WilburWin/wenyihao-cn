import {BILIBILI_USER_AGENT} from './music-transport.js';

export function createUploaderSource({fetcher=fetch,now=Date.now}={}){
  let deviceCookie='',deviceExpires=0;
  async function getJson(path,params={},cookie=''){
    const url=new URL(path,'https://api.bilibili.com');url.search=new URLSearchParams(params).toString();
    const response=await fetcher(url.href,{headers:{'User-Agent':BILIBILI_USER_AGENT,Referer:'https://www.bilibili.com/',Accept:'application/json',...(cookie?{Cookie:cookie}:{})},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!response.ok){await response.body?.cancel();throw Error('B站接口 '+new URL(url).pathname+' HTTP '+response.status+'；本次读取已停止。');}
    const body=await response.json();
    if([-412,-352].includes(body.code))throw Error('B站风控 '+body.code+'；本次读取已停止。');
    return body;
  }
  return async function listVideos(uid,page=1){
    if(!/^\d+$/.test(uid)||!Number.isInteger(page)||page<1)throw Error('UID 或页码无效。');
    if(!deviceCookie||deviceExpires<=now()){
      const device=await getJson('/x/frontend/finger/spi');
      deviceCookie=[['buvid3',device.data?.b_3],['buvid4',device.data?.b_4]].filter(([,value])=>/^[A-Za-z0-9_-]{1,256}$/.test(value||'')).map(([key,value])=>key+'='+value).join('; ');
      if(!deviceCookie)throw Error('无法获取匿名设备标识。');
      deviceExpires=now()+12*3600000;
    }
    const body=await getJson('/x/series/recArchivesByKeywords',{mid:uid,pn:page,ps:100,keywords:'',orderby:'pubdate'},deviceCookie);
    if(body.code!==0)throw Error('投稿列表不可用：'+String(body.code)+' '+String(body.message||''));
    const total=body.data?.page?.total,pageSize=body.data?.page?.size;
    if(!Array.isArray(body.data?.archives)||!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(pageSize)||pageSize<0||(page>0&&pageSize<1))throw Error('投稿列表响应格式无效。');
    const videos=body.data.archives.filter(video=>/^BV[\da-zA-Z]{10}$/.test(video.bvid||'')).map(video=>({
      bvid:video.bvid,title:String(video.title||video.bvid),author:String(video.owner?.name||video.author||''),mid:String(video.owner?.mid||video.mid||uid),
      seconds:Number(video.duration)||0,page:1
    }));
    if(videos.some(video=>video.mid!==uid))throw Error('投稿列表返回了其他 UP 主的资源。');
    return {total,pageSize,videos};
  };
}

