import test from 'node:test';
import assert from 'node:assert/strict';
import {uploaderPlaylists,liveUploaderCatalog} from '../scripts/music-core.mjs';
import {collectionTracks,shuffleTracks} from '../public/music/library.js';

const tracks=[
  {id:'first',bvid:'BV1B34y1h78S',confirmed:true},
  {id:'second',bvid:'BV1kvNw6REcx',confirmed:true,mid:'22'},
  {id:'third',bvid:'BV1nh29YVEty',confirmed:true,mid:'11'},
  {id:'unconfirmed',confirmed:false,mid:'11'}
];
const project={preferred:['11','22','33','11'],songs:[
  {selected:{bvid:tracks[0].bvid,author:'Same name'},candidates:[{bvid:tracks[0].bvid,mid:'11',author:'Same name'}]},
  {selected:{bvid:tracks[1].bvid,mid:'22',author:'Same name'},candidates:[]}
]};

test('uploader grouping recovers manual selections by exact video UID and separates identical names',()=>{
  const groups=uploaderPlaylists(project,tracks);
  assert.equal(groups.length,3);
  assert.deepEqual(groups[0],{id:'up-11',uid:'11',title:'Same name',trackIds:['first','third']});
  assert.deepEqual(groups[1].trackIds,['second']);
  assert.deepEqual(groups[2].trackIds,[]);
  assert.equal(groups[2].uid,'33');
  assert.deepEqual(uploaderPlaylists({...project,preferred:['Same name']},tracks),[],'ambiguous account name must not merge UIDs');
});

test('unrelated candidates and unknown owners never get attributed by uploader name alone',()=>{
  const data={preferred:['11'],songs:[{selected:{bvid:tracks[0].bvid,author:'Preferred'},candidates:[{bvid:'BV0000000000',mid:'11',author:'Preferred'}]}]};
  assert.deepEqual(uploaderPlaylists(data,[tracks[0]])[0].trackIds,[]);
});

test('collection selection keeps uploader tracks, favorites, recent and original library independent',()=>{
  const playlists=uploaderPlaylists(project,tracks);
  assert.deepEqual(collectionTracks(tracks,{view:'up-11',playlists}).map(t=>t.id),['first','third']);
  assert.deepEqual(collectionTracks(tracks,{view:'up-22',playlists}).map(t=>t.id),['second']);
  assert.deepEqual(collectionTracks(tracks,{view:'liked',liked:new Set(['third'])}).map(t=>t.id),['third']);
  assert.deepEqual(collectionTracks(tracks,{view:'recent',recent:['missing','second','first']}).map(t=>t.id),['second','first']);
  assert.deepEqual(collectionTracks(tracks,{defaultTrackIds:['first']}).map(t=>t.id),['first']);
  assert.deepEqual(collectionTracks(tracks,{view:'unknown',playlists}),[]);
});

test('shuffle stays inside the selected uploader playlist and excludes the current song',()=>{
  const playlists=uploaderPlaylists(project,tracks);
  const group=collectionTracks(tracks,{view:'up-11',playlists});
  const shuffled=shuffleTracks(group,'first',()=>0);
  assert.deepEqual(shuffled.map(track=>track.id),['third']);
  assert.equal(new Set(shuffled.map(track=>track.id)).size,shuffled.length);
  assert.deepEqual(shuffleTracks([tracks[0]],'first'),[]);
  assert.deepEqual(shuffleTracks([],null),[]);
});

test('live uploader catalogs preserve the original collection and do not precompute uploads or counts',()=>{
  const base={title:'Original',tracks:tracks.slice(0,3)};
  const result=liveUploaderCatalog(project,base);
  assert.deepEqual(result.defaultTrackIds,['first','second','third']);
  assert.deepEqual(result.tracks,base.tracks);
  assert.equal(result.playlists[0].source,'live');
  assert.deepEqual(result.playlists[0].trackIds,[]);
  assert.equal(result.playlists[0].total,undefined);
  const secondPass=liveUploaderCatalog(project,result);
  assert.deepEqual(secondPass,result);
});
