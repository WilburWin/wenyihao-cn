/* =============================================================
 * HTML Billiards v0.8.9 — rolling.js
 * 仅负责球面视觉姿态，不参与规则或物理，因此不会破坏联机确定性。
 * 按实际台面位移计算无滑滚动的旋转轴与角度：angle = distance / radius。
 * ============================================================= */
(function (root) {
  "use strict";

  const identity = () => ({ x: 0, y: 0, z: 0, w: 1 });

  /** Hamilton 乘法：世界坐标新旋转 × 当前姿态。 */
  function product(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
    };
  }

  function rotate(q, x, y, z) {
    // q * (x,y,z) * conjugate(q) 的展开式，避免构建临时对象。
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    return {
      x: x + q.w * tx + q.y * tz - q.z * ty,
      y: y + q.w * ty + q.z * tx - q.x * tz,
      z: z + q.w * tz + q.x * ty - q.y * tx
    };
  }

  function normalized(q) {
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  }

  /** 每球独立的球面旋转。碰库转向不会把一整帧的往返位移抵消。 */
  class RollingVisuals {
    constructor() { this.poses = new Map(); }

    reset(balls) {
      this.poses.clear();
      for (const b of balls) this.reposition(b);
    }

    reposition(b) {
      if (!b || b.pocketed) { if (b) this.poses.delete(b.id); return; }
      this.poses.set(b.id, { x: b.x, y: b.y, q: identity(), updates: 0 });
    }

    advance(balls, dt) {
      for (const b of balls) {
        if (b.pocketed) { this.poses.delete(b.id); continue; }
        let pose = this.poses.get(b.id);
        if (!pose) {
          pose = { x: b.x, y: b.y, q: identity(), updates: 0 };
          this.poses.set(b.id, pose);
          continue;
        }
        const dx = b.x - pose.x, dy = b.y - pose.y;
        pose.x = b.x; pose.y = b.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        // 碰撞求解每次至多移动约 14 单位；过大跳变视作重摆/联机同步，不作动画。
        if (length > 0.0001 && length <= Math.max(48, b.r * 4)) {
          // 刚出杆或碰撞时会短暂滑行，球面转得稍慢于纯滚动阶段。
          const rollingPart = 1 - Math.min(0.22, Math.max(0, b.skid || 0) * 0.22);
          const half = length * rollingPart / (2 * b.r);
          const k = Math.sin(half) / length;
          pose.q = product({ x: -dy * k, y: dx * k, z: 0, w: Math.cos(half) }, pose.q);
        }
        // 额外的高低杆旋转：以平动方向为参考，在短暂滑转阶段显示跟杆/回旋。
        const top = (b.spinTop || 0) * dt * 3.0;
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (speed > 1 && Math.abs(top) > 0.00001) {
          const h = top / 2, k = Math.sin(h) / speed;
          pose.q = product({ x: -b.vy * k, y: b.vx * k, z: 0, w: Math.cos(h) }, pose.q);
        }
        // 左右塞绕垂直台面的轴转动；这只是表现层，不影响物理计算。
        const english = (b.spinSide || 0) * dt * 3.5;
        if (Math.abs(english) > 0.00001) {
          const h = english / 2;
          pose.q = product({ x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }, pose.q);
        }
        if (++pose.updates % 32 === 0) pose.q = normalized(pose.q);
      }
    }

    orientation(id) { return this.poses.get(id)?.q || identity(); }
  }

  // 固定步长模拟的渲染插值，不改变球本身的物理位置。
  function interpolate(ball, alpha) {
    if (!Number.isFinite(ball.px) || !Number.isFinite(ball.py)) return { x: ball.x, y: ball.y };
    const dx = ball.x - ball.px, dy = ball.y - ball.py;
    if (dx * dx + dy * dy > 4096) return { x: ball.x, y: ball.y }; // 摆球/同步不做长距离补间
    const t = Math.max(0, Math.min(1, alpha));
    return { x: ball.px + dx * t, y: ball.py + dy * t };
  }

  const api = { identity, product, rotate, normalized, interpolate, RollingVisuals };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BilliardsRolling = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
