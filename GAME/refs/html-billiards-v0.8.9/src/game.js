/* =============================================================
 * HTML Billiards v0.8.9  —  game.js
 * 表现层: 渲染 / 输入 / HUD / 音效 / AI 驱动 / 联机
 * 所有规则与物理都在 core.js + match.js 里, 这一层只负责“看得见的部分”。
 * ============================================================= */
(() => {
  "use strict";

  const C = window.BilliardsCore;
  const AI = window.BilliardsAI;
  const { Match, PHASE } = window.BilliardsMatch;
  const { TABLE, POCKETS, CUSHIONS, BALL_R, BALL_D, WORLD_W, WORLD_H, PHYS, clamp, dist, norm, groupOf } = C;

  const VERSION = C.VERSION;

  /* ------------------------------------------------------------------
   * DOM
   * ---------------------------------------------------------------- */
  const $ = id => document.getElementById(id);
  const dom = {};
  [
    "gameCanvas", "motionCanvas", "powerFill", "powerText", "turnText", "scoreText", "statusPill",
    "p1Card", "p2Card", "p1Name", "p2Name", "p1Avatar", "p2Avatar",
    "p1Balls", "p2Balls", "p1GroupText", "p2GroupText",
    "p1PocketedTitle", "p2PocketedTitle", "p1PocketedBalls", "p2PocketedBalls",
    "p1BreakChip", "p2BreakChip", "seriesLabel", "frameScoreText", "resultSeries",
    "soloBtn", "soloSideBtn", "confettiLayer", "soloModeBadge", "practiceModeBadge",
    "lanModeBadge", "guideBtn", "soundBtn", "soundBtnSide", "musicBtnSide", "spinBall", "spinKnob",
    "spinText", "spinResetBtn", "ballInHandTip", "callPocketTip", "fpsText", "qualityText",
    "qualitySelect", "aiDifficulty", "gameOver", "resultTitle", "resultText", "resultIcon",
    "helpDialog", "practiceDialog", "lanDialog", "shotLog",
    "ruleCallEight", "ruleEightOnBreak", "ruleKitchen",
    "networkLinkTab", "networkLanTab", "networkLinkPane", "networkLanPane",
    "linkPlayerName", "linkSignalUrl", "linkCreateBtn", "linkRoomBig",
    "copyInviteLinkBtn", "copyRoomCodeBtn", "linkRoomChip", "linkJoinCard",
    "linkJoinText", "linkJoinRoomCode", "linkJoinRoomBtn", "disconnectLanBtn",
    "lanModeBanner", "lanBannerUrl", "copyLanUrlBtn",
    "lanPortInput", "lanDetectBtn", "lanIpList", "lanHostInput", "lanOpenBtn",
    "lanStatusText", "lanRoomInfo", "restartBtn", "playAgainBtn", "closeOverlayBtn",
    "rulesBtn", "practiceBtn", "practiceSideBtn", "lanBtn", "lanSideBtn"
  ].forEach(id => { dom[id] = $(id); });

  // 单独保留静态球桌：移动时不再每帧铺几百万像素的木框、台呢和背景。
  const baseCtx = dom.gameCanvas.getContext("2d", { alpha: false });
  const ctx = dom.motionCanvas.getContext("2d", { alpha: true, desynchronized: true });
  const rolling = new window.BilliardsRolling.RollingVisuals();
  const rollRotate = window.BilliardsRolling.rotate;
  const smoothPosition = window.BilliardsRolling.interpolate;

  /* ------------------------------------------------------------------
   * 全局状态(只放"表现层"状态, 规则状态在 match 里)
   * ---------------------------------------------------------------- */
  const ui = {
    mode: "solo",            // solo | practice | lan
    aiDifficulty: "normal",
    practiceDrill: "break",
    guide: true,
    sound: true,
    music: true,          // 背景音乐(受总声音开关控制)
    quality: "auto",
    aimAngle: 0,
    power: 0,
    spin: { x: 0, y: 0 },
    charging: false,
    chargeOrigin: null,
    pointerId: null,
    hover: null,
    aiThinking: false,
    aiTimers: [],
    notice: { code: "turn.break", data: { player: "p1" } },
    hudDirty: true,
    renderDirty: true,
    lastLogged: null,
    awaitingRemote: false
  };

  const rules = {
    callEightPocket: true,
    eightOnBreak: "respot",
    kitchenOnBreakFoul: true
  };

  let match = new Match({ rules });

  const lan = {
    connected: false, transport: null, isHost: false, localRole: "p1",
    playerName: "Player", peerName: "Guest",
    signalUrl: "", roomId: "", token: "", signalPollTimer: null, signalLastEventId: 0, lastActivity: 0,
    // 发送队列: 保证消息按顺序到达, 并把积压的消息合并成一次请求
    sendQueue: [], sending: false, batchOk: false,
    // 客机本地预测
    shotSeq: 0, pendingShot: null, pendingState: null, pendingTimer: null,
    // 主机: 模拟进行中收到的客机请求先排队
    hostQueue: [],
    rtt: 0
  };

  const localRole = () => (ui.mode === "lan" ? lan.localRole : "p1");
  const isAuthority = () => ui.mode !== "lan" || lan.isHost;
  const humanControls = p => (ui.mode === "practice") || (ui.mode === "solo" ? p === "p1" : p === localRole());

  /* ------------------------------------------------------------------
   * 文案(按"本地视角"渲染, 联机时两端各自本地化, 不再互相覆盖文案)
   * ---------------------------------------------------------------- */
  const FOUL_TEXT = {
    nocontact: "空杆：白球没有碰到任何球",
    wrong_group: "首碰球不是自己的球",
    must_hit_eight: "已清台，必须先碰 8 号球",
    open_hit_eight: "开放球局不能先碰 8 号球",
    scratch: "白球落袋",
    jumped: "有球跳出台面",
    no_rail: "首碰后既没进球也没有球碰库",
    bad_break: "开球无效：未进球且碰库目标球不足 4 颗"
  };
  const WIN_TEXT = {
    eight_legal: "清台后按叫袋打进 8 号球",
    eight_early: "未清台就打进 8 号球",
    eight_with_foul: "打进 8 号球的同时犯规",
    eight_wrong_pocket: "8 号球进了非指定袋口",
    eight_on_break: "开球直接打进 8 号球"
  };

  /* 玩家名: 所有提示、记录、状态栏统一用“玩家名 + 信息”, 按角色(p1/p2)在本地渲染,
   * 联机时主机发来的提示在客机上也会显示成正确的名字(旧版“你的回合/对方回合”是主机视角, 客机上正好反了) */
  function soloName() {
    const v = String(dom.linkPlayerName?.value || "").trim().slice(0, 18);
    return v && v !== "Player" ? v : "玩家";
  }
  function playerName(role) {
    if (role !== "p1" && role !== "p2") return "";
    if (ui.mode === "practice") return "你";
    if (ui.mode === "solo") return role === "p1" ? soloName() : "AI";
    const mine = role === lan.localRole;
    let n = (mine ? lan.playerName : lan.peerName) || (role === "p1" ? "房主" : "玩家");
    const other = mine ? lan.peerName : lan.playerName;
    if (other && other === n) n += role === "p1" ? "（房主）" : "（玩家）";   // 两人同名时区分
    return n;
  }
  /** 这个角色是不是由本机的人来操作 */
  function isLocal(role) {
    if (ui.mode === "practice") return true;
    if (ui.mode === "solo") return role === "p1";
    return role === lan.localRole;
  }
  /** 显示用的局数: 已分胜负的局数 + 正在打的这一局(重开不算新的一局) */
  const frameNo = () => match.score.p1 + match.score.p2 + (match.gameOver ? 0 : 1);
  const GROUP_NAME = { solids: "全色球（1-7）", stripes: "花色球（9-15）" };
  function ballsText(ids) { return ids.slice().sort((a, b) => a - b).join("、") + " 号球"; }

  function noticeText() {
    const n = ui.notice, d = n.data || {};
    const role = d.player || match.current;
    const who = playerName(role);
    const mine = isLocal(role);
    const foulPart = d.foul ? `${playerName(d.shooter)} 犯规：${FOUL_TEXT[d.foul] || "犯规"} · ` : "";
    switch (n.code) {
      case "turn.break": return mine ? `${who} 开球 · 在开球区内摆放白球` : `${who} 开球中`;
      case "turn": case "turn.you": case "turn.opp":
        return mine ? `${who} 的回合 · 瞄准后按住向后拖动蓄力` : `${who} 的回合`;
      case "turn.continue": return `${who} 进球有效，继续击球`;
      case "shooting": return `${who} 击球中…`;
      case "ai.think": return `${playerName("p2")} 思考中…`;
      case "charge": return `${playerName(localRole())} 蓄力 ${Math.round(ui.power * 100)}% · 松开击球 / 右键取消`;
      case "ballInHand": return foulPart + `${who} 获得自由球` + (mine ? "：点击台面合法位置摆放白球" : "");
      case "ballInHand.kitchen": return foulPart + `${who} 获得开球区自由球` + (mine ? "：只能摆在开球线左侧" : "");
      case "needCall": return mine ? `${who} 打 8 号球：请先点击一个袋口指定进球位置` : `${who} 正在指定 8 号球的袋口`;
      case "foul": return `${playerName(d.shooter)} 犯规：${FOUL_TEXT[d.foul || d.code] || "犯规"} · 轮到 ${who}`;
      case "rerack": return `${playerName(d.shooter)} 开球无效 · 重新摆球，由 ${who} 开球` + (mine ? "：在开球区内摆放白球" : "");
      case "practice": return `训练模式：${DRILL_NAME[ui.practiceDrill]} · 自由击球`;
      case "over": return `${playerName(match.winner)} 赢得本局 · 总比分 ${match.score.p1} : ${match.score.p2}`;
      case "peerLeft": return `${lan.peerName || "对方"} 已离开房间`;
      default: return n.code;
    }
  }
  function setNotice(code, data) {
    ui.notice = { code, data: data || {} };
    ui.hudDirty = true;
  }

  const DRILL_NAME = { break: "开球练习", straight: "直线球", cut: "切球练习", position: "走位练习" };

  /* ------------------------------------------------------------------
   * 画布尺寸: 等比缩放 + 居中, 不再用 scaleX/scaleY 各自拉伸
   * ---------------------------------------------------------------- */
  let view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  let autoPenalty = 1;
  const staticLayer = document.createElement("canvas");
  const staticCtx = staticLayer.getContext("2d");
  let staticScale = 0;

  function effectiveDpr() {
    const raw = window.devicePixelRatio || 1;
    let cap = 1.5;
    if (ui.quality === "performance") cap = 1.0;
    else if (ui.quality === "high") cap = 2.0;
    else cap = 1.5 * autoPenalty;
    const rect = dom.gameCanvas.getBoundingClientRect();
    const maxPixels = ui.quality === "high" ? 4200000 : ui.quality === "performance" ? 1500000 : 2400000;
    const ideal = Math.min(raw, cap);
    if (rect.width * rect.height * ideal * ideal <= maxPixels) return Math.max(1, ideal);
    return Math.max(1, Math.sqrt(maxPixels / Math.max(1, rect.width * rect.height)));
  }

  function resizeCanvas() {
    const rect = dom.gameCanvas.getBoundingClientRect();
    if (rect.width < 2) return;
    const dpr = effectiveDpr();
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (dom.gameCanvas.width !== w || dom.gameCanvas.height !== h) {
      dom.gameCanvas.width = w;
      dom.gameCanvas.height = h;
    }
    if (dom.motionCanvas.width !== w || dom.motionCanvas.height !== h) {
      dom.motionCanvas.width = w;
      dom.motionCanvas.height = h;
    }
    // 移动层位置精确跟随底层的 CSS 实际边界，竖屏/窄屏居中时也不会错位。
    const parent = dom.gameCanvas.parentElement;
    const parentRect = parent.getBoundingClientRect();
    dom.motionCanvas.style.left = (rect.left - parentRect.left - parent.clientLeft) + "px";
    dom.motionCanvas.style.top = (rect.top - parentRect.top - parent.clientTop) + "px";
    dom.motionCanvas.style.width = rect.width + "px";
    dom.motionCanvas.style.height = rect.height + "px";
    const scale = Math.min(w / WORLD_W, h / WORLD_H);
    view = { scale, ox: (w - WORLD_W * scale) / 2, oy: (h - WORLD_H * scale) / 2, dpr };
    if (Math.abs(scale - staticScale) > 0.04) buildStaticLayer(scale);
    paintBackdrop();
    if (dom.qualityText) dom.qualityText.textContent = ui.quality.toUpperCase();
    ui.renderDirty = true;
  }

  /* ------------------------------------------------------------------
   * 贴图 / 静态层 —— 渲染的桌子几何与物理几何完全一致
   * ---------------------------------------------------------------- */
  const textures = {};
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  async function preloadTextures() {
    const list = [["felt", "./assets/textures/felt-pattern.svg"], ["wood", "./assets/textures/wood-grain.svg"]];
    await Promise.all(list.map(async ([k, s]) => { try { textures[k] = await loadImage(s); } catch { } }));
    buildStaticLayer(view.scale);
    paintBackdrop();
    ui.renderDirty = true;
  }

  function roundRect(c, x, y, w, h, r) {
    const q = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + q, y);
    c.arcTo(x + w, y, x + w, y + h, q);
    c.arcTo(x + w, y + h, x, y + h, q);
    c.arcTo(x, y + h, x, y, q);
    c.arcTo(x, y, x + w, y, q);
    c.closePath();
  }

  /** 库边向台外的法线 */
  function outwardNormal(s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const n = norm(-dy, dx);
    const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
    return (mx + n.x - TABLE.cx) ** 2 + (my + n.y - TABLE.cy) ** 2 >
      (mx - TABLE.cx) ** 2 + (my - TABLE.cy) ** 2 ? n : { x: -n.x, y: -n.y };
  }

  /* ------------------------------------------------------------------
   * 台面几何 → 绘制用多边形
   * v0.8.0 的问题: 每段库边(含袋角斜切)各自按“离台心向外”挤出一个 40px 的梯形,
   *   ① 袋角斜切的“外侧”其实朝向袋洞 → 棕色梯形盖在袋洞上;
   *   ② 梯形之间的缝隙露出底下铺满的台呢 → 袋口外侧出现绿色方块;
   *   ③ 每个梯形都从绿色渐变起步 → 袋角处出现一条条绿色高光。
   * 现在改为: 木质库台 → 台呢(只覆盖可击球区 + 袋喉) → 袋洞(以袋角为边界) → 6 块整体库边胶条。
   * ---------------------------------------------------------------- */
  const CUSH_W = C.JAW_DEPTH;      // 库边胶条厚度 = 袋角斜切深度, 胶条背面正好与斜切末端对齐
  const RAIL_W = 56;               // 胶条 + 木质库台总宽
  const near = (ax, ay, bx, by, d) => Math.abs(ax - bx) < d && Math.abs(ay - by) < d;

  const TABLE_GEOM = (() => {
    const rails = CUSHIONS.filter(s => s.kind !== "jaw");
    const jaws = CUSHIONS.filter(s => s.kind === "jaw");
    const P = (x, y) => ({ x, y });
    const cross = (a, b) => (a.x - TABLE.cx) * (b.y - TABLE.cy) - (a.y - TABLE.cy) * (b.x - TABLE.cx);

    // 每段库边 + 两端的袋角 = 一整块胶条; nose 为朝向台面的轮廓(顺时针)
    const pieces = rails.map(r => {
      let a = P(r.x1, r.y1), b = P(r.x2, r.y2);
      if (cross(a, b) < 0) [a, b] = [b, a];
      const jawAt = pt => jaws.find(j => near(j.x1, j.y1, pt.x, pt.y, 3));
      const ja = jawAt(a), jb = jawAt(b);
      const nose = [];
      if (ja) nose.push(P(ja.x2, ja.y2), P(ja.x1, ja.y1));
      nose.push(a, b);
      if (jb) nose.push(P(jb.x1, jb.y1), P(jb.x2, jb.y2));
      const n = outwardNormal(r);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return { rail: r, nose, n, ang: Math.atan2(my - TABLE.cy, mx - TABLE.cx) };
    }).sort((p, q) => p.ang - q.ang);

    // 袋洞轮廓: 两条袋角斜切 + 外侧椭圆 + 内侧微弧(与落袋判定圆对齐)
    const holes = POCKETS.map(p => {
      const js = jaws
        .map(j => ({ j, d: Math.min(dist(j.x1, j.y1, p.x, p.y), dist(j.x2, j.y2, p.x, p.y)) }))
        .sort((u, v) => u.d - v.d).slice(0, 2).map(u => u.j);
      const A = { s: P(js[0].x1, js[0].y1), e: P(js[0].x2, js[0].y2) };
      const B = { s: P(js[1].x1, js[1].y1), e: P(js[1].x2, js[1].y2) };
      const theta = Math.atan2(B.e.y - A.e.y, B.e.x - A.e.x);
      const rx = dist(A.e.x, A.e.y, B.e.x, B.e.y) / 2;
      const ecx = (A.e.x + B.e.x) / 2, ecy = (A.e.y + B.e.y) / 2;
      const out = norm(p.x - TABLE.cx, p.y - TABLE.cy);
      const vx = -Math.sin(theta), vy = Math.cos(theta);
      const ccw = vx * out.x + vy * out.y > 0;
      // 外侧深度: 角袋接近正圆, 中袋受库台宽度限制
      const ry = p.type === "corner" ? rx * 0.86 : Math.min(rx * 0.3, RAIL_W - CUSH_W - 2);
      const mid = P((A.s.x + B.s.x) / 2, (A.s.y + B.s.y) / 2);
      const din = norm(mid.x - p.x, mid.y - p.y);
      const tgt = P(p.x + din.x * (p.r - 8), p.y + din.y * (p.r - 8));
      const ctrl = P(2 * tgt.x - mid.x, 2 * tgt.y - mid.y);
      return { p, A, B, theta, rx, ry, ecx, ecy, ccw, ctrl };
    });
    return { pieces, holes };
  })();

  function holePath(c, h) {
    c.beginPath();
    c.moveTo(h.A.s.x, h.A.s.y);
    c.lineTo(h.A.e.x, h.A.e.y);
    c.ellipse(h.ecx, h.ecy, h.rx, h.ry, h.theta, Math.PI, 0, h.ccw);
    c.lineTo(h.B.s.x, h.B.s.y);
    c.quadraticCurveTo(h.ctrl.x, h.ctrl.y, h.A.s.x, h.A.s.y);
    c.closePath();
  }

  function feltPath(c) {
    c.beginPath();
    let first = true;
    for (const pc of TABLE_GEOM.pieces) for (const pt of pc.nose) {
      if (first) { c.moveTo(pt.x, pt.y); first = false; } else c.lineTo(pt.x, pt.y);
    }
    c.closePath();
  }

  function piecePath(c, pc) {
    const nose = pc.nose;
    c.beginPath();
    c.moveTo(nose[0].x, nose[0].y);
    for (let i = 1; i < nose.length; i++) c.lineTo(nose[i].x, nose[i].y);
    // 背面: 库边线外移 CUSH_W, 与两端斜切末端相接
    const last = nose[nose.length - 1], first = nose[0];
    const bx = pc.n.x * CUSH_W, by = pc.n.y * CUSH_W;
    const r = pc.rail;
    const proj = pt => (pc.n.x ? { x: r.x1 + bx, y: pt.y } : { x: pt.x, y: r.y1 + by });
    const pl = proj(last), pf = proj(first);
    if (!near(pl.x, pl.y, last.x, last.y, 0.5)) c.lineTo(pl.x, pl.y);
    c.lineTo(pf.x, pf.y);
    c.closePath();
  }

  /** 房间背景, 画在整张画布上(含等比缩放留下的边), 与 CSS 背景一致 */
  let roomGrad = null, roomGradKey = "";
  function roomBackground() {
    const cv = dom.gameCanvas, key = cv.width + "x" + cv.height;
    if (key !== roomGradKey) {
      roomGradKey = key;
      roomGrad = baseCtx.createLinearGradient(0, 0, cv.width, cv.height);
      roomGrad.addColorStop(0, "#2d2017"); roomGrad.addColorStop(.55, "#0c0e0d"); roomGrad.addColorStop(1, "#21170f");
    }
    return roomGrad;
  }

  function buildStaticLayer(scale) {
    staticScale = Math.max(0.2, scale || 1);
    staticLayer.width = Math.round(WORLD_W * staticScale);
    staticLayer.height = Math.round(WORLD_H * staticScale);
    const c = staticCtx;
    c.setTransform(staticScale, 0, 0, staticScale, 0, 0);
    c.clearRect(0, 0, WORLD_W, WORLD_H);

    const bandX = TABLE.left - RAIL_W, bandY = TABLE.top - RAIL_W;
    const bandW = TABLE.width + RAIL_W * 2, bandH = TABLE.height + RAIL_W * 2;

    // 1. 外框
    c.save();
    c.shadowColor = "rgba(0,0,0,.72)"; c.shadowBlur = 30; c.shadowOffsetY = 18;
    roundRect(c, 52, 36, 1496, 828, 52);
    const body = c.createLinearGradient(0, 20, 0, WORLD_H);
    body.addColorStop(0, "#7b4a25"); body.addColorStop(.2, "#4c2f1d"); body.addColorStop(1, "#231711");
    c.fillStyle = body; c.fill();
    c.restore();

    // 2. 木质库台(整圈一块, 不再有缝)
    c.save();
    roundRect(c, bandX, bandY, bandW, bandH, 22);
    const wood = c.createLinearGradient(0, bandY, 0, bandY + bandH);
    wood.addColorStop(0, "#8a5429"); wood.addColorStop(.5, "#6a3e1f"); wood.addColorStop(1, "#4e2d17");
    c.fillStyle = wood; c.fill();
    if (textures.wood) {
      try { c.clip(); c.globalAlpha = .22; c.fillStyle = c.createPattern(textures.wood, "repeat"); c.fillRect(bandX, bandY, bandW, bandH); } catch { }
    }
    c.restore();
    c.save(); roundRect(c, 64, 48, 1472, 804, 46);
    c.strokeStyle = "#c8a771"; c.lineWidth = 6; c.stroke(); c.restore();

    // 3. 台呢: 只铺在胶条围出的区域(含袋喉)
    const felt = c.createRadialGradient(TABLE.cx, TABLE.cy - 40, 80, TABLE.cx, TABLE.cy, 860);
    felt.addColorStop(0, "#189a5d"); felt.addColorStop(.6, "#0d7e49"); felt.addColorStop(1, "#08603a");
    c.save();
    feltPath(c); c.fillStyle = felt; c.fill();
    if (textures.felt) {
      try { c.clip(); c.globalAlpha = .12; c.fillStyle = c.createPattern(textures.felt, "repeat"); c.fillRect(bandX, bandY, bandW, bandH); } catch { }
    }
    c.restore();

    // 4. 袋洞: 以两条袋角为边界, 不会盖到库边, 也不会漏出台呢
    for (const h of TABLE_GEOM.holes) {
      const p = h.p;
      const g = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, h.rx * 1.25);
      g.addColorStop(0, "#000"); g.addColorStop(.7, "#040605"); g.addColorStop(1, "#141a17");
      c.save();
      holePath(c, h); c.fillStyle = g; c.fill();
      c.clip();                                   // 袋内深度阴影
      c.strokeStyle = "rgba(0,0,0,.85)"; c.lineWidth = 7; holePath(c, h); c.stroke();
      c.restore();
    }

    // 5. 胶条投在台呢上的阴影
    c.save();
    feltPath(c); c.clip();
    c.shadowColor = "rgba(0,0,0,.55)"; c.shadowBlur = 10;
    c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 3;
    for (const pc of TABLE_GEOM.pieces) {
      c.beginPath(); pc.nose.forEach((pt, i) => (i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y))); c.stroke();
    }
    c.restore();

    // 6. 胶条: 每段库边连同两端袋角是一个整体多边形
    for (const pc of TABLE_GEOM.pieces) {
      const r = pc.rail;
      const g = c.createLinearGradient(r.x1, r.y1, r.x1 + pc.n.x * CUSH_W, r.y1 + pc.n.y * CUSH_W);
      g.addColorStop(0, "#14955a"); g.addColorStop(.45, "#0c7443"); g.addColorStop(1, "#07482a");
      piecePath(c, pc); c.fillStyle = g; c.fill();
      c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 1; c.stroke();
      // 胶条鼻线高光(只描直边, 袋角处收细)
      c.strokeStyle = "rgba(120,255,190,.32)"; c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(r.x1, r.y1); c.lineTo(r.x2, r.y2); c.stroke();
    }
    // 7. 库钉(居中于木质库台)
    c.fillStyle = "rgba(246,229,182,.78)";
    const off = CUSH_W + (RAIL_W - CUSH_W) / 2;
    for (let i = 1; i <= 7; i++) {
      if (i === 4) continue;
      const x = TABLE.left + TABLE.width * (i / 8);
      diamond(c, x, TABLE.top - off); diamond(c, x, TABLE.bottom + off);
    }
    for (let i = 1; i <= 3; i++) {
      const y = TABLE.top + TABLE.height * (i / 4);
      diamond(c, TABLE.left - off, y); diamond(c, TABLE.right + off, y);
    }

    // 8. 开球线 + 置球点
    c.strokeStyle = "rgba(255,255,255,.16)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(C.HEAD_STRING_X, TABLE.top); c.lineTo(C.HEAD_STRING_X, TABLE.bottom); c.stroke();
    c.fillStyle = "rgba(255,255,255,.28)";
    c.beginPath(); c.arc(C.FOOT_SPOT.x, C.FOOT_SPOT.y, 3.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(C.HEAD_STRING_X, TABLE.cy, 3.2, 0, Math.PI * 2); c.fill();
  }

  function paintBackdrop() {
    const cv = dom.gameCanvas;
    if (!cv.width || !cv.height) return;
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.fillStyle = roomBackground();
    baseCtx.fillRect(0, 0, cv.width, cv.height);
    baseCtx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    baseCtx.drawImage(staticLayer, 0, 0, WORLD_W, WORLD_H);
  }

  function diamond(c, x, y) {
    c.save(); c.translate(x, y); c.rotate(Math.PI / 4); c.fillRect(-3.4, -3.4, 6.8, 6.8); c.restore();
  }

  /* ------------------------------------------------------------------
   * 球贴图
   * ---------------------------------------------------------------- */
  const BALL_COLORS = {
    1: "#f0c31f", 2: "#245fc8", 3: "#e63c35", 4: "#7b3ab8", 5: "#e87720", 6: "#159355",
    7: "#7b1f24", 8: "#111413", 9: "#f0c31f", 10: "#245fc8", 11: "#e63c35",
    12: "#7b3ab8", 13: "#e87720", 14: "#159355", 15: "#7b1f24"
  };
  const sprites = new Map();
  const S = 128, SPR_R = 52, SPR_SIZE = BALL_R * 2.6;
  let lightingSprite = null;
  function makeSprite(paint) {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    paint(c.getContext("2d"));
    return c;
  }
  function buildSprite(id) {
    const c = makeSprite(g => {
      const cx = S / 2, cy = S / 2, r = SPR_R;
      const white = id === 0 || id > 8;
      const grad = g.createRadialGradient(cx - r * .38, cy - r * .45, r * .08, cx + r * .07, cy + r * .05, r * 1.18);
      if (white) {
        grad.addColorStop(0, "#fffefa"); grad.addColorStop(.63, "#f2efe6"); grad.addColorStop(1, "#aca99f");
      } else {
        grad.addColorStop(0, "#fff8df"); grad.addColorStop(.16, BALL_COLORS[id]);
        grad.addColorStop(.76, BALL_COLORS[id]); grad.addColorStop(1, "#181d1b");
      }
      g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    });
    sprites.set(id, c);
  }
  for (let i = 0; i <= 15; i++) buildSprite(i);
  lightingSprite = makeSprite(g => {
    const cx = S / 2, cy = S / 2, r = SPR_R;
    const rim = g.createRadialGradient(cx - 13, cy - 17, 8, cx + 10, cy + 9, 70);
    rim.addColorStop(0, "rgba(255,255,255,.13)");
    rim.addColorStop(.55, "rgba(0,0,0,0)");
    rim.addColorStop(.83, "rgba(0,0,0,.13)");
    rim.addColorStop(1, "rgba(0,0,0,.50)");
    g.fillStyle = rim; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,.35)";
    g.beginPath(); g.ellipse(cx - 18, cy - 23, 12, 6, -.48, 0, Math.PI * 2); g.fill();
  });

  // 每颗球的数字与条纹在 3D 球面上，不是把整张 2D 球图旋转成风车。
  // 在表现层读四元数：光源固定，球面上的花纹才会随台面位移转动。
  const beltPoints = Array.from({ length: 49 }, (_, i) => {
    const a = i * Math.PI * 2 / 48;
    return { c: Math.cos(a), s: Math.sin(a) };
  });
  function visiblePolygon(poly) {
    const result = [];
    let prev = poly[poly.length - 1], inside = prev.z >= 0;
    for (const curr of poly) {
      const nextInside = curr.z >= 0;
      if (inside !== nextInside) {
        const t = prev.z / (prev.z - curr.z);
        result.push({ x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t });
      }
      if (nextInside) result.push(curr);
      prev = curr; inside = nextInside;
    }
    return result;
  }
  function drawStripe(b, q) {
    const axis = rollRotate(q, 0, 1, 0);
    const side = rollRotate(q, 1, 0, 0);
    const depth = rollRotate(q, 0, 0, 1);
    const edge = 0.44;
    const count = ui.quality === "performance" || (ui.quality === "auto" && autoPenalty < .8) ? 16 :
      ui.quality === "high" ? 48 : 24;
    const jump = 48 / count;
    function surface(t, latitude) {
      const v = beltPoints[t];
      const ring = Math.sqrt(1 - latitude * latitude);
      const cx = (side.x * v.c + depth.x * v.s) * ring;
      const cy = (side.y * v.c + depth.y * v.s) * ring;
      const cz = (side.z * v.c + depth.z * v.s) * ring;
      return { x: (cx + axis.x * latitude) * b.r, y: (cy + axis.y * latitude) * b.r,
        z: cz + axis.z * latitude };
    }
    // 分段拟合球面的纬线；包含 0 纬度，避免转到正视极点时条纹错误消失。
    const latitudes = [-edge, -edge * .5, 0, edge * .5, edge];
    ctx.beginPath();
    for (let i = 0; i < 48; i += jump) {
      for (let band = 0; band < latitudes.length - 1; band++) {
        const lo = latitudes[band], hi = latitudes[band + 1];
        const poly = visiblePolygon([
          surface(i, lo), surface(i + jump, lo),
          surface(i + jump, hi), surface(i, hi)
        ]);
        if (poly.length < 3) continue;
        ctx.moveTo(b.x + poly[0].x, b.y + poly[0].y);
        for (let j = 1; j < poly.length; j++) ctx.lineTo(b.x + poly[j].x, b.y + poly[j].y);
        ctx.closePath();
      }
    }
    ctx.fillStyle = BALL_COLORS[b.id]; ctx.fill();
  }

  function drawNumber(b, q, backwards) {
    const sign = backwards ? -1 : 1;
    const normal = rollRotate(q, 0, 0, sign);
    if (normal.z <= .035) return;
    const right = rollRotate(q, sign, 0, 0);
    const up = rollRotate(q, 0, 1, 0);
    ctx.save();
    ctx.transform(right.x, right.y, up.x, up.y,
      b.x + normal.x * b.r * .79, b.y + normal.y * b.r * .79);
    ctx.fillStyle = "#f8f6ec";
    ctx.beginPath(); ctx.arc(0, 0, b.r * .43, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#161b19";
    ctx.font = `800 ${b.id >= 10 ? 9.5 : 11.2}px Arial,sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(b.id), 0, .65);
    ctx.restore();
  }

  const cueMarks = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];
  function drawCueSpots(b, q) {
    // 测速白球常见的红色点阵：即使白球没有号码，也能看见无滑滚动与侧旋。
    ctx.fillStyle = "#bd5241";
    for (const m of cueMarks) {
      const p = rollRotate(q, m[0], m[1], m[2]);
      if (p.z <= .10) continue;
      const r = 2.65 * Math.sqrt(p.z);
      ctx.beginPath(); ctx.ellipse(b.x + p.x * b.r * .83, b.y + p.y * b.r * .83,
        r, r * (.55 + .45 * p.z), 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ------------------------------------------------------------------
   * 音效(含移动端解锁)
   * ---------------------------------------------------------------- */
  const audioPools = new Map();
  let audioUnlocked = false;
  function buildAudio() {
    const defs = {
      cue: ["./assets/sfx/cue-hit.wav", 3], ball: ["./assets/sfx/ball-hit.wav", 8],
      rail: ["./assets/sfx/rail-hit.wav", 5], pocket: ["./assets/sfx/pocket.wav", 4],
      lose: ["./assets/sfx/lose.wav", 2]   // 胜利改用 assets/music/victory.mp3
    };
    for (const [k, [src, n]] of Object.entries(defs)) {
      const arr = [];
      for (let i = 0; i < n; i++) { const a = new Audio(src); a.preload = "auto"; arr.push(a); }
      audioPools.set(k, { arr, i: 0 });
    }
  }
  function unlockAudio() {
    if (audioUnlocked) { syncBgm(); return; }
    audioUnlocked = true;
    syncBgm();
    for (const pool of audioPools.values()) {
      const a = pool.arr[0];
      const v = a.volume; a.volume = 0;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = v; }).catch(() => { a.volume = v; });
    }
  }
  /* ------------------------------------------------------------------
   * 音乐: 背景音乐循环 + 胜利音乐
   * 浏览器要求用户先有一次点击 / 按键才能出声, 所以在 unlockAudio 里启动。
   * 胜利音乐响起时背景音乐先压低, 放完再慢慢恢复。
   * ---------------------------------------------------------------- */
  const BGM_VOL = 0.3, BGM_DUCK = 0.05, VICTORY_VOL = 0.85;
  const music = { bgm: null, victory: null, fades: new Map(), victoryPlaying: false };
  try { if (localStorage.getItem("billiards.music") === "off") ui.music = false; } catch { }
  function buildMusic() {
    music.bgm = new Audio("./assets/music/bgm-caromhall.mp3");
    music.bgm.loop = true; music.bgm.preload = "auto"; music.bgm.volume = BGM_VOL;
    music.victory = new Audio("./assets/music/victory.mp3");
    music.victory.preload = "auto"; music.victory.volume = VICTORY_VOL;
    music.victory.addEventListener("ended", () => {
      music.victoryPlaying = false;
      fadeTo(music.bgm, BGM_VOL, 1500);
    });
  }
  /** 平滑调节音量, 同一个音频只保留最后一次渐变 */
  function fadeTo(a, target, ms, then) {
    if (!a) return;
    const old = music.fades.get(a); if (old) clearInterval(old);
    const from = a.volume, t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      a.volume = clamp(from + (target - from) * k, 0, 1);
      if (k >= 1) { clearInterval(id); music.fades.delete(a); if (then) then(); }
    }, 40);
    music.fades.set(a, id);
  }
  function bgmWanted() { return ui.sound && ui.music && audioUnlocked && !document.hidden; }
  function syncBgm() {
    const a = music.bgm; if (!a) return;
    if (bgmWanted()) {
      if (a.paused) {
        a.volume = 0;
        a.play().then(() => fadeTo(a, music.victoryPlaying ? BGM_DUCK : BGM_VOL, 1200)).catch(() => { });
      }
    } else if (!a.paused) {
      fadeTo(a, 0, 300, () => a.pause());
    }
  }
  function playVictory() {
    if (!ui.sound || !music.victory) return;
    const v = music.victory;
    music.victoryPlaying = true;
    fadeTo(music.bgm, BGM_DUCK, 250);
    try { v.currentTime = 0; v.volume = VICTORY_VOL; v.play().catch(() => { music.victoryPlaying = false; fadeTo(music.bgm, BGM_VOL, 800); }); } catch { }
  }
  function stopVictory() {
    const v = music.victory; if (!v || v.paused) return;
    v.pause(); music.victoryPlaying = false;
    fadeTo(music.bgm, BGM_VOL, 800);
  }
  function toggleMusic() {
    ui.music = !ui.music;
    try { localStorage.setItem("billiards.music", ui.music ? "on" : "off"); } catch { }
    unlockAudio();
    syncBgm();
    updateSoundButtons();
    dom.statusPill.textContent = ui.music ? "背景音乐：开" : "背景音乐：关";
  }
  function updateSoundButtons() {
    dom.soundBtn.textContent = ui.sound ? "🔊" : "🔇";
    dom.soundBtnSide.classList.toggle("active", !ui.sound);
    if (dom.musicBtnSide) dom.musicBtnSide.classList.toggle("active", !ui.music || !ui.sound);
  }
  document.addEventListener("visibilitychange", syncBgm);

  let soundGate = 0;
  function play(key, vol) {
    if (!ui.sound) return;
    const pool = audioPools.get(key); if (!pool) return;
    const a = pool.arr[pool.i++ % pool.arr.length];
    try { a.currentTime = 0; a.volume = clamp(vol, 0, 1); a.play().catch(() => { }); } catch { }
  }
  function consumeEvents() {
    const evs = match.events;
    if (!evs.length) return;
    const now = performance.now();
    let ballSounds = 0;
    for (const e of evs) {
      if (e.t === "cue") play("cue", .5 + e.power * .35);
      else if (e.t === "ball") {
        if (e.strength < 120) continue;
        if (ballSounds >= 3 || now - soundGate < 18) continue;
        ballSounds++; soundGate = now;
        play("ball", clamp(e.strength / 2400, .1, .5));
      } else if (e.t === "rail") {
        if (e.strength >= 160) play("rail", clamp(e.strength / 3000, .08, .32));
      } else if (e.t === "pocket") {
        play("pocket", .5);
        spawnBurst(e.x, e.y, e.id);
      }
    }
    evs.length = 0;
  }

  /* ------------------------------------------------------------------
   * 粒子
   * ---------------------------------------------------------------- */
  const particles = [];
  function spawnBurst(x, y, id) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 90;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
        life: .3 + Math.random() * .2, max: .5, size: 1.4 + Math.random() * 2.6,
        color: id === 0 ? "#fff" : BALL_COLORS[id] || "#fff"
      });
    }
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }
  function stepParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .95; p.vy *= .95; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------
   * 渲染
   * ---------------------------------------------------------------- */
  function draw() {
    // 只清理透明运动图层；大幅减少移动中整张球桌的重复绘制。
    const cv = dom.motionCanvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);

    if (match.ballInHand && humanControls(match.ballInHand)) drawPlacementHelper();
    if (match.calledPocket != null) drawCalledPocket(match.calledPocket);
    if (needsCallLocal()) drawPocketChoices();

    const aiming = canAimLocally();
    if (aiming) { drawAimGuide(); drawCue(); }
    else if (ui.mode === "solo" && ui.aiThinking && !match.moving()) drawAiIndicator();

    // 两个固定物理步之间做位置插值；球的位置仅影响显示，不写回联机物理状态。
    const alpha = (match.phase === PHASE.SHOOTING || match.moving()) ?
      clamp(accumulator / PHYS.fixedDt, 0, 1) : 1;
    const visibleBalls = [];
    for (const b of match.balls) if (!b.pocketed) {
      const pos = smoothPosition(b, alpha);
      visibleBalls.push({ id: b.id, x: pos.x, y: pos.y, r: b.r });
    }
    // 阴影先于任何球绘制，不会盖住密集球堆中的其他球。
    ctx.fillStyle = "rgba(0,0,0,.27)";
    for (const b of visibleBalls) {
      ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + 9, b.r * .86, b.r * .34, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const b of visibleBalls) drawBall(b);
    drawParticles();
  }

  function drawBall(b) {
    const sprite = sprites.get(b.id);
    if (!sprite) return;
    const q = rolling.orientation(b.id);
    ctx.drawImage(sprite, b.x - SPR_SIZE / 2, b.y - SPR_SIZE / 2, SPR_SIZE, SPR_SIZE);
    ctx.save();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.clip();
    if (b.id > 8) drawStripe(b, q);
    if (b.id === 0) drawCueSpots(b, q);
    else { drawNumber(b, q, false); drawNumber(b, q, true); }
    ctx.restore();
    ctx.drawImage(lightingSprite, b.x - SPR_SIZE / 2, b.y - SPR_SIZE / 2, SPR_SIZE, SPR_SIZE);
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save(); ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }

  /** 白球沿 angle 射出后, 第一个接触的球 */
  function rayFirstBall(cue, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = null;
    for (const b of match.balls) {
      if (b.pocketed || b.id === 0) continue;
      const ox = cue.x - b.x, oy = cue.y - b.y, R = cue.r + b.r;
      const B = 2 * (ox * dx + oy * dy), Cc = ox * ox + oy * oy - R * R;
      const disc = B * B - 4 * Cc;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc), t1 = (-B - sq) / 2, t2 = (-B + sq) / 2;
      const t = t1 > 0 ? t1 : (t2 > 0 ? t2 : null);
      if (t != null && (!best || t < best.t)) best = { ball: b, t };
    }
    return best;
  }

  /** 白球沿 angle 撞到库边(按真实库边线段, 不是矩形)的距离 */
  function rayCushion(cue, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = 4000;
    for (const s of CUSHIONS) {
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const nx0 = -ey, ny0 = ex;
      const nlen = Math.hypot(nx0, ny0);
      const nx = nx0 / nlen, ny = ny0 / nlen;
      const sign = ((cue.x - s.x1) * nx + (cue.y - s.y1) * ny) >= 0 ? 1 : -1;
      const px = s.x1 + nx * BALL_R * sign, py = s.y1 + ny * BALL_R * sign;
      const t = ((px - cue.x) * ey - (py - cue.y) * ex) / den;
      if (t <= 0 || t >= best) continue;
      const u = ((px - cue.x) * dy - (py - cue.y) * dx) / den;
      if (u < -0.02 || u > 1.02) continue;
      best = t;
    }
    for (const p of POCKETS) {
      const t = (p.x - cue.x) * dx + (p.y - cue.y) * dy;
      if (t > 0 && t < best) {
        const cx = cue.x + dx * t, cy = cue.y + dy * t;
        if (dist(cx, cy, p.x, p.y) < p.r) best = t;
      }
    }
    return best;
  }

  function drawAimGuide() {
    const cue = match.cue(); if (!cue) return;
    const hit = rayFirstBall(cue, ui.aimAngle);
    const railT = rayCushion(cue, ui.aimAngle);
    const t = hit ? Math.min(hit.t, railT) : railT;
    const ex = cue.x + Math.cos(ui.aimAngle) * t, ey = cue.y + Math.sin(ui.aimAngle) * t;

    ctx.save();
    ctx.setLineDash([11, 9]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.beginPath(); ctx.moveTo(cue.x, cue.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);

    if (ui.guide && hit && hit.t <= railT) {
      // 虚拟球
      ctx.strokeStyle = "rgba(255,255,255,.62)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ex, ey, cue.r, 0, Math.PI * 2); ctx.stroke();
      // 目标球走向
      const dir = norm(hit.ball.x - ex, hit.ball.y - ey);
      ctx.strokeStyle = "rgba(252,218,112,.85)"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(hit.ball.x, hit.ball.y);
      ctx.lineTo(hit.ball.x + dir.x * 150, hit.ball.y + dir.y * 150); ctx.stroke();
      // 白球分离方向(切线)
      const aim = { x: Math.cos(ui.aimAngle), y: Math.sin(ui.aimAngle) };
      const d = aim.x * dir.x + aim.y * dir.y;
      const tan = norm(aim.x - dir.x * d, aim.y - dir.y * d);
      if (Math.abs(d) < 0.999) {
        ctx.strokeStyle = "rgba(116,218,255,.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + tan.x * 96, ey + tan.y * 96); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawCue() {
    const cue = match.cue(); if (!cue) return;
    const ax = Math.cos(ui.aimAngle), ay = Math.sin(ui.aimAngle);
    const pull = ui.charging ? 34 + ui.power * 130 : 28;
    // 杆头偏移反映击球点
    const px = -ay * ui.spin.x * BALL_R * 0.55, py = ax * ui.spin.x * BALL_R * 0.55;
    const tipX = cue.x - ax * (cue.r + pull) + px, tipY = cue.y - ay * (cue.r + pull) + py;
    const buttX = tipX - ax * 430, buttY = tipY - ay * 430;
    ctx.save();
    ctx.lineCap = "round"; ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    const g = ctx.createLinearGradient(buttX, buttY, tipX, tipY);
    g.addColorStop(0, "#5a2414"); g.addColorStop(.34, "#9a4a21");
    g.addColorStop(.38, "#d7b675"); g.addColorStop(1, "#efd6a1");
    ctx.strokeStyle = g; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(buttX, buttY); ctx.lineTo(tipX, tipY); ctx.stroke();
    ctx.strokeStyle = "#cfe9ea"; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX + ax * 9, tipY + ay * 9); ctx.stroke();
    ctx.restore();
  }

  function drawAiIndicator() {
    const cue = match.cue(); if (!cue) return;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.font = "600 14px Inter,Arial"; ctx.textAlign = "center";
    ctx.fillText("AI THINKING", cue.x, cue.y - 40);
    if (ui.aiPreviewAngle != null) {
      ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
      const t = rayCushion(cue, ui.aiPreviewAngle);
      ctx.beginPath(); ctx.moveTo(cue.x, cue.y);
      ctx.lineTo(cue.x + Math.cos(ui.aiPreviewAngle) * t, cue.y + Math.sin(ui.aiPreviewAngle) * t);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawPlacementHelper() {
    ctx.save();
    if (match.kitchen) {
      // 只染台呢, 不染袋洞
      ctx.save();
      feltPath(ctx); ctx.clip();
      ctx.beginPath(); ctx.rect(0, 0, WORLD_W, WORLD_H);
      for (const h of TABLE_GEOM.holes) {
        ctx.moveTo(h.A.s.x, h.A.s.y); ctx.lineTo(h.A.e.x, h.A.e.y);
        ctx.ellipse(h.ecx, h.ecy, h.rx, h.ry, h.theta, Math.PI, 0, h.ccw);
        ctx.lineTo(h.B.s.x, h.B.s.y); ctx.quadraticCurveTo(h.ctrl.x, h.ctrl.y, h.A.s.x, h.A.s.y); ctx.closePath();
      }
      ctx.clip("evenodd");
      ctx.fillStyle = "rgba(90,200,255,.10)";
      ctx.fillRect(TABLE.left - CUSH_W, TABLE.top - CUSH_W, C.HEAD_STRING_X - TABLE.left + CUSH_W, TABLE.height + CUSH_W * 2);
      ctx.restore();
      ctx.strokeStyle = "rgba(120,215,255,.55)"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(C.HEAD_STRING_X, TABLE.top); ctx.lineTo(C.HEAD_STRING_X, TABLE.bottom); ctx.stroke();
    }
    if (ui.hover) {
      const legal = C.validCuePlacement(match.balls, ui.hover.x, ui.hover.y, match.kitchen);
      ctx.globalAlpha = .72;
      ctx.fillStyle = legal ? "rgba(255,255,255,.9)" : "rgba(255,90,90,.6)";
      ctx.beginPath(); ctx.arc(ui.hover.x, ui.hover.y, BALL_R, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = legal ? "rgba(120,255,190,.95)" : "rgba(255,90,90,.95)";
      ctx.lineWidth = 2.2; ctx.stroke();
    }
    ctx.restore();
  }

  function drawPocketChoices() {
    ctx.save();
    const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 260);
    for (const p of POCKETS) {
      ctx.strokeStyle = `rgba(255,214,90,${pulse.toFixed(3)})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 12, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCalledPocket(i) {
    const p = POCKETS[i]; if (!p) return;
    ctx.save();
    ctx.strokeStyle = "rgba(90,255,170,.95)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(90,255,170,.95)";
    ctx.font = "700 15px Inter,Arial"; ctx.textAlign = "center";
    const ty = p.y < TABLE.cy ? p.y + 52 : p.y - 42;
    ctx.fillText("叫袋", p.x, ty);
    ctx.restore();
  }

  /* ------------------------------------------------------------------
   * HUD
   * ---------------------------------------------------------------- */
  function ballChip(id, done) {
    if (id === 0) return `<span class="hud-ball cue ${done ? "done" : ""}"><b>●</b></span>`;
    return `<span class="hud-ball ${id > 8 ? "stripe" : "solid"} ${done ? "done" : ""}" style="--ball:${BALL_COLORS[id]}"><b>${id}</b></span>`;
  }
  function targetInfo(player) {
    const g = match.groups[player];
    if (!g) return { text: "开放球局", ids: [1, 9] };
    if (match.remaining(player) === 0) return { text: "黑 8", ids: [8] };
    return g === "solids"
      ? { text: "全色球 1-7", ids: [1, 2, 3, 4, 5, 6, 7] }
      : { text: "花色球 9-15", ids: [9, 10, 11, 12, 13, 14, 15] };
  }
  function setPower(v) {
    ui.power = clamp(v, 0, 1);
    const pct = Math.round(ui.power * 100);
    const vertical = !window.matchMedia("(max-width:650px)").matches;
    if (vertical) { dom.powerFill.style.height = pct + "%"; dom.powerFill.style.width = "calc(100% - 4px)"; }
    else { dom.powerFill.style.height = "auto"; dom.powerFill.style.width = pct + "%"; }
    dom.powerText.textContent = pct + "%";
  }

  function updateHUD() {
    ui.hudDirty = false;
    dom.soloModeBadge.classList.toggle("active", ui.mode === "solo");
    dom.practiceModeBadge.classList.toggle("active", ui.mode === "practice");
    dom.lanModeBadge.classList.toggle("active", ui.mode === "lan");

    if (ui.mode === "practice") {
      dom.p1Name.textContent = "训练者";
      dom.p2Name.textContent = DRILL_NAME[ui.practiceDrill] || "训练";
      dom.p1Avatar.textContent = "你"; dom.p2Avatar.textContent = "◎";
      dom.p1GroupText.textContent = "自由击球";
      dom.p2GroupText.textContent = DRILL_NAME[ui.practiceDrill] || "训练";
      dom.p1Balls.innerHTML = ballChip(0);
      dom.p2Balls.innerHTML = match.balls.filter(b => b.id !== 0 && !b.pocketed).slice(0, 5).map(b => ballChip(b.id)).join("");
      dom.scoreText.textContent = "练习";
      dom.seriesLabel.textContent = "训练模式";
      dom.frameScoreText.textContent = "";
      dom.turnText.textContent = "自由击球";
      dom.p1BreakChip.classList.add("hidden"); dom.p2BreakChip.classList.add("hidden");
      dom.p1Card.classList.add("active"); dom.p2Card.classList.remove("active");
      dom.p1PocketedTitle.textContent = "已进球";
      dom.p2PocketedTitle.textContent = "剩余球";
      const potted = match.balls.filter(b => b.pocketed && b.id !== 0).map(b => ballChip(b.id)).join("");
      dom.p1PocketedBalls.innerHTML = potted || '<span class="unassigned">暂无</span>';
      dom.p2PocketedBalls.innerHTML = match.balls.filter(b => !b.pocketed && b.id !== 0).map(b => ballChip(b.id)).join("");
    } else {
      dom.p1Name.textContent = playerName("p1");
      dom.p2Name.textContent = playerName("p2");
      dom.p1Avatar.textContent = ui.mode === "solo" ? "你" : (isLocal("p1") ? "你" : "P1");
      dom.p2Avatar.textContent = ui.mode === "solo" ? "AI" : (isLocal("p2") ? "你" : "P2");
      const won = r => `胜 ${match.score[r]} 局`;
      dom.p1PocketedTitle.textContent = won("p1");
      dom.p2PocketedTitle.textContent = won("p2");
      dom.p1BreakChip.classList.toggle("hidden", match.breaker !== "p1");
      dom.p2BreakChip.classList.toggle("hidden", match.breaker !== "p2");
      // 中间: 大字 = 对局比分(赢了几局); 小字 = 局内比分(本局各自进了几颗球)
      dom.seriesLabel.textContent = `第 ${frameNo()} 局 · 对局比分`;
      dom.scoreText.textContent = `${match.score.p1} : ${match.score.p2}`;
      dom.frameScoreText.textContent = `本局进球 ${match.pocketedFor("p1").length} : ${match.pocketedFor("p2").length}`;
      dom.p1Card.classList.toggle("active", match.current === "p1" && !match.gameOver);
      dom.p2Card.classList.toggle("active", match.current === "p2" && !match.gameOver);

      if (match.gameOver) dom.turnText.textContent = `${playerName(match.winner)} 赢得本局`;
      else if (ui.mode === "solo" && ui.aiThinking) dom.turnText.textContent = `${playerName("p2")} 思考中…`;
      else if (match.breakShot) dom.turnText.textContent = `${playerName(match.current)} 开球`;
      else dom.turnText.textContent = `${playerName(match.current)} 的回合`;

      for (const [player, textEl, ballsEl, pottedEl] of [
        ["p1", dom.p1GroupText, dom.p1Balls, dom.p1PocketedBalls],
        ["p2", dom.p2GroupText, dom.p2Balls, dom.p2PocketedBalls]
      ]) {
        const info = targetInfo(player);
        textEl.textContent = info.text;
        ballsEl.innerHTML = info.ids.map(id => ballChip(id, !!match.ball(id)?.pocketed)).join("");
        const ids = match.pocketedFor(player);
        pottedEl.innerHTML = ids.length ? ids.map(id => ballChip(id)).join("") : '<span class="unassigned">暂无</span>';
      }
    }

    const iPlace = !!match.ballInHand && humanControls(match.ballInHand) && ui.mode !== "practice";
    dom.ballInHandTip.classList.toggle("hidden", !iPlace);
    if (iPlace) dom.ballInHandTip.textContent = match.kitchen
      ? "开球区自由球：只能摆在开球线左侧的合法位置"
      : "自由球：点击台面任意合法位置摆放白球";
    if (dom.callPocketTip) dom.callPocketTip.classList.toggle("hidden", !needsCallLocal());
    dom.statusPill.textContent = noticeText();
    ui.renderDirty = true;
  }

  /** 左上角记录: “玩家名 + 事件”。role 为 null 时是系统消息。名字用 textContent 写入, 不怕特殊字符 */
  function pushLog(role, text, tone) {
    if (!dom.shotLog) return;
    const li = document.createElement("li");
    if (role === "p1" || role === "p2") {
      const b = document.createElement("b");
      b.className = "log-name " + role;
      b.textContent = playerName(role);
      li.appendChild(b);
      li.appendChild(document.createTextNode(" " + text));
    } else li.textContent = text;
    if (tone) li.className = tone;
    dom.shotLog.prepend(li);
    while (dom.shotLog.children.length > 6) dom.shotLog.lastChild.remove();
  }

  /* ------------------------------------------------------------------
   * 输入
   * ---------------------------------------------------------------- */
  function pointerWorld(e) {
    const r = dom.gameCanvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (dom.gameCanvas.width / r.width);
    const py = (e.clientY - r.top) * (dom.gameCanvas.height / r.height);
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  function needsCallLocal() {
    return ui.mode !== "practice" && match.needsCall(match.current) && humanControls(match.current) && !match.moving();
  }

  function canAimLocally() {
    if (match.gameOver || match.moving() || match.phase !== PHASE.AIM) return false;
    if (ui.awaitingRemote) return false;
    if (match.ballInHand) return false;
    if (needsCallLocal()) return false;
    if (ui.mode === "practice") return true;
    if (ui.mode === "solo") return match.current === "p1" && !ui.aiThinking;
    return lan.connected && match.current === lan.localRole;
  }

  function pocketAt(p) {
    for (const k of POCKETS) if (dist(p.x, p.y, k.x, k.y) < k.r + 30) return k;
    return null;
  }

  dom.gameCanvas.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (ui.charging) cancelCharge();
  });

  dom.gameCanvas.addEventListener("pointerdown", e => {
    unlockAudio();
    const p = pointerWorld(e);

    // 1) 自由球摆放
    if (match.ballInHand && humanControls(match.ballInHand) && ui.mode !== "practice") {
      requestPlaceCue(p.x, p.y);
      return;
    }
    // 2) 叫袋
    if (needsCallLocal()) {
      const k = pocketAt(p);
      if (k) requestCall(k.id);
      return;
    }
    if (!canAimLocally()) return;
    if (e.button !== undefined && e.button !== 0) return;

    dom.gameCanvas.setPointerCapture?.(e.pointerId);
    ui.pointerId = e.pointerId;
    aimAt(p);
    ui.charging = true;
    ui.chargeOrigin = p;
    setPower(0);
    setNotice("charge");
    updateHUD();
  });

  dom.gameCanvas.addEventListener("pointermove", e => {
    const p = pointerWorld(e);
    if (match.ballInHand && humanControls(match.ballInHand) && ui.mode !== "practice") {
      ui.hover = p; ui.renderDirty = true; return;
    }
    ui.hover = null;
    if (!ui.charging) { aimAt(p); return; }
    if (e.pointerId !== ui.pointerId) return;
    const dx = p.x - ui.chargeOrigin.x, dy = p.y - ui.chargeOrigin.y;
    const ax = Math.cos(ui.aimAngle), ay = Math.sin(ui.aimAngle);
    const back = -(dx * ax + dy * ay);
    setPower(clamp(back / 300, 0, 1));
    dom.statusPill.textContent = noticeText();
    ui.renderDirty = true;
  });

  dom.gameCanvas.addEventListener("pointerup", e => {
    if (!ui.charging || e.pointerId !== ui.pointerId) return;
    dom.gameCanvas.releasePointerCapture?.(e.pointerId);
    ui.charging = false; ui.pointerId = null;
    const p = pointerWorld(e);
    const dx = p.x - ui.chargeOrigin.x, dy = p.y - ui.chargeOrigin.y;
    const ax = Math.cos(ui.aimAngle), ay = Math.sin(ui.aimAngle);
    const power = clamp(-(dx * ax + dy * ay) / 300, 0, 1);
    // 关键修复: v0.7.4 里"点一下"就会以 12% 力度直接出杆, 误触频发
    if (power < 0.04) {
      setPower(0);
      setNotice("turn", { player: match.current });
      updateHUD();
      return;
    }
    requestShoot(ui.aimAngle, power, { ...ui.spin });
  });

  dom.gameCanvas.addEventListener("pointercancel", cancelCharge);
  dom.gameCanvas.addEventListener("pointerleave", () => { ui.hover = null; ui.renderDirty = true; });

  function cancelCharge() {
    if (!ui.charging) return;
    ui.charging = false; ui.pointerId = null;
    setPower(0);
    setNotice("turn", { player: match.current });
    updateHUD();
  }

  function aimAt(p) {
    const cue = match.cue();
    if (!cue || !canAimLocally()) return;
    ui.aimAngle = Math.atan2(p.y - cue.y, p.x - cue.x);
    ui.renderDirty = true;
  }

  // 键盘微调, 手柄/无鼠标环境也能玩
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (k === "r") { requestReset(); return; }
    if (k === "g") { toggleGuide(); return; }
    if (k === "m") { toggleMusic(); return; }
    if (e.key === "Escape") {
      [dom.helpDialog, dom.practiceDialog, dom.lanDialog].forEach(d => d.open && d.close());
      cancelCharge();
      return;
    }
    if (!canAimLocally()) return;
    const fine = e.shiftKey ? 0.002 : 0.012;
    if (e.key === "ArrowLeft") { ui.aimAngle -= fine; ui.renderDirty = true; e.preventDefault(); }
    if (e.key === "ArrowRight") { ui.aimAngle += fine; ui.renderDirty = true; e.preventDefault(); }
    if (e.key === "ArrowUp") { setPower(ui.power + 0.04); e.preventDefault(); }
    if (e.key === "ArrowDown") { setPower(ui.power - 0.04); e.preventDefault(); }
    if (e.key === " ") {
      e.preventDefault();
      if (ui.power > 0.04) requestShoot(ui.aimAngle, ui.power, { ...ui.spin });
    }
  });

  /* 旋转控制盘 */
  let spinDragging = false;
  function setSpinFromEvent(e) {
    const r = dom.spinBall.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / (r.width * .36);
    const y = -(e.clientY - (r.top + r.height / 2)) / (r.height * .36);
    const d = Math.hypot(x, y), k = d > 1 ? 1 / d : 1;
    ui.spin = { x: clamp(x * k, -1, 1), y: clamp(y * k, -1, 1) };
    updateSpinUI();
  }
  dom.spinBall.addEventListener("pointerdown", e => {
    spinDragging = true; dom.spinBall.setPointerCapture?.(e.pointerId); setSpinFromEvent(e); e.preventDefault();
  });
  dom.spinBall.addEventListener("pointermove", e => { if (spinDragging) setSpinFromEvent(e); });
  dom.spinBall.addEventListener("pointerup", e => { spinDragging = false; dom.spinBall.releasePointerCapture?.(e.pointerId); });
  dom.spinBall.addEventListener("pointercancel", () => { spinDragging = false; });
  dom.spinResetBtn.addEventListener("click", () => { ui.spin = { x: 0, y: 0 }; updateSpinUI(); });

  function updateSpinUI() {
    dom.spinKnob.style.left = (50 + ui.spin.x * 34) + "%";
    dom.spinKnob.style.top = (50 - ui.spin.y * 34) + "%";
    let label = "中心";
    if (Math.abs(ui.spin.y) > .28) label = ui.spin.y > 0 ? "高杆" : "低杆";
    if (Math.abs(ui.spin.x) > .28) label += (label === "中心" ? "" : " + ") + (ui.spin.x > 0 ? "右塞" : "左塞");
    dom.spinText.textContent = label;
    ui.renderDirty = true;
  }

  /* ------------------------------------------------------------------
   * 动作入口: 单机直接执行, 联机客机走"请求→主机裁决"
   * ---------------------------------------------------------------- */
  /* ------------------------------------------------------------------
   * 联机出杆: 客机本地预测
   * v0.8.7 的流程是 客机发请求 → 主机轮询收到 → 主机出杆并广播 → 客机轮询收到 → 客机才开始动,
   * 两次公网往返 + 两次轮询间隔, 松手到球动要 1 秒以上。
   * 现在客机松手立刻在本地出杆, 同时把“精确初速度 + 出杆前局面指纹”发给主机;
   * 物理是确定性的, 主机用同一组数字重算得到逐位相同的结果, 仍然以主机为准。
   * ---------------------------------------------------------------- */
  function snapHash(snap) {
    // FNV-1a: 只要两端浮点数逐位相同, 字符串就相同
    const str = JSON.stringify([snap.balls, snap.current, snap.ballInHand, snap.calledPocket, snap.groups, snap.shotCount]);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }

  function requestShoot(angle, power, spin) {
    if (ui.mode === "lan" && !lan.isHost) {
      if (match.current !== lan.localRole) return;
      const v = C.shotVelocity(angle, power);
      const pre = match.snapshot();
      const seq = ++lan.shotSeq;
      lan.pendingShot = { seq, hash: snapHash(pre) };
      sendLan("shotRequest", { angle, power, spin, vx: v.vx, vy: v.vy, seq, hash: lan.pendingShot.hash });
      doShoot(angle, power, spin, false, v);
      return;
    }
    doShoot(angle, power, spin, true);
  }

  function doShoot(angle, power, spin, broadcast, exact, seq) {
    ui.spin = { x: spin.x, y: spin.y };
    updateSpinUI();
    const shooter = match.current;
    const pre = broadcast && ui.mode === "lan" && lan.isHost ? match.snapshot() : null;
    const v = exact || C.shotVelocity(angle, power);
    if (!match.shoot(angle, power, spin, v)) return false;
    setPower(0);
    ui.charging = false;
    setNotice("shooting", { player: shooter });
    if (pre && lan.connected) {
      sendLan("shot", { shooter, angle, power, spin, vx: v.vx, vy: v.vy, seq: seq || 0, hash: snapHash(pre), pre });
    }
    updateHUD();
    return true;
  }

  function requestPlaceCue(x, y) {
    if (ui.mode === "lan" && !lan.isHost) {
      if (match.ballInHand !== lan.localRole) return;
      if (!match.placeCue(x, y)) { flashInvalid(); return; }   // 本地先摆, 主机随后确认
      ui.hover = null;
      sendLan("placeRequest", { x, y });
      afterPlace();
      return;
    }
    if (!match.placeCue(x, y)) { flashInvalid(); return; }
    ui.hover = null;
    afterPlace();
  }

  function afterPlace() {
    rolling.reset(match.balls);  // 自由球被玩家拿起再放下：不让画面把摆球路径误当滚动
    setNotice(match.needsCall(match.current) ? "needCall" : "turn", { player: match.current });
    if (ui.mode === "lan" && lan.isHost) broadcastState();
    updateHUD();
    maybeRunAI();
  }

  function flashInvalid() {
    dom.statusPill.textContent = "这个位置不合法：不能压球、进袋口或越过开球线";
    ui.renderDirty = true;
    setTimeout(() => { dom.statusPill.textContent = noticeText(); }, 1400);
  }

  function requestCall(index) {
    if (ui.mode === "lan" && !lan.isHost) {
      if (match.current !== lan.localRole) return;
      match.callPocket(index);                         // 本地先生效
      sendLan("callRequest", { index });
      setNotice("turn", { player: match.current });
      updateHUD();
      return;
    }
    match.callPocket(index);
    setNotice("turn", { player: match.current });
    if (ui.mode === "lan" && lan.isHost) broadcastState();
    updateHUD();
  }

  function requestReset() {
    if (ui.mode === "practice") { setupPractice(ui.practiceDrill); return; }
    if (ui.mode === "lan" && !lan.isHost) { sendLan("resetRequest", {}); return; }
    newGame();
  }

  /* ------------------------------------------------------------------
   * 回合流转
   * ---------------------------------------------------------------- */
  function onSettled(result) {
    ui.awaitingRemote = false;
    if (result) {
      if (result.rerack) rolling.reset(match.balls);
      else {
        for (const id of (result.respot || [])) rolling.reposition(match.ball(id));
        if (result.fouls?.includes("scratch")) rolling.reposition(match.cue());
      }
    }
    onSettledInner(result);
    if (ui.mode === "lan") {
      if (lan.isHost) drainHostQueue();
      else if (lan.pendingState) { const p = lan.pendingState; clearPendingState(); applyHostState(p, false); }
    }
  }
  function onSettledInner(result) {
    if (!result) return;

    if (result.practice) {
      setNotice("practice");
      updateHUD();
      return;
    }

    const shooter = result.shooter || match.current;

    if (result.rerack) {
      pushLog(shooter, result.fouls.indexOf("bad_break") >= 0
        ? `开球无效（未进球且碰库球不足 4 颗），改由 ${playerName(match.breaker)} 重新开球`
        : `开球打进 8 号球，重新摆球开球`, "warn");
      setNotice("rerack", { shooter, player: match.breaker });
    } else if (result.gameOver) {
      if (result.pocketedObjects.length) pushLog(shooter, "打进 " + ballsText(result.pocketedObjects), "good");
      pushLog(shooter, WIN_TEXT[result.winReason] || "打进 8 号球", result.winner === shooter ? "good" : "warn");
      pushLog(result.winner, `赢得第 ${frameNo()} 局 · 总比分 ${match.score.p1} : ${match.score.p2}`, "good");
      showGameOver(result);
      if (ui.mode === "lan" && lan.isHost) broadcastState();
      updateHUD();
      return;
    } else {
      if (result.pocketedObjects.length) pushLog(shooter, "打进 " + ballsText(result.pocketedObjects), result.fouls.length ? "" : "good");
      if (result.respot.indexOf(8) >= 0) pushLog(shooter, "开球打进 8 号球，已摆回置球点", "");
      if (result.newGroup) pushLog(shooter, "定为" + GROUP_NAME[result.newGroup], "good");
      if (result.fouls.length) pushLog(shooter, "犯规：" + (FOUL_TEXT[result.fouls[0]] || result.fouls[0]), "warn");

      if (result.fouls.length) {
        const foul = result.fouls[0];
        if (match.ballInHand) setNotice(match.kitchen ? "ballInHand.kitchen" : "ballInHand", { player: match.ballInHand, shooter, foul });
        else setNotice("foul", { player: match.current, shooter, foul });
      } else if (result.continues) {
        setNotice(match.needsCall(match.current) ? "needCall" : "turn.continue", { player: match.current });
      } else {
        setNotice(match.needsCall(match.current) ? "needCall" : "turn", { player: match.current });
      }
    }

    if (ui.mode === "lan" && lan.isHost) broadcastState();
    updateHUD();
    maybeRunAI();
  }

  function maybeRunAI() {
    clearAiTimers();
    if (ui.mode !== "solo" || match.gameOver || match.current !== "p2") return;
    if (match.phase !== PHASE.AIM) return;

    ui.aiThinking = true;
    ui.aiPreviewAngle = null;
    setNotice("ai.think");
    updateHUD();

    const thinkMs = ui.aiDifficulty === "hard" ? 340 : ui.aiDifficulty === "easy" ? 700 : 520;
    ui.aiTimers.push(setTimeout(() => {
      if (ui.mode !== "solo" || match.gameOver || match.current !== "p2") { ui.aiThinking = false; return; }

      if (match.ballInHand === "p2") {
        const spot = AI.planBallInHand({
          balls: match.balls, group: match.groups.p2, cleared: match.isCleared("p2"),
          kitchen: match.kitchen, isBreak: match.breakShot, difficulty: ui.aiDifficulty
        });
        match.placeCue(spot.x, spot.y);
        rolling.reset(match.balls);
      }

      const plan = AI.planShot({
        balls: match.balls, group: match.groups.p2, cleared: match.isCleared("p2"),
        isBreak: match.breakShot, difficulty: ui.aiDifficulty
      });
      if (!plan) { ui.aiThinking = false; return; }

      if (match.needsCall("p2")) match.callPocket(plan.calledPocket != null ? plan.calledPocket : bestPocketForEight());
      ui.aiPreviewAngle = plan.angle;
      ui.aimAngle = plan.angle;
      ui.renderDirty = true;

      ui.aiTimers.push(setTimeout(() => {
        if (ui.mode !== "solo" || match.gameOver || match.current !== "p2") { ui.aiThinking = false; return; }
        ui.aiThinking = false;
        ui.aiPreviewAngle = null;
        doShoot(plan.angle, plan.power, plan.spin, false);
      }, 300));
    }, thinkMs));
  }

  function bestPocketForEight() {
    const eight = match.ball(8);
    if (!eight) return 0;
    let best = 0, bd = Infinity;
    POCKETS.forEach((p, i) => { const d = dist(eight.x, eight.y, p.x, p.y); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  function clearAiTimers() {
    ui.aiTimers.forEach(clearTimeout);
    ui.aiTimers.length = 0;
    ui.aiThinking = false;
    ui.aiPreviewAngle = null;
  }

  /* ------------------------------------------------------------------
   * 局面控制
   * ---------------------------------------------------------------- */
  /**
   * 开下一局。series=true 时开始新的对局(比分清零, 房主 / 玩家先开球);
   * 否则上一局赢家开球, 中途重开沿用本局开球方。
   */
  function newGame(series) {
    clearAiTimers();
    match.rules = Object.assign(match.rules, rules);
    if (series) match.newSeries(); else match.reset();
    rolling.reset(match.balls);
    particles.length = 0;
    ui.spin = { x: 0, y: 0 };
    ui.awaitingRemote = false;
    setPower(0);
    updateSpinUI();
    clearConfetti();
    stopVictory();
    dom.gameOver.classList.add("hidden");
    if (dom.shotLog) dom.shotLog.innerHTML = "";
    pushLog(match.breaker, `开球 · 第 ${frameNo()} 局（总比分 ${match.score.p1} : ${match.score.p2}）`, "");
    setNotice("turn.break", { player: match.breaker });
    if (ui.mode === "lan" && lan.isHost) broadcastState();
    updateHUD();
    maybeRunAI();
  }

  function setupPractice(drill) {
    clearAiTimers();
    ui.mode = "practice";
    ui.practiceDrill = drill;
    const layout = [];
    const put = (id, x, y) => layout.push({ id, x, y });
    if (drill === "break") {
      match.reset();
      match.freeplay = true;
      match.ballInHand = null;
      match.kitchen = false;
      match.cue().x = C.HEAD_STRING_X - 10;
      match.cue().y = TABLE.cy;
    } else {
      put(0, C.HEAD_STRING_X - 40, TABLE.cy);
      if (drill === "straight") { put(1, 950, TABLE.cy); put(2, 1230, TABLE.cy); }
      else if (drill === "cut") { put(3, 980, TABLE.cy - 90); put(4, 1180, TABLE.cy + 110); }
      else { put(1, 860, TABLE.cy - 110); put(2, 1080, TABLE.cy + 30); put(3, 1280, TABLE.cy - 140); }
      match.setFreeplayLayout(layout);
    }
    rolling.reset(match.balls);
    particles.length = 0;
    ui.spin = { x: 0, y: 0 };
    setPower(0); updateSpinUI();
    dom.gameOver.classList.add("hidden");
    setNotice("practice");
    updateHUD();
  }

  async function switchToSolo() {
    if (lan.connected) await disconnectLan(true);
    ui.mode = "solo";
    newGame(true);
    dom.statusPill.textContent = "已切换到 AI 单机模式";
  }

  function showGameOverSeries() {
    if (!dom.resultSeries) return;
    dom.resultSeries.textContent =
      `对局比分  ${playerName("p1")} ${match.score.p1} : ${match.score.p2} ${playerName("p2")} · 下一局由 ${playerName(match.winner)} 开球`;
  }
  function showGameOver(result) {
    const iWin = isLocal(result.winner);
    const winner = playerName(result.winner);
    dom.resultIcon.textContent = iWin ? "🏆" : "🎱";
    dom.resultTitle.textContent = `${winner} 赢得本局`;
    dom.resultText.textContent = WIN_TEXT[result.winReason] || "本局结束";
    showGameOverSeries();
    dom.playAgainBtn.textContent = ui.mode === "lan" && !lan.isHost ? "请求下一局" : "下一局";
    dom.gameOver.classList.remove("hidden");
    setNotice("over");
    if (iWin) spawnConfetti(); else clearConfetti();
    if (iWin) playVictory(); else play("lose", .7);
  }

  /* 彩带 */
  let confettiTimer = null;
  function clearConfetti() {
    if (confettiTimer) { clearTimeout(confettiTimer); confettiTimer = null; }
    if (dom.confettiLayer) dom.confettiLayer.innerHTML = "";
  }
  function spawnConfetti() {
    if (!dom.confettiLayer) return;
    clearConfetti();
    const colors = ["#ff4d4f", "#ffd84d", "#18cc7e", "#5ec8ff", "#b47cff", "#ffffff", "#ff9d22"];
    const emit = (count, side) => {
      for (let i = 0; i < count; i++) {
        const piece = document.createElement("i");
        piece.className = "confetti-piece" + (Math.random() > .55 ? " ribbon" : "");
        let left = "50%", top = "50%", sx = "0px", sy = "0px", tx = "0px", ty = "0px";
        if (side === "left") {
          left = (2 + Math.random() * 6).toFixed(1) + "%"; top = (62 + Math.random() * 24).toFixed(1) + "%";
          sx = (-20 - Math.random() * 35).toFixed(1) + "px"; sy = (Math.random() * 30 - 15).toFixed(1) + "px";
          tx = (320 + Math.random() * 760).toFixed(1) + "px"; ty = (-120 - Math.random() * 420).toFixed(1) + "px";
        } else if (side === "right") {
          left = (92 + Math.random() * 6).toFixed(1) + "%"; top = (62 + Math.random() * 24).toFixed(1) + "%";
          sx = (20 + Math.random() * 35).toFixed(1) + "px"; sy = (Math.random() * 30 - 15).toFixed(1) + "px";
          tx = (-320 - Math.random() * 760).toFixed(1) + "px"; ty = (-120 - Math.random() * 420).toFixed(1) + "px";
        } else {
          left = (8 + Math.random() * 84).toFixed(1) + "%"; top = (2 + Math.random() * 7).toFixed(1) + "%";
          sx = (Math.random() * 30 - 15).toFixed(1) + "px"; sy = (-40 - Math.random() * 60).toFixed(1) + "px";
          tx = (Math.random() * 700 - 350).toFixed(1) + "px"; ty = (280 + Math.random() * 520).toFixed(1) + "px";
        }
        piece.style.left = left; piece.style.top = top;
        piece.style.background = colors[(Math.random() * colors.length) | 0];
        piece.style.setProperty("--sx", sx); piece.style.setProperty("--sy", sy);
        piece.style.setProperty("--tx", tx); piece.style.setProperty("--ty", ty);
        piece.style.setProperty("--rot", (Math.random() * 1440 - 720).toFixed(0) + "deg");
        piece.style.setProperty("--dur", (2.5 + Math.random() * 1.3).toFixed(2) + "s");
        dom.confettiLayer.appendChild(piece);
      }
    };
    emit(70, "left"); emit(70, "right"); emit(60, "top");
    confettiTimer = setTimeout(clearConfetti, 4300);
  }

  /* ------------------------------------------------------------------
   * 联机(主机权威)
   * ---------------------------------------------------------------- */
  const NET = window.BILLIARDS_NETWORK_CONFIG || {};
  const DEFAULT_SIGNAL = "https://8balls-signal.pages.dev";

  function normalizeUrl(v) {
    let u = String(v || "").trim();
    if (!u) return "";
    if (/^wss:\/\//i.test(u)) u = u.replace(/^wss:/i, "https:");
    else if (/^ws:\/\//i.test(u)) u = u.replace(/^ws:/i, "http:");
    return u.replace(/\/+$/, "");
  }
  const configuredSignal = () => normalizeUrl(dom.linkSignalUrl?.value || NET.signalingUrl || DEFAULT_SIGNAL);
  const toyUrl = () => String(NET.toyPublicUrl || "https://www.bilibili.com/toy/8Balls/index.html").trim();

  function lanStatus(text, info, tone) {
    dom.lanStatusText.textContent = text;
    dom.lanRoomInfo.textContent = info || " ";
    const box = dom.lanStatusText.closest(".lan-status-box");
    box?.classList.toggle("connected", tone === "connected");
    box?.classList.toggle("failed", tone === "failed");
  }

  function sendLan(type, payload) {
    if (!lan.connected && type !== "hello") return;
    const msg = { from: lan.localRole, type, payload: payload || {} };
    if (lan.transport === "link") {
      lan.sendQueue.push({ type, payload: msg.payload });
      flushSendQueue();
    }
  }

  function broadcastState() {
    if (ui.mode !== "lan" || !lan.connected || !lan.isHost) return;
    sendLan("state", { snapshot: match.snapshot(), notice: ui.notice });
  }

  /* --- 主机: 处理客机请求 --- */
  function hostHandleRequest(evt) {
    const pl = evt.payload || {};
    if (evt.type === "shotRequest") {
      const ok = match.current === "p2" && match.phase === PHASE.AIM && !match.ballInHand && !match.needsCall("p2");
      if (!ok) {
        sendLan("shotReject", { seq: pl.seq, snapshot: match.snapshot(), notice: ui.notice });
        return;
      }
      doShoot(pl.angle, pl.power, pl.spin || { x: 0, y: 0 }, true,
        Number.isFinite(pl.vx) && Number.isFinite(pl.vy) ? { vx: pl.vx, vy: pl.vy } : null, pl.seq);
    } else if (evt.type === "placeRequest") {
      if (match.ballInHand === "p2" && match.placeCue(pl.x, pl.y)) afterPlace();
      else broadcastState();                            // 不合法: 把客机拉回主机局面
    } else if (evt.type === "callRequest") {
      if (match.current === "p2") match.callPocket(pl.index);
      broadcastState(); updateHUD();
    }
  }
  function drainHostQueue() {
    while (lan.hostQueue.length && match.phase === PHASE.AIM && !match.moving() && !match.gameOver) {
      hostHandleRequest(lan.hostQueue.shift());
    }
    if (match.gameOver) lan.hostQueue.length = 0;
  }

  /* --- 客机: 接收主机消息 --- */
  function clearPendingState() {
    lan.pendingState = null;
    if (lan.pendingTimer) { clearTimeout(lan.pendingTimer); lan.pendingTimer = null; }
  }
  function applyHostState(pl, force) {
    const snap = pl.snapshot;
    if (!snap) return;
    if (!force && snap.gameNo === match.gameNo && (snap.shotCount || 0) < match.shotCount) return;  // 过期: 早于本地已预测的那一杆
    const fresh = lan.freshJoin; lan.freshJoin = false;
    const newFrame = (fresh || (snap.gameNo != null && snap.gameNo !== match.gameNo)) && !snap.gameOver;
    match.restore(snap);
    rolling.reset(match.balls);
    ui.awaitingRemote = false;
    if (newFrame) {
      // 主机开了新的一局: 客机同样清空记录、写下开球方
      clearConfetti();
      if (dom.shotLog) dom.shotLog.innerHTML = "";
      if (!snap.shotCount) pushLog(match.breaker, `开球 · 第 ${frameNo()} 局（总比分 ${match.score.p1} : ${match.score.p2}）`, "");
    }
    if (pl.notice) {
      // 主机本地的临时提示(蓄力等)对客机没有意义, 换成“谁的回合”
      ui.notice = pl.notice.code === "charge" ? { code: "turn", data: { player: match.current } } : pl.notice;
    }
    if (match.gameOver) {
      if (dom.gameOver.classList.contains("hidden")) showGameOver({ winner: match.winner, winReason: match.winReason, pocketedObjects: [] });
      else if (dom.resultSeries) showGameOverSeries();
    }
    else dom.gameOver.classList.add("hidden");
    ui.renderDirty = true;
    updateHUD();
  }
  function guestOnState(pl) {
    const snap = pl.snapshot;
    if (!snap) return;
    if (snap.gameNo === match.gameNo && (snap.shotCount || 0) < match.shotCount) return;
    if (match.phase === PHASE.SHOOTING) {
      // 本地这一杆还在滚: 等本地结算后再对齐, 不在半路把球瞬移到终点
      lan.pendingState = pl;
      if (!lan.pendingTimer) lan.pendingTimer = setTimeout(() => {
        const p = lan.pendingState; clearPendingState();
        if (p) { match.forceStop(); match.phase = PHASE.AIM; applyHostState(p, true); }
      }, 12000);
      return;
    }
    applyHostState(pl, false);
  }
  function guestOnShot(pl) {
    const mine = lan.pendingShot && pl.seq && pl.seq === lan.pendingShot.seq;
    if (mine) {
      const same = pl.hash === lan.pendingShot.hash;
      lan.pendingShot = null;
      if (same) return;                                   // 预测与主机一致: 什么都不用做
      pushLog(null, "本地局面与主机不一致，已按主机重放这一杆", "warn");
    }
    // 主机出杆(或预测失败): 从主机的出杆前局面开始, 用同一组初速度重算
    clearPendingState();
    if (pl.pre) {
      match.forceStop();
      match.phase = PHASE.AIM;
      match.restore(pl.pre);
      rolling.reset(match.balls);
    }
    doShoot(pl.angle, pl.power, pl.spin || { x: 0, y: 0 }, false,
      Number.isFinite(pl.vx) ? { vx: pl.vx, vy: pl.vy } : null);
  }

  function handleLanEvent(evt) {
    if (!evt || evt.from === lan.localRole) return;
    const pl = evt.payload || {};
    switch (evt.type) {
      case "hello":
        lan.peerName = pl.name || lan.peerName;
        if (lan.isHost) { sendLan("helloAck", { name: lan.playerName }); broadcastState(); }
        updateHUD();
        break;
      case "helloAck":
        lan.peerName = pl.name || lan.peerName;
        updateHUD();
        break;

      /* --- 主机收到的请求: 模拟进行中就先排队, 结算后按顺序处理 --- */
      case "shotRequest":
      case "placeRequest":
      case "callRequest":
        if (!lan.isHost) break;
        if (match.phase !== PHASE.AIM || match.moving()) { lan.hostQueue.push(evt); break; }
        hostHandleRequest(evt);
        break;
      case "resetRequest":
        if (lan.isHost) { lan.hostQueue.length = 0; newGame(); }
        break;

      /* --- 客机收到的权威消息 --- */
      case "shot":
        if (lan.isHost) break;
        guestOnShot(pl);
        break;
      case "shotReject":
        if (lan.isHost) break;
        lan.pendingShot = null;
        clearPendingState();
        if (pl.snapshot) applyHostState(pl, true);
        pushLog(null, "主机未接受这一杆，已同步回主机局面", "warn");
        break;
      case "state":
        if (lan.isHost) break;
        guestOnState(pl);
        break;
      case "peer-left":
      case "bye":
        lanStatus("对方已离开房间", lan.isHost ? "房间仍然保留，朋友可以用同一个房间号重新加入。" : "主机已关闭房间，可以重新加入或创建房间。");
        setNotice("peerLeft");
        updateHUD();
        break;
    }
  }

  /* --- Cloudflare 中继 --- */
  async function signalApi(path, body, method) {
    const base = normalizeUrl(lan.signalUrl || configuredSignal());
    if (!base) throw new Error("尚未配置联机服务地址");
    const opts = { method: method || "POST", headers: {} };
    if (body != null) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch(base + path, opts);
    let data = {};
    try { data = await res.json(); } catch { }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.message || SIGNAL_ERR[data.error] || data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const SIGNAL_ERR = {
    BAD_ROOM: "房间号格式不正确", ROOM_EXISTS: "房间号已被占用", ROOM_NOT_FOUND: "房间不存在或已过期",
    ROOM_FULL: "房间已满", HOST_OFFLINE: "主机已离线", NO_FREE_ROOM: "房间号暂时用完了，请稍后再试",
    BAD_TOKEN: "房间会话已失效，请重新创建或加入"
  };
  /**
   * 顺序发送: 同一时刻只有一个请求在路上, 保证 placeRequest 一定先于 shotRequest 到达;
   * 在路上时新产生的消息攒起来, 下一次一起发(后端支持 batch 时)。
   */
  async function flushSendQueue() {
    if (lan.sending || !lan.sendQueue.length) return;
    if (lan.transport !== "link" || !lan.roomId) { lan.sendQueue.length = 0; return; }
    lan.sending = true;
    lan.lastActivity = Date.now();
    const base = { room: lan.roomId, role: lan.isHost ? "host" : "guest", token: lan.token };
    const take = lan.batchOk ? lan.sendQueue.splice(0, 20) : lan.sendQueue.splice(0, 1);
    const body = take.length === 1 ? { ...base, type: take[0].type, payload: take[0].payload } : { ...base, batch: take };
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await signalApi("/api/send", body); break; }
      catch (err) {
        if (err.status && err.status < 500) break;             // 4xx 重试也没用
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    lan.sending = false;
    if (lan.sendQueue.length) flushSendQueue();
  }
  function stopLinkPolling() { if (lan.signalPollTimer) clearTimeout(lan.signalPollTimer); lan.signalPollTimer = null; }
  /** 房间被关闭 / 会话失效: 停止轮询并提示, 不再静默卡住 */
  function linkSessionLost(err) {
    stopLinkPolling();
    const msg = String(err.message || err);
    lan.connected = false; lan.transport = null; lan.roomId = ""; lan.token = "";
    showRoom("");
    lanStatus("房间已关闭", msg, "failed");
    dom.statusPill.textContent = "联机已断开：" + msg;
  }
  /* 自适应轮询: 最近 6 秒内有消息往来 → 220ms; 空闲 → 700ms。
   * Cloudflare Pages Functions 免费额度每天 10 万次请求, 固定 180ms 轮询两人约 2.5 小时就会用完。 */
  function pollDelay() {
    if (!lan.connected) return 900;
    // 轮到对方 / 有球在滚 / 刚有消息往来: 对方随时会出杆, 快速轮询
    if (match.current !== localRole() || match.phase === PHASE.SHOOTING || lan.pendingShot) return 150;
    // 轮到自己瞄准时对方不会发来关键消息, 放慢以节省请求额度
    return Date.now() - lan.lastActivity < 4000 ? 250 : 650;
  }
  function startLinkPolling() {
    stopLinkPolling();
    const tick = async () => {
      if (lan.transport !== "link") return;
      const roomAtStart = lan.roomId;
      try {
        const base = normalizeUrl(lan.signalUrl);
        const role = lan.isHost ? "host" : "guest";
        const url = `${base}/api/poll?room=${encodeURIComponent(lan.roomId)}&role=${role}` +
          `&since=${lan.signalLastEventId}&token=${encodeURIComponent(lan.token || "")}`;
        const t0 = performance.now();
        const res = await fetch(url, { cache: "no-store" });
        const rtt = performance.now() - t0;
        lan.rtt = lan.rtt ? lan.rtt * 0.8 + rtt * 0.2 : rtt;
        let data = {};
        try { data = await res.json(); } catch { }
        if (!res.ok || data.ok === false) {
          const err = new Error(data.message || SIGNAL_ERR[data.error] || data.error || `HTTP ${res.status}`);
          err.status = res.status; throw err;
        }
        if (lan.roomId !== roomAtStart) return;       // 期间已切换房间
        const events = data.events || [];
        if (events.length) lan.lastActivity = Date.now();
        // 对方关页面/断网时 beacon 不一定送达, 靠服务端心跳兜底
        if (typeof data.peerOnline === "boolean" && lan.connected) {
          if (lan.peerOnline && !data.peerOnline) { lanStatus("对方可能已掉线", "等待重连，或重新创建房间。", "failed"); setNotice("peerLeft"); updateHUD(); }
          lan.peerOnline = data.peerOnline;
        }
        for (const evt of events) {
          lan.signalLastEventId = Math.max(lan.signalLastEventId, Number(evt.id) || 0);
          if (evt.type === "peer-joined") {
            if (!lan.isHost) continue;
            lan.peerName = evt.payload?.name || "好友";
            lan.connected = true;
            enterLan(true, true);
            lanStatus("好友已加入房间", `房间 ${lan.roomId} · ${NET.lanMode ? "局域网" : "云端"}同步已连接`, "connected");
            sendLan("helloAck", { name: lan.playerName });
            broadcastState();
            continue;
          }
          handleLanEvent({ from: evt.from === "host" ? "p1" : evt.from === "guest" ? "p2" : evt.from, type: evt.type, payload: evt.payload || {} });
        }
      } catch (err) {
        if (err.status === 403 || err.status === 404) { linkSessionLost(err); return; }
        if (!lan.connected) lanStatus(NET.lanMode ? "局域网服务暂时不可用" : "云端房间暂时不可用", String(err.message || err), "failed");
      }
      if (lan.transport === "link" && lan.roomId === roomAtStart) lan.signalPollTimer = setTimeout(tick, pollDelay());
    };
    lan.lastActivity = Date.now();
    tick();
  }

  /* --- 三位数字房间号 ---
   * 客户端先随机一个 100–999 的号码提交;
   *   · 后端返回了 room 字段 → 以后端分配为准(lan-server / 升级后的云端都会这么做);
   *   · 号码被占用(409 或提示已存在) → 换号重试;
   *   · 后端还不认 3 位格式(400) → 退回旧的 8 位房间码, 保证旧后端照样能用。 */
  const ROOM_RE = /^(\d{3}|[A-Z2-9]{6,12})$/;
  function randomDigits() {
    const b = new Uint32Array(1); crypto.getRandomValues(b);
    return String(100 + (b[0] % 900));
  }
  function randomLegacyRoom() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let out = ""; for (const b of bytes) out += abc[b % abc.length];
    return out;
  }
  const isTaken = err => err.status === 409 || /exist|taken|占用|已存在|duplicate/i.test(err.message || "");
  const isBadFormat = err => err.status === 400 || /format|格式|invalid/i.test(err.message || "");

  async function allocateRoom(name) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const room = randomDigits();
      try {
        const data = await signalApi("/api/create", { room, name });
        lan.token = data.token || "";
        lan.batchOk = Array.isArray(data.features) && data.features.includes("batch");
        return String(data.room || room).toUpperCase();
      } catch (err) {
        if (isTaken(err)) continue;
        if (isBadFormat(err)) break;
        throw err;
      }
    }
    const room = randomLegacyRoom();
    const data = await signalApi("/api/create", { room, name });
    lan.token = data.token || "";
    return String(data.room || room).toUpperCase();
  }

  function showRoom(room) {
    dom.linkRoomChip.textContent = `ROOM ${room || "---"}`;
    if (dom.linkRoomBig) dom.linkRoomBig.textContent = room || "---";
  }
  const shareUrl = () => (NET.lanMode && NET.lanUrls && NET.lanUrls[0]) || toyUrl();

  async function createLinkRoom() {
    try {
      await disconnectLan(false);
      const signalUrl = configuredSignal();
      if (!signalUrl) throw new Error("联机服务地址为空");
      if (location.protocol === "https:" && signalUrl.startsWith("http://")) throw new Error("HTTPS 页面必须使用 https:// 联机地址");
      lan.transport = "link"; lan.isHost = true; lan.localRole = "p1";
      lan.playerName = (dom.linkPlayerName.value.trim() || "Player").slice(0, 18);
      lan.peerName = "等待朋友"; lan.signalUrl = signalUrl; lan.roomId = ""; lan.token = "";
      lan.connected = false; lan.signalLastEventId = 0;
      dom.linkJoinCard.classList.add("hidden");
      showRoom("…");
      lanStatus("正在创建房间", NET.lanMode ? "正在连接局域网服务…" : "正在连接云端…");
      const room = await allocateRoom(lan.playerName);
      lan.roomId = room;
      showRoom(room);
      lanStatus("房间已创建", `房间号 ${room} · 等待朋友加入`);
      startLinkPolling();
    } catch (err) {
      lan.transport = null; showRoom("");
      lanStatus("创建房间失败", String(err.message || err), "failed");
    }
  }

  async function joinLinkRoom(room) {
    try {
      await disconnectLan(false);
      const url = configuredSignal();
      if (!url) throw new Error("联机服务地址为空");
      switchNetworkTab("link");
      dom.linkJoinCard.classList.remove("hidden");
      dom.linkJoinText.textContent = "正在加入房间…";
      lan.transport = "link"; lan.isHost = false; lan.localRole = "p2";
      lan.playerName = (dom.linkPlayerName.value.trim() || "好友").slice(0, 18);
      lan.peerName = "房主"; lan.signalUrl = url; lan.roomId = room; lan.token = "";
      lan.connected = false; lan.signalLastEventId = 0;
      showRoom(room);
      const data = await signalApi("/api/join", { room, name: lan.playerName });
      lan.peerName = data.hostName || "房主";
      lan.token = data.token || "";
      lan.batchOk = Array.isArray(data.features) && data.features.includes("batch");
      lan.signalLastEventId = Number(data.since) || 0;   // 只收加入之后的事件
      lan.connected = true;
      enterLan(false, false);
      startLinkPolling();
      sendLan("hello", { name: lan.playerName });
      dom.linkJoinText.textContent = "已进入房间，等待主机同步局面…";
      lanStatus("已进入房间", `房间 ${room} · ${NET.lanMode ? "局域网" : "云端"}同步已连接`, "connected");
    } catch (err) {
      lan.transport = null;
      lanStatus("加入房间失败", String(err.message || err), "failed");
      dom.linkJoinCard.classList.remove("hidden");
      dom.linkJoinText.textContent = String(err.message || err);
    }
  }

  /* --- 局域网 ---
   * 浏览器拿不到本机真实 IPv4(WebRTC 已用 mDNS 隐藏; HTTPS 页面也不能访问 http 局域网地址),
   * 所以由 server/lan-server.js 读取网卡地址, 并托管游戏页面。
   * 页面由它打开时 NET.lanMode === true, 好友房间自动改走本机中继。 */
  function lanPort() {
    const n = parseInt(String(dom.lanPortInput?.value || NET.lanPort || 8765), 10);
    return n > 0 && n < 65536 ? n : 8765;
  }
  function renderLanUrls(urls, note) {
    dom.lanIpList.innerHTML = "";
    if (!urls.length) {
      const li = document.createElement("li"); li.className = "empty";
      li.textContent = note || "没有找到可用的局域网地址，请确认已连接 Wi-Fi 或网线。";
      dom.lanIpList.appendChild(li); return;
    }
    for (const u of urls) {
      const li = document.createElement("li");
      const code = document.createElement("code"); code.textContent = u;
      const copy = document.createElement("button"); copy.className = "ghost-btn compact"; copy.textContent = "复制";
      copy.addEventListener("click", async () => {
        const ok = await copyText(u);
        lanStatus(ok ? "地址已复制" : "复制失败", ok ? `把 ${u} 发给朋友` : "请手动复制。", ok ? "connected" : "failed");
      });
      const open = document.createElement("button"); open.className = "primary-btn compact"; open.textContent = "用此地址打开";
      open.addEventListener("click", () => openUrl(u));
      li.append(code, copy, open);
      dom.lanIpList.appendChild(li);
    }
  }
  async function detectLanServer() {
    const port = lanPort();
    const base = `http://localhost:${port}`;
    lanStatus("正在检测本机服务", base);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1500);
      const res = await fetch(`${base}/api/lan-info`, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      const data = await res.json();
      renderLanUrls(data.urls || []);
      lanStatus("已找到本机服务", "点“用此地址打开”，然后在好友房间里创建房间。", "connected");
    } catch (err) {
      renderLanUrls([], location.protocol === "https:"
        ? "当前是 HTTPS 页面，浏览器可能拦截了对本机服务的访问。请直接在浏览器地址栏打开 http://localhost:" + port + "/"
        : "没有检测到服务：请先双击 server/start_server.bat，并确认端口一致。");
      lanStatus("未检测到本机服务", String(err.name === "AbortError" ? "连接超时" : (err.message || err)), "failed");
    }
  }
  function normalizeLanHost(v) {
    let u = String(v || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "http://" + u;
    try {
      const url = new URL(u);
      if (!url.port) url.port = String(lanPort());
      url.pathname = "/"; url.search = ""; url.hash = "";
      return url.toString();
    } catch { return ""; }
  }
  function openUrl(u) {
    // Toy 等 iframe 环境里改不了顶层地址, 用新窗口打开
    let top = false;
    try { top = window.top === window.self; } catch { }
    if (top) location.href = u; else window.open(u, "_blank", "noopener");
  }
  function applyLanMode() {
    if (!NET.lanMode) return;
    dom.lanModeBanner?.classList.remove("hidden");
    const u = (NET.lanUrls && NET.lanUrls[0]) || location.origin + "/";
    if (dom.lanBannerUrl) dom.lanBannerUrl.textContent = u;
    renderLanUrls(NET.lanUrls || []);
  }

  function enterLan(asHost, doReset) {
    ui.mode = "lan";
    lan.isHost = asHost;
    lan.localRole = asHost ? "p1" : "p2";
    lan.freshJoin = !asHost;
    clearAiTimers();
    if (doReset) newGame(true);      // 新朋友加入: 新的对局, 房主先开球
    else updateHUD();
  }

  async function disconnectLan(notify) {
    if (notify && lan.connected) sendLan("bye", {});
    if (lan.transport === "link" && lan.roomId) {
      try { await signalApi("/api/leave", { room: lan.roomId, role: lan.isHost ? "host" : "guest", token: lan.token }); } catch { }
    }
    stopLinkPolling();
    lan.connected = false; lan.transport = null; lan.isHost = false;
    lan.localRole = "p1"; lan.peerName = "Guest"; lan.roomId = ""; lan.token = "";
    lan.signalLastEventId = 0; lan.peerOnline = false;
    lan.sendQueue.length = 0; lan.sending = false; lan.hostQueue.length = 0;
    lan.pendingShot = null; clearPendingState();
    ui.awaitingRemote = false;
    showRoom("");
    lanStatus("未连接", NET.lanMode ? "局域网模式：创建房间或输入房间号。" : "创建房间，或输入朋友的 3 位房间号。");
  }

  function switchNetworkTab(mode) {
    const map = { link: [dom.networkLinkTab, dom.networkLinkPane], lan: [dom.networkLanTab, dom.networkLanPane] };
    for (const key of Object.keys(map)) {
      map[key][0].classList.toggle("active", key === mode);
      map[key][1].classList.toggle("hidden", key !== mode);
    }
    if (lan.transport) return;          // 已连接时不覆盖状态文案
    if (mode === "link") lanStatus(NET.lanMode ? "局域网好友房间" : "好友房间", "主机创建房间，把 3 位房间号报给朋友。");
    else lanStatus("局域网", NET.lanMode ? "当前页面已由局域网服务托管，直接用好友房间即可。" : "主机先运行 server/start_server.bat。");
  }

  async function copyText(text) {
    if (!text) return false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch { }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch { }
    ta.remove(); return ok;
  }
  /* ------------------------------------------------------------------
   * 绑定
   * ---------------------------------------------------------------- */
  function bindDialogClose(dialog, sel) {
    document.querySelector(sel)?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", e => {
      const r = dialog.getBoundingClientRect();
      if (!(e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) dialog.close();
    });
  }
  const openDialog = el => (typeof el.showModal === "function" ? el.showModal() : el.setAttribute("open", ""));
  bindDialogClose(dom.helpDialog, "[data-close-help]");
  bindDialogClose(dom.practiceDialog, "[data-close-practice]");
  bindDialogClose(dom.lanDialog, "[data-close-lan]");

  dom.rulesBtn.addEventListener("click", () => openDialog(dom.helpDialog));
  dom.practiceBtn.addEventListener("click", () => openDialog(dom.practiceDialog));
  dom.practiceSideBtn.addEventListener("click", () => openDialog(dom.practiceDialog));
  dom.lanBtn.addEventListener("click", () => openDialog(dom.lanDialog));
  dom.lanSideBtn.addEventListener("click", () => openDialog(dom.lanDialog));

  document.querySelectorAll("[data-drill]").forEach(btn => btn.addEventListener("click", async () => {
    if (lan.connected) await disconnectLan(true);
    setupPractice(btn.dataset.drill);
    dom.practiceDialog.close();
  }));

  dom.soloBtn.addEventListener("click", switchToSolo);
  dom.soloSideBtn.addEventListener("click", switchToSolo);
  dom.restartBtn.addEventListener("click", requestReset);
  dom.playAgainBtn.addEventListener("click", requestReset);
  dom.closeOverlayBtn.addEventListener("click", () => dom.gameOver.classList.add("hidden"));

  function toggleGuide() {
    ui.guide = !ui.guide;
    dom.guideBtn.classList.toggle("active", ui.guide);
    dom.statusPill.textContent = ui.guide ? "瞄准辅助已开启" : "瞄准辅助已关闭";
    ui.renderDirty = true;
  }
  dom.guideBtn.addEventListener("click", toggleGuide);

  dom.aiDifficulty.addEventListener("change", () => {
    ui.aiDifficulty = dom.aiDifficulty.value;
    dom.statusPill.textContent = `AI 难度：${{ easy: "休闲", normal: "标准", hard: "高手" }[ui.aiDifficulty]}`;
  });
  dom.qualitySelect.addEventListener("change", () => {
    ui.quality = dom.qualitySelect.value;
    autoPenalty = 1; staticScale = 0;
    resizeCanvas();
  });

  function toggleSound() {
    ui.sound = !ui.sound;
    unlockAudio();
    if (!ui.sound) stopVictory();
    syncBgm();
    updateSoundButtons();
  }
  dom.soundBtn.addEventListener("click", toggleSound);
  dom.soundBtnSide.addEventListener("click", toggleSound);
  if (dom.musicBtnSide) dom.musicBtnSide.addEventListener("click", toggleMusic);

  // 规则开关
  if (dom.ruleCallEight) dom.ruleCallEight.addEventListener("change", () => {
    rules.callEightPocket = dom.ruleCallEight.checked;
    match.rules.callEightPocket = rules.callEightPocket;
    updateHUD();
  });
  if (dom.ruleKitchen) dom.ruleKitchen.addEventListener("change", () => {
    rules.kitchenOnBreakFoul = dom.ruleKitchen.checked;
    match.rules.kitchenOnBreakFoul = rules.kitchenOnBreakFoul;
  });
  if (dom.ruleEightOnBreak) dom.ruleEightOnBreak.addEventListener("change", () => {
    rules.eightOnBreak = dom.ruleEightOnBreak.value;
    match.rules.eightOnBreak = rules.eightOnBreak;
  });

  dom.networkLinkTab.addEventListener("click", () => switchNetworkTab("link"));
  dom.networkLanTab.addEventListener("click", () => switchNetworkTab("lan"));
  dom.linkCreateBtn.addEventListener("click", createLinkRoom);
  dom.copyInviteLinkBtn.addEventListener("click", async () => {
    const room = lan.roomId || "";
    if (!room) { lanStatus("还没有房间号", "请先创建房间。", "failed"); return; }
    const ok = await copyText(`来和我打 8 球！\n打开：${shareUrl()}\n房间号：${room}\n进入“联机 → 好友房间”，输入房间号即可加入。`);
    lanStatus(ok ? "邀请信息已复制" : "复制失败", ok ? `房间号 ${room}` : "请手动复制。", ok ? "connected" : "failed");
  });
  dom.copyRoomCodeBtn.addEventListener("click", async () => {
    if (!lan.roomId) { lanStatus("还没有房间号", "请先创建房间。", "failed"); return; }
    const ok = await copyText(lan.roomId);
    lanStatus(ok ? "房间号已复制" : "复制失败", ok ? `已复制 ${lan.roomId}` : "请手动复制。", ok ? "connected" : "failed");
  });
  dom.linkJoinRoomBtn.addEventListener("click", () => {
    const room = String(dom.linkJoinRoomCode.value || "").replace(/\s+/g, "").toUpperCase();
    if (!ROOM_RE.test(room)) { lanStatus("房间号格式不正确", "请输入 3 位数字房间号。", "failed"); return; }
    joinLinkRoom(room);
  });
  dom.linkJoinRoomCode.addEventListener("keydown", e => { if (e.key === "Enter") dom.linkJoinRoomBtn.click(); });
  dom.linkJoinRoomCode.addEventListener("input", () => {
    const v = dom.linkJoinRoomCode.value;
    if (/^\d{3}$/.test(v.trim())) dom.linkJoinRoomBtn.focus();   // 输满 3 位直接回车/点按钮
  });
  dom.copyLanUrlBtn?.addEventListener("click", async () => {
    const u = dom.lanBannerUrl.textContent;
    const ok = await copyText(u);
    lanStatus(ok ? "地址已复制" : "复制失败", ok ? `把 ${u} 发给朋友` : "请手动复制。", ok ? "connected" : "failed");
  });
  dom.lanDetectBtn.addEventListener("click", detectLanServer);
  dom.lanOpenBtn.addEventListener("click", () => {
    const u = normalizeLanHost(dom.lanHostInput.value);
    if (!u) { lanStatus("地址格式不正确", "例如 192.168.1.25 或 192.168.1.25:8765", "failed"); return; }
    openUrl(u);
  });
  dom.lanHostInput.addEventListener("keydown", e => { if (e.key === "Enter") dom.lanOpenBtn.click(); });
  dom.disconnectLanBtn.addEventListener("click", async () => { await disconnectLan(true); switchToSolo(); });

  window.addEventListener("pagehide", () => {
    if (lan.transport !== "link" || !lan.roomId) return;
    if (lan.connected) sendLan("bye", {});
    // 关页面时立刻释放房间号 / 客机位(text/plain 不触发 CORS 预检)
    try {
      const body = JSON.stringify({ room: lan.roomId, role: lan.isHost ? "host" : "guest", token: lan.token });
      navigator.sendBeacon?.(normalizeUrl(lan.signalUrl) + "/api/leave", new Blob([body], { type: "text/plain" }));
    } catch { }
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  window.addEventListener("keydown", unlockAudio, { once: true });

  /* ------------------------------------------------------------------
   * 主循环: 固定步长 + 累加器, 与帧率解耦
   * ---------------------------------------------------------------- */
  let lastTs = 0, accumulator = 0, fpsFrames = 0, fpsStamp = performance.now();
  let activeFrames = 0, slowFrames = 0, renderMs = 0, qualityCooldown = 0;
  document.addEventListener("visibilitychange", () => {
    // 页面暂停后不能把后台的几秒钟累积成大量物理步数。
    lastTs = 0; accumulator = 0;
  });

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;

    if (document.hidden) { lastTs = 0; accumulator = 0; requestAnimationFrame(frame); return; }
    const busy = match.phase === PHASE.SHOOTING || match.moving() || particles.length > 0;
    if (busy) {
      activeFrames++;
      if (dt > 0.021) slowFrames++;
      accumulator += dt;
      let steps = 0;
      const maxSteps = PHYS.maxSubSteps * 3;
      while (accumulator >= PHYS.fixedDt && steps < maxSteps) {
        const settled = match.step(PHYS.fixedDt);
        rolling.advance(match.balls, PHYS.fixedDt);
        stepParticles(PHYS.fixedDt);
        accumulator -= PHYS.fixedDt;
        steps++;
        if (settled) { onSettled(match.lastResult); break; }
      }
      if (accumulator > 0.25) accumulator = 0;
      consumeEvents();
      ui.renderDirty = true;
    } else {
      accumulator = 0;
      if (match.events.length) consumeEvents();
    }

    if (needsCallLocal()) ui.renderDirty = true;   // 袋口呼吸动画
    if (ui.hudDirty) updateHUD();
    if (ui.renderDirty) {
      const started = performance.now();
      draw();
      if (busy) renderMs += performance.now() - started;
      ui.renderDirty = false;
    }

    fpsFrames++;
    if (ts - fpsStamp >= 1000) {
      const fps = Math.round(fpsFrames * 1000 / (ts - fpsStamp));
      dom.fpsText.textContent = fps + " FPS" + (ui.mode === "lan" && lan.rtt ? ` · 延迟 ${Math.round(lan.rtt)}ms` : "");
      fpsFrames = 0; fpsStamp = ts;
      // 自适应仅在真实滚动/动画时采样，不会因静止或隐藏标签页误判。
      // 使用冷却期防止 DPR 频繁切换导致纹理层重建和卡顿。
      if (ui.quality === "auto" && activeFrames >= 15 && ts > qualityCooldown) {
        const misses = slowFrames / activeFrames;
        const ms = renderMs / activeFrames;
        if ((misses > .22 || ms > 10) && autoPenalty > .66) {
          autoPenalty = Math.max(.66, autoPenalty - .12);
          qualityCooldown = ts + 5000;
          resizeCanvas();
        } else if (misses < .035 && ms < 4.5 && autoPenalty < 1) {
          autoPenalty = Math.min(1, autoPenalty + .05);
          qualityCooldown = ts + 7000;
          resizeCanvas();
        }
      }
      activeFrames = 0; slowFrames = 0; renderMs = 0;
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------
   * 启动
   * ---------------------------------------------------------------- */
  buildAudio();
  buildMusic();
  updateSoundButtons();
  if (dom.linkSignalUrl) dom.linkSignalUrl.value = normalizeUrl(NET.signalingUrl || DEFAULT_SIGNAL);
  applyLanMode();
  switchNetworkTab("link");
  buildStaticLayer(1);
  resizeCanvas();
  preloadTextures();
  updateSpinUI();
  newGame(true);
  requestAnimationFrame(frame);

  // ResizeObserver 比 window.resize 更可靠(布局变化 / 全屏 / 旋转屏)
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(dom.gameCanvas);

  window.BilliardsGame = {
    version: VERSION, ui, rules,
    get match() { return match; },
    music,
    reset: requestReset, setupPractice, switchToSolo
  };
})();
