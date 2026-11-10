# 音乐播放实现

音乐页采用 Spotify 方向的黑灰面板与 `#1ed760` 绿色强调，参考 BiliTune 的三栏工作区：资料库、歌单、正在播放。常驻底部播放条，手机端收成单栏，保留独立的资料库筛选与侧栏按钮。主导航与歌单地址不变，播放和缓冲状态由原生音频事件驱动。设计细节及来源见 [music-design.md](music-design.md)。

歌单随本地工作室的已锁定结果更新。封面经 `/api/music/cover?id=<歌曲 ID>&v=<BV号>` 从 B站视频详情中自动获取，本站代理图片并用 Cloudflare Cache API 按视频缓存 6 小时，浏览器缓存 1 小时，不保存项目图片文件。页面懒加载，前四首在线封面在浏览器中组成歌单拼图。工作室重新发布保留视频与分P未改变的已知时长；也可用 `python scripts/music-metadata.py` 提前补齐缺失时长（无需 Pillow）。

封面接口接受已发布歌曲以及配置的实时 UP 主投稿，不接受任意图片地址；实时投稿先核验视频所属 UID。仅访问指定 B站图床、限制图片类型和 2MB 响应大小，拒绝重定向。匿名设备 Cookie 仅用于视频详情，不接触访客账号 Cookie；图片 CDN 使用原生 fetch，不携带账号信息。服务端只共享已完成的数据与边缘缓存，不跨请求等待队列、Socket 或未完成的 Promise，避免 Workers 请求上下文取消导致挂起。风控时暂停上游读取、不自动重试。封面读取与音轨解析的退避状态独立，失败显示音符占位，不阻断播放。

浏览器也限制最多同时加载两张封面，只有进入可见区域的图片才入队；同一封面合并加载，当前歌曲优先。音频连接与缓冲期间暂停启动新封面请求，避免大量图片占满本地 HTTP/1.1 的同源连接。音频连接或缓冲超过 30 秒会中止并显示可重试状态，避免永久停留在连接提示。

「喜欢」和「最近播放」保存在当前浏览器，只作用于本站；不写入 B站收藏夹。随机播放队列与下一首按钮使用相同的待播顺序。

## 实时 UP 主歌单

工作室将 `preferred` 名单发布为 `playlist.json` 中的 `playlists` 元数据，不预取投稿或记录总数。原有收藏由 `defaultTrackIds` 保持独立。`GET /api/music/uploaders?uid=<UID>&page=1` 只接受已配置 UID，调用投稿列表接口读取当前页及其附带总数；页面点击歌单才发起请求，每页最多 100 条，后续由“加载更多投稿”按需读取。页面搜索仅匹配已加载条目，页面显示的时长也是已加载部分的时长。

随机播放先从列表响应的 `total` 中随机选一个位置，再按需读取对应页，不预抓全部投稿，也不局限于可见歌曲。顺序播放同样按需换页；多分P视频默认第一P。动态曲目 ID 绑定 UID 与 BV 号，取流和封面读取前再通过视频详情验证所属 UP 主，防止借该接口读取任意视频。喜欢和最近播放会保存必要的动态曲目元数据，刷新后可继续访问。

已完成的投稿页使用 Cache API 缓存 10 分钟、浏览器缓存 1 分钟；当前页面复用已加载分页，刷新重新读取。没有后台全量扫描。接口出现 412、429 或业务风控码时返回可重试错误，停止上游请求，不自动循环重试。实际投稿列表会随 UP 主新增或删除而变化，分页和随机结果以当次响应为准，缓存不能保证即时反映更改。

## 为什么需要 Worker

`@bryan-kuang/bilibili-audio-extractor` 的 npm `0.1.0` 发布包声明 Node >=20，编译产物直接依赖 `crypto` 和 `fs`，使用 `createHash('md5')` 计算 WBI 签名，并通过服务端请求发送 Cookie / Referer。README 的 “native web API” 指调用 B站的网页接口，不代表库可在普通浏览器页面直接运行。

浏览器里的第三方页面还要遵守 CORS 与 Cookie 域隔离；使用 fetch 不会改变这些规则。由现有 Worker 运行提取器、并流式转发受限的媒体请求，可以让网页用同源 `<audio>` 播放，无需 Electron、浏览器扩展或访客本地服务。

## 浏览器直接读取音频的试验

新增 `MUSIC_AUDIO_DELIVERY`：默认或 `relay` 保留现有中转，只有显式设为 `direct` 才启用直连试验。本地可用 `npx wrangler dev --var MUSIC_AUDIO_DELIVERY:direct`。生产配置仍为 `relay`，本次没有发布音乐变更。

直连时 `/api/music/resolve` 按音质返回经过 CDN 主机白名单校验的短期签名地址，响应为 `private, no-store`，不包含账号 Cookie。浏览器原生 `<audio>` 不设置 `crossOrigin`，音乐文档使用 `no-referrer`，依次尝试最多三个上游地址，失败后最多重新解析一次。直连模式的 `/api/music/audio` 返回 410，不会自动中转或调用其他代理。

2026-11-07 在本机 Chrome 的独立无账号测试环境中，直接请求实际 B站 CDN 返回 403，音频未播放；网络记录中的本站音频中转请求数为零。对相同签名地址的小范围请求对比：不发送 Referer 返回 403，服务端发送 `Referer: https://www.bilibili.com/` 返回 206。其他已返回的音质和备用 CDN 也均拒绝无 Referer 请求。因此目前没有把直连试验开启到生产。结果只覆盖当次曲目、CDN 和网络，不能断言所有资源都如此，也不能把接口测试通过等同于真实可播放。

普通网页不能把自身来源任意伪造成 B站；`no-referrer` 只会省略来源，不能替换为 B站。相关规范说明见 [MDN Referer](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer)。把接口改成 302 跳转也不会使浏览器自动获得 B站来源。保留实验实现便于后续针对实际可直连资源复测，不将失败结果当作已解决播放。

## B站 API 的 Socket 传输试验

当前生产音乐请求由独立 Worker 处理，配置文件是 `wrangler.music.jsonc`；主站的同名传输变量用于本地开发与回退链路。日常部署使用 `npm run deploy` 更新两者。主站保存原有登录密钥，通过私有服务完成会话加解密，不将密钥复制到音乐 Worker。音乐请求的区域偏好、同源转发和回退见 [音乐香港部署](music-regional.md)。

`wrangler.jsonc` 中 `MUSIC_API_TRANSPORT` 默认设为 `socket`。网站入口通过 `worker/music-transport.js` 将 `api.bilibili.com` 和 `passport.bilibili.com` 的 JSON 请求交给锁定版本 `stealth-fetch@0.2.2` 的 `/lite` 客户端，以 `cloudflare:sockets` 的平台 TLS 直接发送 HTTP/1.1 请求，避开原生 `fetch()` 的 HTTP 请求头注入路径。不使用 NAT64、第三方代理或第三方 DNS 服务。

二维码生成、轮询、登录校验、设备信息、封面详情、WBI 密钥和音轨解析统一使用该传输。媒体 CDN 仍使用原生流式 `fetch()`，保留 Range/206、超时和已有的目标主机限制，账号 Cookie 不发送到媒体主机。封面图片使用原生 fetch 读取固定图床。网站、GitHub、留言板和游戏请求不使用这个客户端。

适配器将库的 `HttpResponse` 转换为标准 `Response`，分别保留多条 `Set-Cookie`，接入取消信号、15 秒接口超时及响应读取超时。非成功响应及时取消流；库的自动重试关闭，412/429 继续交给已有冷却机制处理，不自动换传输重复撞接口。两种传输使用相同的 UA、Referer 和 Accept，不将访客的转发 IP 请求头带给 B站。

音乐接口响应的 `X-Music-Api-Transport: socket` 表示服务端选用了 Socket 传输，不代表上游请求已经成功。如果需要回退传输，将生产后端 `wrangler.music.jsonc` 的 `MUSIC_API_TRANSPORT` 改为 `fetch`，提交并重新部署即可；主站本地链路使用 `wrangler.jsonc` 的变量。此开关由服务器配置决定，网页访客不能用查询参数切换。保持原有 `MUSIC_SESSION_KEY` 即可，无需重新生成密钥。

这项改动仍然从 Cloudflare 出口请求 B站，不会自动获得访客浏览器的 B站登录状态，也不能保证消除 412 或取得 Hi-Res。Socket 和原生 fetch 的出口及 TLS 也可能不同，不能将两者成功率的差异直接归因于某一个请求头。线上效果需在部署后验证；本地成功不等于公网成功。

匿名解析对视频信息和 WBI 密钥接口保留提取器从 `finger/spi` 获取的 `buvid3/buvid4`；只允许设备 Cookie 白名单，不携带账号会话字段。此前对 view/nav 删除全部 Cookie 的做法，在云端 Socket 测试中仍导致 view 返回 412，保留有效设备 Cookie 后同一链路成功。登录后的 Cookie 仍按原有独立加密会话传递，不加入匿名缓存。

## 包的使用边界

- WBI 签名和匿名会话处理使用锁定版本的 npm 包；保留在 node_modules 中的 MIT 许可与发布来源。
- 分P由 Worker 注入详情响应的 cid，避免签名后修改请求参数。包默认只处理默认分P。
- 获取实际 DASH 音轨后，网页按照浏览器解码能力与带宽选择，用户也可切换接口提供的档位。
- 默认访客播放；可选扫码登录建立独立会话，不能自动沿用 B站官网在浏览器中的登录状态。
- 上游媒体请求只接受配置歌单或经过 UID 核验的优选 UP 主投稿，以及 B站 CDN 主机，拒绝任意 URL、重定向、非单段 Range 和跨站调用。
- 访客播放地址在服务端短期缓存，账号播放地址仅使用按会话隔离的内存缓存，不写入共享持久缓存。失效可重新解析一次。媒体响应采用流式转发，不把整首歌加载到 Worker 内存。

## 可选扫码登录

「登录 B站」位于播放器顶部工具栏，弹窗使用同一黑灰绿色系统；原导航、歌单、播放与 MV 入口保持原有功能。弹窗先解释会话使用方式，点击「同意并生成二维码」后才调用 B站接口。二维码由 Worker 本地编码，未接入第三方二维码服务。

- `GET /api/music/auth/status`：读取本站会话状态，不返回账号 Cookie。
- `POST /api/music/auth/start`：申请二维码，将轮询密钥加密放入 3 分钟的 HttpOnly Cookie，仅返回二维码图片。
- `POST /api/music/auth/poll`：前端每 3 秒检查，关闭窗口即停止；扫码并确认后校验账号状态，将网页登录会话加密放入浏览器 Cookie。发生网络错误后停下，等用户手动重试。
- `POST /api/music/auth/logout`：清除本站 Cookie，停止旧音频并重新解析访客音轨；不退出 B站官网账号。

生成二维码失败时返回安全的 `authIssue` 分类（上游 HTTP 状态、超时、网络、响应解析或本站处理阶段），不回显原始响应、取码 URL、轮询密钥或账号凭据。失败通常冷却 10 秒，B站明确要求更长等待时尊重其 Retry-After；前端显示倒计时，不自动重试申请。成功申请后限制 30 秒内重复取码，但当前浏览器可从其加密 Cookie 恢复未过期二维码，不必再次请求 B站。关闭并重新打开窗口时，也会继续展示内存中尚未过期的二维码。

这不是仅授权音乐的 OAuth 接入，而是 B站网页登录会话。本站会使用该会话调用音轨接口，Worker 会接触解密后的凭据；不要求输入密码，不读取已有的浏览器 B站 Cookie。会话最多保存 8 小时，不自动刷新，不写入数据库、日志或其他访客能复用的缓存。Cookie 使用 AES-GCM，密文绑定站点来源和用途，生产启用 `__Host-`、Secure、HttpOnly、SameSite=Lax。写接口检查同源 Origin，只允许 HTTPS（localhost 开发例外）。本地退出清除本浏览器 Cookie，已复制的旧密文仍有原定有效期。

本地执行 `node scripts/music-session-key.mjs --local`；生成的 `.dev.vars` 已忽略。生产执行 `node scripts/music-session-key.mjs | npx wrangler secret put MUSIC_SESSION_KEY`，设置 32 字节随机密钥的 base64url 编码（43 字符）。密钥用于加密，不是账号凭据；不要在前端或仓库中保存。生产不配置时关闭扫码登录，访客播放不受影响。

复制粘贴附带的首尾空格或换行会自动移除，密钥主体仍须为 43 位 base64url 字符。状态接口用 `configurationIssue: "missing"` 表示未读取到密钥，`"invalid_format"` 表示已读取但格式不正确，配置成功时为 `null`；不返回密钥内容。调整 Cloudflare 配置后须部署到当前域名使用的 Worker 才会生效。

Worker 在 WBI 签名前请求扩展 DASH 音轨标志，音质菜单仍以实际返回结果为准。登录后重新解析当前歌曲并保留进度，退出时先丢弃旧音频缓冲。Hi-Res 还需要音源提供 FLAC 音轨、账号有访问权限且浏览器能解码，不能靠视频标题或一个开关保证。

## 实测范围

2026-11-05，使用独立的临时 Cloudflare 诊断 Worker 做线上对照（未替换正式站点）：相同应用请求头下，原生 fetch 的二维码生成返回 HTTP 412，Socket 生成返回 HTTP 200 / code 0，并获得有效二维码。保留匿名设备 Cookie 后，测试 BV 的 finger/spi、view、nav、WBI playurl 全部返回 HTTP 200，提供 AAC 64K / 132K / 192K；继续请求原生媒体转发，Range `bytes=0-1023` 返回 HTTP 206 和正确的 1024 字节范围。该测试不涉及真实账号扫码确认，尚未验证登录后的 Hi-Res，也不代表全部歌曲或未来出口均可用。诊断 Worker 和临时路由在测试后删除。

2026-11-05，本地完整 Workers 运行时成功解析公开歌单中的音轨，返回 AAC 64K / 132K / 192K 档位。音频 Range 请求返回 `206`、正确的 `Content-Range` 及 MP4 数据。测试覆盖分P签名、缓存、失效地址刷新、CDN 限制和风控停止。

这不保证 Cloudflare 公网节点或未来接口持续可用。B站的地域限制、风控和接口变化仍可能导致部分曲目无法播放；前端会显示失败状态并保留 MV 原视频入口。

扫码流程的单元测试使用模拟会话，覆盖密文篡改、来源及用途隔离、过期、扫码状态、退出、缓存隔离和失效账号处理。尚未使用真实账号验证扫码成功后的 Hi-Res 获取；不要把模拟测试视作真实账号验证。

## 来源

- [npm 包与 README](https://www.npmjs.com/package/@bryan-kuang/bilibili-audio-extractor)
- [npm 0.1.0 元数据](https://registry.npmjs.org/@bryan-kuang%2fbilibili-audio-extractor/0.1.0)
- [BLMV 参考版本：cbfc827](https://github.com/liaoran2002/BLMV/tree/cbfc827af2033be2a84639dd75edd4fa5d2c36e4)
- [BLMV 网络层](https://github.com/liaoran2002/BLMV/blob/cbfc827af2033be2a84639dd75edd4fa5d2c36e4/electron/main/biliApi.ts)
- [MDN：受限制的请求头](https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_request_header)
- [MDN：CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
- [B站扫码二维码接口](https://passport.bilibili.com/x/passport-login/web/qrcode/generate)
- [stealth-fetch 源码](https://github.com/0XwX/stealth-fetch)（Apache-2.0，使用 npm 0.2.2 的 lite 入口）
- [Cloudflare：Worker 子请求的 HTTP 请求头](https://developers.cloudflare.com/fundamentals/reference/http-headers/)

BLMV 作为架构研究参考，本站没有复制其 GPL 代码。实际提取器使用上面的 MIT npm 包，Worker 适配与页面控件为本项目实现。
