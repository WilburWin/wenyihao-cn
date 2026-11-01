# 局域网服务 (lan-server.js)

把 `server/` 文件夹放到游戏根目录（与 `index.html` 同级），然后：

- Windows：双击 `server/start_server.bat`
- macOS / Linux：`sh server/start_server.sh`
- 指定端口：`node server/lan-server.js 8766`

控制台会打印类似 `http://192.168.1.25:8765/` 的地址。**主机和朋友都用浏览器打开这个地址**
（主机也可以用 `http://localhost:8765/`），进入“联机 → 好友房间”，主机创建房间得到 3 位数字房间号，
朋友输入即可。

## 为什么不在浏览器里读本机 IPv4

现代浏览器已经封死了这条路：WebRTC 的本地地址候选会被替换成随机的 `xxxx.local`（mDNS 混淆），
拿不到真实 IPv4；而且 HTTPS 页面（如 B 站 Toy）不允许请求 `http://192.168.x.x`（混合内容 +
Chrome 的私有网络访问限制）。所以正确做法是：**由主机上的小服务读取网卡地址，并且让页面本身从这台服务打开**。
同源之后既没有混合内容问题，也不需要手动填 IP。

## 接口（与 Cloudflare 好友房间协议一致）

| 接口 | 说明 |
|---|---|
| `POST /api/create {name, room?}` | 不传 room 时由服务器分配 3 位数字房间号，返回 `{room}` |
| `POST /api/join {room, name}` | 返回 `{hostName}`，并向主机推送 `peer-joined` |
| `POST /api/send {room, role, type, payload}` | role 为 `host` / `guest` |
| `GET /api/poll?room=&role=&since=` | 返回 `{events:[{id,type,from,payload}]}` |
| `POST /api/leave {room, role}` | 主机离开会删除房间 |
| `GET /api/lan-info` | 本机 IPv4 列表（已排序，虚拟网卡已标记） |

另外兼容旧版“输入 IP”模式的 `/api/host` 等接口。访问 `/network-config.js` 和 `/index.html` 时，
服务器会把联机服务地址自动改写成自己，所以**旧版前端不改代码也能直接在局域网用好友房间**。
