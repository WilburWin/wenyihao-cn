import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
async function walk(dir){let out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;out.push(...e.isDirectory()?await walk(p):[p]);}return out;}
const files=[...await walk('public'),...await walk('worker'),...await walk('server')].filter(x=>/\.m?js$/.test(x));
for(const f of files){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1);}}
for(const game of ['go','mahjong','billiards']){const html=await readFile(`public/games/${game}/index.html`,'utf8');if(!html.includes('/shared/realtime.js'))throw Error(`Missing adapter: ${game}`);}
console.log(`Syntax checked ${files.length} JavaScript files; three game adapters connected.`);
