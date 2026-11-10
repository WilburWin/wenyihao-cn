import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBaiduShare} from '../public/tools/baidu-share.js';

test('share text retains case-sensitive extraction code and strips tracking parameters',()=>{
  const result=parseBaiduShare('通过百度网盘分享的文件：资料\n链接: https://pan.baidu.com/s/1Ab_c-123?pwd=aB12&from=share&tracking=ignored\n提取码: aB12');
  assert.deepEqual(result,{link:'https://pan.baidu.com/s/1Ab_c-123',code:'aB12',openUrl:'https://pan.baidu.com/s/1Ab_c-123?pwd=aB12',shareText:'https://pan.baidu.com/s/1Ab_c-123 提取码：aB12'});
});
test('accepts canonical, old and omitted-scheme share formats',()=>{
  assert.equal(parseBaiduShare('pan.baidu.com/s/1abc').link,'https://pan.baidu.com/s/1abc');
  assert.equal(parseBaiduShare('https://yun.baidu.com/share/init?surl=abc&pwd=1234').openUrl,'https://pan.baidu.com/s/1abc?pwd=1234');
  assert.equal(parseBaiduShare('http://pan.baidu.com/share/link?uk=123&shareid=456&from=x').link,'https://pan.baidu.com/share/link?shareid=456&uk=123');
  assert.equal(parseBaiduShare('https://pan.baidu.com/s/1abc。提取码：aB12').code,'aB12');
  assert.equal(parseBaiduShare('https://pan.baidu.com/s/1abc').code,'');
});
test('never accepts arbitrary hosts, credentials, ports or unsupported Baidu paths',()=>{
  for(const value of ['https://pan.baidu.com.evil.test/s/1abc','https://pan.baidu.com@evil.test/s/1abc','javascript:alert(1)','https://127.0.0.1/s/1abc','https://pan.baidu.com:8443/s/1abc','https://evil.test@pan.baidu.com/s/1abc','https://pan.baidu.com/disk/home'])assert.throws(()=>parseBaiduShare(value));
});
test('conflicting codes require explicit override; multiple distinct links are rejected',()=>{
  assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1abc?pwd=1234 提取码：AbCd'),/不一致/);
  assert.equal(parseBaiduShare('https://pan.baidu.com/s/1abc?pwd=1234 提取码：AbCd','xY12').code,'xY12');
  assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1abc https://pan.baidu.com/s/1def'),/多条/);
  assert.equal(parseBaiduShare('https://pan.baidu.com/s/1abc https://pan.baidu.com/s/1abc?pwd=abcd').code,'abcd');
  assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1abc?pwd=12345'),/格式/);
  assert.throws(()=>parseBaiduShare('https://pan.baidu.com/s/1abc','字母12'),/4 位/);
  assert.throws(()=>parseBaiduShare('x'.repeat(4001)),/过长/);
  assert.throws(()=>parseBaiduShare('  '),/先粘贴/);
});
