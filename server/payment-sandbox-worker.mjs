// Local sandbox entry only. Production deployment uses worker/entrypoint.js.
import {DownloadBridge} from '../worker/downloads.js';
export class PaymentSandboxBridge extends DownloadBridge{
  agentOnline(){return !!this.env.SANDBOX_LIBRARY_ACCESS_CODE;}
  async agent(message){
    if(!['list','link','import','status'].includes(message.action))throw Error('Unsupported library operation');
    if(!this.env.SANDBOX_LIBRARY_ACCESS_CODE)throw Error('Local sandbox library is not configured');
    const origin=this.env.SANDBOX_LIBRARY_ORIGIN;
    if(new URL(origin).protocol!=='https:')throw Error('Library origin must use HTTPS');
    const response=await fetch(origin+'/api/tools/downloads/'+message.action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Download-Code':this.env.SANDBOX_LIBRARY_ACCESS_CODE},body:JSON.stringify(message),redirect:'manual',signal:AbortSignal.timeout(message.action==='import'?95000:25000)});
    if(!response.ok)throw Error('Shared library request failed');
    const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,raw='';
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144){await reader.cancel();throw Error('Library response too large');}raw+=decoder.decode(value,{stream:true});}
    return JSON.parse(raw+decoder.decode());
  }
}
export default{
  fetch(request,env){
    if(env.ALIPAY_ENV!=='sandbox'||!['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname))return new Response('Local sandbox only',{status:403});
    if(!new URL(request.url).pathname.startsWith('/api/tools/'))return new Response('Not found',{status:404});
    return env.PAYMENT_SANDBOX.get(env.PAYMENT_SANDBOX.idFromName('local-sandbox')).fetch(request);
  }
};
