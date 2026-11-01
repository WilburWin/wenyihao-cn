import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[], requests=[];
async function page(path){const ctx=await browser.newContext();const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().includes('pages.dev'))requests.push(r.url());});await p.goto(`http://127.0.0.1:8787${path}`);return p;}
try{
 await mkdir('artifacts',{recursive:true});
 const home=await page('/');assert.equal(await home.locator('.game').count(),4);
 await home.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>{img.loading='eager';return img.decode().catch(()=>{});})));await home.screenshot({path:'artifacts/home-desktop.png',fullPage:true});
 await home.setViewportSize({width:390,height:844});await home.goto('http://127.0.0.1:8787/games/');
 assert.ok(await home.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await home.screenshot({path:'artifacts/games-mobile.png',fullPage:true});
 const go=await page('/games/go/');await go.locator('[data-mode="online"]').click();await go.locator('#createRoom').click();
 await go.waitForFunction(()=>/^\d{3}$/.test(document.getElementById('roomCodeDisplay').textContent));
 const goCode=await go.locator('#roomCodeDisplay').textContent();
 const goGuest=await page('/games/go/');await goGuest.locator('[data-mode="online"]').click();await goGuest.locator('#roomCode').fill(goCode);await goGuest.locator('#joinRoom').click();
 await go.waitForFunction(()=>s.peerOnline);
 await go.locator('.intersection').nth(180).click();await goGuest.waitForFunction(()=>s.moves.length===1);
 console.log('Go: two browser sessions joined and synchronized a move.');
 const mahjong=await page('/games/mahjong/');await mahjong.locator('[data-act="create"]').click();
 await mahjong.waitForSelector('.waiting strong');const mahjongCode=await mahjong.locator('.waiting strong').textContent();
 const mahjongGuests=[];
 for(let i=0;i<3;i++){const p=await page('/games/mahjong/');await p.locator('#room').fill(mahjongCode);await p.locator('[data-act="join"]').click();await p.waitForSelector('.waiting');mahjongGuests.push(p);}
 await mahjong.locator('[data-act="start"]').click();
 for(const p of mahjongGuests)await p.waitForSelector('.my-hand .hand');
 console.log('Mahjong: four browser sessions joined, started, and received individual hands.');
 const pool=await page('/games/billiards/');await pool.locator('#lanSideBtn').click();await pool.locator('#linkCreateBtn').click();
 await pool.waitForFunction(()=>/^\d{3}$/.test(document.getElementById('linkRoomBig').textContent));
 const poolCode=await pool.locator('#linkRoomBig').textContent();
 const poolGuest=await page('/games/billiards/');await poolGuest.locator('#lanSideBtn').click();await poolGuest.locator('#linkJoinRoomCode').fill(poolCode);await poolGuest.locator('#linkJoinRoomBtn').click();
 await poolGuest.waitForFunction(()=>document.getElementById('linkJoinText').textContent.includes('已进入'));
 await pool.waitForFunction(()=>document.body.textContent.includes('好友已加入'));
 console.log('Billiards: two browser sessions joined and established a game.');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log('No browser JavaScript errors or old relay requests.');
}finally{await browser.close();}
