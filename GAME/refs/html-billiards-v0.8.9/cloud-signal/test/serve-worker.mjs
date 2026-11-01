/* 本地把 _worker.js 跑成 HTTP 服务(用 node:sqlite 模拟 D1), 供浏览器端到端测试 */
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import worker from "../_worker.js";
const db = new DatabaseSync(":memory:");
const wrap = (sql, args = []) => ({
  bind: (...a) => wrap(sql, a),
  async first() { return db.prepare(sql).get(...args) ?? null; },
  async all() { return { results: db.prepare(sql).all(...args) }; },
  async run() {
    if (/^\s*(select|pragma)|returning/i.test(sql)) return { results: db.prepare(sql).all(...args), meta: { changes: 0 } };
    const r = db.prepare(sql).run(...args); return { results: [], meta: { changes: Number(r.changes) } };
  },
});
const env = { DB: { prepare: s => wrap(s), async batch(st) { const o = []; for (const s of st) o.push(await s.run()); return o; } },
  ASSETS: { fetch: () => new Response("ok") } };
const DELAY = Number(process.env.DELAY || 0);   // 模拟公网延迟(毫秒/请求)
http.createServer(async (req, res) => {
  if (DELAY) await new Promise(r => setTimeout(r, DELAY));
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(Number(process.argv[2] || 8788), () => console.log("worker on", process.argv[2] || 8788));
