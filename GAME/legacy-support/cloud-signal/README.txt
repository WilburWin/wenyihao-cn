# 8Balls Cloudflare 联机中继 v2.1.0

配套前端：HTML Billiards v0.8.3（v0.8.2 也能用）。旧版前端（v0.7.x / v0.8.0）也能继续用，只是仍然使用 8 位房间码。

## 2.1.0：降低延迟

- 每个收发请求原来要和 D1 串行往返 3 次（鉴权、写入、心跳），现在合并成一次 batch，一次往返完成。
- /api/send 支持 batch: [{type, payload}, …]，客户端积压的消息一次发出。

## 延迟排查：D1 数据库放在哪里很关键

D1 只有一个主库，所有请求最终都要到主库所在地区。朋友和你都在中国/亚洲、而数据库建在美国时，
每次请求光这一段就要多出 150–300ms。前端画面右上角会显示“延迟 xx ms”：

- 低于 200ms：正常；
- 超过 300ms：建议新建一个数据库，创建时在“Location”里选 Asia-Pacific（APAC），
  然后在 Pages 项目 Settings → Bindings 里把变量 DB 改绑到新库，再部署一次（表会自动创建）。
  注意 Location 只能在创建数据库时选择，已有数据库无法迁移。

## 2.0.0 的改动

1. 3 位数字房间号（100–999），由服务器分配。客户端建议的号码被占用时，服务器会自动另选一个空号。
2. 建房只用一条 SQL 原子完成（INSERT … ON CONFLICT … WHERE），两个人同时建同一个号不会互相覆盖。
3. 心跳与回收：
   - 轮询时顺带刷新在线时间（每 10 秒最多写一次库，控制 D1 写入量）；
   - 主机 60 秒没有心跳 → 房间号可以被新主机回收；
   - 客机 25 秒没有心跳 → 空出客机位，别人可以加入；
   - 主机离线 10 分钟后删除房间，事件保留 30 分钟。
4. 会话令牌：3 位号码谁都猜得到，所以建房和加入会返回 token，之后收发消息必须带上对应角色的 token。
   陌生人猜中房间号，也不能冒充主机或客机发消息。已有客机在线时，别人加入会返回“房间已满”。
5. 加入时返回 since，新客机只会收到加入之后的消息。
6. 主机主动离开时，房间号立即释放，客机仍能收到“对方已离开”的通知。

## 升级方式（已经部署过 1.0.0）

1. Cloudflare Dashboard → Workers & Pages → 打开原来的 `8balls-signal` Pages 项目
2. 创建新部署 → 把本 ZIP 拖进去 → Deploy
3. D1 绑定（变量名 `DB`）保持不变，不需要手动改表：
   第一次收到请求时会自动给旧的 rooms 表补上新列（host_token / guest_token / host_seen / guest_seen）并补建索引。

## 检查

访问 `https://你的项目.pages.dev/health`，应看到：

`{"ok":true,"service":"8balls-dragdrop-signal","version":"2.1.0","db":true,...}`

version 不是 2.1.0 说明新部署还没生效；db=false 说明 D1 绑定没有生效。

## 首次部署（没部署过的话）

1. Workers & Pages → Create application → 页面底部“想要部署 Pages？开始使用”
2. Direct Upload，把 ZIP 拖进去，项目名建议 `8balls-signal`
3. Storage & Databases → D1 → 创建数据库 `8balls-signal-db`
4. Pages 项目 → Settings → Bindings → Add → D1 database，变量名填 `DB`
5. 再部署一次同一个 ZIP

## 免费额度提醒

Pages Functions 免费版每天 10 万次请求。v0.8.2 前端改成了自适应轮询：有消息时 220ms，空闲时 700ms。
一局两人大约每小时 1.2–1.6 万次请求，比原来固定 180ms 轮询少了约三分之二。
如果同时在线的人多，建议升级到 Workers 付费版，或者改用 Durable Objects + WebSocket。

## 接口

| 接口 | 说明 |
|---|---|
| POST /api/create {name, room?} | 返回 {room, token}；room 省略或为 3 位数字时由服务器分配 |
| POST /api/join {room, name} | 返回 {hostName, token, since}；409 房间已满，410 主机离线，404 不存在 |
| POST /api/send {room, role, token, type, payload} | role 为 host / guest |
| GET  /api/poll?room=&role=&since=&token= | 返回 {events, peerOnline}；token 失效返回 403 |
| POST /api/leave {room, role, token} | 主机离开会立即释放房间号 |
