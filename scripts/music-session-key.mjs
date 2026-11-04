import {randomBytes} from 'node:crypto';
import {readFile,appendFile} from 'node:fs/promises';

// An encryption key, not a Bilibili credential. Pipe stdout directly to Wrangler
// for production; --local writes only the gitignored development environment.
if(process.argv.includes('--local')){
  const path=new URL('../.dev.vars',import.meta.url);
  const existing=await readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  if(/^\s*MUSIC_SESSION_KEY\s*=/m.test(existing))console.log('Local music session key is already configured.');
  else{
    await appendFile(path,`${existing&&!existing.endsWith('\n')?'\n':''}MUSIC_SESSION_KEY=${randomBytes(32).toString('base64url')}\n`,{mode:0o600});
    console.log('Local music session key added to .dev.vars (gitignored).');
  }
}else process.stdout.write(randomBytes(32).toString('base64url')+'\n');
