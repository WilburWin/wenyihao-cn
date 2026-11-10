import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {experimental_readRawConfig} from 'wrangler';
import {deploymentEnvironment} from './deploy-environment.mjs';
import {prepareDownloadAgent} from './prepare-download-agent.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const {rawConfig:site}=experimental_readRawConfig({config:'wrangler.jsonc'});
const {rawConfig:music}=experimental_readRawConfig({config:'wrangler.music.jsonc'});
const args=process.argv.slice(2);
const allowed=new Set(['--bootstrap','--dry-run','--only=site','--only=music']);
if(args.some(value=>!allowed.has(value))||args.filter(value=>value.startsWith('--only=')).length>1)throw Error('Usage: node scripts/deploy.mjs [--bootstrap] [--dry-run] [--only=site|--only=music]');
const only=args.find(value=>value.startsWith('--only='))?.slice(7),dryRun=args.includes('--dry-run');
if(args.includes('--bootstrap')&&(dryRun||only))throw Error('--bootstrap must be used without --dry-run or --only');
// Validate the connected CI target before any stage can change a deployment.
deploymentEnvironment(process.env,{siteName:site.name,targetName:site.name});
if(only!=='music')await prepareDownloadAgent();
function run(config,targetName){
  const env=deploymentEnvironment(process.env,{siteName:site.name,targetName});
  console.log(`\n${dryRun?'Checking':'Deploying'} Worker: ${targetName}`);
  const command=[cli,'deploy','--config',config,'--name',targetName,...(dryRun?['--dry-run']:[])];
  const result=spawnSync(process.execPath,command,{stdio:'inherit',env});
  if(result.status!==0)throw Error(`Deployment stopped (${result.status??result.error?.message}). The previous completed stage remains active.`);
}
if(only==='site'||(site.vars?.MUSIC_BACKEND_MODE!=='regional'&&only!=='music')){
  run('wrangler.jsonc',site.name);
}else{
  const service=site.services?.find(value=>value.binding==='MUSIC_BACKEND');
  const support=music.services?.find(value=>value.binding==='SITE_SUPPORT');
  if(service?.service!==music.name||support?.service!==site.name||support?.entrypoint!=='MusicSiteSupport')throw Error('Music service bindings do not match deployment names');
  if(args.includes('--bootstrap')){
    const directory=path.resolve(root,'.wrangler');
    await mkdir(directory,{recursive:true});
    const temporary=await mkdtemp(path.join(directory,'music-deploy-'));
    try{
      // Break the first-deployment binding cycle. This stage serves the existing
      // local music implementation and publishes the private crypto entrypoint.
      const interim={...site,main:path.resolve(root,site.main),
        vars:{...site.vars,MUSIC_BACKEND_MODE:'local'},
        services:(site.services||[]).filter(value=>value.binding!=='MUSIC_BACKEND'),
        assets:{...site.assets,directory:path.resolve(root,site.assets.directory)}};
      const config=path.join(temporary,'wrangler.json');
      await writeFile(config,JSON.stringify(interim,null,2));
      run(config,site.name);
    }finally{
      const target=path.resolve(temporary);
      if(path.dirname(target)!==directory||!path.basename(target).startsWith('music-deploy-'))throw Error('Unexpected temporary deployment directory');
      await rm(target,{recursive:true,force:true});
    }
  }
  run('wrangler.music.jsonc',music.name);
  if(only!=='music')run('wrangler.jsonc',site.name);
}
