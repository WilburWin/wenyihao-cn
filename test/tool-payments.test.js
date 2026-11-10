import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {ToolPayments,paymentSettings,cents,alipayClient} from '../worker/tool-payments.js';
import {safePath,safeDownload,DownloadBridge} from '../worker/downloads.js';
const merchant=generateKeyPairSync('rsa',{modulusLength:2048}),provider=generateKeyPairSync('rsa',{modulusLength:2048});
const env={TOOLS_PAYMENT_ENABLED:'true',PAYMENT_SITE_ORIGIN:'https://example.com',ALIPAY_ENV:'sandbox',ALIPAY_APP_ID:'2026000000000001',ALIPAY_SELLER_ID:'2088000000000001',ALIPAY_PRIVATE_KEY:merchant.privateKey.export({type:'pkcs8',format:'pem'}),ALIPAY_PUBLIC_KEY:provider.publicKey.export({type:'spki',format:'pem'})};
const path='/链接导入/share-123456abcdef/Example.txt';
function memory(){
 const rows=new Map();let queue=Promise.resolve();
 const storage={async get(k){return structuredClone(rows.get(k));},async put(k,v){rows.set(k,structuredClone(v));},async list(){return rows;},async delete(k){return rows.delete(k);},async setAlarm(){},transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};return storage;
}
function req(action,body={},cookie='',origin='https://example.com'){
 return new Request('https://example.com/api/tools/payments/'+action,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
function signedNotify(order,patch={}){
 const params={app_id:env.ALIPAY_APP_ID,out_trade_no:order.id,seller_id:env.ALIPAY_SELLER_ID,total_amount:'0.50',trade_no:'2026111022000000000000001',trade_status:'TRADE_SUCCESS',sign_type:'RSA2',...patch};
 const content=Object.keys(params).filter(k=>k!=='sign_type'&&params[k]!=='').sort().map(k=>k+'='+params[k]).join('&');
 params.sign=sign('RSA-SHA256',Buffer.from(content),provider.privateKey).toString('base64');
 return new Request('https://example.com/api/tools/payments/notify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
}
async function fixture(overrides={}){
 let now=Date.now(),calls=0,fail=false;
 const storage=memory(),service=new ToolPayments({storage,env:{...env,...overrides},safePath,safeDownload,now:()=>now,callAgent:async message=>{calls++;if(fail)throw Error('Private upstream details');assert.equal(message.path,path);return {name:'Example.txt',size:123,url:'https://a.baidupcs.com/file'};}});
 const session=await service.handle(req('session'));const cookie=session.headers.get('set-cookie')?.split(';')[0]||'';
 if(cookie)await service.rememberImport(req('session',{},cookie),'/链接导入/share-123456abcdef');
 return {service,storage,cookie,advance:ms=>now+=ms,fail:()=>{fail=true;},calls:()=>calls};
}
async function create(f){const result=await f.service.handle(req('order',{path,requestId:crypto.randomUUID(),totalAmount:'0.01'},f.cookie));assert.equal(result.status,200);return result.json();}
function checkoutParams(html){
 const url=new URL(html.match(/<form action="([^"]+)"/)[1]);
 for(const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g))url.searchParams.set(match[1],match[2].replaceAll('&quot;','"').replaceAll('&amp;','&'));
 return url;
}
const adminKey='test-only-operator-key-32-characters';
function operator(action,body,secret=adminKey){return new Request('https://example.com/api/tools/payments/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify(body)});}

test('payments are disabled without complete configuration, amounts use integer cents',()=>{
 assert.equal(paymentSettings({TOOLS_PAYMENT_ENABLED:'true'}).enabled,false);assert.equal(paymentSettings(env).enabled,true);
 assert.equal(cents('0.50'),50);assert.equal(cents('0.5'),50);for(const value of ['0.501','5e-1','-0.50',0.5,'NaN'])assert.equal(cents(value),null);
});
test('only sandbox permits HTTP loopback; local checkout omits an unreachable provider callback',()=>{
 for(const origin of ['http://localhost:8791','http://127.0.0.1:8791']){
  const local={...env,PAYMENT_SITE_ORIGIN:origin};assert.equal(paymentSettings(local).configured,true);
  const params=checkoutParams(alipayClient(local).checkout({id:'DL'+'a'.repeat(32),expiresAt:Date.now()+900000})).searchParams;
  assert.equal(params.has('notify_url'),false);assert.equal(params.get('return_url'),origin+'/tools/?payment_order=DL'+'a'.repeat(32));
  assert.equal(paymentSettings({...local,ALIPAY_ENV:'production'}).configured,false);
 }
 for(const origin of ['http://example.com','http://localhost.evil.example:8791','http://192.168.1.2:8791'])assert.equal(paymentSettings({...env,PAYMENT_SITE_ORIGIN:origin}).configured,false);
});

test('production uses the official live gateway and canonical site callbacks, and stays disabled without merchant credentials',()=>{
 const production={...env,ALIPAY_ENV:'production'},cfg=paymentSettings(production);
 assert.equal(cfg.sandbox,false);assert.equal(cfg.gateway,'https://openapi.alipay.com/gateway.do');
 const params=checkoutParams(alipayClient(production).checkout({id:'DL'+'a'.repeat(32),expiresAt:Date.now()+900000}));
 assert.equal(params.origin+params.pathname,'https://openapi.alipay.com/gateway.do');
 assert.equal(params.searchParams.get('notify_url'),'https://example.com/api/tools/payments/notify');
 assert.equal(params.searchParams.get('return_url'),'https://example.com/tools/?payment_order=DL'+'a'.repeat(32));
 for(const field of ['ALIPAY_SELLER_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY'])assert.equal(paymentSettings({...production,[field]:''}).enabled,false);
});

test('checkout permits official cashier redirects, keeps merchant return and provides a submit fallback',async()=>{
 for(const environment of ['sandbox','production']){
  const f=await fixture({ALIPAY_ENV:environment}),{checkout}=await create(f);
  const response=await f.service.handle(new Request(checkout,{headers:{Cookie:f.cookie}})),html=await response.text();
  assert.equal(response.status,200);const policy=response.headers.get('Content-Security-Policy');
  assert.ok(policy.includes('form-action https://*.alipay.com')||policy.includes(' https://*.alipay.com'));
  assert.equal(policy.includes('https://*.alipaydev.com'),environment==='sandbox');
  assert.ok(policy.endsWith(' https://example.com'));assert.ok(!policy.includes('form-action *'));
  assert.match(html,/<button type="submit">继续前往支付宝<\/button>/);
  assert.match(html,/document.forms\[.*\]\.submit\(\)/);
  assert.equal(checkoutParams(html).searchParams.get('biz_content').includes('0.50'),true);
 }
});
test('certificate mode requires all three certificates and the official SDK adds certificate serials',()=>{
 // A public CA certificate is only a local parser fixture, never merchant
 // configuration and never used for a request to the Alipay network.
 const cert=rootCertificates.find(pem=>new X509Certificate(pem).publicKey.asymmetricKeyType==='rsa');
 const config={...env,ALIPAY_SIGN_MODE:'certificate',ALIPAY_PUBLIC_KEY:undefined,ALIPAY_APP_CERT:cert,ALIPAY_PUBLIC_CERT:cert,ALIPAY_ROOT_CERT:cert};
 assert.equal(paymentSettings(config).configured,true);
 for(const key of ['ALIPAY_APP_CERT','ALIPAY_PUBLIC_CERT','ALIPAY_ROOT_CERT'])assert.equal(paymentSettings({...config,[key]:undefined}).enabled,false);
 const checkout=checkoutParams(alipayClient(config).checkout({id:'DL'+'a'.repeat(32),expiresAt:Date.now()+900000}));
 assert.match(checkout.searchParams.get('app_cert_sn'),/^[a-f0-9]{32}$/);assert.match(checkout.searchParams.get('alipay_root_cert_sn'),/^[a-f0-9]{32}$/);
});
test('official SDK signs fixed-price sandbox checkout and callback verification handles decoded form data',async()=>{
 const f=await fixture(),data=await create(f);
 assert.equal(new URL(data.checkout).origin,'https://example.com');
 const checkout=await f.service.handle(new Request(data.checkout,{headers:{Cookie:f.cookie}}));
 assert.equal(checkout.status,200);assert.match(checkout.headers.get('Content-Security-Policy'),/form-action https:\/\/openapi-sandbox/);
 const html=await checkout.text();assert.match(html,/method="post"/);const url=checkoutParams(html),params=Object.fromEntries(url.searchParams);
 assert.equal(url.origin,'https://openapi-sandbox.dl.alipaydev.com');assert.equal(params.method,'alipay.trade.page.pay');
 assert.equal(JSON.parse(params.biz_content).total_amount,'0.50');assert.equal(params.notify_url,'https://example.com/api/tools/payments/notify');
 const content=Object.keys(params).filter(k=>k!=='sign'&&params[k]!=='').sort().map(k=>k+'='+params[k]).join('&');
 assert.equal(verify('RSA-SHA256',Buffer.from(content),merchant.publicKey,Buffer.from(params.sign,'base64')),true);
 assert.equal((await f.service.handle(signedNotify(data.order))).status,200);
 assert.equal((await f.service.handle(new Request(data.checkout,{headers:{Cookie:f.cookie}}))).status,409);
});
test('guest sessions cannot list someone else’s files or access another browser’s orders',async()=>{
 const f=await fixture(),data=await create(f),second=await f.service.handle(req('session')),other=second.headers.get('set-cookie').split(';')[0];
 assert.match(second.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.equal(await f.service.allowed(req('session',{},f.cookie),path),true);assert.equal(await f.service.allowed(req('session',{},other),path),false);
 assert.equal(await f.service.allowed(req('session',{},f.cookie),'/'),false);
 assert.equal((await f.service.handle(req('status',{id:data.order.id},other))).status,404);
 assert.equal((await f.service.handle(req('order',{path:'/private',requestId:crypto.randomUUID()},f.cookie))).status,403);
 assert.equal((await f.service.handle(req('session',{},'','https://evil.example'))).status,403);
});
test('unpaid orders never return a URL and preflight failure creates no chargeable order',async()=>{
 const f=await fixture(),{order}=await create(f),result=await f.service.handle(req('download',{id:order.id,paid:true},f.cookie));
 assert.equal(result.status,402);assert.equal((await result.text()).includes('baidupcs'),false);
 const g=await fixture();g.fail();assert.equal((await g.service.handle(req('order',{path,requestId:crypto.randomUUID()},g.cookie))).status,502);
 assert.equal([...await g.storage.list()].filter(([key])=>key.startsWith('order:')).length,0);
});
test('concurrent order creation, duplicate callbacks and delivery retries retain a single paid grant',async()=>{
 const f=await fixture(),[a,b]=await Promise.all([create(f),create(f)]);assert.equal(a.order.id,b.order.id);
 const notification=await f.service.handle(signedNotify(a.order));assert.equal(await notification.text(),'success');
 const first=await f.storage.get('order:'+a.order.id);f.advance(2000);assert.equal(await(await f.service.handle(signedNotify(a.order))).text(),'success');
 const second=await f.storage.get('order:'+a.order.id);assert.equal(second.paidAt,first.paidAt);
 const one=await f.service.handle(req('download',{id:a.order.id},f.cookie)),two=await f.service.handle(req('download',{id:a.order.id},f.cookie));assert.equal(one.status,200);assert.deepEqual(await one.json(),await two.json());
 assert.equal((await f.service.handle(req('status',{id:a.order.id},f.cookie))).status,200);
});
test('validly signed mismatched amount, app, seller and forged signatures cannot confirm payment',async()=>{
 const f=await fixture(),{order}=await create(f);
 for(const patch of [{total_amount:'0.01'},{app_id:'2026000000000002'},{seller_id:'2088000000000002'}])assert.equal((await f.service.handle(signedNotify(order,patch))).status,400);
 const bad=signedNotify(order),form=new URLSearchParams(await bad.text());form.set('sign','forged');assert.equal((await f.service.handle(new Request(bad.url,{method:'POST',headers:bad.headers,body:form}))).status,400);
 assert.equal((await f.storage.get('order:'+order.id)).status,'pending');
});
test('provider query uses native transport, checks signatures, and cannot trust an unsigned success body',async()=>{
 const id='DL'+'a'.repeat(32),trade={code:'10000',out_trade_no:id,total_amount:'0.50',seller_id:env.ALIPAY_SELLER_ID,trade_no:'2026111022000000000000001',trade_status:'TRADE_SUCCESS'};
 const signature=sign('RSA-SHA256',Buffer.from(JSON.stringify(trade)),provider.privateKey).toString('base64');let valid=true;
 const client=alipayClient(env,async(url,opts)=>{
  const gateway=new URL(url),params=Object.fromEntries([...gateway.searchParams,...new URLSearchParams(opts.body)]);
  assert.equal(gateway.origin+gateway.pathname,'https://openapi-sandbox.dl.alipaydev.com/gateway.do');
  assert.equal(gateway.searchParams.get('charset'),'utf-8');assert.equal(gateway.searchParams.get('format'),'json');assert.equal(params.method,'alipay.trade.query');
  assert.equal(opts.headers['Content-Type'],'application/x-www-form-urlencoded; charset=utf-8');assert.equal(opts.redirect,'manual');
  const signed=Object.keys(params).filter(key=>key!=='sign'&&params[key]!=='').sort().map(key=>key+'='+params[key]).join('&');
  assert.equal(verify('RSA-SHA256',Buffer.from(signed),merchant.publicKey,Buffer.from(params.sign,'base64')),true);
  return Response.json({alipay_trade_query_response:trade,...(valid?{sign:signature}:{})});
 });
 assert.equal((await client.query(id)).trade_status,'TRADE_SUCCESS');valid=false;await assert.rejects(client.query(id));
});
test('payment transport rejects redirects without following them or forwarding credentials',async()=>{
 let requests=0;
 const client=alipayClient(env,async(url,options)=>{
  requests++;const u=new URL(url);assert.equal(u.origin+u.pathname,'https://openapi-sandbox.dl.alipaydev.com/gateway.do');assert.equal(options.redirect,'manual');
  return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});
 });
 await assert.rejects(client.query('DL'+'a'.repeat(32)),error=>error.status===502);assert.equal(requests,1);
});

test('Chinese provider errors are verified and unsigned or GBK responses cannot alter orders',async()=>{
 const trade={code:'40004',msg:'Business Failed',sub_code:'ACQ.TRADE_NOT_EXIST',sub_msg:'交易不存在'},signature=sign('RSA-SHA256',Buffer.from(JSON.stringify(trade)),provider.privateKey).toString('base64');
 let signed=true,charset='utf-8';
 const client=alipayClient(env,async()=>new Response(JSON.stringify({alipay_trade_query_response:trade,...(signed?{sign:signature}:{})}),{headers:{'Content-Type':'application/json; charset='+charset}}));
 assert.deepEqual(await client.query('DL'+'a'.repeat(32)),{absent:true,pending:true});
 signed=false;await assert.rejects(client.query('DL'+'a'.repeat(32)));
 signed=true;charset='GBK';await assert.rejects(client.query('DL'+'a'.repeat(32)),error=>error.status===502);
});

test('paid downloads survive disabled new purchases; verified refunds revoke access; expiry is enforced',async()=>{
 const f=await fixture(),{order}=await create(f);await f.service.handle(signedNotify(order));f.service.cfg.enabled=false;
 assert.equal((await f.service.handle(req('order',{path,requestId:crypto.randomUUID()},f.cookie))).status,503);
 assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,200);
 assert.equal(await(await f.service.handle(signedNotify(order,{trade_status:'TRADE_CLOSED'}))).text(),'success');
 assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,402);
 const g=await fixture(),b=await create(g);await g.service.handle(signedNotify(b.order));g.advance(86400001);
 assert.equal((await g.service.handle(req('download',{id:b.order.id},g.cookie))).status,410);
});
test('friend access remains private when payments are disabled and guest direct-link bypass is rejected',async()=>{
 const storage=memory(),sockets=[],bridge=new DownloadBridge({storage,getWebSockets:()=>sockets},{...env,DOWNLOAD_ACCESS_CODE:'friend'});
 const f=new ToolPayments({storage,env,safePath,safeDownload,callAgent:()=>{throw Error();}});
 const session=await f.handle(req('session')),cookie=session.headers.get('set-cookie').split(';')[0];
 const request=new Request('https://example.com/api/tools/downloads/link',{method:'POST',headers:{Origin:'https://example.com',Cookie:cookie},body:JSON.stringify({path})});
 sockets.push({readyState:1,send(){assert.fail('Unpaid URL must not be requested');}});
 assert.equal((await bridge.fetch(request)).status,402);
 assert.equal((await bridge.fetch(new Request('https://example.com/api/tools/downloads/list',{method:'POST',headers:{Origin:'https://example.com',Cookie:cookie},body:JSON.stringify({path:'/'})}))).status,403);
});

test('signed refund and non-payment events never create a paid grant',async()=>{
 for(const patch of [{out_biz_no:'refund-1'},{gmt_refund:'2026-11-10 12:00:00',refund_fee:'0.50'},{trade_status:'WAIT_BUYER_PAY'},{trade_status:'UNKNOWN'}]){
  const f=await fixture(),{order}=await create(f);
  assert.equal((await f.service.handle(signedNotify(order,patch))).status,200);
  assert.notEqual((await f.storage.get('order:'+order.id)).status,'paid');
  assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,402);
 }
 const f=await fixture(),{order}=await create(f);await f.service.handle(signedNotify(order));
 await f.service.handle(signedNotify(order,{refund_fee:'0.50',gmt_refund:'2026-11-10 12:00:00',out_biz_no:'refund-1'}));
 assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,402);
});

test('refund endpoints require separate operator authentication and retain one full refund request',async()=>{
 const f=await fixture({TOOLS_PAYMENT_ADMIN_KEY:adminKey}),{order}=await create(f);await f.service.handle(signedNotify(order));
 let sends=0,queries=0,confirmed=false;const requests=[];
 f.service._client={...f.service.client,refund:async(id,refund)=>{sends++;requests.push(structuredClone(refund));return {out_trade_no:id,trade_no:'2026111022000000000000001',refund_fee:'0.50',fund_change:'N'};},refundQuery:async(id,refund)=>{queries++;return {out_trade_no:id,trade_no:'2026111022000000000000001',out_request_no:refund.id,total_amount:'0.50',refund_amount:'0.50',refund_status:confirmed?'REFUND_SUCCESS':'REFUND_PROCESSING'};}};
 assert.equal((await f.service.handle(operator('refund',{id:order.id,amountCents:50},'friend'))).status,403);
 assert.equal((await f.service.handle(operator('refund',{id:order.id,amountCents:51}))).status,400);assert.equal(sends,0);
 assert.equal((await f.service.handle(operator('refund',{id:order.id,amountCents:50}))).status,200);
 assert.equal((await f.service.handle(operator('refund',{id:order.id,amountCents:50}))).status,200);assert.equal(sends,1);
 assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,402);
 await f.service.handle(operator('refund-status',{id:order.id}));await f.service.handle(operator('refund-status',{id:order.id}));assert.equal(queries,1);
 f.advance(10001);confirmed=true;const result=await f.service.handle(operator('refund-status',{id:order.id}));assert.equal((await result.json()).order.status,'refunded');
 assert.equal((await f.storage.get('order:'+order.id)).refundedCents,50);assert.equal(requests[0].id,'RF'+order.id.slice(2));
});

test('uncertain refunds survive service restart and are queried instead of being sent twice',async()=>{
 const f=await fixture({TOOLS_PAYMENT_ADMIN_KEY:adminKey}),{order}=await create(f);await f.service.handle(signedNotify(order));
 let sends=0;f.service._client={...f.service.client,refund:async()=>{sends++;throw Error('Timeout after provider accepted');}};
 assert.equal((await f.service.handle(operator('refund',{id:order.id,amountCents:50}))).status,502);
 const restarted=new ToolPayments({storage:f.storage,env:f.service.env,safePath,safeDownload,callAgent:()=>assert.fail('No delivery during refund')});
 restarted._client={refund:()=>assert.fail('Must not send twice'),refundQuery:async(id,refund)=>({out_trade_no:id,trade_no:'2026111022000000000000001',out_request_no:refund.id,total_amount:'0.50',refund_amount:'0.50',refund_status:'REFUND_SUCCESS'})};
 assert.equal((await restarted.handle(operator('refund',{id:order.id,amountCents:50}))).status,200);
 await restarted.reconcile();assert.equal((await f.storage.get('order:'+order.id)).status,'refunded');assert.equal(sends,1);
});

test('background recovery confirms a paid order after its browser closes and never trusts unknown states',async()=>{
 const f=await fixture(),{order}=await create(f);
 f.service._client={...f.service.client,query:async id=>({out_trade_no:id,seller_id:env.ALIPAY_SELLER_ID,total_amount:'0.50',trade_no:'2026111022000000000000001',trade_status:'WAIT_BUYER_PAY'})};
 await f.service.reconcile();assert.equal((await f.storage.get('order:'+order.id)).status,'pending');
 f.advance(60001);f.service._client.query=async id=>({out_trade_no:id,seller_id:env.ALIPAY_SELLER_ID,total_amount:'0.50',trade_no:'2026111022000000000000001',trade_status:'TRADE_SUCCESS'});
 await f.service.reconcile();assert.equal((await f.storage.get('order:'+order.id)).status,'paid');
 assert.equal((await f.service.handle(req('download',{id:order.id},f.cookie))).status,200);
});

test('official SDK transport signs refund, refund query and close with the expected parameters',async()=>{
 const id='DL'+'b'.repeat(32),refund={id:'RF'+'b'.repeat(32),amountCents:50};let method;
 const client=alipayClient(env,async(url,opts)=>{
  const params=new URL(url).searchParams,biz=JSON.parse(new URLSearchParams(opts.body).get('biz_content'));method=params.get('method');assert.equal(biz.out_trade_no,id);
  if(method.includes('refund'))assert.equal(biz.out_request_no,refund.id);
  if(method==='alipay.trade.refund')assert.equal(biz.refund_amount,'0.50');
  const response={code:'10000',out_trade_no:id},signature=sign('RSA-SHA256',Buffer.from(JSON.stringify(response)),provider.privateKey).toString('base64');
  return Response.json({[method.replaceAll('.','_')+'_response']:response,sign:signature});
 });
 await client.refund(id,refund);assert.equal(method,'alipay.trade.refund');await client.refundQuery(id,refund);assert.equal(method,'alipay.trade.fastpay.refund.query');await client.close(id);assert.equal(method,'alipay.trade.close');
});
