const assert = require('node:assert/strict');
const C = require('../src/core.js');
const { Match } = require('../src/match.js');

// 相同初速度：滑行阶段应比已稳定滚动的球更快损失平动速度。
const steady = new C.Ball(1, 400, 450), sliding = new C.Ball(1, 400, 450);
steady.vx = sliding.vx = 650;
sliding.skid = 0.75;
C.step([steady], C.PHYS.fixedDt);
C.step([sliding], C.PHYS.fixedDt);
assert.ok(sliding.vx < steady.vx);
for (let i = 0; i < 100; i++) C.step([sliding], C.PHYS.fixedDt);
assert.equal(sliding.skid, 0);
console.log('✓ 撞击后滑转阻力较大，并平滑过渡至稳定滚动');

// 联机快照必须保存新物理状态，避免主客机半途恢复后的结算结果不同。
const m = new Match({ rng: () => 0.7 });
assert.ok(m.placeCue(400, 440));
assert.ok(m.shoot(0, 0.6, { x: 0.22, y: -0.3 }));
for (let i = 0; i < 35; i++) m.step(C.PHYS.fixedDt);
const s = JSON.parse(JSON.stringify(m.snapshot()));
assert.ok(s.balls.some(b => b.sk > 0));
const other = new Match({ rng: () => 0.7 });
assert.equal(other.restore(s), true);
assert.deepEqual(other.snapshot(), m.snapshot());
// match 的回合记录不随中途快照发送，故这里只对比纯物理轨迹（规则联机另有测试）。
for (let i = 0; i < 9000 && (C.anyMoving(m.balls) || C.anyMoving(other.balls)); i++) {
  C.step(m.balls, C.PHYS.fixedDt);
  C.step(other.balls, C.PHYS.fixedDt);
}
const position = balls => balls.map(b => [b.id, b.x, b.y, b.vx, b.vy, b.pocketed, b.skid]);
assert.deepEqual(position(other.balls), position(m.balls));
console.log('✓ 球的滑转状态可序列化，快照恢复后的纯物理轨迹一致');
