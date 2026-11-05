import {createHash} from 'node:crypto';

export function uploaderTrackId(uid,bvid){
  return createHash('sha256').update('bili-uploader\0'+uid+'\0'+bvid).digest('hex').slice(0,16);
}

export function requestedTrack(url,catalog){
  const id=url.searchParams.get('id');
  const published=(catalog.tracks||[]).find(track=>track.confirmed&&track.id===id);
  if(published)return published;
  const uid=url.searchParams.get('uid'),bvid=url.searchParams.get('bvid');
  if(!/^\d+$/.test(uid||'')||!/^BV[\da-zA-Z]{10}$/.test(bvid||'')||
    !(catalog.playlists||[]).some(list=>list.uid===uid&&list.source==='live')||id!==uploaderTrackId(uid,bvid))return null;
  return {id,bvid,mid:uid,page:1,dynamic:true,title:'',artist:'',confirmed:true};
}

export function trackQuery(track){
  const query=new URLSearchParams({id:track.id});
  if(track.dynamic){query.set('uid',track.mid);query.set('bvid',track.bvid);}
  return query.toString();
}
