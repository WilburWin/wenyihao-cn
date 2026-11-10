import {AlipaySdk} from 'alipay-sdk';

const DAY=86400000,PRICE=50,SESSION='__Host-tool-buyer';
const responseHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{...responseHeaders,...headers}});
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const failure=(message,status=400)=>Object.assign(Error(message),{status});
function withoutSdkDebug(operation){
  // Workerd always enables util.debuglog. The SDK logs signed payment requests
  // there, so filter its namespace during these strictly synchronous calls.
  const previous=console.log;
  console.log=(...args)=>{if(typeof args[0]!=='string'||!args[0].startsWith('ALIPAY-SDK'))previous.apply(console,args);};
  try{return operation();}finally{console.log=previous;}
}
export function cents(value){
  if(typeof value!=='string'||!/^\d{1,9}(?:\.\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function paymentSettings(env){
  const sandbox=env.ALIPAY_ENV==='sandbox';
  const signMode=env.ALIPAY_SIGN_MODE||((env.ALIPAY_APP_CERT||env.ALIPAY_PUBLIC_CERT||env.ALIPAY_ROOT_CERT)?'certificate':'public-key');
  let origin,loopback=false;try{const u=new URL(env.PAYMENT_SITE_ORIGIN);loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);const localSandbox=sandbox&&loopback&&u.protocol==='http:';if((u.protocol!=='https:'&&!localSandbox)||u.pathname!=='/'||u.search||u.hash||(!localSandbox&&u.port)||u.username||u.password)throw Error();origin=u.origin;}catch{}
  const verification=signMode==='certificate'?[env.ALIPAY_APP_CERT,env.ALIPAY_PUBLIC_CERT,env.ALIPAY_ROOT_CERT].every(value=>typeof value==='string'&&value.includes('-----BEGIN CERTIFICATE-----')):signMode==='public-key'&&!!env.ALIPAY_PUBLIC_KEY;
  const configured=!!origin&&/^\d{16,20}$/.test(env.ALIPAY_APP_ID||'')&&/^2088\d{12}$/.test(env.ALIPAY_SELLER_ID||'')&&!!env.ALIPAY_PRIVATE_KEY&&verification&&['sandbox','production'].includes(env.ALIPAY_ENV);
  return {configured,enabled:configured&&env.TOOLS_PAYMENT_ENABLED==='true',signMode,sandbox,origin,notifyUrl:origin&&!loopback?origin+'/api/tools/payments/notify':null,priceCents:PRICE,gateway:sandbox?'https://openapi-sandbox.dl.alipaydev.com/gateway.do':'https://openapi.alipay.com/gateway.do'};
}
// Official SDK owns signing and verification. Only the HTTP transport uses
// Workers fetch; the SDK's Node HTTP client is never called at the edge.
export function alipayClient(env,fetcher=fetch){
  const cfg=paymentSettings(env);
  if(!cfg.configured)throw failure('支付配置尚未完成。',503);
  const clean=value=>value.replaceAll('\\n','\n');
  const verification=cfg.signMode==='certificate'?{appCertContent:clean(env.ALIPAY_APP_CERT),alipayPublicCertContent:clean(env.ALIPAY_PUBLIC_CERT),alipayRootCertContent:clean(env.ALIPAY_ROOT_CERT)+(env.ALIPAY_ROOT_CERT_2?'\n'+clean(env.ALIPAY_ROOT_CERT_2):'')}:{alipayPublicKey:clean(env.ALIPAY_PUBLIC_KEY)};
  const sdk=new AlipaySdk({appId:env.ALIPAY_APP_ID,privateKey:clean(env.ALIPAY_PRIVATE_KEY),...verification,keyType:env.ALIPAY_KEY_TYPE||(env.ALIPAY_PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY')?'PKCS1':'PKCS8'),signType:'RSA2',gateway:cfg.gateway});
  // Workerd's PEM reader requires wrapped base64; the SDK collapses the
  // contents into a single line while formatting keys for Node/OpenSSL.
  const wrapped=value=>value.replace(/-----BEGIN ([A-Z ]+)-----\s*([\s\S]*?)\s*-----END \1-----/,(_,type,body)=>`-----BEGIN ${type}-----\n${body.replace(/\s/g,'').match(/.{1,64}/g).join('\n')}\n-----END ${type}-----\n`);
  sdk.config.privateKey=wrapped(sdk.config.privateKey);sdk.config.alipayPublicKey=wrapped(sdk.config.alipayPublicKey);
  async function execute(method,id,extra={}){
    const signed=Object.fromEntries(new URLSearchParams(withoutSdkDebug(()=>sdk.sdkExecute(method,{format:'json',bizContent:{outTradeNo:id,...extra}}))));
    // Follow the official SDK's URL/body split. In particular, charset must
    // reach the gateway in the URL; body-only charset can produce GBK replies.
    const {url,execParams}=sdk.formatUrl(cfg.gateway,signed),body=new URLSearchParams(execParams).toString();
    const res=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8',Accept:'application/json'},body,redirect:'manual',signal:AbortSignal.timeout(12000)});
    if(!res.ok)throw failure('支付状态暂时无法查询，请稍后重试。',502);
    const charset=res.headers.get('Content-Type')?.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
    if(charset&&!/^utf-?8$/i.test(charset))throw failure('支付宝响应编码异常，请稍后重试。',502);
    const raw=await boundedText(res,32768),data=JSON.parse(raw),key=method.replaceAll('.','_')+'_response',trade=data[key];
    if(!trade||typeof trade!=='object')throw failure('支付状态暂时无法查询。',502);
    if(typeof data.sign!=='string')throw failure('支付状态签名无效。',502);
    sdk.checkResponseSign(raw,key,data.sign);
    if(trade.code!=='10000'){
      if(['alipay.trade.query','alipay.trade.close'].includes(method)&&trade.sub_code==='ACQ.TRADE_NOT_EXIST')return {absent:true,pending:true};
      throw failure('支付宝暂时无法确认此订单，请稍后重试。',502);
    }
    return trade;
  }
  return {
    checkout(order){
      return withoutSdkDebug(()=>sdk.pageExec('alipay.trade.page.pay','POST',{
        ...(cfg.notifyUrl?{notifyUrl:cfg.notifyUrl}:{}),returnUrl:cfg.origin+'/tools/?payment_order='+order.id,
        bizContent:{outTradeNo:order.id,totalAmount:'0.50',subject:'文件下载地址授权',productCode:'FAST_INSTANT_TRADE_PAY',timeExpire:new Date(order.expiresAt+8*3600000).toISOString().slice(0,19).replace('T',' ')}
      }));
    },
    verify(params){return params.sign_type==='RSA2'&&sdk.checkNotifySignV2(params);},
    query:id=>execute('alipay.trade.query',id),
    close:id=>execute('alipay.trade.close',id),
    refund:(id,refund)=>execute('alipay.trade.refund',id,{refundAmount:(refund.amountCents/100).toFixed(2),outRequestNo:refund.id,refundReason:'文件下载地址授权退款'}),
    refundQuery:(id,refund)=>execute('alipay.trade.fastpay.refund.query',id,{outRequestNo:refund.id})
  };
}
async function boundedText(source,limit){
  const reader=source.body?.getReader();if(!reader)return '';let length=0,text='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw failure('请求内容过长。',413);}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();
}
export class ToolPayments{
  constructor({storage,env,callAgent,safePath,safeDownload,now=Date.now,clientFactory=alipayClient}){Object.assign(this,{storage,env,callAgent,safePath,safeDownload,now,clientFactory});this.cfg=paymentSettings(env);}
  get client(){return this._client??=this.clientFactory(this.env);}
  async buyer(request,required=true){
    const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(SESSION+'='))?.slice(SESSION.length+1);
    if(token&&/^[a-f0-9]{64}$/.test(token)){
      const key='buyer:'+await digest(token),buyer=await this.storage.get(key);
      if(buyer&&buyer.until>this.now())return {...buyer,key};
    }
    if(required)throw failure('请先开启按次下载入口；原浏览器中的订单可继续恢复。',401);return null;
  }
  async allowed(request,path){
    if(!this.cfg.enabled)return false;
    const buyer=await this.buyer(request,false);
    return !!buyer?.roots.some(root=>path===root||path.startsWith(root+'/'));
  }
  async rememberImport(request,path){
    const buyer=await this.buyer(request);
    await this.storage.transaction(async tx=>{const fresh=await tx.get(buyer.key);fresh.roots=[...new Set([...fresh.roots,path])].slice(-20);await tx.put(buyer.key,fresh);});
  }
  async owned(request,id){
    if(typeof id!=='string'||!/^DL[a-f0-9]{32}$/.test(id))throw failure('订单不存在。',404);
    const buyer=await this.buyer(request),order=await this.storage.get('order:'+id);
    if(!order||order.buyer!==buyer.key)throw failure('订单不存在，需在下单浏览器中查看。',404);
    return order;
  }
  publicOrder(order){return {id:order.id,name:order.name,size:order.size,priceCents:order.amountCents,status:order.status,refundPending:!!order.refund&&order.refund.status!=='succeeded',createdAt:order.createdAt,paidAt:order.paidAt||null,expiresAt:order.expiresAt,retryUntil:order.paidAt?order.paidAt+DAY:null};}
  checkoutURL(order){return order.status==='pending'&&order.expiresAt>this.now()&&this.cfg.enabled?this.cfg.origin+'/api/tools/payments/checkout?id='+order.id:null;}
  async schedule(at=this.now()+30000){
    const current=await this.storage.getAlarm?.();
    if(!current||current<=this.now()||current>at)await this.storage.setAlarm(at);
  }
  async applyTrade(id,trade){
    return this.storage.transaction(async tx=>{
      const key='order:'+id,order=await tx.get(key);
      if(!order||trade.out_trade_no!==id||trade.seller_id!==this.env.ALIPAY_SELLER_ID||cents(trade.total_amount)!==order.amountCents||!/^[0-9]{16,64}$/.test(trade.trade_no||''))throw failure('支付订单核对失败。',400);
      const tradeKey='trade:'+trade.trade_no,bound=await tx.get(tradeKey);
      if(bound&&bound.order!==id)throw failure('支付订单核对失败。',400);
      if(order.tradeNo&&order.tradeNo!==trade.trade_no)throw failure('支付订单核对失败。',400);
      const refundEvent=!!(trade.out_biz_no||trade.gmt_refund||trade.refund_fee);
      if(refundEvent){
        // Refund events may also carry TRADE_SUCCESS. They are never proof of
        // a buyer payment. Persist only the event identity and reconcile later.
        order.refundEventAt=this.now();
        if(cents(trade.refund_fee)>0){order.status='refunded';delete order.download;}
      }else if(['TRADE_SUCCESS','TRADE_FINISHED'].includes(trade.trade_status)){
        if(!['paid','fulfilled','refunded'].includes(order.status)){order.status='paid';order.paidAt=this.now();order.tradeNo=trade.trade_no;}
        await tx.put(tradeKey,{order:id,until:order.until});
      }else if(trade.trade_status==='TRADE_CLOSED'){
        order.status=['paid','fulfilled','refunded'].includes(order.status)?'refunded':'closed';delete order.download;
      }
      await tx.put(key,order);return order;
    });
  }
  async refreshRefund(id){
    const order=await this.storage.get('order:'+id),refund=order?.refund;
    if(!refund||refund.status==='succeeded'||refund.checkedAt&&this.now()-refund.checkedAt<10000)return order;
    await this.storage.transaction(async tx=>{const row=await tx.get('order:'+id);row.refund.checkedAt=this.now();await tx.put('order:'+id,row);});
    const result=await this.client.refundQuery(id,refund);
    if(result.out_trade_no!==id||result.out_request_no!==refund.id||result.trade_no!==order.tradeNo||cents(result.refund_amount)!==refund.amountCents||cents(result.total_amount)!==order.amountCents)throw failure('退款查询核对失败。',502);
    if(result.refund_status==='REFUND_SUCCESS')await this.storage.transaction(async tx=>{const row=await tx.get('order:'+id);row.refund.status='succeeded';row.refund.completedAt=this.now();row.refundedCents=row.refund.amountCents;row.status='refunded';delete row.download;await tx.put('order:'+id,row);});
    return this.storage.get('order:'+id);
  }
  async admin(request,action){
    // A separate operator credential is never delivered to the website. Friend
    // access codes and buyer cookies cannot close or refund somebody's order.
    const secret=this.env.TOOLS_PAYMENT_ADMIN_KEY;
    if(typeof secret!=='string'||secret.length<32||await digest(request.headers.get('Authorization')||'')!==await digest('Bearer '+secret))throw failure('无权访问。',403);
    if(request.method!=='POST')throw failure('请使用 POST。',405);
    const body=JSON.parse(await boundedText(request,2048));
    if(typeof body.id!=='string'||!/^DL[a-f0-9]{32}$/.test(body.id))throw failure('订单不存在。',404);
    let order=await this.storage.get('order:'+body.id);if(!order)throw failure('订单不存在。',404);
    if(action==='admin/order')return json({order:this.publicOrder(order)});
    if(action==='admin/close'){
      if(order.status!=='pending')throw failure('只能关闭待支付订单。',409);
      const trade=await this.client.query(order.id);
      if(!trade.pending)order=await this.applyTrade(order.id,trade);
      if(order.status==='pending'){
        const result=trade.absent?trade:await this.client.close(order.id);
        if(!result.absent&&(result.out_trade_no!==order.id||order.tradeNo&&result.trade_no!==order.tradeNo))throw failure('关闭订单核对失败。',502);
        await this.storage.transaction(async tx=>{const row=await tx.get('order:'+order.id);if(row.status==='pending'){row.status='closed';await tx.put('order:'+row.id,row);}});
      }
    }else if(action==='admin/refund-status'){
      order=await this.refreshRefund(order.id);
    }else if(action==='admin/refund'){
      if(body.amountCents!==order.amountCents)throw failure('本工具仅支持原订单金额全额退款。');
      let shouldSend=false;
      await this.storage.transaction(async tx=>{
        const row=await tx.get('order:'+order.id);
        if(row.refund){order=row;return;}
        if(!['paid','fulfilled'].includes(row.status)||!row.tradeNo||row.refundedCents)throw failure('此订单当前不可退款。',409);
        row.refund={id:'RF'+row.id.slice(2),amountCents:row.amountCents,status:'pending',requestedAt:this.now()};delete row.download;order=row;shouldSend=true;await tx.put('order:'+row.id,row);
      });
      await this.schedule();
      if(shouldSend){
        // Journal first. Timeouts stay pending and are queried with the same
        // request number; a repeated operator click never sends a second refund.
        const result=await this.client.refund(order.id,order.refund);
        if(result.out_trade_no!==order.id||result.trade_no!==order.tradeNo||cents(result.refund_fee)!==order.refund.amountCents)throw failure('退款结果待核对，请查询原退款记录。',502);
        if(result.fund_change==='Y')await this.storage.transaction(async tx=>{const row=await tx.get('order:'+order.id);row.refund.status='succeeded';row.refund.completedAt=this.now();row.refundedCents=row.refund.amountCents;row.status='refunded';delete row.download;await tx.put('order:'+row.id,row);});
      }
    }else throw failure('Not found',404);
    order=await this.storage.get('order:'+order.id);return json({order:this.publicOrder(order)});
  }
  async reconcile(){
    if(!this.cfg.configured)return;
    const rows=await this.storage.list({prefix:'order:'});let checked=0,remaining=false;
    for(const row of rows.values()){
      if(row.until<=this.now()||!(row.status==='pending'||row.refund?.status==='pending'))continue;
      if(checked>=10||row.nextCheckAt>this.now()){remaining=true;continue;}
      checked++;
      try{if(row.refund?.status==='pending')await this.refreshRefund(row.id);else await this.refreshPending(row);}catch{/* Retry unknown results without logging credentials or a payment form. */}
      await this.storage.transaction(async tx=>{const fresh=await tx.get('order:'+row.id);if(fresh){fresh.nextCheckAt=this.now()+60000;await tx.put('order:'+row.id,fresh);}});
      const fresh=await this.storage.get('order:'+row.id);if(fresh.status==='pending'||fresh.refund?.status==='pending')remaining=true;
    }
    if(remaining)await this.schedule(this.now()+60000);
  }
  async refreshPending(order){
    const trade=await this.client.query(order.id);
    if(!trade.pending)order=await this.applyTrade(order.id,trade);
    if(order.status==='pending'&&order.expiresAt<=this.now()){
      if(!trade.absent){const closed=await this.client.close(order.id);if(!closed.absent&&closed.out_trade_no!==order.id)throw failure('支付宝订单关闭结果不一致，请稍后重试。',502);}
      await this.storage.transaction(async tx=>{const row=await tx.get('order:'+order.id);if(row.status==='pending'){row.status='closed';await tx.put('order:'+row.id,row);}});
    }
    return this.storage.get('order:'+order.id);
  }
  async handle(request){
    const url=new URL(request.url),action=url.pathname.slice('/api/tools/payments/'.length);
    try{
      if(action==='config'&&request.method==='GET')return json({enabled:this.cfg.enabled,configured:this.cfg.configured,sandbox:this.cfg.sandbox,priceCents:PRICE,message:this.cfg.enabled?'每个文件 0.50 元，支付后获取下载地址。':'支付宝收款尚未开通，朋友访问码仍可使用。'});
      if(action==='notify')return await this.notify(request);
      if(action.startsWith('admin/')){if(!this.cfg.configured)throw failure('支付配置尚未完成。',503);return await this.admin(request,action);}
      if(action==='checkout'&&request.method==='GET'){
        if(!this.cfg.enabled||url.origin!==this.cfg.origin)throw failure('暂不接受付款。',503);
        const order=await this.owned(request,url.searchParams.get('id'));
        if(order.status!=='pending'||order.expiresAt<=this.now())throw failure('订单当前不可支付，请返回工具页查询结果。',409);
        // Chromium applies form-action to the gateway's 302 redirect chain.
        // The live gateway redirects to unitradeprod.alipay.com before the
        // cashier, so allow official Alipay HTTPS hosts, not just openapi.
        const targets=new URL(this.cfg.gateway).origin+(this.cfg.sandbox?' https://*.alipaydev.com https://*.alipay.com':' https://*.alipay.com');
        const form=this.client.checkout(order).replace('</form>','<button type="submit">继续前往支付宝</button></form>');
        return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>正在前往支付宝</title><p>正在前往支付宝…</p><p>若未自动跳转，请点击下方按钮；请勿重复创建订单。</p>'+form+'</html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action "+targets+' '+this.cfg.origin}});
      }
      if(!this.cfg.configured||(!this.cfg.enabled&&!['session','status','download'].includes(action)))throw failure('支付宝收款尚未开通，暂不接受付款。',503);
      if(new URL(request.url).origin!==this.cfg.origin||request.headers.get('Origin')!==this.cfg.origin)throw failure('来源验证失败。',403);
      if(request.method!=='POST')throw failure('请使用 POST。',405);
      const body=JSON.parse(await boundedText(request,2048)||'{}');
      if(action==='session'){
        let buyer=await this.buyer(request,false),cookie;
        if(!buyer){if(!this.cfg.enabled||body.restore===true)throw failure('当前浏览器没有可恢复的订单。',401);const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join(''),key='buyer:'+await digest(token);buyer={key,roots:[],orders:[],until:this.now()+7*DAY};const {key:_,...data}=buyer;await this.storage.put(key,data);cookie=`${SESSION}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;}
        const orders=[];for(const id of buyer.orders){const order=await this.storage.get('order:'+id);if(order)orders.push(this.publicOrder(order));}
        return json({ready:true,orders},200,cookie?{'Set-Cookie':cookie}:{});
      }
      if(action==='order'){
        const buyer=await this.buyer(request),path=this.safePath(body.path);
        if(!await this.allowed(request,path))throw failure('请先导入自己的分享文件，再选择下载。',403);
        if(typeof body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(body.requestId))throw failure('下单标识无效。');
        // Resolve expired pending orders before allowing another charge for the
        // same file. If the provider cannot confirm, do not create another order.
        for(const id of buyer.orders){const old=await this.storage.get('order:'+id);if(old?.path===path&&old.refund?.status==='pending')throw failure('此文件的原订单退款仍在确认，请稍后重试。',409);if(old?.path===path&&old.status==='pending'&&old.expiresAt<=this.now())await this.refreshPending(old);}
        // Verify that this particular file can resolve before accepting money.
        const metadata=await this.callAgent({action:'link',path});this.safeDownload(metadata.url);
        if(typeof metadata.name!=='string'||metadata.name.length>255||!Number.isSafeInteger(metadata.size)||metadata.size<0)throw failure('文件信息无效。',502);
        const order=await this.storage.transaction(async tx=>{
          const fresh=await tx.get(buyer.key),idemKey='purchase:'+buyer.key+':'+body.requestId,existing=await tx.get(idemKey);
          if(existing){const old=await tx.get('order:'+existing.order);if(old&&old.path===path)return old;throw failure('请重新选择文件后下单。');}
          // Reuse pending / paid orders for this file, including repeated clicks
          // with a different request id. A failed delivery never requires repaying.
          for(const id of fresh.orders){const old=await tx.get('order:'+id);if(old?.path===path&&old.name===metadata.name&&old.size===metadata.size&&((old.status==='pending'&&old.expiresAt>this.now())||(['paid','fulfilled'].includes(old.status)&&old.paidAt+DAY>this.now())))return old;}
          if(fresh.orders.length>=100)throw failure('此浏览器订单较多，请联系站长处理。',429);
          const created={id:'DL'+crypto.randomUUID().replaceAll('-',''),buyer:buyer.key,path,name:metadata.name,size:metadata.size,amountCents:PRICE,status:'pending',createdAt:this.now(),expiresAt:this.now()+900000,until:this.now()+180*DAY,mobile:body.mobile===true};
          fresh.orders.unshift(created.id);await tx.put(buyer.key,fresh);await tx.put('order:'+created.id,created);await tx.put(idemKey,{order:created.id,until:fresh.until});return created;
        });
        await this.schedule();
        return json({order:this.publicOrder(order),checkout:this.checkoutURL(order)});
      }
      if(action==='status'){
        let order=await this.owned(request,body.id);
        // Browser status can never mark an order paid. Throttle active queries;
        // signed callbacks and provider queries are the only payment evidence.
        if(order.status==='pending'&&(!order.checkedAt||this.now()-order.checkedAt>=10000)){
          const shouldQuery=await this.storage.transaction(async tx=>{const row=await tx.get('order:'+order.id);if(row.status!=='pending'||(row.checkedAt&&this.now()-row.checkedAt<10000))return false;row.checkedAt=this.now();await tx.put('order:'+row.id,row);return true;});
          if(shouldQuery)order=await this.refreshPending(order);
        }
        order=await this.owned(request,body.id);return json({order:this.publicOrder(order),checkout:this.checkoutURL(order)});
      }
      if(action==='download'){
        let order=await this.owned(request,body.id);
        if(!['paid','fulfilled'].includes(order.status)||order.refund)throw failure('订单尚未到账或正在退款，请查询支付结果。',402);
        if(this.now()>order.paidAt+DAY)throw failure('此订单的 24 小时下载地址重试期已结束。',410);
        let data=order.download;
        if(!data||this.now()-data.at>600000){data=await this.callAgent({action:'link',path:order.path});data.url=this.safeDownload(data.url);if(data.name!==order.name||data.size!==order.size)throw failure('文件已变更，请联系站长处理该订单。',409);data={name:data.name,size:data.size,url:data.url,userAgent:'pan.baidu.com',at:this.now()};}
        await this.storage.transaction(async tx=>{const row=await tx.get('order:'+order.id);if(!['paid','fulfilled'].includes(row.status)||row.refund)throw failure('订单当前不可下载。',409);row.download=data;row.status='fulfilled';await tx.put('order:'+row.id,row);});
        return json({name:data.name,size:data.size,url:data.url,userAgent:data.userAgent});
      }
      return json({message:'Not found'},404);
    }catch(error){return json({message:error.status?error.message:'订单暂时无法处理，请稍后重试；已付款请保留订单号联系站长。'},error.status||502);}
  }
  async notify(request){
    const text=(value,status=200)=>new Response(value,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
    // Accept verified callbacks even after new purchases are disabled, so an
    // in-flight payment cannot disappear during a deployment or pause.
    if(!this.cfg.configured||new URL(request.url).origin!==this.cfg.origin||request.method!=='POST')return text('failure',400);
    try{
      if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))throw Error();
      const form=new URLSearchParams(await boundedText(request,16384));
      if(new Set(form.keys()).size!==[...form.keys()].length)throw Error();
      const params=Object.fromEntries(form);
      if(params.app_id!==this.env.ALIPAY_APP_ID||!this.client.verify(params))throw Error();
      const eventKey=params.notify_id?'payment-notify:'+await digest(params.notify_id):null;
      const event=eventKey&&await this.storage.get(eventKey);
      if(event&&event.order===params.out_trade_no)return text('success');
      const order=await this.applyTrade(params.out_trade_no,params);
      if(eventKey)await this.storage.put(eventKey,{order:order.id,trade:params.trade_no,type:params.trade_status,until:order.until});
      return text('success');
    }catch{return text('failure',400);}
  }
}
