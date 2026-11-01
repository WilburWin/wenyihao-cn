/* =============================================================
 * 8Balls 联机中继 (Cloudflare Pages + D1)  v2.0.0
 *
 * 相对 1.0.0 的改动:
 *   1. 3 位数字房间号 (100–999), 由服务器原子分配; 旧的 6–12 位房间码继续兼容。
 *   2. 建房用 INSERT … ON CONFLICT … WHERE 一条语句完成, 不再“先查后插”,
 *      两个人同时建同一个号不会互相覆盖。
 *   3. 心跳: 轮询时刷新 host_seen / guest_seen (每 10 秒最多写一次, 控制 D1 写入量)。
 *      主机 60 秒无心跳 → 房间号可被回收; 客机 25 秒无心跳 → 允许别人加入。
 *   4. 会话令牌: 3 位房间号谁都猜得到, 所以 create/join 返回 token,
 *      之后 send/poll/leave 必须带上对应角色的 token, 陌生人无法冒充主机或客机发消息。
 *   5. join 返回 since, 新客机不会收到上一位客机时期的旧事件。
 *   6. 清理改为按索引删除, 并且只在建房时顺带执行。
 *
 * 2.1.0 (降低延迟):
 *   7. send / poll 的鉴权、心跳、读写合并成一次 D1 batch —— 原来每个请求要和 D1 串行往返 3 次,
 *      D1 主库如果不在附近, 光这一项就是几百毫秒。
 *   8. /api/send 支持 batch: [{type, payload}, ...], 一次请求写多条消息。
 * ============================================================= */

const VERSION = "2.1.0";

const HOST_TTL = 60 * 1000;          // 主机多久没心跳视为离线, 房间号可回收
const GUEST_TTL = 25 * 1000;         // 客机多久没心跳视为离线, 空出客机位
const SEEN_WRITE_EVERY = 10 * 1000;  // 心跳最多每 10 秒写一次库
const ROOM_GC = 10 * 60 * 1000;      // 主机离线 10 分钟后删除房间
const EVENT_GC = 30 * 60 * 1000;     // 事件保留 30 分钟

const FEATURES = ["short-room", "token", "batch"];

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

const MESSAGES = {
  BAD_ROOM: "房间号格式不正确",
  BAD_REQUEST: "请求参数不正确",
  ROOM_EXISTS: "房间号已被占用",
  ROOM_NOT_FOUND: "房间不存在或已过期",
  ROOM_FULL: "房间已满",
  HOST_OFFLINE: "主机已离线",
  NO_FREE_ROOM: "房间号暂时用完了，请稍后再试",
  BAD_TOKEN: "房间会话已失效，请重新创建或加入",
  NOT_FOUND: "未知接口",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}
function fail(error, status, extra) {
  return json({ ok: false, error, message: MESSAGES[error] || error, ...(extra || {}) }, status);
}

/* ---------------- 房间号 / 角色 / 令牌 ---------------- */

const SHORT_RE = /^\d{3}$/;
const LEGACY_RE = /^[A-Z2-9]{6,12}$/;

function roomId(value) {
  const v = String(value ?? "").trim().toUpperCase();
  if (SHORT_RE.test(v) && Number(v) >= 100) return v;
  return LEGACY_RE.test(v) ? v : "";
}
const isShort = room => SHORT_RE.test(room);

function roleName(value) {
  return value === "host" ? "host" : value === "guest" ? "guest" : "";
}

function newToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

function randomShortRoom() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(100 + (b[0] % 900));
}

/* ---------------- 表结构(自动迁移) ---------------- */

let schemaReady = null;

async function ensureSchema(env) {
  if (!env.DB) throw new Error("D1 binding DB is missing");
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS rooms (
            room TEXT PRIMARY KEY,
            host_name TEXT NOT NULL,
            guest_name TEXT,
            updated_at INTEGER NOT NULL
          )`),
        env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room TEXT NOT NULL,
            sender TEXT NOT NULL,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL
          )`),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_room_id ON events(room, id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)"),
      ]);

      // 1.0.0 的旧表没有这些列: 缺什么补什么
      const info = await env.DB.prepare("PRAGMA table_info(rooms)").all();
      const have = new Set((info.results || []).map(r => r.name));
      const add = [
        ["host_token", "TEXT NOT NULL DEFAULT ''"],
        ["guest_token", "TEXT"],
        ["host_seen", "INTEGER NOT NULL DEFAULT 0"],
        ["guest_seen", "INTEGER NOT NULL DEFAULT 0"],
      ].filter(([name]) => !have.has(name));
      for (const [name, def] of add) {
        try { await env.DB.prepare(`ALTER TABLE rooms ADD COLUMN ${name} ${def}`).run(); }
        catch (err) { if (!/duplicate column/i.test(String(err?.message || err))) throw err; }
      }
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_rooms_host_seen ON rooms(host_seen)").run();
    })().catch(err => { schemaReady = null; throw err; });
  }
  await schemaReady;
}

async function bodyJson(request) {
  try { return await request.json(); }
  catch { return {}; }
}

const cleanName = (v, d) => String(v || d).trim().slice(0, 18) || d;

async function cleanup(env, now) {
  const deadRooms = now - ROOM_GC;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE created_at < ?").bind(now - EVENT_GC),
    env.DB.prepare("DELETE FROM events WHERE room IN (SELECT room FROM rooms WHERE host_seen < ?)").bind(deadRooms),
    env.DB.prepare("DELETE FROM rooms WHERE host_seen < ?").bind(deadRooms),
  ]);
}

/* ---------------- 建房 ---------------- */

/**
 * 原子占号: 号码空闲, 或原主机已离线超过 HOST_TTL, 才会写入。
 * 返回是否占到。
 */
async function claimRoom(env, room, name, token, now) {
  const res = await env.DB.prepare(`
    INSERT INTO rooms(room, host_name, guest_name, updated_at, host_token, guest_token, host_seen, guest_seen)
    VALUES(?, ?, NULL, ?, ?, NULL, ?, 0)
    ON CONFLICT(room) DO UPDATE SET
      host_name   = excluded.host_name,
      guest_name  = NULL,
      updated_at  = excluded.updated_at,
      host_token  = excluded.host_token,
      guest_token = NULL,
      host_seen   = excluded.host_seen,
      guest_seen  = 0
    WHERE rooms.host_seen < ?
  `).bind(room, name, now, token, now, now - HOST_TTL).run();
  if (!res.meta || !res.meta.changes) return false;
  // 回收的旧号码: 清掉上一局残留的事件
  await env.DB.prepare("DELETE FROM events WHERE room = ?").bind(room).run();
  return true;
}

async function createRoom(request, env) {
  const body = await bodyJson(request);
  const name = cleanName(body.name, "Player");
  const raw = String(body.room ?? "").trim();
  const now = Date.now();

  await cleanup(env, now);

  // 旧客户端: 自带 6–12 位房间码, 占用即 409, 行为与 1.0.0 一致
  if (raw && !SHORT_RE.test(raw) && raw.toUpperCase() !== "AUTO") {
    const room = roomId(raw);
    if (!room) return fail("BAD_ROOM", 400);
    const token = newToken();
    if (!(await claimRoom(env, room, name, token, now))) return fail("ROOM_EXISTS", 409);
    return json({ ok: true, room, role: "host", token, features: FEATURES });
  }

  // 新客户端: 3 位数字。客户端建议的号码优先, 被占就由服务器另选
  const tried = new Set();
  const candidates = [];
  if (roomId(raw) && isShort(roomId(raw))) candidates.push(roomId(raw));
  while (candidates.length < 24) {
    const r = randomShortRoom();
    if (!tried.has(r) && !candidates.includes(r)) candidates.push(r);
  }
  const token = newToken();
  for (const room of candidates) {
    tried.add(room);
    if (await claimRoom(env, room, name, token, now)) {
      return json({ ok: true, room, role: "host", token, features: FEATURES });
    }
  }
  return fail("NO_FREE_ROOM", 503);
}

/* ---------------- 加入 ---------------- */

async function joinRoom(request, env) {
  const body = await bodyJson(request);
  const room = roomId(body.room);
  const name = cleanName(body.name, "Guest");
  if (!room) return fail("BAD_ROOM", 400);

  const now = Date.now();
  const token = newToken();

  // 原子占客机位: 主机在线, 且客机位空闲或原客机已离线
  const res = await env.DB.prepare(`
    UPDATE rooms SET guest_name = ?, guest_token = ?, guest_seen = ?, updated_at = ?
    WHERE room = ? AND host_seen >= ? AND (guest_name IS NULL OR guest_seen < ?)
  `).bind(name, token, now, now, room, now - HOST_TTL, now - GUEST_TTL).run();

  if (!res.meta || !res.meta.changes) {
    const cur = await env.DB.prepare("SELECT host_seen FROM rooms WHERE room = ?").bind(room).first();
    if (!cur) return fail("ROOM_NOT_FOUND", 404);
    if (cur.host_seen < now - HOST_TTL) return fail("HOST_OFFLINE", 410);
    return fail("ROOM_FULL", 409);
  }

  // since: 新客机从这里开始收事件, 不会收到上一位客机时期的旧消息
  const last = await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE room = ?").bind(room).first();
  const joined = await env.DB.prepare(
    "INSERT INTO events(room, sender, type, payload, created_at) VALUES(?, 'guest', 'peer-joined', ?, ?) RETURNING id"
  ).bind(room, JSON.stringify({ name }), now).first();
  const host = await env.DB.prepare("SELECT host_name FROM rooms WHERE room = ?").bind(room).first();

  return json({
    ok: true, room, role: "guest", token, features: FEATURES,
    hostName: host?.host_name || "主机",
    since: Math.max(Number(last?.id) || 0, Number(joined?.id) || 0),
  });
}

/* ---------------- 鉴权 + 心跳 ----------------
 * 3 位房间必须带正确 token; 旧的长房间码不强制(旧客户端没有 token, 且长码本身难以猜中)。
 * 鉴权条件直接写进 SQL, 与读写放进同一个 batch, 一次往返完成。 */

function authSql(room, role, token) {
  const col = role === "host" ? "host_token" : "guest_token";
  const need = isShort(room) || !!token;
  return need
    ? { cond: `(${col} = ? AND ${col} <> '')`, args: [String(token || "")] }
    : { cond: "1 = 1", args: [] };
}

/** 心跳: 距上次记录超过 SEEN_WRITE_EVERY 才真正写库(不命中的 UPDATE 不计写入行数) */
function touchStmt(env, room, role, auth, now) {
  const col = role === "host" ? "host_seen" : "guest_seen";
  return env.DB.prepare(
    `UPDATE rooms SET ${col} = ? WHERE room = ? AND ${auth.cond} AND ${col} < ?`
  ).bind(now, room, ...auth.args, now - SEEN_WRITE_EVERY);
}

function roomStmt(env, room, auth) {
  return env.DB.prepare(
    `SELECT host_seen, guest_seen, guest_name, (${auth.cond}) AS authed FROM rooms WHERE room = ?`
  ).bind(...auth.args, room);
}

function authError(row) {
  if (!row) return fail("ROOM_NOT_FOUND", 404);
  if (!row.authed) return fail("BAD_TOKEN", 403);
  return null;
}

/* ---------------- 收发 ---------------- */

async function sendEvent(request, env) {
  const body = await bodyJson(request);
  const room = roomId(body.room);
  const role = roleName(body.role);
  if (!room || !role) return fail("BAD_REQUEST", 400);

  const list = Array.isArray(body.batch) ? body.batch.slice(0, 32) : [{ type: body.type, payload: body.payload }];
  const items = [];
  for (const it of list) {
    const type = String(it?.type || "").slice(0, 32);
    if (!type) return fail("BAD_REQUEST", 400);
    const payload = JSON.stringify(it.payload ?? {});
    if (payload.length > 64 * 1024) return fail("BAD_REQUEST", 413);
    items.push({ type, payload });
  }
  if (!items.length) return fail("BAD_REQUEST", 400);

  const now = Date.now();
  const auth = authSql(room, role, body.token);
  const stmts = [roomStmt(env, room, auth)];
  for (const it of items) {
    stmts.push(env.DB.prepare(`
      INSERT INTO events(room, sender, type, payload, created_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rooms WHERE room = ? AND ${auth.cond})
      RETURNING id
    `).bind(room, role, it.type, it.payload, now, room, ...auth.args));
  }
  stmts.push(touchStmt(env, room, role, auth, now));

  const res = await env.DB.batch(stmts);
  const err = authError(res[0].results?.[0]);
  if (err) return err;
  const ids = res.slice(1, 1 + items.length).map(r => r.results?.[0]?.id || 0);
  return json({ ok: true, id: ids[ids.length - 1] || 0, ids });
}

async function poll(request, env) {
  const url = new URL(request.url);
  const room = roomId(url.searchParams.get("room"));
  const role = roleName(url.searchParams.get("role"));
  const since = Math.max(0, Number(url.searchParams.get("since") || 0) || 0);
  const token = url.searchParams.get("token") || "";
  if (!room || !role) return fail("BAD_REQUEST", 400);

  const now = Date.now();
  const auth = authSql(room, role, token);
  const res = await env.DB.batch([
    touchStmt(env, room, role, auth, now),
    roomStmt(env, room, auth),
    env.DB.prepare(`
      SELECT id, sender, type, payload, created_at
      FROM events
      WHERE room = ? AND id > ? AND sender <> ?
        AND EXISTS (SELECT 1 FROM rooms WHERE room = ? AND ${auth.cond})
      ORDER BY id ASC
      LIMIT 100
    `).bind(room, since, role, room, ...auth.args),
  ]);

  const row = res[1].results?.[0];
  const err = authError(row);
  if (err) return err;

  const events = (res[2].results || []).map(r => {
    let payload = {};
    try { payload = JSON.parse(r.payload || "{}"); } catch { }
    return { id: r.id, from: r.sender, type: r.type, payload, ts: r.created_at };
  });

  const peerSeen = role === "host" ? (row.guest_name ? row.guest_seen : 0) : row.host_seen;
  const peerTtl = role === "host" ? GUEST_TTL : HOST_TTL;
  return json({ ok: true, events, peerOnline: !!peerSeen && now - peerSeen < peerTtl });
}

/* ---------------- 离开 ---------------- */

async function leaveRoom(request, env) {
  const body = await bodyJson(request);
  const room = roomId(body.room);
  const role = roleName(body.role);
  if (!room || !role) return fail("BAD_REQUEST", 400);

  const auth = authSql(room, role, body.token);
  const row = await roomStmt(env, room, auth).first();
  if (!row || !row.authed) return json({ ok: true });     // 房间已不存在 / 已被接管: 离开视为成功

  const now = Date.now();
  const bye = env.DB.prepare(
    "INSERT INTO events(room, sender, type, payload, created_at) VALUES(?, ?, 'peer-left', '{}', ?)"
  ).bind(room, role, now);

  if (role === "host") {
    // 不立即删除: 让客机还能收到 peer-left; 号码立刻可被新主机回收
    await env.DB.batch([
      bye,
      env.DB.prepare("UPDATE rooms SET host_seen = 0, host_token = '', updated_at = ? WHERE room = ?").bind(now, room),
    ]);
  } else {
    await env.DB.batch([
      bye,
      env.DB.prepare(
        "UPDATE rooms SET guest_name = NULL, guest_token = NULL, guest_seen = 0, updated_at = ? WHERE room = ?"
      ).bind(now, room),
    ]);
  }
  return json({ ok: true });
}

/* ---------------- 入口 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return json({ ok: true, service: "8balls-dragdrop-signal", version: VERSION, db: !!env.DB, shortRooms: true, features: FEATURES });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        await ensureSchema(env);
        const p = url.pathname, m = request.method;
        if (p === "/api/create" && m === "POST") return await createRoom(request, env);
        if (p === "/api/join" && m === "POST") return await joinRoom(request, env);
        if (p === "/api/send" && m === "POST") return await sendEvent(request, env);
        if (p === "/api/poll" && m === "GET") return await poll(request, env);
        if (p === "/api/leave" && m === "POST") return await leaveRoom(request, env);
        return fail("NOT_FOUND", 404);
      } catch (err) {
        return json({ ok: false, error: "BACKEND_ERROR", message: String(err?.message || err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
