import test from 'node:test';
import assert from 'node:assert/strict';
import {directAudioSources,playbackSources} from '../public/music/audio-source.js';

test('direct playback validates CDN destinations and never falls back to the site relay',()=>{
  const good='https://cdn.bilivideo.com/audio.m4s?deadline=123';
  const choices={id:30280,urls:[good,good,'http://cdn.bilivideo.com/a','https://cdn.bilivideo.com.evil.test/a','https://user@cdn.bilivideo.com/a','https://cdn.bilivideo.com:8080/a','https://backup.bilivideo.cn/a']};
  assert.deepEqual(directAudioSources(choices),[good,'https://backup.bilivideo.cn/a']);
  assert.deepEqual(playbackSources({delivery:'direct',streamUrl:'/api/music/audio'},choices,'https://example.com'),[good,'https://backup.bilivideo.cn/a']);
  assert.throws(()=>playbackSources({delivery:'direct',streamUrl:'/api/music/audio'},{urls:[]},'https://example.com'),/直连地址/);
  assert.throws(()=>playbackSources({streamUrl:'/api/music/audio'},choices,'https://example.com'),/刷新页面/);
});

test('explicit legacy relay responses stay same-origin and retain the selected quality',()=>{
  const data={delivery:'relay',streamUrl:'/api/music/audio?id=123'};
  const [source]=playbackSources(data,{id:30280},'https://example.com');
  assert.equal(source,'https://example.com/api/music/audio?id=123&quality=30280');
  assert.throws(()=>playbackSources({...data,streamUrl:'https://other.test/api/music/audio'},{id:1},'https://example.com'),/地址无效/);
});
