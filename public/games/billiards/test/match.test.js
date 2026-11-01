/* 无头对局压力测试: node test/match.test.js
 * 目的: 验证规则状态机不会卡死, AI 能正常打完一局, 并统计犯规率。 */
const C = require("../src/core.js");
global.BilliardsCore = C;
const { Match } = require("../src/match.js");
const AI = require("../src/ai.js");

function playGame(difficulty, seed) {
  let s = seed >>> 0;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const m = new Match({ rng });
  const stat = { shots: 0, fouls: 0, pots: 0, scratches: 0, noContact: 0, winner: null, turns: 0 };

  for (let guard = 0; guard < 400 && !m.gameOver; guard++) {
    const player = m.current;
    stat.turns++;

    if (m.ballInHand) {
      const spot = AI.planBallInHand({
        balls: m.balls, group: m.groups[player], cleared: m.isCleared(player),
        kitchen: m.kitchen, isBreak: m.breakShot, difficulty, rng
      });
      if (!m.placeCue(spot.x, spot.y)) throw new Error("AI 摆出了非法的自由球位置");
    }

    const plan = AI.planShot({
      balls: m.balls, group: m.groups[player], cleared: m.isCleared(player),
      isBreak: m.breakShot, difficulty, rng
    });
    if (!plan) break;

    if (m.needsCall(player)) m.callPocket(plan.calledPocket != null ? plan.calledPocket : 0);
    if (!m.shoot(plan.angle, plan.power, plan.spin)) break;

    const res = m.runToSettle(40);
    stat.shots++;
    if (res) {
      if (res.fouls.length) stat.fouls++;
      if (res.fouls.includes("scratch")) stat.scratches++;
      if (res.fouls.includes("nocontact")) stat.noContact++;
      stat.pots += res.pocketedObjects.length;
    }
  }
  stat.winner = m.winner;
  stat.over = m.gameOver;
  return stat;
}

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (e ? " → " + e : ""))); };

for (const diff of ["easy", "normal", "hard"]) {
  console.log("\n难度: " + diff);
  const N = 12;
  let over = 0, shots = 0, fouls = 0, pots = 0, scratches = 0, noContact = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const s = playGame(diff, 20260919 + i * 977);
    if (s.over) over++;
    shots += s.shots; fouls += s.fouls; pots += s.pots;
    scratches += s.scratches; noContact += s.noContact;
  }
  const ms = Date.now() - t0;
  const foulRate = fouls / shots, potRate = pots / shots;
  console.log(`   ${N} 局 / ${shots} 杆 / ${ms}ms  犯规率 ${(foulRate * 100).toFixed(1)}%  ` +
    `场均进球 ${(pots / N).toFixed(1)}  空杆 ${noContact}  吃袋 ${scratches}`);
  ok("所有对局都能正常分出胜负", over === N, over + "/" + N);
  ok("平均每局杆数合理(8~120)", shots / N > 8 && shots / N < 120, (shots / N).toFixed(1));
  ok("犯规率低于 35%", foulRate < 0.35, (foulRate * 100).toFixed(1) + "%");
  ok("空杆(完全没碰到球)极少", noContact / shots < 0.08, noContact + "/" + shots);
  if (diff === "hard") ok("高手 AI 进球率高于 45%", potRate > 0.45, (potRate * 100).toFixed(1) + "%");
  if (diff === "easy") ok("休闲 AI 明显更弱", potRate < 0.62, (potRate * 100).toFixed(1) + "%");
}

console.log("\n比分栏 / 已进球记录");
{
  // 找一个开球就有进球的种子, 验证开放球局时比分栏也能显示
  let found = null;
  for (let seed = 1; seed < 400 && !found; seed++) {
    let s = seed >>> 0;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const m = new Match({ rng });
    const spot = AI.planBallInHand({ balls: m.balls, group: null, cleared: false, kitchen: true, isBreak: true, difficulty: "hard", rng });
    m.placeCue(spot.x, spot.y);
    const plan = AI.planShot({ balls: m.balls, group: null, cleared: false, isBreak: true, difficulty: "hard", rng });
    m.shoot(plan.angle, plan.power, plan.spin);
    const r = m.runToSettle(40);
    if (r && r.pocketedObjects.some(id => r.respot.indexOf(id) < 0) && !r.rerack && !m.groups.p1) found = { m, r };
  }
  ok("找到开球进球的对局", !!found);
  if (found) {
    const { m, r } = found;
    const shown = m.pocketedFor("p1");
    ok("开放球局时开球进球计入开球方", shown.length > 0 && shown.every(id => r.pocketedObjects.includes(id)), shown.join(","));
    ok("对手已进球为空", m.pocketedFor("p2").length === 0);
    const snap = JSON.parse(JSON.stringify(m.snapshot()));
    const m2 = new Match({});
    m2.restore(snap);
    ok("联机快照同步已进球记录", m2.pocketedFor("p1").join(",") === shown.join(","));
    m.groups = { p1: "solids", p2: "stripes" };
    const solidsDown = m.balls.filter(b => b.pocketed && b.id > 0 && b.id < 8).length;
    ok("分组后按本组统计", m.pocketedFor("p1").length === solidsDown);
  }
}

console.log("\n联机确定性(客机预测)");
{
  // 主机和客机从同一份 JSON 快照出发、用同一组初速度出杆, 每一杆的结局必须逐位相同
  let s = 777;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const host = new Match({ rng });
  let shots = 0, mismatch = 0, games = 0;
  for (let guard = 0; guard < 300 && games < 3; guard++) {
    if (host.gameOver) { host.reset(); games++; continue; }
    const player = host.current;
    if (host.ballInHand) {
      const spot = AI.planBallInHand({ balls: host.balls, group: host.groups[player], cleared: host.isCleared(player), kitchen: host.kitchen, isBreak: host.breakShot, difficulty: "normal", rng });
      host.placeCue(spot.x, spot.y);
    }
    const plan = AI.planShot({ balls: host.balls, group: host.groups[player], cleared: host.isCleared(player), isBreak: host.breakShot, difficulty: "normal", rng });
    if (host.needsCall(player)) host.callPocket(plan.calledPocket != null ? plan.calledPocket : 0);

    const guest = new Match({ rng: () => 0.5 });
    guest.restore(JSON.parse(JSON.stringify(host.snapshot())));
    const v = C.shotVelocity(plan.angle, plan.power);
    const wire = JSON.parse(JSON.stringify(v));
    host.shoot(plan.angle, plan.power, plan.spin, wire);
    guest.shoot(plan.angle, plan.power, plan.spin, wire);
    const rh = host.runToSettle(40), rg = guest.runToSettle(40);
    shots++;
    if (rh && rh.rerack) continue;                        // 重摆用随机数, 由主机快照同步, 不比较
    const a = JSON.stringify(host.snapshot().balls), b = JSON.stringify(guest.snapshot().balls);
    if (a !== b || JSON.stringify(rh.fouls) !== JSON.stringify(rg.fouls) || rh.nextPlayer !== rg.nextPlayer) mismatch++;
  }
  ok("主客两端逐杆结果完全一致", mismatch === 0 && shots > 20, `${mismatch}/${shots}`);
}

console.log("\n对局比分 / 开球方");
{
  const m = new Match({});
  ok("第一局 p1 开球", m.breaker === "p1" && m.current === "p1" && m.ballInHand === "p1" && m.score.p1 === 0 && m.score.p2 === 0);
  // 模拟 p2 赢下第一局
  m.applyResult({ groups: m.groups, gameOver: true, winner: "p2", winReason: "eight_legal", respot: [], fouls: [] });
  ok("赢家记 1 分", m.score.p2 === 1 && m.score.p1 === 0);
  m.reset();
  ok("第二局赢家 p2 开球", m.breaker === "p2" && m.current === "p2" && m.ballInHand === "p2" && m.kitchen && m.breakShot);
  ok("新一局比分保留", m.score.p2 === 1);
  m.reset();
  ok("中途重开沿用开球方、不加分", m.breaker === "p2" && m.score.p1 + m.score.p2 === 1);
  m.applyResult({ groups: m.groups, gameOver: false, rerack: true, nextPlayer: "p1", respot: [], fouls: ["bad_break"] });
  ok("开球无效换人开球", m.breaker === "p1" && m.current === "p1" && m.ballInHand === "p1");
  m.applyResult({ groups: m.groups, gameOver: true, winner: "p1", winReason: "eight_legal", respot: [], fouls: [] });
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  const g = new Match({}); g.restore(snap);
  ok("快照同步比分与开球方", g.score.p1 === 1 && g.score.p2 === 1 && g.breaker === m.breaker && g.gameOver);
  g.reset();
  ok("客机侧同样由赢家开球", g.breaker === "p1");
  m.newSeries();
  ok("新对局清零并由 p1 开球", m.score.p1 === 0 && m.score.p2 === 0 && m.breaker === "p1");
  // 真实打一局: 结算结果带上击球者
  const r = new Match({ rng: () => 0.3 });
  r.placeCue(300, 450); r.shoot(0, 0.9, { x: 0, y: 0 }); const res = r.runToSettle(30);
  ok("结算结果带 shooter", res.shooter === "p1");
}

console.log("\n────────────────────────");
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
