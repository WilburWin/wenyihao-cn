/* =============================================================
 * HTML Billiards v0.8.9  —  match.js
 * 一局比赛的状态机。完全不依赖 DOM, 浏览器和 Node 测试共用同一套逻辑,
 * 从根本上杜绝 v0.7.4 里“主机和客户端各自算一遍规则”的分歧。
 * ============================================================= */
(function (root) {
  "use strict";
  const C = root.BilliardsCore || (typeof require === "function" ? require("./core.js") : null);

  const PHASE = { AIM: "aim", SHOOTING: "shooting", OVER: "over" };

  class Match {
    constructor(options) {
      options = options || {};
      this.rules = Object.assign({}, C.DEFAULT_RULES, options.rules || {});
      this.rng = options.rng || Math.random;
      this.events = [];          // 物理事件, 供音效/特效消费
      this.newSeries();
    }

    /** 开始一场新的对局: 比分清零, 第一局由 p1(房主 / 单机玩家)开球 */
    newSeries() {
      this.score = { p1: 0, p2: 0 };          // 对局比分(赢了几局)
      this.gameNo = 0;
      this.gameOver = false;
      this.winner = null;
      this.reset("p1");
    }

    /**
     * 开新的一局。
     * breaker 省略时: 上一局已分出胜负 → 赢家开球; 否则(中途重开)沿用本局开球方。
     */
    reset(breaker) {
      if (breaker !== "p1" && breaker !== "p2") {
        breaker = this.gameOver && this.winner ? this.winner : (this.breaker || "p1");
      }
      if (!this.score) this.score = { p1: 0, p2: 0 };
      this.breaker = breaker;
      this.freeplay = false;
      this.gameNo = (this.gameNo || 0) + 1;   // 第几局(联机时用来判断快照新旧)
      this.shotCount = 0;                     // 本局第几杆
      this.pottedBy = { p1: [], p2: [] };   // 谁打进了哪颗球(开放球局时比分栏靠它显示)
      this.balls = C.buildRack(this.rng);
      this.groups = { p1: null, p2: null };
      this.current = breaker;
      this.phase = PHASE.AIM;
      this.breakShot = true;
      this.ballInHand = breaker;  // 开球前可以在开球区内摆白球
      this.kitchen = true;
      this.gameOver = false;
      this.winner = null;
      this.winReason = "";
      this.calledPocket = null;
      this.shot = null;
      this.lastResult = null;
      this.settleTimer = 0;
      this.events.length = 0;
    }

    /* --------- 查询 --------- */
    ball(id) { return this.balls.find(b => b.id === id); }
    cue() { return this.ball(0); }
    remaining(player) { return C.remainingOf(this.balls, this.groups[player]); }
    /**
     * 比分栏显示用的“已进球”:
     *   分组确定前 → 该玩家亲手打进的球(含开球进球);
     *   分组确定后 → 台面上已落袋的本组球(八球规则里本组球无论谁打进都算你的)。
     */
    pocketedFor(player) {
      const g = this.groups[player];
      if (!g) return this.pottedBy[player].filter(id => this.ball(id) && this.ball(id).pocketed);
      return this.balls.filter(b => b.pocketed && C.groupOf(b.id) === g).map(b => b.id).sort((a, b) => a - b);
    }
    isCleared(player) { return !!this.groups[player] && this.remaining(player) === 0; }
    /** 该玩家这一杆是不是在打 8 号 */
    onEight(player) { return this.isCleared(player); }
    /** 是否必须先叫袋 */
    needsCall(player) {
      return this.rules.callEightPocket && this.onEight(player) && this.calledPocket === null;
    }
    moving() { return C.anyMoving(this.balls); }

    canShoot(player) {
      if (this.gameOver || this.phase !== PHASE.AIM) return false;
      if (this.current !== player) return false;
      if (this.ballInHand) return false;
      if (this.needsCall(player)) return false;
      return !this.moving();
    }

    /* --------- 自由球 --------- */
    placeCue(x, y) {
      if (!this.ballInHand) return false;
      if (!C.validCuePlacement(this.balls, x, y, this.kitchen)) return false;
      const cue = this.cue();
      cue.pocketed = false;
      cue.x = x; cue.y = y;
      cue.reset();
      this.ballInHand = null;
      this.kitchen = false;
      return true;
    }

    callPocket(index) {
      if (index < 0 || index >= C.POCKETS.length) return false;
      this.calledPocket = index;
      return true;
    }

    /* --------- 出杆 --------- */
    /**
     * exact: { vx, vy } 由出杆方预先算好的初速度。联机时两端用同一组数字出杆,
     * 保证同一杆在两台机器上逐位一致。
     */
    shoot(angle, power, spin, exact) {
      const shooter = this.current;
      if (!this.canShoot(shooter)) return false;
      const cue = this.cue();
      let v = null;
      if (exact && Number.isFinite(exact.vx) && Number.isFinite(exact.vy)) {
        const sp = Math.sqrt(exact.vx * exact.vx + exact.vy * exact.vy);
        if (sp <= C.PHYS.maxSpeed * 1.0001) v = exact;
      }
      if (!v) v = C.shotVelocity(angle, power);

      cue.vx = v.vx;
      cue.vy = v.vy;
      this.shotCount++;
      cue.spinTop = C.clamp((spin && spin.y) || 0, -1, 1);
      cue.spinSide = C.clamp((spin && spin.x) || 0, -1, 1);
      cue.spinUsed = false;
      cue.skid = 0.7;       // 出杆先滑动短暂时间，再自然过渡到纯滚动
      for (const b of this.balls) b.rolled = 0;

      this.shot = C.newShotRecord(shooter, {
        isBreak: this.breakShot,
        group: this.groups[shooter],
        cleared: this.isCleared(shooter),
        calledPocket: this.calledPocket
      });
      this.phase = PHASE.SHOOTING;
      this.settleTimer = 0;
      this.events.push({ t: "cue", power });
      return true;
    }

    _hooks() {
      const shot = this.shot, ev = this.events;
      return {
        onRail: (b, strength) => {
          if (shot) {
            shot.railed.add(b.id);
            if (shot.firstContact !== null) shot.railAfterContact = true;
          }
          ev.push({ t: "rail", id: b.id, strength });
        },
        onContact: (a, b, strength) => {
          if (shot && shot.firstContact === null) {
            if (a.id === 0 && b.id !== 0) shot.firstContact = b.id;
            else if (b.id === 0 && a.id !== 0) shot.firstContact = a.id;
          }
          ev.push({ t: "ball", strength });
        },
        onPocket: (b, p) => {
          if (shot) {
            shot.pocketed.push(b.id);
            shot.pocketedIn[b.id] = p.id;
            if (b.id === 0) shot.cueScratch = true;
          }
          ev.push({ t: "pocket", id: b.id, pocket: p.id, x: p.x, y: p.y });
        },
        onOut: (b) => {
          if (shot) {
            shot.jumped.push(b.id);
            if (b.id === 0) shot.cueScratch = true;
          }
          ev.push({ t: "out", id: b.id });
        }
      };
    }

    /** 推进一个固定步长; 返回 true 表示本杆已结算 */
    step(dt) {
      C.step(this.balls, dt, this.phase === PHASE.SHOOTING ? this._hooks() : null);
      if (this.phase !== PHASE.SHOOTING) return false;
      if (this.moving()) { this.settleTimer = 0; return false; }
      this.settleTimer += dt;
      if (this.settleTimer < 0.08) return false;
      this.settle();
      return true;
    }

    /** 跑完整杆(供 AI 评估与无头测试使用) */
    runToSettle(maxSeconds) {
      const limit = (maxSeconds || 30) / C.PHYS.fixedDt;
      let n = 0;
      while (this.phase === PHASE.SHOOTING && n++ < limit) this.step(C.PHYS.fixedDt);
      if (this.phase === PHASE.SHOOTING) { this.forceStop(); this.settle(); }
      return this.lastResult;
    }

    forceStop() { for (const b of this.balls) b.reset(); }

    /** 训练模式: 自定义布局, 不判犯规不换人 */
    setFreeplayLayout(list) {
      this.freeplay = true;
      this.balls = list.map(d => new C.Ball(d.id, d.x, d.y));
      this.groups = { p1: null, p2: null };
      this.current = "p1";
      this.phase = PHASE.AIM;
      this.breakShot = false;
      this.ballInHand = null;
      this.kitchen = false;
      this.gameOver = false;
      this.winner = null;
      this.calledPocket = null;
      this.shot = null;
      this.lastResult = null;
    }

    /* --------- 结算 --------- */
    settle() {
      const shot = this.shot;
      this.phase = PHASE.AIM;
      if (!shot) return null;

      if (this.freeplay) {
        const cue = this.cue();
        if (cue.pocketed) {
          cue.pocketed = false; cue.reset();
          cue.x = C.HEAD_STRING_X; cue.y = C.TABLE.cy;
          if (!C.validCuePlacement(this.balls, cue.x, cue.y, false)) C.spotBall(this.balls, cue);
        }
        for (const id of shot.jumped) {
          const b = this.ball(id);
          if (b && id !== 0) C.spotBall(this.balls, b);
        }
        this.shot = null;
        this.lastResult = { fouls: [], practice: true, pocketedObjects: shot.pocketed.filter(i => i !== 0) };
        return this.lastResult;
      }

      const groupsBefore = Object.assign({}, this.groups);
      const result = C.resolveShot({
        balls: this.balls, shot, groups: this.groups, rules: this.rules
      });
      result.shooter = shot.shooter;
      result.newGroup = !groupsBefore[shot.shooter] && !!result.groups[shot.shooter] && !result.rerack
        ? result.groups[shot.shooter] : null;
      for (const id of result.pocketedObjects) {
        if (result.respot.indexOf(id) < 0 && this.pottedBy[shot.shooter].indexOf(id) < 0) {
          this.pottedBy[shot.shooter].push(id);
        }
      }
      this.applyResult(result);
      this.shot = null;
      this.lastResult = result;
      return result;
    }

    /** 把判定结果落到实际状态上(主机与客户端都走这一份代码) */
    applyResult(result) {
      this.groups = Object.assign({}, result.groups);
      this.calledPocket = null;

      if (result.rerack) {
        const keepGroups = { p1: null, p2: null };
        this.balls = C.buildRack(this.rng);
        this.groups = keepGroups;
        this.pottedBy = { p1: [], p2: [] };
        this.breakShot = true;
        this.breaker = result.nextPlayer;     // 开球无效: 换人开球
        this.current = result.nextPlayer;
        this.ballInHand = result.nextPlayer;
        this.kitchen = true;
        this.gameOver = false;
        return;
      }

      for (const id of result.respot) {
        const b = this.ball(id);
        if (b) C.spotBall(this.balls, b);
      }

      if (result.gameOver) {
        this.gameOver = true;
        this.phase = PHASE.OVER;
        this.winner = result.winner;
        this.winReason = result.winReason;
        this.current = result.winner;
        this.score[result.winner] = (this.score[result.winner] || 0) + 1;
        return;
      }

      this.breakShot = false;
      this.current = result.nextPlayer;
      this.ballInHand = result.ballInHand;
      this.kitchen = !!result.kitchen;

      const cue = this.cue();
      if (cue.pocketed) {
        cue.pocketed = false;
        cue.reset();
        if (!this.ballInHand) {
          // 理论上不会发生(白球落袋必定犯规), 兜底摆回开球区
          this.ballInHand = this.current;
          this.kitchen = false;
        }
        cue.x = C.HEAD_STRING_X; cue.y = C.TABLE.cy;
      }
    }

    /* --------- 序列化(联机同步) --------- */
    snapshot() {
      return {
        v: C.VERSION,
        // 不再四舍五入: 两端必须从完全相同的浮点数出发(JSON 对 double 可以精确往返)
        balls: this.balls.map(b => ({
          id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          p: b.pocketed ? 1 : 0, st: b.spinTop, ss: b.spinSide, sk: b.skid
        })),
        gameNo: this.gameNo,
        shotCount: this.shotCount,
        score: { p1: this.score.p1, p2: this.score.p2 },
        breaker: this.breaker,
        groups: this.groups,
        current: this.current,
        phase: this.phase,
        breakShot: this.breakShot,
        ballInHand: this.ballInHand,
        kitchen: this.kitchen,
        gameOver: this.gameOver,
        winner: this.winner,
        winReason: this.winReason,
        calledPocket: this.calledPocket,
        pottedBy: this.pottedBy
      };
    }

    restore(s) {
      if (!s || !Array.isArray(s.balls)) return false;
      // 数组顺序也要与主机一致: 碰撞按数组顺序两两求解, 顺序不同结局就不同
      const ordered = [];
      for (const sb of s.balls) {
        let b = this.ball(sb.id);
        if (!b) b = new C.Ball(sb.id, sb.x, sb.y);
        b.x = sb.x; b.y = sb.y; b.vx = sb.vx; b.vy = sb.vy;
        b.pocketed = !!sb.p; b.spinTop = sb.st || 0; b.spinSide = sb.ss || 0;
        b.spinUsed = false;
        b.skid = sb.sk || 0;
        ordered.push(b);
      }
      this.balls = ordered;
      this.groups = Object.assign({ p1: null, p2: null }, s.groups);
      this.current = s.current;
      this.phase = s.phase;
      this.breakShot = !!s.breakShot;
      this.ballInHand = s.ballInHand || null;
      this.kitchen = !!s.kitchen;
      this.gameOver = !!s.gameOver;
      this.winner = s.winner || null;
      this.winReason = s.winReason || "";
      this.calledPocket = s.calledPocket == null ? null : s.calledPocket;
      if (s.gameNo != null) this.gameNo = s.gameNo;
      if (s.shotCount != null) this.shotCount = s.shotCount;
      if (s.score) this.score = { p1: s.score.p1 | 0, p2: s.score.p2 | 0 };
      if (s.breaker === "p1" || s.breaker === "p2") this.breaker = s.breaker;
      this.pottedBy = {
        p1: (s.pottedBy && s.pottedBy.p1 || []).slice(),
        p2: (s.pottedBy && s.pottedBy.p2 || []).slice()
      };
      this.shot = null;
      return true;
    }
  }

  const api = { Match, PHASE };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BilliardsMatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
