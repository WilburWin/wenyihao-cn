export function collectionTracks(tracks,{view='all',playlists=[],liked=new Set(),recent=[],defaultTrackIds}={}){
  const byId=new Map(tracks.map(track=>[track.id,track]));
  if(view==='liked')return tracks.filter(track=>liked.has(track.id));
  if(view==='recent')return recent.map(id=>byId.get(id)).filter(Boolean);
  if(view==='all')return defaultTrackIds?defaultTrackIds.map(id=>byId.get(id)).filter(Boolean):tracks;
  const playlist=playlists.find(item=>item.id===view);
  return (playlist?.trackIds||[]).map(id=>byId.get(id)).filter(Boolean);
}

export function shuffleTracks(tracks,currentId,random=Math.random){
  const queue=tracks.filter(track=>track.id!==currentId);
  for(let i=queue.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}
  return queue;
}
