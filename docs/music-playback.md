# 音乐播放实现

音乐页采用 Spotify 方向的黑灰面板与 `#1ed760` 绿色强调，参考 BiliTune 的三栏工作区：资料库、歌单、正在播放。常驻底部播放条，手机端收成单栏，保留独立的资料库筛选与侧栏按钮。主导航与歌单地址不变，播放和缓冲状态由原生音频事件驱动。设计细节及来源见 [music-design.md](music-design.md)。

当前 16 首歌已缓存实际视频封面与时长，前四首封面组成歌单拼图，图片从本站加载，不需要访客打开页面就批量请求 B站接口。「喜欢」和「最近播放」保存在当前浏览器，只作用于本站；不写入 B站收藏夹。随机播放队列与下一首按钮使用相同的待播顺序。新增歌曲后可手动执行 `python scripts/music-artwork.py` 补齐封面（需 Pillow）；工作室重新发布时会保留视频与分P未改变的封面信息。

## 为什么需要 Worker

`@bryan-kuang/bilibili-audio-extractor` 的 npm `0.1.0` 发布包声明 Node >=20，编译产物直接依赖 `crypto` 和 `fs`，使用 `createHash('md5')` 计算 WBI 签名，并通过服务端请求发送 Cookie / Referer。README 的 “native web API” 指调用 B站的网页接口，不代表库可在普通浏览器页面直接运行。

浏览器里的第三方页面还要遵守 CORS 与 Cookie 域隔离；使用 fetch 不会改变这些规则。由现有 Worker 运行提取器、并流式转发受限的媒体请求，可以让网页用同源 `<audio>` 播放，无需 Electron、浏览器扩展或访客本地服务。

## 包的使用边界

- WBI 签名和匿名会话处理使用锁定版本的 npm 包；保留在 node_modules 中的 MIT 许可与发布来源。
- 分P由 Worker 注入详情响应的 cid，避免签名后修改请求参数。包默认只处理默认分P。
- 获取实际 DASH 音轨后，网页按照浏览器解码能力与带宽选择，用户也可切换接口提供的档位。
- 默认访客播放；可选扫码登录建立独立会话，不能自动沿用 B站官网在浏览器中的登录状态。
- 上游媒体请求只接受配置歌单和 B站 CDN 主机，拒绝任意 URL、重定向、非单段 Range 和跨站调用。
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

BLMV 作为架构研究参考，本站没有复制其 GPL 代码。实际提取器使用上面的 MIT npm 包，Worker 适配与页面控件为本项目实现。
