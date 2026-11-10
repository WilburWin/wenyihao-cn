import {createServer} from 'node:http';
import {readFile,mkdir,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';
import {experimental_readRawConfig} from 'wrangler';
import {paymentSettings} from '../worker/tool-payments.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),get=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.some((value,index)=>index%2===0&&!['--port','--bridge-config'].includes(value))||args.length%2)throw Error('Usage: npm run payments:sandbox -- [--port 8791] [--bridge-config <private library configuration>]');
const port=Number(get('--port')||8791);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local sandbox port.');
const origin='http://localhost:'+port,privateDirectory=path.join(root,'.wrangler/alipay-sandbox');
const config=JSON.parse(await readFile(path.join(privateDirectory,'secret-bindings.json'),'utf8'));
if(config.ALIPAY_ENV!=='sandbox')throw Error('This command only accepts sandbox configuration.');
const {rawConfig:site}=experimental_readRawConfig({config:path.join(root,'wrangler.jsonc')});
const customDomain=site.routes?.find(route=>typeof route==='object'&&route.custom_domain)?.pattern;
let libraryCode;
if(get('--bridge-config')){
  const bridge=JSON.parse(await readFile(path.resolve(get('--bridge-config')),'utf8'));libraryCode=bridge.accessCode;
  if(typeof libraryCode!=='string'||!libraryCode)throw Error('Library access code is missing from the private configuration.');
}
const bindings={...Object.fromEntries(Object.entries(config).filter(([,value])=>typeof value==='string')),PAYMENT_SITE_ORIGIN:origin,TOOLS_PAYMENT_ENABLED:'true',...(libraryCode?{SANDBOX_LIBRARY_ACCESS_CODE:libraryCode,SANDBOX_LIBRARY_ORIGIN:'https://'+customDomain}:{})};
if(!paymentSettings(bindings).configured)throw Error('Local sandbox payment configuration is incomplete.');
const temporary=path.join(root,'.wrangler/payment-sandbox-runtime');await mkdir(temporary,{recursive:true});
const bundle=path.join(temporary,'worker.mjs');
await build({entryPoints:[path.join(root,'server/payment-sandbox-worker.mjs')],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'es2022',external:['cloudflare:*'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire('/');"}});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:bundle,compatibilityDate:'2026-10-01',compatibilityFlags:['nodejs_compat'],durableObjects:{PAYMENT_SANDBOX:{className:'PaymentSandboxBridge',useSQLite:true}},durableObjectsPersist:path.join(temporary,'storage'),bindings,log:new Log(LogLevel.NONE)}));
const publicRoot=await realpath(path.join(root,'public'));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(req.headers.host!==new URL(origin).host){res.writeHead(403);res.end('Use the local sandbox URL.');return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const response=await mf.dispatchFetch(url.href,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const pathname=decodeURIComponent(url.pathname);
  if(pathname.startsWith('/_backend')||pathname.includes('\\')||pathname.split('/').some(part=>part==='..'||part.startsWith('.'))){res.writeHead(404);res.end();return;}
  const candidate=path.resolve(publicRoot,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  const actual=await realpath(candidate),relative=path.relative(publicRoot,actual);
  if(relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(404);res.end();return;}
  const bytes=await readFile(actual);res.writeHead(200,{'Content-Type':mime[path.extname(actual).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Local sandbox request could not be completed.');}
});
server.on('error',async()=>{console.error('Local sandbox could not listen; check whether the selected port is already in use.');await mf.dispose();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
 console.log('Local Alipay sandbox: '+origin+'/tools/');
 console.log('Uses the real sandbox gateway and isolated local orders. Production payment settings are unchanged.');
 if(!libraryCode)console.log('To test actual file orders, restart with --bridge-config pointing to the private download configuration.');
});
let stopping=false;async function stop(){if(stopping)return;stopping=true;server.close();await mf.dispose();process.exit();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
