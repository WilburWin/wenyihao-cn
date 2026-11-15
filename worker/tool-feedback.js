const DAY=86400000;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const failure=(message,status=400)=>Object.assign(Error(message),{status});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const kinds=new Set(['parse','download','payment','refund','suggestion','other']);
const states=new Set(['open','processing','resolved']);
const validId=value=>/^FB\d{13}[a-f0-9]{32}$/.test(value||'');
async function body(request){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw failure('请使用 JSON 提交。',415);
 const reader=request.body?.getReader(),decoder=new TextDecoder();let text='',length=0;
 if(reader)for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw failure('反馈内容过长。',413);}text+=decoder.decode(value,{stream:true});}
 try{const data=JSON.parse(text+decoder.decode());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw failure('反馈格式无效。');}
}
function field(value,max,label){if(value===undefined)return '';if(typeof value!=='string'||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw failure(label+'格式无效。');return value.trim();}
export function validateFeedback(data){
 if(data.website)throw failure('暂时无法提交，请稍后重试。');
 if(!kinds.has(data.kind))throw failure('请选择问题类型。');
 if(typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestId))throw failure('提交标识无效，请刷新重试。');
 const message=field(data.message,3000,'问题描述'),contact=field(data.contact,120,'联系方式'),orderId=field(data.orderId,34,'订单号');
 if(message.length<5)throw failure('请至少填写 5 个字的问题描述。');
 if(orderId&&!/^DL[a-f0-9]{32}$/.test(orderId))throw failure('请填写本站 DL 开头的订单号，或暂时留空。');
 return {kind:data.kind,message,contact,orderId,requestId:data.requestId};
}
export class ToolFeedback{
 constructor({storage,env,now=Date.now}){Object.assign(this,{storage,env,now});}
 async handle(request){
  const path=new URL(request.url).pathname;
  try{
   if(request.method!=='POST')throw failure('请使用 POST。',405);
   if(path.startsWith('/api/tools/feedback/admin/')){
    const secret=this.env.TOOLS_FEEDBACK_ADMIN_KEY;
    if(typeof secret!=='string'||secret.length<32||await hash(request.headers.get('Authorization')||'')!==await hash('Bearer '+secret))throw failure('管理密钥不正确或尚未配置。',403);
    const data=await body(request);
    if(path.endsWith('/list')){
     if(data.cursor!==undefined&&data.cursor!==null&&!validId(data.cursor))throw failure('分页标识无效。');
     const rows=await this.storage.list({prefix:'feedback:',reverse:true,limit:26,...(data.cursor?{end:'feedback:'+data.cursor}:{})});
     const entries=[...rows].slice(0,25),items=entries.map(([,row])=>row).filter(row=>row.until>this.now());
     return json({items,cursor:rows.size>25?entries.at(-1)[1].id:null});
    }
    if(path.endsWith('/update')){
     if(!validId(data.id)||!states.has(data.status))throw failure('反馈编号或处理状态无效。');
     const note=field(data.note,2000,'处理备注');
     const item=await this.storage.transaction(async tx=>{
      const row=await tx.get('feedback:'+data.id);if(!row||row.until<=this.now())throw failure('反馈不存在或已到保留期限。',404);
      Object.assign(row,{status:data.status,note,updatedAt:this.now()});await tx.put('feedback:'+data.id,row);return row;
     });return json({item});
    }
    throw failure('Not found',404);
   }
   if(path!=='/api/tools/feedback/submit')throw failure('Not found',404);
   if(request.headers.get('Origin')!==new URL(request.url).origin)throw failure('来源验证失败。',403);
   const data=validateFeedback(await body(request)),now=this.now(),day=Math.floor(now/DAY);
   const ipHash=await hash(day+':'+(request.headers.get('CF-Connecting-IP')||'local'));
   const retryKey='feedback-retry:'+await hash(data.requestId),fingerprint=await hash(JSON.stringify([data.kind,data.message,data.contact,data.orderId]));
   const receipt=await this.storage.transaction(async tx=>{
    const prior=await tx.get(retryKey);
    if(prior&&prior.until>now){if(prior.fingerprint!==fingerprint)throw failure('内容已变化，请重新提交。',409);return {id:prior.id,createdAt:prior.createdAt};}
    const rateKey='feedback-rate:'+ipHash,rate=await tx.get(rateKey),daily=await tx.get('feedback-daily');
    if(rate&&rate.until>now&&(now-rate.last<60000||rate.count>=10))throw failure('反馈提交较频繁，请稍后再试。',429);
    if(daily?.day===day&&daily.count>=500)throw failure('今日反馈较多，请稍后再试或通过首页邮箱联系。',429);
    const id='FB'+now+crypto.randomUUID().replaceAll('-',''),row={id,kind:data.kind,message:data.message,contact:data.contact,orderId:data.orderId,status:'open',note:'',createdAt:now,updatedAt:now,until:now+180*DAY};
    await tx.put('feedback:'+id,row);
    await tx.put(retryKey,{id,createdAt:now,fingerprint,until:now+DAY});
    await tx.put(rateKey,{last:now,count:rate&&rate.until>now?rate.count+1:1,until:(day+1)*DAY});
    await tx.put('feedback-daily',{day,count:daily?.day===day?daily.count+1:1,until:(day+1)*DAY});
    return {id,createdAt:now};
   });
   const alarm=await this.storage.getAlarm?.();if(!alarm||alarm>now+3600000)await this.storage.setAlarm(now+3600000);
   return json({receipt},201);
  }catch(error){return json({message:error.status?error.message:'反馈服务暂时不可用，请稍后重试。'},error.status||503);}
 }
}
