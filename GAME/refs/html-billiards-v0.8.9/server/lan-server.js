#!/usr/bin/env node
/* =============================================================
 * HTML Billiards  —  LAN server (零依赖, Node >= 16)
 *
 * 作用:
 *   1. 在局域网内托管游戏页面 (http://<本机IPv4>:8765/)
 *   2. 提供与 Cloudflare 好友房间“完全同一套协议”的中继 API
 *      /api/create /api/join /api/send /api/poll /api/leave
 *      → 前端只保留“好友房间”一条代码路径, 局域网和公网只是服务地址不同
 *   3. 房间号由服务器分配, 3 位数字 (100–999), 冲突自动重试, 闲置自动回收
 *   4. /api/lan-info 返回本机 IPv4 列表; 访问 /network-config.js 时
 *      自动把 signalingUrl 改写为本服务器地址, 页面无需任何手动填写
 *
 * 运行:  node server/lan-server.js [端口]      (默认 8765)
 * ============================================================= */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const ROOT = path.resolve(__dirname, "..");
const ROOM_IDLE_MS = 10 * 60 * 1000;   // 双方都 10 分钟没轮询 → 回收房间
const HOST_GONE_MS = 45 * 1000;        // 主机 45 秒没轮询 → 视为离线, 拒绝新加入
const GUEST_GONE_MS = 20 * 1000;       // 客机 20 秒没轮询 → 允许别人顶替加入
const MAX_QUEUE = 600;
const FEATURES = ["short-room", "batch"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".wav": "audio/wav", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8"
};

/* ---------------- 本机 IPv4 ---------------- */
function lanIPv4() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === "IPv4" || a.family === 4;
      if (!v4 || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;            // 自动私有地址, 不可用
      const virtual = /vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier|utun|tun|tap/i.test(name);
      const privateNet = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      out.push({ name, address: a.address, virtual, privateNet });
    }
  }
  // 真实网卡 + 私网地址排前面 (192.168 > 10 > 172)
  const rank = x => (x.virtual ? 10 : 0) + (x.privateNet ? 0 : 5) +
    (x.address.startsWith("192.168.") ? 0 : x.address.startsWith("10.") ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

/* ---------------- 房间 ---------------- */
const rooms = new Map();   // code → room

function now() { return Date.now(); }

function allocCode() {
  // 先随机尝试, 满了再线性扫描; 900 个号码对局域网绰绰有余
  for (let i = 0; i < 60; i++) {
    const code = String(100 + crypto.randomInt(900));
    if (!rooms.has(code)) return code;
  }
  for (let n = 100; n <= 999; n++) if (!rooms.has(String(n))) return String(n);
  return null;
}

function newRoom(code, hostName) {
  const t = now();
  const room = {
    code, hostName, guestName: null, nextId: 1,
    queues: { host: [], guest: [] },
    seen: { host: t, guest: 0 },
    created: t
  };
  rooms.set(code, room);
  return room;
}

function push(room, to, type, from, payload) {
  const q = room.queues[to];
  q.push({ id: room.nextId++, type, from, payload: payload == null ? {} : payload, ts: now() });
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE);
}

function sweep() {
  const t = now();
  for (const [code, r] of rooms) {
    const last = Math.max(r.seen.host, r.seen.guest, r.created);
    if (t - last > ROOM_IDLE_MS) rooms.delete(code);
  }
}
setInterval(sweep, 30 * 1000).unref();

const cleanName = (s, dflt) => String(s || dflt).trim().slice(0, 18) || dflt;
const cleanCode = s => String(s == null ? "" : s).trim().toUpperCase();
const roleOf = s => (s === "host" || s === "p1" ? "host" : s === "guest" || s === "p2" ? "guest" : null);
const other = r => (r === "host" ? "guest" : "host");

/* ---------------- HTTP 工具 ---------------- */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Chrome Private Network Access 预检: 允许从其它来源访问局域网地址
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function json(res, status, data) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}
const fail = (res, status, message) => json(res, status, { ok: false, error: message, message });

function readBody(req) {
  return new Promise(resolve => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > 256 * 1024) req.destroy(); });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function originOf(req) {
  // 用浏览器实际访问的 Host, 这样通过 IP 或 localhost 打开都正确
  return "http://" + (req.headers.host || ("localhost:" + PORT));
}

/* ---------------- API ---------------- */
const LEGACY = "IP";   // 兼容旧版“输入 IP”模式的固定房间

async function api(req, res, url) {
  const p = url.pathname;
  const body = req.method === "POST" ? await readBody(req) : {};
  const q = k => url.searchParams.get(k);

  if (p === "/api/health") return json(res, 200, { ok: true, server: "billiards-lan", rooms: rooms.size });

  if (p === "/api/lan-info") {
    const ips = lanIPv4();
    return json(res, 200, {
      ok: true, port: PORT, ips,
      urls: ips.filter(x => !x.virtual).map(x => `http://${x.address}:${PORT}/`),
      origin: originOf(req)
    });
  }

  /* ---- 创建房间: 默认服务器分配 3 位数字 ---- */
  if (p === "/api/create") {
    sweep();
    let code = cleanCode(body.room);
    // 客户端不传 / 传 "AUTO" → 服务器分配; 客户端自带旧式长房间码也兼容
    if (!code || code === "AUTO") code = allocCode();
    if (!code) return fail(res, 503, "房间已满, 请稍后再试");
    if (!/^(\d{3}|[A-Z0-9]{3,12})$/.test(code)) return fail(res, 400, "房间码格式不正确");
    if (rooms.has(code)) return fail(res, 409, "房间码已被占用");
    newRoom(code, cleanName(body.name, "主机"));
    return json(res, 200, { ok: true, room: code, features: FEATURES });
  }

  /* ---- 加入房间 ---- */
  if (p === "/api/join" && body.room != null) {
    const code = cleanCode(body.room);
    const r = rooms.get(code);
    if (!r) return fail(res, 404, `房间 ${code} 不存在或已过期`);
    const t = now();
    if (t - r.seen.host > HOST_GONE_MS) return fail(res, 410, "主机已离线");
    if (r.guestName && t - r.seen.guest < GUEST_GONE_MS) return fail(res, 409, "房间已满");
    r.guestName = cleanName(body.name, "好友");
    r.seen.guest = t;
    r.queues.guest.length = 0;
    push(r, "host", "peer-joined", "guest", { name: r.guestName });
    return json(res, 200, { ok: true, room: code, hostName: r.hostName, features: FEATURES });
  }

  /* ---- 发送 ---- */
  if (p === "/api/send" && body.room != null) {
    const r = rooms.get(cleanCode(body.room));
    const role = roleOf(body.role);
    if (!r) return fail(res, 404, "房间不存在");
    if (!role) return fail(res, 400, "role 无效");
    const list = Array.isArray(body.batch) ? body.batch.slice(0, 32) : [{ type: body.type, payload: body.payload }];
    if (!list.length || list.some(it => typeof it?.type !== "string" || !it.type)) return fail(res, 400, "type 无效");
    r.seen[role] = now();
    for (const it of list) push(r, other(role), it.type, role, it.payload);
    return json(res, 200, { ok: true });
  }

  /* ---- 轮询 ---- */
  if (p === "/api/poll" && q("room") != null) {
    const r = rooms.get(cleanCode(q("room")));
    const role = roleOf(q("role"));
    if (!r) return fail(res, 404, "房间不存在或已过期");
    if (!role) return fail(res, 400, "role 无效");
    r.seen[role] = now();
    const since = Number(q("since")) || 0;
    // since 之前的事件客户端已确认收到, 直接丢弃, 防止队列无限增长
    if (since > 0) r.queues[role] = r.queues[role].filter(e => e.id > since);
    const events = r.queues[role];
    return json(res, 200, {
      ok: true, events,
      peerOnline: r.seen[other(role)] > 0 && now() - r.seen[other(role)] < GUEST_GONE_MS
    });
  }

  /* ---- 离开 ---- */
  if (p === "/api/leave" && (body.room != null)) {
    const code = cleanCode(body.room);
    const r = rooms.get(code);
    const role = roleOf(body.role);
    if (r && role) {
      push(r, other(role), "peer-left", role, {});
      if (role === "host") rooms.delete(code);
      else { r.guestName = null; r.seen.guest = 0; }
    }
    return json(res, 200, { ok: true });
  }

  /* ---- 兼容旧版“输入 IP”模式 (player=p1/p2, 无房间号) ---- */
  if (p === "/api/host") {
    rooms.delete(LEGACY);
    newRoom(LEGACY, cleanName(body.name, "主机"));
    const ip = lanIPv4().find(x => !x.virtual);
    return json(res, 200, { ok: true, lanUrl: ip ? `http://${ip.address}:${PORT}` : originOf(req) });
  }
  if (p === "/api/join") {
    const r = rooms.get(LEGACY);
    if (!r) return fail(res, 404, "主机尚未创建对局");
    r.guestName = cleanName(body.name, "P2"); r.seen.guest = now();
    push(r, "host", "hello", "p2", { name: r.guestName });
    return json(res, 200, { ok: true, hostName: r.hostName });
  }
  if (p === "/api/send") {
    const r = rooms.get(LEGACY); const role = roleOf(body.player);
    if (!r || !role) return fail(res, 404, "对局不存在");
    r.seen[role] = now();
    push(r, other(role), body.type, role === "host" ? "p1" : "p2", body.payload);
    return json(res, 200, { ok: true });
  }
  if (p === "/api/poll") {
    const r = rooms.get(LEGACY); const role = roleOf(q("player"));
    if (!r || !role) return json(res, 200, { ok: true, events: [] });
    r.seen[role] = now();
    const since = Number(q("since")) || 0;
    return json(res, 200, { ok: true, events: r.queues[role].filter(e => e.id > since) });
  }
  if (p === "/api/leave") {
    const r = rooms.get(LEGACY); const role = roleOf(body.player);
    if (r && role) { push(r, other(role), "peer-left", role === "host" ? "p1" : "p2", {}); if (role === "host") rooms.delete(LEGACY); }
    return json(res, 200, { ok: true });
  }

  return fail(res, 404, "未知接口 " + p);
}

/* ---------------- 静态文件 + 配置注入 ---------------- */
function lanConfigScript(req) {
  const origin = originOf(req);
  const ips = lanIPv4().filter(x => !x.virtual).map(x => x.address);
  // 保留原 network-config.js 的其它字段, 只覆盖 signalingUrl
  let base = "";
  try { base = fs.readFileSync(path.join(ROOT, "network-config.js"), "utf8"); } catch {}
  return base + `
/* ---- 以下由 lan-server.js 在局域网托管时自动注入 ---- */
window.BILLIARDS_NETWORK_CONFIG = Object.assign(window.BILLIARDS_NETWORK_CONFIG || {}, {
  signalingUrl: ${JSON.stringify(origin)},
  lanMode: true,
  lanPort: ${PORT},
  lanIPs: ${JSON.stringify(ips)},
  lanUrls: ${JSON.stringify(ips.map(ip => `http://${ip}:${PORT}/`))}
});
`;
}

function injectIndex(html, req) {
  const origin = originOf(req);
  // 页面里“联机服务地址”输入框的默认值改为本服务器, 旧版前端不改代码也能用
  return html.replace(/(id="linkSignalUrl"[^>]*?value=")[^"]*(")/, `$1${origin}$2`);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end("Forbidden"); }
  if (/[\\/]server[\\/]/.test(file.slice(ROOT.length))) { res.writeHead(403); return res.end("Forbidden"); }

  const base = path.basename(file);
  if (base === "network-config.js" && path.dirname(file) === ROOT) {
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    return res.end(lanConfigScript(req));
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404"); }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    if (base === "index.html" && path.dirname(file) === ROOT) {
      fs.readFile(file, "utf8", (e, txt) => {
        if (e) { res.writeHead(500); return res.end(); }
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(injectIndex(txt, req));
      });
      return;
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- 启动 ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith("/api/")) {
    api(req, res, url).catch(err => fail(res, 500, String(err && err.message || err)));
    return;
  }
  serveStatic(req, res, url);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") console.error(`\n端口 ${PORT} 被占用。换一个端口: node server/lan-server.js 8766\n`);
  else console.error(err);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIPv4();
  const line = "─".repeat(52);
  console.log(`\n${line}\n  HTML 台球 · 局域网服务已启动\n${line}`);
  console.log(`  本机打开:      http://localhost:${PORT}/`);
  const real = ips.filter(x => !x.virtual);
  if (real.length) {
    console.log(`  同一 Wi-Fi 的朋友打开:`);
    for (const ip of real) console.log(`    http://${ip.address}:${PORT}/    (${ip.name})`);
  } else {
    console.log("  没找到可用的局域网 IPv4, 请确认已连接 Wi-Fi / 网线。");
  }
  const virt = ips.filter(x => x.virtual);
  if (virt.length) console.log(`  (已忽略虚拟网卡: ${virt.map(x => x.address).join(", ")})`);
  console.log(`\n  打开后进入“联机 → 好友房间”，主机创建房间得到 3 位房间号，`);
  console.log(`  朋友输入房间号即可。首次运行 Windows 可能弹出防火墙提示，请允许“专用网络”。`);
  console.log(`${line}\n`);
});
