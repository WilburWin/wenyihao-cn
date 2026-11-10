import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function prepareDownloadAgent(){
  const code=await readFile(new URL('../server/download-agent.mjs',import.meta.url),'utf8');
  const folder=new URL('../public/_backend/',import.meta.url);await mkdir(folder,{recursive:true});
  await writeFile(new URL('download-agent.mjs',folder),code);
  await writeFile(new URL('manifest.json',folder),JSON.stringify({sha256:createHash('sha256').update(code).digest('hex')}));
}
