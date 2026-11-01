/* 不依赖浏览器 / 额外 npm 包：用 Canvas 路径桩检查 v0.8.9 的球面投影。
 * 真实彩色像素渲染可在带 Canvas 的浏览器中进行；这里先确保全部画质无异常坐标。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rotate, identity } = require('../src/rolling.js');

const source = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const from = source.indexOf('  function visiblePolygon(');
const to = source.indexOf('  /* ------------------------------------------------------------------\n   * 音效(含移动端解锁)', from);
assert.ok(from > 0 && to > from, '渲染函数存在');
const funcs = source.slice(from, to);
const beltPoints = Array.from({ length: 49 }, (_, i) => {
  const a = i * Math.PI / 24;
  return { c: Math.cos(a), s: Math.sin(a) };
});
const COLORS = { 1: '#ffe000', 9: '#ffe000', 10: '#245fc8', 15: '#6f2035' };
const ui = { quality: 'auto' };
let penalty = 1, calls = 0, paths = 0, text = 0;
const ctx = {};
for (const name of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'ellipse', 'fill',
  'save', 'restore', 'transform', 'fillText']) {
  ctx[name] = (...args) => {
    for (const n of args) if (typeof n === 'number') assert.ok(Number.isFinite(n), `${name} 非有限坐标 ${n}`);
    if (name === 'moveTo') paths++;
    if (name === 'fillText') text++;
    calls++;
  };
}
const make = new Function('ctx', 'rollRotate', 'beltPoints', 'ui', 'readPenalty', 'BALL_COLORS',
  'const autoPenalty = readPenalty();\n' + funcs + '\nreturn { drawStripe, drawNumber, drawCueSpots };');
function axis(x, y, z, rad) {
  return { x: x * Math.sin(rad / 2), y: y * Math.sin(rad / 2),
    z: z * Math.sin(rad / 2), w: Math.cos(rad / 2) };
}
for (const quality of ['auto', 'performance', 'high']) {
  ui.quality = quality;
  for (const q of [identity(), axis(1, 0, 0, Math.PI / 4),
    axis(1, 0, 0, Math.PI / 2), axis(0, 1, 0, Math.PI / 2),
    axis(1, 1, 0, Math.PI / 3), axis(0, 0, 1, Math.PI)]) {
    const { drawStripe, drawNumber, drawCueSpots } = make(ctx, rotate, beltPoints, ui, () => penalty, COLORS);
    for (const id of [1, 9, 10, 15, 0]) {
      const ball = { id, r: 16, x: 200, y: 200 };
      if (id > 8) drawStripe(ball, q);
      if (id === 0) drawCueSpots(ball, q);
      else { drawNumber(ball, q, false); drawNumber(ball, q, true); }
    }
  }
  console.log(`✓ ${quality} 画质：球面贴图投影没有异常坐标`);
}
assert.ok(calls > 1000 && paths > 100 && text > 30);
console.log(`✓ 数字、条纹和白球红点路径有效（${calls} 次绘制指令）`);
