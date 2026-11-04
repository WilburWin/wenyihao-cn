import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSongs,rank,cleanVideo} from '../scripts/music-core.mjs';
test('parse preserves hyphens within titles and reports malformed lines',()=>{const p=parseSongs('A-B - Artist\nA-B - Artist\nbroken\n歌曲-歌手');assert.equal(p.songs.length,2);assert.equal(p.songs[0].title,'A-B');assert.equal(p.errors.length,1);assert.equal(p.songs[1].artist,'歌手');});
test('preferred uploader and version affect ranking',()=>{const s={title:'鲜花',artist:'回春丹'};const a=rank(s,[{title:'鲜花 回春丹 翻唱',author:'a',mid:'1'},{title:'鲜花 回春丹',author:'b',mid:'2'}],['2']);assert.equal(a[0].author,'b');assert.ok(a[0].score>a[1].score);});
test('video identifier must be valid',()=>{assert.equal(cleanVideo('https://www.bilibili.com/video/BV1B34y1h78S/'),'BV1B34y1h78S');assert.throws(()=>cleanVideo('javascript:alert(1)'));});
