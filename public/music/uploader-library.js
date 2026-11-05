export function createUploaderLibrary(playlists,{fetcher=fetch,onTracks=()=>{},onChange=()=>{},random=Math.random}={}){
  const lists=playlists.map(list=>({...list,trackIds:[],pages:new Map(),pending:new Map(),total:null,pageSize:100,error:'',loading:false}));
  const get=id=>lists.find(list=>list.id===id);
  async function load(id,page=1){
    const list=get(id);if(!list)throw Error('UP 主歌单不存在。');
    if(list.pages.has(page))return list.pages.get(page);
    if(list.pending.has(page))return list.pending.get(page);
    list.loading=true;list.error='';onChange(list);
    const pending=(async()=>{
      try{
        const response=await fetcher('/api/music/uploaders?uid='+encodeURIComponent(list.uid)+'&page='+page,{signal:AbortSignal.timeout(20000)});
        const data=await response.json();
        if(!response.ok)throw Error(data.message||'暂时无法读取 UP 主投稿。');
        if(data.uid!==list.uid||!Array.isArray(data.tracks)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.pageSize)||data.pageSize<1)throw Error('投稿列表格式无效。');
        const tracks=data.tracks.filter(track=>track.dynamic&&track.mid===list.uid&&/^[a-f\d]{16}$/.test(track.id)&&/^BV[\da-zA-Z]{10}$/.test(track.bvid));
        list.total=data.total;list.pageSize=data.pageSize;list.pages.set(page,tracks);
        list.trackIds=[...new Set([...list.pages].sort(([a],[b])=>a-b).flatMap(([,items])=>items.map(track=>track.id)))];
        onTracks(tracks);return tracks;
      }catch(error){list.error=error.name==='TimeoutError'?'读取投稿超时，请重试。':error.message;throw Error(list.error);}
      finally{list.pending.delete(page);list.loading=list.pending.size>0;onChange(list);}
    })();
    list.pending.set(page,pending);return pending;
  }
  function nextPage(id){
    const list=get(id);if(!list)return null;
    if(list.total===null)return 1;
    for(let page=1;page<=Math.ceil(list.total/list.pageSize);page++)if(!list.pages.has(page))return page;
    return null;
  }
  async function at(id,index){
    const list=get(id);if(list.total===null)await load(id,1);
    if(!list.total)throw Error('这位 UP 主暂时没有可读取的公开视频。');
    const position=(index%list.total+list.total)%list.total,page=Math.floor(position/list.pageSize)+1;
    const tracks=await load(id,page);
    const track=tracks[position%list.pageSize];
    if(!track)throw Error('投稿列表发生变化，请重新打开歌单。');
    return track;
  }
  return {lists,get,load,nextPage,
    async randomTrack(id,current){
      const list=get(id);if(list.total===null)await load(id,1);
      const exclude=list.total>1&&current?.mid===list.uid&&Number.isInteger(current.uploadIndex)&&current.uploadIndex>=0&&current.uploadIndex<list.total;
      let index=Math.floor(random()*(list.total-(exclude?1:0)));
      if(exclude&&index>=current.uploadIndex)index++;
      return at(id,index);
    },
    async adjacentTrack(id,current,direction){return at(id,(current?.uploadIndex??-1)+direction);}
  };
}
