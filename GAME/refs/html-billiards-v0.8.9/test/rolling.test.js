const assert = require('node:assert/strict');
const { RollingVisuals, rotate, interpolate } = require('../src/rolling.js');

const close = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const ball = (id = 1) => ({ id, x: 0, y: 0, r: 16, pocketed: false, spinSide: 0 });
const R = Math.PI * 16 / 2;

{
  const v = new RollingVisuals(), b = ball();
  v.reset([b]);
  b.x = R; v.advance([b], 0.04);
  // 向右滚半个球周长的四分之一，正面转到右侧。
  const f = rotate(v.orientation(1), 0, 0, 1);
  close(f.x, 1, 1e-8); close(f.z, 0, 1e-8);
  b.x = 0; v.advance([b], 0.04);
  const back = rotate(v.orientation(1), 0, 0, 1);
  close(back.x, 0); close(back.z, 1);
  console.log('✓ 正向滚动、反向滚动与位移/半径成正比');
}
{
  const v = new RollingVisuals(), b = ball();
  v.reset([b]);
  b.y = R; v.advance([b], 0.04);
  const f = rotate(v.orientation(1), 0, 0, 1);
  close(f.y, 1, 1e-8);
  b.x = 999; v.advance([b], 0.04);
  const teleported = rotate(v.orientation(1), 0, 0, 1);
  close(teleported.y, 1, 1e-8);
  console.log('✓ 转向轴正确，重摆球/联机瞬移不产生异常滚动');
}
{
  const v = new RollingVisuals(), b = ball(0);
  v.reset([b]);
  b.spinSide = 1;
  v.advance([b], 0.25);
  const r = rotate(v.orientation(0), 1, 0, 0);
  assert.ok(r.y > 0.5 && r.y < 1);
  b.pocketed = true;
  v.advance([b], 0.04);
  close(v.orientation(0).w, 1);
  console.log('✓ 侧塞独立可见，落袋后姿态清除');
}
{
  const v = new RollingVisuals(), b = ball();
  v.reset([b]);
  for (let i = 0; i < 10000; i++) { b.x += 1; v.advance([b], 1 / 300); }
  const q = v.orientation(1);
  close(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2, 1, 1e-10);
  console.log('✓ 长时间滚动不会造成四元数漂移');
}

{
  const b = { x: 30, y: 40, px: 10, py: 20 };
  assert.deepEqual(interpolate(b, 0), { x: 10, y: 20 });
  assert.deepEqual(interpolate(b, 0.5), { x: 20, y: 30 });
  assert.deepEqual(interpolate(b, 1), { x: 30, y: 40 });
  assert.deepEqual(interpolate({ ...b, x: 1000 }, 0), { x: 1000, y: 40 });
  console.log('✓ 固定步长位置插值保持边界正确，瞬移不产生拖影');
}
{
  const v = new RollingVisuals(), b = ball();
  v.reset([b]); b.skid = 0.75; b.x += R; v.advance([b], .04);
  const xSkid = rotate(v.orientation(1), 0, 0, 1).x;
  const v2 = new RollingVisuals(), b2 = ball();
  v2.reset([b2]); b2.x += R; v2.advance([b2], .04);
  const xPure = rotate(v2.orientation(1), 0, 0, 1).x;
  assert.ok(xSkid < xPure);
  console.log('✓ 滑行时球面角速度略小于纯滚动阶段');
}
