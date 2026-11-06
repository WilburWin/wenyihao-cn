import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {experimental_readRawConfig} from 'wrangler';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const {rawConfig:site}=experimental_readRawConfig({config:'wrangler.jsonc'});
const {rawConfig:music}=experimental_readRawConfig({config:'wrangler.music.jsonc'});
function run(config){
  const result=spawnSync(process.execPath,[cli,'deploy','--config',config],{stdio:'inherit',env:process.env});
  if(result.status!==0)throw Error(`Deployment stopped (${result.status??result.error?.message}). The previous completed stage remains active.`);
}
if(site.vars?.MUSIC_BACKEND_MODE!=='regional'){
  run('wrangler.jsonc');
}else{
  const service=site.services?.find(value=>value.binding==='MUSIC_BACKEND');
  const support=music.services?.find(value=>value.binding==='SITE_SUPPORT');
  if(service?.service!==music.name||support?.service!==site.name||support?.entrypoint!=='MusicSiteSupport')throw Error('Music service bindings do not match deployment names');
  if(process.argv.includes('--bootstrap')){
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
      run(config);
    }finally{
      const target=path.resolve(temporary);
      if(path.dirname(target)!==directory||!path.basename(target).startsWith('music-deploy-'))throw Error('Unexpected temporary deployment directory');
      await rm(target,{recursive:true,force:true});
    }
  }
  run('wrangler.music.jsonc');
  run('wrangler.jsonc');
}
