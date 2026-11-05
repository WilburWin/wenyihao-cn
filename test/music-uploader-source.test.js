import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploaderSource} from '../worker/uploader-source.js';

test('upload source retrieves complete public pages using device cookies and respects actual pagination',async()=>{
  const requests=[];
  const source=createUploaderSource({fetcher:async(value,options)=>{
    const url=new URL(value);requests.push({url,options});
    if(url.pathname.endsWith('/spi'))return Response.json({code:0,data:{b_3:'test-device',b_4:'test-device-4'}});
    assert.equal(url.pathname,'/x/series/recArchivesByKeywords');
    assert.equal(url.searchParams.get('mid'),'11');assert.equal(url.searchParams.get('keywords'),'');
    assert.match(options.headers.Cookie,/buvid3=test-device/);
    return Response.json({code:0,data:{page:{total:1,size:100},archives:[{bvid:'BV1B34y1h78S',title:'Upload',duration:120}]}});
  }});
  const result=await source('11',1);
  assert.equal(result.total,1);assert.equal(result.pageSize,100);assert.equal(result.videos[0].mid,'11');
  assert.equal(result.videos[0].seconds,120);assert.equal(result.videos[0].page,1);
  await source('11',2);assert.equal(requests.filter(r=>r.url.pathname.endsWith('/spi')).length,1);
  await assert.rejects(source('invalid',1),/UID/);
});

test('upload source stops on risk responses without repeated requests or authenticated fallback',async()=>{
  let calls=0;
  const source=createUploaderSource({fetcher:async()=>{calls++;return new Response('blocked',{status:412});}});
  await assert.rejects(source('11',1),/HTTP 412/);assert.equal(calls,1);
});
