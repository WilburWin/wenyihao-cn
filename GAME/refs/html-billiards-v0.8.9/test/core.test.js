/* 纯 Node 回归测试: node test/core.test.js */
const C = require("../src/core.js");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function section(t) { console.log("\n" + t); }

/* ---------- 几何 ---------- */
section("几何 / 摆球");
{
  const balls = C.buildRack();
  ok("共 16 颗球", balls.length === 16);
  ok("8 号在第三排中心", balls.find(b => b.id === 8) &&
    Math.abs(balls.find(b => b.id === 8).y - C.TABLE.cy) < 0.01);
  const back = balls.slice(11);
  const corners = [back[0], back[4]];
  const gs = corners.map(b => C.groupOf(b.id)).sort().join(",");
  ok("底排两角一全一花", gs === "solids,stripes", gs);
  let minGap = Infinity;
  for (let i = 1; i < balls.length; i++)
    for (let j = i + 1; j < balls.length; j++)
      minGap = Math.min(minGap, C.dist(balls[i].x, balls[i].y, balls[j].x, balls[j].y));
  ok("球堆无重叠且紧密", minGap >= C.BALL_D && minGap < C.BALL_D + 1, "minGap=" + minGap.toFixed(3));
  ok("顶球在置球点", Math.abs(balls[1].x - C.FOOT_SPOT.x) < 0.01);
  const seen = new Set(balls.map(b => b.id));
  ok("0-15 号球齐全", seen.size === 16);
}

/* ---------- 随机性 ---------- */
section("开球随机性");
{
  const sigs = new Set();
  for (let i = 0; i < 40; i++) sigs.add(C.buildRack().map(b => b.id).join(","));
  ok("40 次摆球有多种排列", sigs.size > 20, "unique=" + sigs.size);
}

/* ---------- 物理: 不穿墙 ---------- */
function simulate(balls, maxSec, hooks) {
  let t = 0;
  while (t < maxSec) {
    C.step(balls, C.PHYS.fixedDt, hooks);
    t += C.PHYS.fixedDt;
    if (!C.anyMoving(balls)) break;
  }
  return t;
}

section("物理");
{
  // 满力白球乱撞, 不允许逃出台面
  let escaped = 0;
  for (let trial = 0; trial < 25; trial++) {
    const cue = new C.Ball(0, 500, 400);
    const a = Math.random() * Math.PI * 2;
    const sp = C.powerToSpeed(1);
    cue.vx = Math.cos(a) * sp; cue.vy = Math.sin(a) * sp;
    const balls = [cue];
    simulate(balls, 20, { onOut: () => escaped++ });
    if (!cue.pocketed &&
      !C.insidePlayfield(cue.x, cue.y, -1)) escaped++;
  }
  ok("满力白球不会穿库飞出台面", escaped === 0, "escaped=" + escaped);

  // 停球距离
  const cue = new C.Ball(0, C.TABLE.left + 40, C.TABLE.cy + 120);
  cue.vx = C.powerToSpeed(0.5); cue.vy = 0;
  const d0 = cue.x;
  simulate([cue], 20);
  ok("中等力度白球会停下", cue.speed === 0);
  ok("中等力度滚动 1.5~3 台长",
    cue.rolled > C.TABLE.width * 1.4 && cue.rolled < C.TABLE.width * 2.8,
    (cue.rolled / C.TABLE.width).toFixed(2) + " 台长");

  // 轻推
  const soft = new C.Ball(0, 400, 450);
  soft.vx = C.powerToSpeed(0.05); soft.vy = 0;
  simulate([soft], 20);
  ok("最轻力度只走 0.2 台长以内", soft.rolled < C.TABLE.width * 0.25,
    (soft.rolled / C.TABLE.width).toFixed(3) + " 台长");
}

section("袋口行为");
{
  // 正对角袋 → 必进
  const b = new C.Ball(1, C.TABLE.left + 300, C.TABLE.top + 300);
  const dir = C.norm(C.POCKETS[0].x - b.x, C.POCKETS[0].y - b.y);
  const sp = C.powerToSpeed(0.35);
  b.vx = dir.x * sp; b.vy = dir.y * sp;
  simulate([b], 10);
  ok("正对角袋进球", b.pocketed);

  // 贴上库横穿中袋 → 不应该掉
  const r = new C.Ball(2, C.TABLE.left + 120, C.TABLE.top + C.BALL_R);
  r.vx = C.powerToSpeed(0.35); r.vy = 0;
  simulate([r], 10);
  ok("贴库球横穿中袋不掉袋", !r.pocketed, "pocketed=" + r.pocketed);

  // 贴上库滚向角袋 → 应该掉
  const c2 = new C.Ball(3, C.TABLE.left + 420, C.TABLE.top + C.BALL_R);
  c2.vx = -C.powerToSpeed(0.5); c2.vy = 0;
  simulate([c2], 10);
  ok("贴库球滚进角袋", c2.pocketed);

  // 大角度撞袋角 → 应该涮出来
  let rattled = 0;
  for (let i = 0; i < 12; i++) {
    const t = new C.Ball(4, C.TABLE.cx, C.TABLE.top + 240);
    const ang = -Math.PI / 2 + (0.60 + i * 0.02);   // 明显偏离中袋
    const s = C.powerToSpeed(0.5);
    t.vx = Math.cos(ang) * s; t.vy = Math.sin(ang) * s;
    simulate([t], 10);
    if (!t.pocketed) rattled++;
  }
  ok("大角度打中袋会被袋角挡回", rattled >= 10, "rattled=" + rattled + "/12");
}

section("旋转");
{
  // 直接测量“撞击后瞬间”的白球速度方向, 而不是长时间模拟后的落点
  function strike(spinTop, power, gap) {
    const cue = new C.Ball(0, 500, 450), obj = new C.Ball(1, 500 + (gap || 300), 450);
    cue.vx = C.powerToSpeed(power); cue.spinTop = spinTop;
    const balls = [cue, obj];
    for (let i = 0; i < 4000; i++) {
      C.step(balls, C.PHYS.fixedDt);
      if (cue.spinUsed) break;
    }
    return { cue, obj };
  }
  const draw = strike(-0.9, 0.55);
  ok("低杆撞正后白球立刻后退", draw.cue.vx < -60, "vx=" + draw.cue.vx.toFixed(1));

  const follow = strike(0.9, 0.55);
  ok("高杆撞正后白球继续前进", follow.cue.vx > 60, "vx=" + follow.cue.vx.toFixed(1));

  const stun = strike(0, 0.55);
  ok("中杆撞正后白球基本定杆", Math.abs(stun.cue.vx) < 120, "vx=" + stun.cue.vx.toFixed(1));

  // 杆法强度必须随力度缩放(v0.7.4 是常数, 轻杆也能把白球弹飞)
  const weak = strike(-1, 0.10, 120);
  const strong = strike(-1, 0.90, 120);
  ok("低杆回缩速度随力度缩放",
    Math.abs(weak.cue.vx) < Math.abs(strong.cue.vx) * 0.35,
    "weak=" + weak.cue.vx.toFixed(0) + " strong=" + strong.cue.vx.toFixed(0));
}

/* ---------- 规则 ---------- */
section("规则引擎");
function mkShot(over, ctxOver) {
  const balls = C.buildRack();
  const shot = C.newShotRecord("p1", Object.assign({ isBreak: false, group: "solids", cleared: false }, over.snap || {}));
  Object.assign(shot, over.shot || {});
  return C.resolveShot(Object.assign({
    balls, shot, groups: { p1: "solids", p2: "stripes" }, rules: {}
  }, ctxOver || {}));
}

{
  let r = mkShot({ shot: { firstContact: null } });
  ok("空杆判犯规", r.fouls.includes("nocontact"));

  r = mkShot({ shot: { firstContact: 9, railAfterContact: true } });
  ok("先碰对方球判犯规", r.fouls.includes("wrong_group"));

  r = mkShot({ shot: { firstContact: 1, cueScratch: true, pocketed: [0] } });
  ok("白球落袋判犯规并给自由球", r.fouls.includes("scratch") && r.ballInHand === "p2");

  r = mkShot({ shot: { firstContact: 1, railAfterContact: false, pocketed: [] } });
  ok("首碰后无进球无碰库判犯规", r.fouls.includes("no_rail"));

  r = mkShot({ shot: { firstContact: 1, pocketed: [1], pocketedIn: { 1: 0 } } });
  ok("合法进球续杆", r.continues && r.nextPlayer === "p1" && r.fouls.length === 0);

  // 开球不分组
  r = mkShot({
    snap: { isBreak: true, group: null },
    shot: { firstContact: 1, pocketed: [3], pocketedIn: { 3: 0 }, railed: new Set([1, 2, 5, 9]) }
  }, { groups: { p1: null, p2: null } });
  ok("开球进球后台面仍然开放", r.groups.p1 === null, JSON.stringify(r.groups));
  ok("开球进球可以续杆", r.continues);

  // 开球未进球且碰库不足
  r = mkShot({
    snap: { isBreak: true, group: null },
    shot: { firstContact: 1, pocketed: [], railed: new Set([1, 2]) }
  }, { groups: { p1: null, p2: null } });
  ok("无效开球触发重摆", r.rerack === true && r.nextPlayer === "p2");

  // 开球进 8 → 重摆 8 号, 不判负
  r = mkShot({
    snap: { isBreak: true, group: null },
    shot: { firstContact: 1, pocketed: [8], pocketedIn: { 8: 2 }, railed: new Set([1, 2, 3, 4]) }
  }, { groups: { p1: null, p2: null } });
  ok("开球进 8 不判负, 摆回置球点", !r.gameOver && r.respot.includes(8));

  // 清台前进 8 → 判负
  r = mkShot({ shot: { firstContact: 1, pocketed: [8], pocketedIn: { 8: 0 } } });
  ok("未清台打进 8 判负", r.gameOver && r.winner === "p2" && r.winReason === "eight_early");

  // 关键回归: 最后一颗组球和 8 号同杆落袋 → 必须判负
  r = mkShot({
    snap: { cleared: false, group: "solids" },
    shot: { firstContact: 1, pocketed: [1, 8], pocketedIn: { 1: 0, 8: 2 } }
  });
  ok("最后一颗组球与 8 号同杆进袋判负", r.gameOver && r.winner === "p2");

  // 清台后合法打 8 且袋口正确 → 胜
  r = mkShot({
    snap: { cleared: true, group: "solids", calledPocket: 2 },
    shot: { firstContact: 8, pocketed: [8], pocketedIn: { 8: 2 } }
  });
  ok("清台后叫袋命中获胜", r.gameOver && r.winner === "p1" && r.winReason === "eight_legal");

  // 清台后打 8 进错袋 → 判负
  r = mkShot({
    snap: { cleared: true, group: "solids", calledPocket: 2 },
    shot: { firstContact: 8, pocketed: [8], pocketedIn: { 8: 5 } }
  });
  ok("8 号进错袋判负", r.gameOver && r.winner === "p2" && r.winReason === "eight_wrong_pocket");

  // 清台后打 8 同时白球落袋 → 判负
  r = mkShot({
    snap: { cleared: true, group: "solids", calledPocket: 2 },
    shot: { firstContact: 8, pocketed: [8, 0], pocketedIn: { 8: 2 }, cueScratch: true }
  });
  ok("打 8 同时白球落袋判负", r.gameOver && r.winner === "p2");

  // 开放球局先碰 8
  r = mkShot({
    snap: { group: null },
    shot: { firstContact: 8, railAfterContact: true }
  }, { groups: { p1: null, p2: null } });
  ok("开放球局先碰 8 判犯规", r.fouls.includes("open_hit_eight"));

  // 开放球局一杆进两组 → 保持开放
  r = mkShot({
    snap: { group: null },
    shot: { firstContact: 1, pocketed: [1, 9], pocketedIn: { 1: 0, 9: 3 } }
  }, { groups: { p1: null, p2: null } });
  ok("同杆进两组保持开放并续杆", r.groups.p1 === null && r.continues);

  // 开球犯规 → 开球区自由球
  r = mkShot({
    snap: { isBreak: true, group: null },
    shot: { firstContact: 1, cueScratch: true, pocketed: [0, 2], pocketedIn: { 2: 0 }, railed: new Set([1, 2, 3, 4, 5]) }
  }, { groups: { p1: null, p2: null } });
  ok("开球白球落袋 → 对手开球区自由球", r.ballInHand === "p2" && r.kitchen === true);

  // 目标球跳出台面
  r = mkShot({ shot: { firstContact: 1, jumped: [3], railAfterContact: true } });
  ok("目标球跳出台面判犯规并摆回", r.fouls.includes("jumped") && r.respot.includes(3));
}

section("自由球落点");
{
  const balls = C.buildRack();
  ok("袋口内不能摆球", !C.validCuePlacement(balls, C.POCKETS[0].x, C.POCKETS[0].y, false));
  ok("台面外不能摆球", !C.validCuePlacement(balls, 50, 50, false));
  ok("开球区限制生效", !C.validCuePlacement(balls, C.HEAD_STRING_X + 100, C.TABLE.cy, true));
  ok("开球区内合法", C.validCuePlacement(balls, C.HEAD_STRING_X - 100, C.TABLE.cy, true));
  ok("紧贴其它球不能摆", !C.validCuePlacement(balls, C.FOOT_SPOT.x + 5, C.TABLE.cy, false));
}

console.log("\n────────────────────────");
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
