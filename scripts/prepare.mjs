import {rename,mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('GAME/legacy-support',{recursive:true});
for(const name of ['cloud-signal','server']){try{await rename(`public/games/billiards/${name}`,`GAME/legacy-support/${name}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
const path='public/games/billiards/src/game.js';
let code=await readFile(path,'utf8');
code=code.replace(/function pollDelay\(\) \{ return 0;[\s\S]*?\n  \}/,'function pollDelay() { return 0; }');
code=code.replace('const rtt = performance.now() - t0;','const rtt = window.gameRealtimeRTT?.() || performance.now() - t0;');
await writeFile(path,code);
