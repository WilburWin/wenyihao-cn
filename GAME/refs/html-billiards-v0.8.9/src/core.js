/* =============================================================
 * HTML Billiards v0.8.9  —  core.js
 * 世界常量 / 球桌几何 / 物理求解器 / 规则引擎(纯函数, 无 DOM 依赖)
 * 该文件不接触任何 DOM, 可单独用 Node 跑回归测试。
 * ============================================================= */
(function (root) {
  "use strict";

  /* ---------------- 基本常量 ---------------- */

  const VERSION = "0.8.9";
  const WORLD_W = 1600;
  const WORLD_H = 900;

  // 台面按真实 9ft 台比例: 有效台面 2:1, 球直径 = 台面短边 / 20.75
  const TABLE = {
    left: 135, right: 1465, top: 118, bottom: 782,
    width: 1330, height: 664,
    cx: 800, cy: 450
  };
  const BALL_R = 16;
  const BALL_D = BALL_R * 2;

  // 开球线(1/4 处)与置球点(3/4 处), 与真实台球一致
  const HEAD_STRING_X = TABLE.left + TABLE.width * 0.25;   // 467.5
  const FOOT_SPOT = { x: TABLE.left + TABLE.width * 0.75, y: TABLE.cy }; // 1132.5, 450

  /* ---------------- 袋口几何 ----------------
   * v0.7.4 的做法: “某段库边直接不存在”, 于是球从缺口飞出界再判定进袋,
   * 等价于一个 100px 宽的洞, 且完全没有袋角。这里改为真实结构:
   *   - 库边 = 一组线段 (袋口处断开)
   *   - 袋角 = 向外张开的斜切线段(jaw), 球会被弹回 → 可以“涮袋”
   *   - 落袋 = 球心进入袋喉圆
   */
  const CORNER_OPEN = 46;   // 角袋: 库边自角点起断开的长度 (袋口 ≈ 46*√2 ≈ 65 ≈ 2.03 球径)
  const SIDE_OPEN = 40;   // 中袋: 半宽 (袋口 80 ≈ 2.5 球径, 但袋喉更靠外, 见下)
  const JAW_DEPTH = 24;   // 斜切深度
  const JAW_LIFT = 1.6;  // 斜切起点向外抬起, 避免贴库球被端点蹭到
  const CORNER_CAPTURE = 31;
  const SIDE_CAPTURE = 26;

  const POCKETS = [
    { id: 0, type: "corner", name: "左上", x: TABLE.left - 3.5, y: TABLE.top - 3.5, r: CORNER_CAPTURE },
    { id: 1, type: "side", name: "上中", x: TABLE.cx, y: TABLE.top - 14, r: SIDE_CAPTURE },
    { id: 2, type: "corner", name: "右上", x: TABLE.right + 3.5, y: TABLE.top - 3.5, r: CORNER_CAPTURE },
    { id: 3, type: "corner", name: "左下", x: TABLE.left - 3.5, y: TABLE.bottom + 3.5, r: CORNER_CAPTURE },
    { id: 4, type: "side", name: "下中", x: TABLE.cx, y: TABLE.bottom + 14, r: SIDE_CAPTURE },
    { id: 5, type: "corner", name: "右下", x: TABLE.right + 3.5, y: TABLE.bottom + 3.5, r: CORNER_CAPTURE }
  ];

  function seg(x1, y1, x2, y2, kind) {
    return { x1, y1, x2, y2, kind: kind || "rail",
      minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
      minY: Math.min(y1, y2), maxY: Math.max(y1, y2) };
  }

  // 库边线段(袋口断开)
  const CUSHIONS = (() => {
    const L = TABLE.left, R = TABLE.right, T = TABLE.top, B = TABLE.bottom, C = TABLE.cx;
    const s = [];
    // 上下长库, 被中袋切成两段
    s.push(seg(L + CORNER_OPEN, T, C - SIDE_OPEN, T));
    s.push(seg(C + SIDE_OPEN, T, R - CORNER_OPEN, T));
    s.push(seg(L + CORNER_OPEN, B, C - SIDE_OPEN, B));
    s.push(seg(C + SIDE_OPEN, B, R - CORNER_OPEN, B));
    // 左右短库
    s.push(seg(L, T + CORNER_OPEN, L, B - CORNER_OPEN));
    s.push(seg(R, T + CORNER_OPEN, R, B - CORNER_OPEN));

    // 角袋斜切: 从库边端点向台外张开
    const corner = (cx, cy, sx, sy) => {
      // sx, sy 为“指向台内”的方向
      s.push(seg(cx + sx * CORNER_OPEN, cy - sy * JAW_LIFT,
        cx + sx * CORNER_OPEN * 0.40, cy - sy * JAW_DEPTH, "jaw"));
      s.push(seg(cx - sx * JAW_LIFT, cy + sy * CORNER_OPEN,
        cx - sx * JAW_DEPTH, cy + sy * CORNER_OPEN * 0.40, "jaw"));
    };
    corner(L, T, 1, 1);
    corner(R, T, -1, 1);
    corner(L, B, 1, -1);
    corner(R, B, -1, -1);

    // 中袋斜切: 向外张开(真实中袋袋角外张, 贴库球不会掉)
    const side = (cy, sy) => {
      s.push(seg(C - SIDE_OPEN, cy - sy * JAW_LIFT, C - SIDE_OPEN - 12, cy - sy * JAW_DEPTH, "jaw"));
      s.push(seg(C + SIDE_OPEN, cy - sy * JAW_LIFT, C + SIDE_OPEN + 12, cy - sy * JAW_DEPTH, "jaw"));
    };
    side(TABLE.top, 1);
    side(TABLE.bottom, -1);
    return s;
  })();

  /* ---------------- 物理参数 ----------------
   * 由“可玩性目标”反推, 不是拍脑袋:
   *   中等力度 (power=0.5) 白球空杆应滚约 2 个台长
   *   满力开球 ≈ 3.2 台长/秒
   */
  const PHYS = {
    maxSpeed: 4200,      // 单位/秒, 约 3.2 台长/秒
    minSpeed: 260,       // power→0 时的最小出杆速度(轻推)
    powerGamma: 1.30,    // 力度曲线: 低力度区间更细腻, 0.5 力度 ≈ 1.8 台长
    rollDecel: 760,      // 滚动摩擦减速度 (单位/秒²)
    slideExtra: 1.25,    // 杆法带来的滑动摩擦系数
    skidExtra: 0.24,     // 出杆/球碰撞后的短暂滑行阻力(逐渐过渡到纯滚动)
    skidFade: 3.2,       // 滑转程度每秒降低(物理秒，低帧率结果不变)
    stopSpeed: 11,       // 低于该速度直接停球
    ballRestitution: 0.94,
    railRestitution: 0.82,
    railTangentFriction: 0.72,
    spinDecay: 2.6,      // 旋转自然衰减 (1/秒)
    followGain: 0.62,    // 高/低杆对白球分离速度的贡献 (相对撞击前速度)
    sideGain: 0.10,      // 左右塞对白球切线速度的贡献
    throwGain: 0.035,    // 左右塞传给目标球的“抛球”效应
    railSpinGain: 0.40,  // 左右塞对库边出射角的影响
    fixedDt: 1 / 300,    // 固定步长: 4200/300 = 14 单位/步 < 球直径 32, 不会穿透
    maxSubSteps: 12
  };

  /* ---------------- 工具 ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  /* 跨浏览器确定性: 联机时主客两端各自模拟同一杆, 结果必须逐位相同。
   * Math.hypot / Math.exp / Math.pow 在 V8 与 JavaScriptCore 之间可能差 1 ulp, 混沌的球堆会把它放大成
   * 完全不同的结局; 而 + - * / 与 Math.sqrt 由 IEEE-754 保证逐位一致, 所以物理只用这些。 */
  const hypot = (x, y) => Math.sqrt(x * x + y * y);
  /** 只用四则运算的 e^x (缩放到 |x|<=0.05 后 Taylor 展开再平方回去) */
  function detExp(x) {
    let n = 0;
    while (Math.abs(x) > 0.05 && n < 30) { x /= 2; n++; }
    let term = 1, sum = 1;
    for (let k = 1; k <= 10; k++) { term = term * x / k; sum += term; }
    while (n-- > 0) sum *= sum;
    return sum;
  }
  const dist = (ax, ay, bx, by) => hypot(ax - bx, ay - by);
  function norm(x, y) { const d = hypot(x, y) || 1; return { x: x / d, y: y / d }; }

  function groupOf(id) {
    if (id === 0) return "cue";
    if (id === 8) return "eight";
    return id < 8 ? "solids" : "stripes";
  }
  const otherGroup = g => (g === "solids" ? "stripes" : "solids");
  const otherPlayer = p => (p === "p1" ? "p2" : "p1");

  function pointSegDist(px, py, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return { d: dist(px, py, s.x1, s.y1), cx: s.x1, cy: s.y1 };
    const t = clamp(((px - s.x1) * dx + (py - s.y1) * dy) / l2, 0, 1);
    const cx = s.x1 + t * dx, cy = s.y1 + t * dy;
    return { d: dist(px, py, cx, cy), cx, cy };
  }

  /* ---------------- Ball ---------------- */
  class Ball {
    constructor(id, x, y) {
      this.id = id;
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.r = BALL_R;
      this.pocketed = false;
      this.spinTop = 0;    // >0 高杆(跟), <0 低杆(缩)
      this.spinSide = 0;   // >0 右塞, <0 左塞
      this.spinUsed = false;
      this.rolled = 0;     // 本杆滚动距离, 用于音效/调试
      this.skid = 0;       // 撞击后短暂滑动的程度，0 为稳定滚动
    }
    get speed() { return hypot(this.vx, this.vy); }
    reset() { this.vx = this.vy = 0; this.spinTop = this.spinSide = 0; this.spinUsed = false; this.skid = 0; }
  }

  /* ---------------- 摆球 ----------------
   * 符合 WPA: 8 号固定在第三排中心, 底排两角一花一全, 其余随机。
   * v0.7.4 是写死的球序 → 每局开球完全一样, 没有任何变数。
   */
  function buildRack(rng) {
    rng = rng || Math.random;
    const solids = [1, 2, 3, 4, 5, 6, 7];
    const stripes = [9, 10, 11, 12, 13, 14, 15];
    const shuffle = a => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    shuffle(solids); shuffle(stripes);

    const slots = new Array(15).fill(null);
    slots[4] = 8;                       // 第三排中心 (索引: 0 |1,2 |3,4,5 |6..9 |10..14)
    const backCornerA = 10, backCornerB = 14;
    if (rng() < 0.5) { slots[backCornerA] = solids.pop(); slots[backCornerB] = stripes.pop(); }
    else { slots[backCornerA] = stripes.pop(); slots[backCornerB] = solids.pop(); }

    const rest = shuffle(solids.concat(stripes));
    for (let i = 0; i < 15; i++) if (slots[i] === null) slots[i] = rest.pop();

    const rowGap = BALL_D * Math.cos(Math.PI / 6) + 0.18; // 27.9
    const colGap = BALL_D + 0.18;
    const balls = [new Ball(0, HEAD_STRING_X, TABLE.cy)];
    let k = 0;
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i <= row; i++) {
        const x = FOOT_SPOT.x + row * rowGap;
        const y = FOOT_SPOT.y + (i - row / 2) * colGap;
        balls.push(new Ball(slots[k++], x, y));
      }
    }
    return balls;
  }

  /* ---------------- 位置合法性 ---------------- */
  function insidePlayfield(x, y, inset) {
    inset = inset == null ? BALL_R : inset;
    return x > TABLE.left + inset && x < TABLE.right - inset &&
      y > TABLE.top + inset && y < TABLE.bottom - inset;
  }

  function inAnyPocket(x, y, pad) {
    pad = pad || 0;
    for (const p of POCKETS) if (dist(x, y, p.x, p.y) < p.r + pad) return true;
    return false;
  }

  function spotIsFree(balls, x, y, ignoreId) {
    for (const b of balls) {
      if (b.pocketed || b.id === ignoreId) continue;
      if (dist(x, y, b.x, b.y) < BALL_D + 0.6) return false;
    }
    return true;
  }

  /** 把球摆回置球点(沿底库方向的长线), 用于跳出台面的球和开球进 8 的重置 */
  function spotBall(balls, ball) {
    ball.pocketed = false;
    ball.reset();
    const y = TABLE.cy;
    for (let d = 0; d <= TABLE.width; d += 4) {
      for (const x of (d === 0 ? [FOOT_SPOT.x] : [FOOT_SPOT.x + d, FOOT_SPOT.x - d])) {
        if (!insidePlayfield(x, y, BALL_R + 1)) continue;
        if (!spotIsFree(balls, x, y, ball.id)) continue;
        ball.x = x; ball.y = y; return true;
      }
    }
    ball.x = FOOT_SPOT.x; ball.y = y;
    return false;
  }

  /* ---------------- 碰撞求解 ---------------- */

  /** 球 vs 库边(含袋角斜切)。返回是否发生碰撞 */
  function collideCushions(b, hooks) {
    let hit = false;
    for (const s of CUSHIONS) {
      // 绝大多数球距离库边很远：先做无平方根的包围盒排除。
      if (b.x < s.minX - b.r || b.x > s.maxX + b.r ||
        b.y < s.minY - b.r || b.y > s.maxY + b.r) continue;
      const p = pointSegDist(b.x, b.y, s);
      if (p.d >= b.r) continue;
      let nx = b.x - p.cx, ny = b.y - p.cy;
      let nd = hypot(nx, ny);
      if (nd < 1e-6) {           // 圆心正好落在线段上, 用线段法线兜底
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        const n = norm(-dy, dx);
        nx = n.x; ny = n.y; nd = 1;
      }
      nx /= nd; ny /= nd;

      b.x = p.cx + nx * b.r;
      b.y = p.cy + ny * b.r;

      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        const tx = -ny, ty = nx;
        let vt = b.vx * tx + b.vy * ty;
        // 左右塞改变出射角(真实台球的“吃库变线”)
        if (b.spinSide !== 0) {
          vt += b.spinSide * Math.abs(vn) * PHYS.railSpinGain;
          b.spinSide *= -0.42;
        }
        vt *= PHYS.railTangentFriction + 0.28;   // 库皮切向损耗
        const outN = -vn * PHYS.railRestitution;
        b.vx = nx * outN + tx * vt;
        b.vy = ny * outN + ty * vt;
        b.spinTop *= 0.55;
        b.skid = Math.max(b.skid, Math.min(0.65, Math.abs(vn) / PHYS.maxSpeed));
        hit = true;
        if (hooks && hooks.onRail) hooks.onRail(b, Math.abs(vn));
      }
    }
    return hit;
  }

  /** 球 vs 球, 等质量弹性碰撞 + 位置修正 + 塞的抛球效应 */
  function collideBalls(list, hooks) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.pocketed) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.pocketed) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const minD = a.r + b.r;
        // AABB 排除远距离球对，降低密集开球以外的大量无效计算。
        if (dx <= -minD || dx >= minD || dy <= -minD || dy >= minD) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD) continue;

        let d = Math.sqrt(d2), nx, ny;
        if (d < 1e-6) { nx = 1; ny = 0; d = 1e-6; } else { nx = dx / d; ny = dy / d; }

        const overlap = (minD - d) * 0.5 + 0.001;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;

        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel >= 0) continue;

        const cue = a.id === 0 ? a : (b.id === 0 ? b : null);
        const obj = cue ? (cue === a ? b : a) : null;
        const preSpeed = cue ? cue.speed : 0;

        if (hooks && hooks.onContact) hooks.onContact(a, b, Math.abs(rel));

        const jn = -(1 + PHYS.ballRestitution) * rel * 0.5;
        a.vx -= jn * nx; a.vy -= jn * ny;
        b.vx += jn * nx; b.vy += jn * ny;
        // 碰撞瞬间新获得的平动速度会先经历极短滑行，再由台呢摩擦滚起来。
        const impactSkid = Math.min(0.75, Math.abs(jn) / PHYS.maxSpeed);
        a.skid = Math.max(a.skid, impactSkid);
        b.skid = Math.max(b.skid, impactSkid);

        // 杆法: 只在白球的第一次实体碰撞时释放, 且强度随击球速度缩放
        if (cue && obj && !cue.spinUsed) {
          const sgn = cue === a ? 1 : -1;          // 由白球指向目标球
          const ux = nx * sgn, uy = ny * sgn;
          const tx = -uy, ty = ux;
          cue.vx += ux * cue.spinTop * preSpeed * PHYS.followGain;
          cue.vy += uy * cue.spinTop * preSpeed * PHYS.followGain;
          cue.vx += tx * cue.spinSide * preSpeed * PHYS.sideGain;
          cue.vy += ty * cue.spinSide * preSpeed * PHYS.sideGain;
          obj.vx += tx * cue.spinSide * preSpeed * PHYS.throwGain;
          obj.vy += ty * cue.spinSide * preSpeed * PHYS.throwGain;
          cue.spinTop *= 0.22;
          cue.spinSide *= 0.55;
          cue.spinUsed = true;
        }
      }
    }
  }

  /**
   * 单步物理推进。
   * hooks: { onRail(ball, strength), onContact(a,b,strength), onPocket(ball, pocket), onOut(ball) }
   */
  function step(balls, dt, hooks) {
    const live = [];
    for (const b of balls) if (!b.pocketed) live.push(b);

    for (const b of live) {
      b.px = b.x; b.py = b.y;
      const sp = b.speed;
      if (sp <= 0) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rolled += sp * dt;

      const slide = clamp(Math.abs(b.spinTop) * 0.9 + Math.abs(b.spinSide) * 0.45, 0, 1);
      const skid = b.skid || 0;
      const decel = PHYS.rollDecel * (1 + PHYS.slideExtra * slide + PHYS.skidExtra * skid);
      const ns = sp - decel * dt;
      if (ns <= PHYS.stopSpeed) {
        b.vx = 0; b.vy = 0; b.spinTop = 0; b.spinSide = 0; b.skid = 0;
      } else {
        const k = ns / sp; b.vx *= k; b.vy *= k;
        b.skid = Math.max(0, skid - PHYS.skidFade * dt);
      }

      const decay = detExp(-PHYS.spinDecay * dt);
      b.spinTop *= decay;
      b.spinSide *= decay * 1.02;
    }

    // 落袋优先于库边, 否则袋角斜切会把即将进袋的球推出来
    // 扫掠式落袋判定: 高速球一步可走 14 单位, 点判定会从袋喉边缘“擦过去”逃掉
    for (const b of live) {
      if (b.pocketed) continue;
      const sweep = { x1: b.px, y1: b.py, x2: b.x, y2: b.y };
      for (const p of POCKETS) {
        const near = pointSegDist(p.x, p.y, sweep);
        if (near.d >= p.r) continue;
        // 必须是朝袋口方向运动, 排除数值抖动
        if ((p.x - b.px) * b.vx + (p.y - b.py) * b.vy < 0 && dist(b.x, b.y, p.x, p.y) >= p.r) continue;
        b.x = p.x; b.y = p.y;
        b.pocketed = true; b.reset();
        if (hooks && hooks.onPocket) hooks.onPocket(b, p);
        break;
      }
    }

    for (const b of live) if (!b.pocketed) collideCushions(b, hooks);

    // 兜底: 数值异常导致球逃出台面 → 判为跳球(犯规), 而不是当作进袋
    for (const b of live) {
      if (b.pocketed) continue;
      if (b.x < TABLE.left - 70 || b.x > TABLE.right + 70 ||
        b.y < TABLE.top - 70 || b.y > TABLE.bottom + 70) {
        b.pocketed = true; b.reset();
        if (hooks && hooks.onOut) hooks.onOut(b);
      }
    }

    collideBalls(live, hooks);
    collideBalls(live, null);   // 第二次迭代, 处理密集球堆的连锁重叠
  }

  function anyMoving(balls) {
    for (const b of balls) if (!b.pocketed && (b.vx !== 0 || b.vy !== 0)) return true;
    return false;
  }

  /** 出杆初速度。联机时由出杆方算好后原样发给对端, 避免两端各自调用 cos/sin/pow 产生差异 */
  function shotVelocity(angle, power) {
    const sp = powerToSpeed(power);
    return { vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp };
  }

  function powerToSpeed(power) {
    const p = clamp(power, 0, 1);
    return PHYS.minSpeed + (PHYS.maxSpeed - PHYS.minSpeed) * Math.pow(p, PHYS.powerGamma);
  }

  /* =============================================================
   * 规则引擎 (WPA 8 球, 可配置)
   * ============================================================= */

  const DEFAULT_RULES = {
    callEightPocket: true,      // 打 8 必须指定袋口
    openAfterBreak: true,       // 开球进球不定组(WPA 标准)
    breakMinRails: 4,           // 开球未进球时至少 4 颗目标球碰库
    kitchenOnBreakFoul: true,   // 开球犯规 → 对手在开球区内自由球
    eightOnBreak: "respot",     // respot | lose | rebreak
    illegalBreak: "rerack"      // rerack | continue
  };

  /** 本杆的事件记录 */
  function newShotRecord(shooter, snapshotInfo) {
    return {
      shooter,
      isBreak: !!snapshotInfo.isBreak,
      groupBefore: snapshotInfo.group || null,
      clearedBefore: !!snapshotInfo.cleared,
      calledPocket: snapshotInfo.calledPocket == null ? null : snapshotInfo.calledPocket,
      firstContact: null,
      pocketed: [],
      pocketedIn: {},
      railed: new Set(),
      railAfterContact: false,
      cueScratch: false,
      jumped: []
    };
  }

  function remainingOf(balls, group) {
    if (!group) return 7;
    let n = 0;
    for (const b of balls) if (!b.pocketed && groupOf(b.id) === group) n++;
    return n;
  }

  /**
   * 结算一杆。纯函数式: 读入 balls / groups / shot, 返回判定结果, 不直接改 state。
   * 返回 {
   *   fouls:[code], foulText, gameOver, winner, winReason,
   *   groups, nextPlayer, continues, ballInHand, kitchen,
   *   respot:[ids], rerack:bool
   * }
   */
  function resolveShot(ctx) {
    const { balls, shot } = ctx;
    const rules = Object.assign({}, DEFAULT_RULES, ctx.rules || {});
    const groups = Object.assign({}, ctx.groups);
    const shooter = shot.shooter;
    const opp = otherPlayer(shooter);

    const out = {
      fouls: [], foulText: "", gameOver: false, winner: null, winReason: "",
      groups, nextPlayer: opp, continues: false,
      ballInHand: null, kitchen: false, respot: [], rerack: false,
      pocketedObjects: []
    };

    const objectPocketed = shot.pocketed.filter(id => id !== 0 && id !== 8);
    out.pocketedObjects = objectPocketed;

    const foul = code => { if (out.fouls.indexOf(code) < 0) out.fouls.push(code); };

    /* --- 1. 首碰合法性 --- */
    if (shot.firstContact === null) {
      foul("nocontact");
    } else if (!shot.isBreak) {
      const fg = groupOf(shot.firstContact);
      if (shot.clearedBefore) {
        if (shot.firstContact !== 8) foul("must_hit_eight");
      } else if (!shot.groupBefore) {
        if (shot.firstContact === 8) foul("open_hit_eight");
      } else if (fg !== shot.groupBefore) {
        foul("wrong_group");
      }
    }

    /* --- 2. 白球落袋 / 跳球 --- */
    if (shot.cueScratch) foul("scratch");
    if (shot.jumped.some(id => id !== 0)) foul("jumped");

    /* --- 3. 碰库规则 --- */
    if (shot.isBreak) {
      const objToRail = [...shot.railed].filter(id => id !== 0).length;
      if (objectPocketed.length === 0 && objToRail < rules.breakMinRails) foul("bad_break");
    } else if (shot.pocketed.length === 0 && !shot.railAfterContact && shot.firstContact !== null) {
      foul("no_rail");
    }

    /* --- 4. 8 号球 --- */
    if (shot.pocketed.indexOf(8) >= 0) {
      if (shot.isBreak) {
        // WPA: 开球进 8 不算输, 重新摆回置球点(可配置)
        if (rules.eightOnBreak === "lose") {
          out.gameOver = true; out.winner = opp; out.winReason = "eight_on_break";
          return finish();
        }
        if (rules.eightOnBreak === "rebreak") { out.rerack = true; out.nextPlayer = shooter; return finish(); }
        out.respot.push(8);
      } else if (!shot.clearedBefore) {
        out.gameOver = true; out.winner = opp; out.winReason = "eight_early";
        return finish();
      } else if (out.fouls.length) {
        out.gameOver = true; out.winner = opp; out.winReason = "eight_with_foul";
        return finish();
      } else if (rules.callEightPocket &&
        shot.calledPocket != null &&
        shot.pocketedIn[8] !== shot.calledPocket) {
        out.gameOver = true; out.winner = opp; out.winReason = "eight_wrong_pocket";
        return finish();
      } else {
        out.gameOver = true; out.winner = shooter; out.winReason = "eight_legal";
        return finish();
      }
    }

    /* --- 5. 分组判定 (开球杆不分组) --- */
    if (!out.fouls.length && !groups[shooter] && objectPocketed.length &&
      !(shot.isBreak && rules.openAfterBreak)) {
      let solid = 0, stripe = 0;
      for (const id of objectPocketed) (groupOf(id) === "solids" ? solid++ : stripe++);
      if (solid && !stripe) { groups[shooter] = "solids"; groups[opp] = "stripes"; }
      else if (stripe && !solid) { groups[shooter] = "stripes"; groups[opp] = "solids"; }
      // 两组同时进 → 台面继续开放
    }

    /* --- 6. 违规开球的处理 --- */
    if (out.fouls.indexOf("bad_break") >= 0 && rules.illegalBreak === "rerack") {
      out.rerack = true;
      out.nextPlayer = opp;
      out.ballInHand = null;
      return finish();
    }

    /* --- 7. 续杆 / 交换球权 --- */
    if (out.fouls.length) {
      out.nextPlayer = opp;
      out.ballInHand = opp;
      out.kitchen = shot.isBreak && rules.kitchenOnBreakFoul;
    } else {
      if (!groups[shooter]) out.continues = objectPocketed.length > 0;
      else out.continues = objectPocketed.some(id => groupOf(id) === groups[shooter]);
      out.nextPlayer = out.continues ? shooter : opp;
    }

    // 跳出台面的目标球摆回置球点
    for (const id of shot.jumped) if (id !== 0 && out.respot.indexOf(id) < 0) out.respot.push(id);

    return finish();

    function finish() {
      out.foulText = out.fouls.length ? out.fouls[0] : "";
      return out;
    }
  }

  /** 白球自由球落点合法性 */
  function validCuePlacement(balls, x, y, kitchen) {
    if (!insidePlayfield(x, y, BALL_R + 0.5)) return false;
    if (inAnyPocket(x, y, BALL_R)) return false;
    if (kitchen && x > HEAD_STRING_X) return false;
    for (const b of balls) {
      if (b.id === 0 || b.pocketed) continue;
      if (dist(x, y, b.x, b.y) < BALL_D + 0.8) return false;
    }
    return true;
  }

  const api = {
    VERSION, WORLD_W, WORLD_H, TABLE, BALL_R, BALL_D,
    HEAD_STRING_X, FOOT_SPOT, POCKETS, CUSHIONS, PHYS,
    CORNER_OPEN, SIDE_OPEN, JAW_DEPTH,
    DEFAULT_RULES,
    Ball, buildRack, step, anyMoving, powerToSpeed, shotVelocity, detExp,
    collideCushions, collideBalls,
    groupOf, otherGroup, otherPlayer, remainingOf,
    clamp, dist, norm, pointSegDist,
    insidePlayfield, inAnyPocket, spotBall, spotIsFree, validCuePlacement,
    newShotRecord, resolveShot
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BilliardsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
