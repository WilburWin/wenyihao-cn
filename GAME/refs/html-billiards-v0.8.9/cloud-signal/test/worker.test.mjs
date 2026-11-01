/* 本地回归测试: node test/worker.test.mjs  (用 node:sqlite 模拟 D1) */
import { DatabaseSync } from "node:sqlite";
import worker from "../_worker.js";

function makeD1(db) {
  const wrap = (sql, args = []) => ({
    sql, args,
    bind: (...a) => wrap(sql, a),
    async first() { const r = db.prepare(sql).get(...args); return r ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() {
      if (/^\s*(select|pragma)|returning/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: { changes: 0 } };
      const r = db.prepare(sql).run(...args); return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: sql => wrap(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

const sqlite = new DatabaseSync(":memory:");
// 模拟 1.0.0 已经建好的旧表 + 一个旧房间
sqlite.exec(`CREATE TABLE rooms (room TEXT PRIMARY KEY, host_name TEXT NOT NULL, guest_name TEXT, updated_at INTEGER NOT NULL);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, sender TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
  INSERT INTO rooms VALUES ('OLDROOM1','old',NULL,${Date.now()});`);
const env = { DB: makeD1(sqlite), ASSETS: { fetch: () => new Response("asset") } };

let realNow = Date.now, offset = 0;
Date.now = () => realNow() + offset;

async function call(method, path, body) {
  const init = { method, headers: { "content-type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  const res = await worker.fetch(new Request("https://x.dev" + path, init), env);
  return { status: res.status, ...(await res.json()) };
}
const post = (p, b) => call("POST", p, b);
const get = p => call("GET", p);

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (e ? "  → " + JSON.stringify(e) : ""))); };

console.log("\n迁移 / 建房");
let h = await post("/api/create", { room: "427", name: "Alice" });
ok("旧表自动迁移后可以建房", h.ok && h.room === "427" && h.token, h);
const cols = sqlite.prepare("PRAGMA table_info(rooms)").all().map(r => r.name);
ok("补齐新列", ["host_token", "guest_token", "host_seen", "guest_seen"].every(c => cols.includes(c)), cols);

let h2 = await post("/api/create", { room: "427", name: "Bob" });
ok("号码被占时服务器自动换号", h2.ok && /^\d{3}$/.test(h2.room) && h2.room !== "427", h2);
let h3 = await post("/api/create", { name: "Carol" });
ok("不带房间号也能分配", h3.ok && /^\d{3}$/.test(h3.room), h3);
let bad = await post("/api/create", { room: "ab!", name: "x" });
ok("非法房间号返回 400", bad.status === 400);
let legacy = await post("/api/create", { room: "ABCD2345", name: "Legacy" });
ok("旧版长房间码继续可用", legacy.ok && legacy.room === "ABCD2345");
let legacyDup = await post("/api/create", { room: "ABCD2345", name: "Legacy2" });
ok("旧版长房间码重复返回 409", legacyDup.status === 409);

console.log("\n加入 / 鉴权");
let g = await post("/api/join", { room: "427", name: "Guest" });
ok("加入成功并返回 token / since", g.ok && g.token && g.hostName === "Alice" && g.since > 0, g);
let g2 = await post("/api/join", { room: "427", name: "Eve" });
ok("客机在线时第二人加入被拒(409)", g2.status === 409, g2);
let nf = await post("/api/join", { room: "999", name: "x" });
ok("不存在的房间 404", nf.status === 404 || (nf.status === 409 && false), nf);

let spoof = await post("/api/send", { room: "427", role: "host", type: "state", payload: {} });
ok("不带 token 冒充主机被拒(403)", spoof.status === 403);
let spoof2 = await post("/api/send", { room: "427", role: "host", token: g.token, type: "state", payload: {} });
ok("用客机 token 冒充主机被拒", spoof2.status === 403);
let badPoll = await get(`/api/poll?room=427&role=guest&since=0&token=nope`);
ok("错误 token 轮询被拒", badPoll.status === 403);

let hp = await get(`/api/poll?room=427&role=host&since=0&token=${h.token}`);
ok("主机收到 peer-joined", hp.ok && hp.events.some(e => e.type === "peer-joined" && e.payload.name === "Guest"), hp);
await post("/api/send", { room: "427", role: "host", token: h.token, type: "helloAck", payload: { name: "Alice" } });
let gp = await get(`/api/poll?room=427&role=guest&since=${g.since}&token=${g.token}`);
ok("客机只收到加入之后的事件", gp.ok && gp.events.length === 1 && gp.events[0].type === "helloAck", gp.events);
ok("peerOnline 正确", gp.peerOnline === true);

console.log("\n超时 / 回收");
offset += 30 * 1000;   // 客机 30 秒没心跳
await get(`/api/poll?room=427&role=host&since=0&token=${h.token}`);
let g3 = await post("/api/join", { room: "427", name: "Eve" });
ok("原客机掉线后新客机可以顶替", g3.ok, g3);
let oldGuest = await get(`/api/poll?room=427&role=guest&since=0&token=${g.token}`);
ok("被顶替的旧客机 token 失效", oldGuest.status === 403);

offset += 70 * 1000;   // 主机 70 秒没心跳
let off = await post("/api/join", { room: "427", name: "Late" });
ok("主机离线后加入返回 410", off.status === 410 || off.status === 409, off);
let take = await post("/api/create", { room: "427", name: "Dave" });
ok("主机离线的号码可被回收", take.ok && take.room === "427", take);
let oldHost = await get(`/api/poll?room=427&role=host&since=0&token=${h.token}`);
ok("被回收后旧主机 token 失效", oldHost.status === 403);
let fresh = await get(`/api/poll?room=427&role=host&since=0&token=${take.token}`);
ok("回收后的新房间没有旧事件", fresh.ok && fresh.events.length === 0, fresh.events);

console.log("\n离开");
let g4 = await post("/api/join", { room: "427", name: "Guest4" });
await post("/api/leave", { room: "427", role: "host", token: take.token });
let left = await get(`/api/poll?room=427&role=guest&since=${g4.since}&token=${g4.token}`);
ok("主机离开后客机收到 peer-left", left.ok && left.events.some(e => e.type === "peer-left"), left);
let reuse = await post("/api/create", { room: "427", name: "Next" });
ok("主机离开后号码立即可复用", reuse.ok && reuse.room === "427", reuse);

console.log("\n清理 / 容量");
offset += 11 * 60 * 1000;
await post("/api/create", { name: "gc" });
const roomsLeft = sqlite.prepare("SELECT COUNT(*) AS n FROM rooms").get().n;
ok("长时间离线的房间被清理", roomsLeft <= 2, roomsLeft);
// 占满 900 个号码
const tk = Date.now();
sqlite.exec("BEGIN");
const ins = sqlite.prepare("INSERT OR REPLACE INTO rooms(room,host_name,updated_at,host_token,host_seen) VALUES(?,?,?,?,?)");
for (let n = 100; n <= 999; n++) ins.run(String(n), "x", tk, "t", tk);
sqlite.exec("COMMIT");
let full = await post("/api/create", { name: "late" });
ok("号码全满时返回 503", full.status === 503, full);

console.log("\n批量发送");
{
  sqlite.exec("DELETE FROM rooms");
  const hb = await post("/api/create", { name: "Batch" });
  const gb = await post("/api/join", { room: hb.room, name: "G" });
  ok("create / join 声明支持 batch", hb.features?.includes("batch") && gb.features?.includes("batch"));
  const r = await post("/api/send", { room: hb.room, role: "guest", token: gb.token,
    batch: [{ type: "placeRequest", payload: { x: 1 } }, { type: "shotRequest", payload: { seq: 1 } }] });
  ok("一次请求写入多条消息", r.ok && r.ids.length === 2 && r.ids[0] < r.ids[1], r);
  const p = await get(`/api/poll?room=${hb.room}&role=host&since=0&token=${hb.token}`);
  const types = p.events.map(e => e.type);
  ok("按发送顺序收到", types.indexOf("placeRequest") < types.indexOf("shotRequest") && types.includes("shotRequest"), types);
  const bad = await post("/api/send", { room: hb.room, role: "guest", token: "x", batch: [{ type: "a" }] });
  ok("批量发送同样鉴权", bad.status === 403);
  const none = await post("/api/send", { room: "998", role: "guest", token: "x", type: "a" });
  ok("不存在的房间 404", none.status === 404);
}

console.log("\n健康检查");
let hc = await get("/health");
ok("health 显示新版本", hc.version === "2.1.0" && hc.shortRooms === true, hc);

console.log(`\n通过 ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
