# 架构与验证

## 请求路径

| 路径或组件 | 处理方式 |
| --- | --- |
| 页面、CSS、图片、发布歌单 | Workers Static Assets，从 `public/` 提供 |
| `/realtime/<game>/<room>` | Worker 校验后连接 `GameRoom` Durable Object |
| `/api/github` | GitHub REST API 分页读取公开仓库，缓存 10 分钟 |
| `/api/guestbook` | `Guestbook` Durable Object 读取、发布和管理删除 |
| `/api/music/cover` | 已发布视频封面，匿名读取、图片代理和 6 小时边缘缓存 |
| `/api/music/*` | 音轨解析、同源流式媒体代理与独立登录会话 |
| 本地 `127.0.0.1:8790` | 歌单工作室，编辑候选和发布静态 JSON，不参与线上播放 |

`wrangler.jsonc` 让 API 与实时路径优先进入 Worker，其余由静态资源处理。无需 Pages 或 D1。当前 `GameRoom` 与 `Guestbook` 均由 SQLite Durable Objects 迁移创建。

## 联机游戏

`public/shared/realtime.js` 兼容原游戏调用方式，房间按游戏和房间号隔离。服务器负责连接、成员、转发及必要的恢复状态，房主客户端仍负责对局计算。当前使用普通 WebSocket 接口，并非 WebSocket Hibernation 实现。

对象创建带有 `apac` 位置提示；这是位置偏好，不是大陆节点或延迟承诺。RTT 测量网络往返，不能直接等同于单向时延或每次操作耗时。保留客户端计算便于迁移原游戏，但不具备服务端权威规则校验的所有能力。

`realtime-config.json` 配置可选联机域名，浏览器建房前比较实际游戏 ping，候选不可用时保留同源入口；不同入口继续使用同一 ROOMS 绑定。RTT 从 WebSocket 已建立后、实际发送 ping 时开始计时，排除握手与选线时间。配置及 DNS 实验边界见 [联机延迟排查](game-latency.md)。

整站的公开页面、资源与读取接口另由根作用域 Service Worker 后台选线，保持主域名文档来源；登录、音频和写入不经过公开镜像。镜像与主站使用相同 Worker，镜像动态读取由 `worker/site-network.js` 实施只读白名单、来源检查和凭据剥离。具体范围、首次访问行为及关闭方法见 [整站自动选线](site-network.md)。

## 留言与音乐

留言昵称最多 24 字，正文 1–200 字，每页 25 条。提交需同源 JSON 请求，使用诱捕字段、请求体大小限制、每 IP 一分钟一次及每日总量 500 条限制。限流键使用日期与 IP 的摘要，不保存原始 IP。删除需管理令牌及同源检查。

音乐解析仅处理配置歌单中的资源，媒体代理限制 CDN 主机、重定向和 Range。JSON 请求默认经 Socket，媒体经原生流式 fetch。封面从指定 B站图床读取，按视频缓存，由浏览器控制并发并合并重复图片；服务端不跨请求共享未完成的 I/O，不需要仓库中的图片文件。扫码会话由 Worker 加密后放入当前浏览器 HttpOnly Cookie，Worker 临时解密使用，不共享账号；详见 [音乐实现](music-playback.md)。

本地工作室只监听回环地址并检查 Host 与 Origin。候选优先从本地缓存读取，一次只进行一个联网搜索，失败不自动重试、不设额外冷却。网站扫码和音轨接口有各自的风控退避，不受工作室设置影响。

## 常规检查

在仓库根目录运行：

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

`check` 对 `public/` 和 `worker/` 的 JavaScript 做语法检查，并确认三款联机游戏接入兼容层。`test` 覆盖房间、留言、音乐传输、媒体处理和登录会话等逻辑，其中上游响应多使用模拟数据。dry-run 检查 Worker 打包，不部署到公网。

额外修改开发脚本时，使用 `node --check <脚本路径>`；Python 可用 `ast.parse` 做不执行脚本的语法检查。

## 游戏规则与浏览器检查

修改对应游戏逻辑时，再运行该游戏已有的检查：

```sh
node --test public/games/catwhere/tests/engine.test.cjs
node public/games/billiards/test/core.test.js
node public/games/billiards/test/match.test.js
node public/games/billiards/test/rolling.test.js
node public/games/billiards/test/render.test.js
node public/games/billiards/test/skid.test.js
```

麻将规则检查在 `public/games/mahjong/` 目录执行 `node test-v30-rules.mjs`。

`scripts/browser-smoke.mjs` 是可选的浏览器冒烟脚本，需要自行准备 Playwright 和 Chrome，并先在 8787 端口启动网站；Playwright 未列为项目默认依赖。脚本检查首页、游戏大厅窄屏和三款游戏加入房间的主要流程，截图写入被忽略的 `artifacts/`。它不覆盖音乐真实登录、所有响应式尺寸或完整对局。

公网验收需另行检查跨网络联机、实际 RTT、真实音源和账号权限。模拟测试通过不代表公网风控不会触发，也不能证明 Hi-Res 可用。
