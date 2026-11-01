/* =============================================================
 * HTML Billiards v0.8.9  —  ai.js
 * AI 对手: 几何选球 → 命中率估计 → 走位/防吃袋 → 解球(翻袋/斜射) → 安全球
 * v0.7.4 的 AI 不检查切角是否物理可行, 也不会算力度和吃袋,
 * 结果就是频繁空杆、频繁母球落袋。这里全部重写。
 * ============================================================= */
(function (root) {
  "use strict";
  const C = root.BilliardsCore || (typeof require === "function" ? require("./core.js") : null);
  const { TABLE, BALL_R, BALL_D, POCKETS, PHYS, clamp, dist, norm, groupOf } = C;

  const SKILL = {
    easy: { aimNoise: 0.040, powerNoise: 0.15, vision: 0.62, maxCut: 1.12, scratchCare: 0.25, position: 0, threshold: 0.02, kick: true },
    normal: { aimNoise: 0.017, powerNoise: 0.065, vision: 0.85, maxCut: 1.25, scratchCare: 0.75, position: 0.4, threshold: 0.06, kick: true },
    hard: { aimNoise: 0.005, powerNoise: 0.022, vision: 1.00, maxCut: 1.36, scratchCare: 1.00, position: 1.0, threshold: 0.05, kick: true }
  };

  function speedToPower(v) {
    const t = (v - PHYS.minSpeed) / (PHYS.maxSpeed - PHYS.minSpeed);
    return clamp(Math.pow(clamp(t, 0, 1), 1 / PHYS.powerGamma), 0.05, 1);
  }
  /** 要让球滚 d 距离需要的初速度(含一点余量) */
  function speedForDistance(d) {
    return Math.sqrt(2 * PHYS.rollDecel * Math.max(d, 1) * 1.18);
  }

  function activeBalls(balls) { return balls.filter(b => !b.pocketed); }

  function pathClear(balls, x1, y1, x2, y2, ignore, clearance) {
    const s = { x1, y1, x2, y2 };
    for (const b of balls) {
      if (b.pocketed || ignore.indexOf(b.id) >= 0) continue;
      if (C.pointSegDist(b.x, b.y, s).d < clearance) return false;
    }
    return true;
  }

  /** 球心可活动区域(离库一个半径) */
  function ghostReachable(x, y) {
    return x > TABLE.left + BALL_R - 1 && x < TABLE.right - BALL_R + 1 &&
      y > TABLE.top + BALL_R - 1 && y < TABLE.bottom - BALL_R + 1;
  }

  /** 估算母球撞击后的分离方向(切线方向) */
  function tangentDir(cue, ghost, target) {
    const toGhost = norm(ghost.x - cue.x, ghost.y - cue.y);
    const toTarget = norm(target.x - ghost.x, target.y - ghost.y);
    const d = toGhost.x * toTarget.x + toGhost.y * toTarget.y;
    const tx = toGhost.x - toTarget.x * d;
    const ty = toGhost.y - toTarget.y * d;
    if (Math.hypot(tx, ty) < 1e-5) return { x: toGhost.x, y: toGhost.y };
    return norm(tx, ty);
  }

  /** 母球沿 dir 走 len 距离, 是否会撞到袋口(吃袋风险 0~1) */
  function scratchRisk(from, dir, len) {
    let worst = 0;
    for (const p of POCKETS) {
      const t = (p.x - from.x) * dir.x + (p.y - from.y) * dir.y;
      if (t < BALL_D || t > len) continue;
      const cx = from.x + dir.x * t, cy = from.y + dir.y * t;
      const d = dist(cx, cy, p.x, p.y);
      if (d < p.r + BALL_R * 1.6) {
        const risk = clamp(1 - d / (p.r + BALL_R * 1.6), 0, 1) * clamp(1 - t / (len + 1), 0.25, 1);
        worst = Math.max(worst, risk);
      }
    }
    return worst;
  }

  /** 枚举一颗目标球 → 一个袋口的直接进球方案 */
  function evalPot(balls, cue, target, pocket, cfg) {
    const toP = norm(pocket.x - target.x, pocket.y - target.y);
    const ghost = { x: target.x - toP.x * BALL_D, y: target.y - toP.y * BALL_D };
    if (!ghostReachable(ghost.x, ghost.y)) return null;

    const cueDist = dist(cue.x, cue.y, ghost.x, ghost.y);
    if (cueDist < 1) return null;
    const toG = norm(ghost.x - cue.x, ghost.y - cue.y);
    const cosCut = toG.x * toP.x + toG.y * toP.y;
    const cut = Math.acos(clamp(cosCut, -1, 1));
    if (cut > cfg.maxCut) return null;                 // 切角过大, 物理上打不进

    if (!pathClear(balls, cue.x, cue.y, ghost.x, ghost.y, [0, target.id], BALL_D - 0.5)) return null;
    const potDist = dist(target.x, target.y, pocket.x, pocket.y);
    if (!pathClear(balls, target.x, target.y, pocket.x, pocket.y, [0, target.id], BALL_D - 2)) return null;

    // 命中率模型: 切角 + 目标球到袋距离 + 母球到目标距离
    const p =
      Math.pow(Math.max(cosCut, 0.02), 1.35) *
      clamp(1 - potDist / 2400, 0.12, 1) *
      clamp(1 - cueDist / 3000, 0.25, 1);

    // 力度: 让目标球恰好能滚到袋口再多一点
    const vObj = speedForDistance(potDist + BALL_D * 2);
    const vAtContact = vObj / Math.max(cosCut, 0.2) / 0.97;
    const vCue = Math.sqrt(vAtContact * vAtContact + 2 * PHYS.rollDecel * cueDist);
    let power = speedToPower(vCue);
    if (pocket.type === "side") power = Math.min(1, power * 1.04);

    // 吃袋风险
    const tan = tangentDir(cue, ghost, target);
    const cueRun = Math.max(0, (vAtContact * Math.sin(cut)) ** 2 / (2 * PHYS.rollDecel));
    const risk = scratchRisk(ghost, tan, Math.min(cueRun, TABLE.width));

    let spinY = 0;
    if (cfg.position > 0) {
      // 高杆延伸 / 低杆回收, 用来降低吃袋风险 & 简单走位
      if (risk > 0.35) spinY = -0.55 * cfg.position;
      else if (cueRun < TABLE.width * 0.18) spinY = 0.45 * cfg.position;
    }

    const score = p * 100 - risk * 65 * cfg.scratchCare - (power > 0.85 ? 8 : 0);
    return {
      kind: "pot", target: target.id, pocket: pocket.id,
      angle: Math.atan2(ghost.y - cue.y, ghost.x - cue.x),
      power: clamp(power, 0.12, 1),
      spin: { x: 0, y: spinY },
      prob: p, risk, score, cut
    };
  }

  /** 解球: 一库翻袋(镜像法), 只要求合法首碰 */
  function planKick(balls, cue, targets, cfg) {
    const rails = [
      { axis: "y", v: TABLE.top + BALL_R },
      { axis: "y", v: TABLE.bottom - BALL_R },
      { axis: "x", v: TABLE.left + BALL_R },
      { axis: "x", v: TABLE.right - BALL_R }
    ];
    let best = null;
    for (const t of targets) {
      for (const rail of rails) {
        const m = rail.axis === "y"
          ? { x: t.x, y: 2 * rail.v - t.y }
          : { x: 2 * rail.v - t.x, y: t.y };
        const dir = norm(m.x - cue.x, m.y - cue.y);
        // 与库线的交点
        let s;
        if (rail.axis === "y") { if (Math.abs(dir.y) < 1e-4) continue; s = (rail.v - cue.y) / dir.y; }
        else { if (Math.abs(dir.x) < 1e-4) continue; s = (rail.v - cue.x) / dir.x; }
        if (s <= BALL_D) continue;
        const hit = { x: cue.x + dir.x * s, y: cue.y + dir.y * s };
        if (!ghostReachable(hit.x, hit.y)) continue;
        if (C.inAnyPocket(hit.x, hit.y, BALL_R * 1.4)) continue;
        if (!pathClear(balls, cue.x, cue.y, hit.x, hit.y, [0], BALL_D - 1)) continue;
        if (!pathClear(balls, hit.x, hit.y, t.x, t.y, [0, t.id], BALL_D - 2)) continue;

        const total = s + dist(hit.x, hit.y, t.x, t.y);
        const v = speedForDistance(total * 1.45);
        const cand = {
          kind: "kick", target: t.id, pocket: null,
          angle: Math.atan2(dir.y, dir.x),
          power: clamp(speedToPower(v), 0.28, 0.95),
          spin: { x: 0, y: 0 },
          prob: 0.12, risk: 0.2, score: 6 - total / 600
        };
        if (!best || cand.score > best.score) best = cand;
      }
    }
    return best;
  }

  /** 安全球: 合法首碰 + 保证碰库 + 让母球远离袋口 */
  function planSafety(balls, cue, targets, cfg) {
    let best = null;
    for (const t of targets) {
      if (!pathClear(balls, cue.x, cue.y, t.x, t.y, [0, t.id], BALL_D - 2)) continue;
      const dir = norm(t.x - cue.x, t.y - cue.y);
      const d = dist(cue.x, cue.y, t.x, t.y);
      // 目标球被推向哪面库? 保证“击球后有球碰库”这条规则不被犯规
      const railDist = Math.min(
        dir.x > 0.15 ? (TABLE.right - BALL_R - t.x) / dir.x : Infinity,
        dir.x < -0.15 ? (TABLE.left + BALL_R - t.x) / dir.x : Infinity,
        dir.y > 0.15 ? (TABLE.bottom - BALL_R - t.y) / dir.y : Infinity,
        dir.y < -0.15 ? (TABLE.top + BALL_R - t.y) / dir.y : Infinity
      );
      const need = isFinite(railDist) ? railDist : TABLE.width * 0.5;
      const v = Math.sqrt((speedForDistance(need * 1.5)) ** 2 + 2 * PHYS.rollDecel * d);
      const power = clamp(speedToPower(v), 0.18, 0.72);
      const risk = scratchRisk(t, dir, TABLE.width * 0.35);
      const score = 3 - risk * 40 - d / 1500;
      const cand = {
        kind: "safety", target: t.id, pocket: null,
        angle: Math.atan2(dir.y, dir.x), power,
        spin: { x: 0, y: -0.45 }, prob: 0.05, risk, score
      };
      if (!best || cand.score > best.score) best = cand;
    }
    return best;
  }

  /** 合法目标球集合 */
  function legalTargets(balls, group, cleared) {
    const live = activeBalls(balls).filter(b => b.id !== 0);
    if (cleared) return live.filter(b => b.id === 8);
    if (!group) return live.filter(b => b.id !== 8);       // 开放球局不能先碰 8
    return live.filter(b => groupOf(b.id) === group);
  }

  /** 开球是完全不同的问题: 目标不是进球, 而是满足“进球或 4 颗球碰库” */
  function planBreak(balls, cue, cfg, rng) {
    // 顶球 = 距离白球最近的那颗(置球点上的球)
    let apex = null;
    for (const b of balls) {
      if (b.pocketed || b.id === 0) continue;
      if (!apex || b.x < apex.x) apex = b;
    }
    if (!apex) return null;
    const jitter = (rng() - 0.5) * 2 * (cfg.aimNoise * 0.6 + 0.004);
    return {
      kind: "break", target: apex.id, pocket: null,
      angle: Math.atan2(apex.y - cue.y, apex.x - cue.x) + jitter,
      power: clamp(0.94 + (rng() - 0.5) * 0.08, 0.82, 1),
      spin: { x: 0, y: -0.15 },     // 轻微低杆, 防止白球跟进吃袋
      prob: 0.3, risk: 0.1, score: 100
    };
  }

  /**
   * 主入口。
   * opts: { balls, group, cleared, isBreak, difficulty, rng }
   * 返回 { angle, power, spin, calledPocket, kind, prob }
   */
  function planShot(opts) {
    const cfg = SKILL[opts.difficulty] || SKILL.normal;
    const rng = opts.rng || Math.random;
    const balls = opts.balls;
    const cue = balls.find(b => b.id === 0);
    const targets = legalTargets(balls, opts.group, opts.cleared);
    if (!cue || !targets.length) return null;

    if (opts.isBreak) {
      const br = planBreak(balls, cue, cfg, rng);
      if (br) {
        return {
          angle: br.angle, power: br.power, spin: br.spin,
          calledPocket: null, kind: "break", prob: br.prob, targetId: br.target, spread: 0
        };
      }
    }

    const cands = [];
    for (const t of targets) {
      for (const p of POCKETS) {
        if (rng() > cfg.vision) continue;                 // 低难度会“看漏”一些线路
        const c = evalPot(balls, cue, t, p, cfg);
        if (c) cands.push(c);
      }
    }
    cands.sort((a, b) => b.score - a.score);

    let plan = cands.find(c => c.prob >= cfg.threshold) || null;
    if (!plan && cfg.kick) plan = planKick(balls, cue, targets, cfg);
    if (!plan) plan = planSafety(balls, cue, targets, cfg);
    if (!plan && cands.length) plan = cands[0];
    if (!plan) {
      // 彻底被做安全, 只能随便碰一下, 至少保证有方向
      const t = targets[0];
      plan = {
        kind: "desperate", target: t.id, pocket: null,
        angle: Math.atan2(t.y - cue.y, t.x - cue.x),
        power: 0.5, spin: { x: 0, y: 0 }, prob: 0, risk: 0.5, score: 0
      };
    }

    // 抖动: 难度体现在手感误差, 而不是“少看几个袋”
    const spread = cfg.aimNoise * (0.6 + dist(cue.x, cue.y, cue.x, cue.y) / 2000);
    const angle = plan.angle + (rng() - 0.5) * 2 * cfg.aimNoise;
    const power = clamp(plan.power * (1 + (rng() - 0.5) * 2 * cfg.powerNoise), 0.1, 1);

    return {
      angle, power,
      spin: plan.spin || { x: 0, y: 0 },
      calledPocket: plan.pocket,
      kind: plan.kind,
      prob: plan.prob,
      targetId: plan.target,
      spread
    };
  }

  /** 自由球: 采样若干合法落点, 选整体最优的一杆 */
  function planBallInHand(opts) {
    const balls = opts.balls;
    const cue = balls.find(b => b.id === 0);
    const rng = opts.rng || Math.random;
    const kitchen = !!opts.kitchen;
    const cfg = SKILL[opts.difficulty] || SKILL.normal;

    if (opts.isBreak) {
      // 标准开球位: 开球线稍后, 偏离中线一点点, 避免每次都是同一杆
      const off = (rng() - 0.5) * 2 * 90;
      const y = clamp(TABLE.cy + off, TABLE.top + BALL_R * 3, TABLE.bottom - BALL_R * 3);
      const x = C.HEAD_STRING_X - 12;
      if (C.validCuePlacement(balls, x, y, true)) return { x, y };
      return { x, y: TABLE.cy };
    }

    const saveX = cue.x, saveY = cue.y, savePocketed = cue.pocketed;
    cue.pocketed = false;

    const xs = [], ys = [];
    const xMin = TABLE.left + BALL_R * 2.2;
    const xMax = kitchen ? C.HEAD_STRING_X - BALL_R : TABLE.right - BALL_R * 2.2;
    for (let i = 0; i < 9; i++) xs.push(xMin + (xMax - xMin) * (i / 8));
    for (let i = 0; i < 6; i++) ys.push(TABLE.top + BALL_R * 2.2 + (TABLE.height - BALL_R * 4.4) * (i / 5));

    let best = null;
    for (const x of xs) {
      for (const y of ys) {
        if (!C.validCuePlacement(balls, x, y, kitchen)) continue;
        cue.x = x; cue.y = y;
        const plan = planShot({
          balls, group: opts.group, cleared: opts.cleared,
          difficulty: opts.difficulty, rng: () => 0.5     // 评估阶段不加噪声
        });
        if (!plan) continue;
        const s = (plan.kind === "pot" ? plan.prob * 100 : plan.kind === "safety" ? 4 : 1);
        if (!best || s > best.score) best = { x, y, score: s };
      }
    }

    cue.x = saveX; cue.y = saveY; cue.pocketed = savePocketed;
    if (best) return { x: best.x, y: best.y };

    // 兜底: 找任意合法点
    for (const x of xs) for (const y of ys)
      if (C.validCuePlacement(balls, x, y, kitchen)) return { x, y };
    return { x: C.HEAD_STRING_X, y: TABLE.cy };
  }

  const api = { planShot, planBallInHand, legalTargets, SKILL, speedToPower, speedForDistance };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BilliardsAI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
