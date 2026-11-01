import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const ctx={window:null,crypto:webcrypto,Date,Math};ctx.window=ctx;vm.runInNewContext(fs.readFileSync('engine.js','utf8'),ctx);const M=ctx.Mahjong;
const assert=(ok,message)=>{if(!ok)throw Error(message)};
function count(g){const found=Array(34).fill(0);for(const t of g.wall)found[t]++;for(const seat of g.seats){for(const t of seat.hand)found[t]++;for(const t of seat.discards)found[t]++;for(const m of seat.melds)for(const t of m.tiles)found[t]++;}return found;}
for(const rule of Object.values(M.RULES))for(let trial=0;trial<12;trial++){
 const g=M.create('solo','电脑东',rule.id);for(const seat of g.seats)seat.type='bot';M.start(g);
 assert(g.phase==='discard',`${rule.id} bots completed setup`);
 for(let step=0;step<450&&g.phase!=='finished';step++){
   g.nextBotAt=0;M.tick(g);
   const found=count(g);for(let t=0;t<34;t++)assert(found[t]===(t<rule.tiles?4:0),`${rule.id} trial ${trial} step ${step}: ${t} has ${found[t]} tiles`);
   assert(g.seats.every(s=>s.melds.every(m=>m.tiles.length===(m.kind==='gang'?4:3))),`${rule.id} malformed meld`);
 }
 assert(g.phase==='finished',`${rule.id} bots got stuck`);
 assert(rule.blood||g.winners.length<=1,`${rule.id} extra winner`);
}
const c=M.create('solo','东家');M.start(c);
const standard=[0,0,0,1,2,3,10,11,12,18,19,20,27,27];
assert(M.winning(standard),'standard four groups + pair');
const seven=[0,0,0,0,8,8,9,9,17,17,18,18,26,26];
assert(M.winning(seven),'four identical tiles count as two seven-pairs pairs');
const orphans=[0,8,9,17,18,26,27,28,29,30,31,32,33,33];assert(M.winning(orphans),'thirteen orphans');
assert(!M.winning([...orphans.slice(0,13),25]),'invalid orphans');
const ding=M.create('solo','东家','sichuan');M.start(ding);assert(ding.phase==='dingque','Sichuan waits for human suit choices');ding.seats[0].type='bot';
for(let i=0;i<4;i++){ding.nextBotAt=0;M.tick(ding);}assert(ding.phase==='discard'&&ding.seats[0].missing!==null,'disconnected human auto-selects missing suit');
const kinds=(g,seat)=>M.options(g,seat).map(x=>x.kind);
const expectThrow=(fn,msg)=>{let threw=false;try{fn()}catch{threw=true}assert(threw,msg)};
const classic=M.create('solo','东家');M.start(classic);
classic.phase='claim';classic.last={tile:4,from:0};classic.responses={};classic.seats[1].type='human';classic.seats[1].hand=[4,4,4,0,0,1,1,2,2,3,3,5,5];classic.wall=[];
assert(kinds(classic,1).includes('peng')&&!kinds(classic,1).includes('gang'),'empty wall allows peng but blocks exposed kong');
expectThrow(()=>M.action(classic,1,'claim',{kind:'gang'}),'empty wall cannot claim kong');
classic.wall=[27];assert(kinds(classic,1).includes('gang'),'live wall allows exposed kong');
const gd=M.create('solo','东家','guangdong');M.start(gd);gd.phase='claim';gd.last={tile:4,from:0};gd.responses={};gd.seats[1].type='human';gd.seats[1].hand=[2,3,4,4,4,0,0,1,1,5,5,6,6];
assert(!kinds(gd,1).includes('chi')&&!kinds(gd,1).includes('hu'),'Guangdong disables chi and discard win');
const sc=M.create('solo','东家','sichuan');M.start(sc);sc.seats[0].missing=0;sc.phase='discard';sc.turn=0;sc.seats[0].hand=[0,1,2,9,9,9,10,10,10,18,18,18,19,19];
expectThrow(()=>M.action(sc,0,'discard',{tile:9}),'Sichuan missing suit must be discarded first');
assert(!M.view(sc,0).canHu,'Sichuan cannot win before clearing missing suit');
sc.seats[0].hand=[0,0,0,0,9,9,9,10,10,10,18,18,18,19];sc.wall=[20];assert(!M.view(sc,0).gangTiles.includes(0),'Sichuan missing suit cannot be konged');
const priority=M.create('solo','东家');M.start(priority);priority.phase='claim';priority.last={tile:27,from:0};priority.responses={};priority.seats[0].discards.push(27);priority.seats[1].type='human';priority.seats[1].hand=[0,0,0,1,2,3,10,11,12,18,19,20,27];priority.seats[2].type='human';priority.seats[2].hand=[27,27,0,1,2,3,4,5,6,9,10,11,12];priority.seats[3].type='human';priority.seats[3].hand=[0,1,2,3,4,5,6,7,8,9,10,11,12];
assert(kinds(priority,1).includes('hu')&&kinds(priority,2).includes('peng'),'competing claims available');
M.action(priority,2,'claim',{kind:'peng'});assert(priority.phase==='claim','claim waits for other players');
M.action(priority,3,'claim',{kind:'pass'});M.action(priority,1,'claim',{kind:'hu'});
assert(priority.phase==='finished'&&priority.winners[0]===1&&priority.seats[0].discards.length===0,'win outranks peng, consumed river tile');
const blood=M.create('solo','东家','sichuan');M.start(blood);blood.phase='claim';blood.last={tile:9,from:0};blood.responses={};blood.seats[0].discards.push(9);blood.seats[1].type='human';blood.seats[1].missing=2;blood.seats[1].hand=[0,0,0,1,2,3,3,4,5,9,10,11,9];blood.seats[2].type='human';blood.seats[3].type='human';blood.wall=[4,5,6];
assert(kinds(blood,1).includes('hu'),'Sichuan discard win available after clearing missing suit');
M.action(blood,1,'claim',{kind:'hu'});M.action(blood,2,'claim',{kind:'pass'});M.action(blood,3,'claim',{kind:'pass'});
assert(blood.winners[0]===1&&blood.phase==='discard'&&blood.turn===2&&blood.seats[1].won,'Sichuan continues, skipping winner');
assert(!M.winning([0,0,0,0,0,0,8,8,9,9,17,17,18,18]),'impossible five copies of a tile rejected');
const turn=M.create('solo','东家');M.start(turn);expectThrow(()=>M.action(turn,1,'discard',{tile:turn.seats[1].hand[0]}),'other player cannot discard');
console.log('v3.0: 36 full bot games, tile conservation per step, winning forms, empty-wall kong, Guangdong restrictions, Sichuan missing suit, claim priority, blood continuation, turn validation, disconnected dingque passed');
