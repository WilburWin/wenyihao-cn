import {createHash} from 'node:crypto';
export function parseSongs(source){const songs=[],errors=[];for(const [i,line] of source.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){const raw=line.trim();if(!raw)continue;let at=raw.lastIndexOf(' - '),width=3;if(at<0){at=raw.lastIndexOf('-');width=1;}if(at<1||!raw.slice(at+width).trim()){errors.push({line:i+1,text:raw});continue;}const title=raw.slice(0,at).trim(),artist=raw.slice(at+width).trim(),id=createHash('sha256').update(title+'\0'+artist).digest('hex').slice(0,16);if(!songs.some(s=>s.id===id))songs.push({id,title,artist,candidates:[],selected:null,locked:false});}return {songs,errors};}
export function rank(song,items,preferred=[],titleKeywords=[]){const norm=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const keywords=[...new Set(titleKeywords.map(x=>String(x).trim()).filter(Boolean))];return items.map(item=>{let score=0;const reasons=[],t=norm(item.title),rawTitle=String(item.title).toLocaleLowerCase();if(t.includes(norm(song.title))){score+=60;reasons.push('歌名匹配');}const artists=song.artist.split(/\s*\/\s*/);if(artists.some(a=>t.includes(norm(a)))){score+=25;reasons.push('歌手匹配');}const priority=preferred.findIndex(x=>x===item.author||x===String(item.mid));if(priority>=0){score+=40-priority;reasons.push('优先UP主');}for(const keyword of keywords)if(rawTitle.includes(keyword.toLocaleLowerCase())){score+=30;reasons.push('标题关键词：'+keyword);}for(const v of ['翻唱','伴奏','Live','现场','加速','降调'])if(item.title.toLowerCase().includes(v.toLowerCase())&&!song.title.toLowerCase().includes(v.toLowerCase())){score-=20;reasons.push('注意版本：'+v);}return {...item,score,reasons};}).sort((a,b)=>b.score-a.score);}
export function cleanVideo(value){const m=String(value).match(/BV[0-9A-Za-z]{10}/);if(!m)throw Error('请输入有效的 BV 号或视频链接');return m[0];}

// Recover owner IDs for manually locked videos from saved search results.
// Names alone are not identities: two uploader accounts can share a name.
export function uploaderPlaylists(project,tracks){
  const owners=new Map();
  for(const song of project.songs||[]){
    for(const item of [...(song.candidates||[]),...(song.selected?[song.selected]:[])]){
      if(/^BV[\da-zA-Z]{10}$/.test(item.bvid||'')&&/^\d+$/.test(String(item.mid||''))){
        owners.set(item.bvid,{mid:String(item.mid),name:String(item.author||'')});
      }
    }
  }
  const result=[],seen=new Set();
  for(const value of project.preferred||[]){
    const key=String(value).trim();if(!key)continue;
    const known=[...owners.values()].filter(owner=>owner.mid===key||owner.name===key);
    const mids=[...new Set(known.map(owner=>owner.mid))];
    const mid=/^\d+$/.test(key)?key:mids.length===1?mids[0]:null;
    if(!mid||seen.has(mid))continue;
    seen.add(mid);
    const owner=known.find(item=>item.mid===mid);
    const ids=tracks.filter(track=>{
      const identity=track.mid?String(track.mid):owners.get(track.bvid)?.mid;
      return track.confirmed&&identity===mid;
    }).map(track=>track.id);
    result.push({id:'up-'+mid,uid:mid,title:owner?.name||'UP 主 '+mid,trackIds:ids});
  }
  return result;
}

export function liveUploaderCatalog(project,data){
  const defaultTrackIds=data.defaultTrackIds||data.tracks.map(track=>track.id);
  const previous=new Map(data.tracks.map(track=>[track.id,track]));
  const tracks=defaultTrackIds.map(id=>previous.get(id)).filter(Boolean);
  const playlists=uploaderPlaylists(project,tracks).map(({trackIds,...owner})=>({...owner,source:'live',trackIds:[]}));
  return {...data,tracks,defaultTrackIds,playlists};
}
