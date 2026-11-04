# 文艺淏 · wenyihao.cn

文艺淏的个人网站：月夜封面、拟真照片墙、游戏厅、访客便签、B 站主页与 GitHub 公开仓库。中文为主，英文辅助信息使用较小字号。

- 网站：https://wenyihao.cn
- 仓库：https://github.com/WilburWin/wenyihao-cn
- 部署：Cloudflare Workers Builds 连接 GitHub，生产分支为 `main`。

## 页面与功能

| 页面 | 地址 | 功能 |
| --- | --- | --- |
| 首页 | `/` | 全屏背景、个人简介与图标形式的账号和邮箱入口 |
| 照片墙 | `/photos/` | 相纸、胶带与投影效果，分类搜索、大图预览 |
| 游戏人生 | `/games/` | 四台游戏机卡片，分别使用落子、翻牌、击球和找猫动画 |
| 留言板 | `/guestbook/` | 免登录便签、公开展示、分页、持久化存储 |
| B 站 | `/bilibili/` | 嵌入 B 站主页，并提供外部打开入口 |
| GitHub | `/github/` | 自动读取所有公开仓库，含 Fork，支持搜索和语言筛选 |
| 星弈围棋 | `/games/go/` | 人机、双人联机、本地双人、棋谱练习 |
| 雀神麻将 | `/games/mahjong/` | 单机与最多四人联机，空位由电脑补齐 |
| 黑八台球 | `/games/billiards/` | 人机、训练、双人联机与网络 RTT 显示 |
| 猫咪在哪里 | `/games/catwhere/` | 单人逻辑解谜、三种难度、随机关卡 |

各板块保留相同的顶部导航位置与尺寸，顺序为 GitHub、B站、游戏、照片墙、留言板。GitHub 使用深蓝科技控制台布局，B站主页置于小电视外框内，游戏厅采用霓虹配色，照片墙使用暖白墙面与柔和投影，留言板使用浅灰蓝背景与浅木框软木材质。设计素材与颜色记录见 `brand-spec.md`。

首页背景暂用已有的月夜庭院图。游戏卡片动画由鼠标悬停或键盘聚焦触发；系统启用减少动态效果时不播放。照片墙裁切用于缩略展示，大图保留完整图片。

围棋宽屏布局为中央棋盘、左侧模式、右侧操作；找猫宽屏布局为中央网格、左侧规则、右侧设置。窄屏自适应排列，内容较多时允许滚动。麻将保留原有布局。

## 本地运行

需要 Node.js 22 或更新版本及 npm。

```sh
npm ci
npm run dev
```

打开终端显示的网址，通常为 `http://localhost:8787/`。联机游戏需要通过 Wrangler 提供的服务运行，不能用双击 HTML 或普通静态服务器代替。仅本地设备可访问的地址不能用于朋友跨网络加入。

## GitHub 自动部署

项目使用 **Workers + Static Assets + Durable Objects**。生产静态资源目录为 `public/`，Worker 入口为 `worker/index.js`，配置位于 `wrangler.jsonc`。旧 Pages/D1 中继不再使用。

在 Cloudflare 控制台进入对应 Worker 的 **设置 → 构建（Settings → Build）**，核对：

| 设置 | 值 |
| --- | --- |
| Git 仓库 | `WilburWin/wenyihao-cn` |
| 生产分支 | `main` |
| 根目录 | 仓库根目录 |
| 构建命令 | `npm run check` |
| 部署命令 | `npx wrangler deploy` |
| Node.js | 22 或更新版本 |

依赖通过锁文件安装。首次部署由配置中的迁移创建 SQLite Durable Objects 命名空间；自定义域名 `wenyihao.cn` 在 Cloudflare 控制台绑定。

更新时提交并推送到 `main`，然后在构建记录中确认最新提交号及部署成功状态。若页面没有更新：

1. 对照 GitHub 最新提交号与 Cloudflare 构建对应提交号，确认没有查看或重试旧提交的构建。
2. 没有新构建时，检查 Git 连接、生产分支和自动构建配置。
3. 构建失败时查看日志；成功时核对域名绑定的 Worker 和生产版本，再强制刷新浏览器。

需要手动部署时：

```sh
npx wrangler login
npm run deploy
```

## 照片维护

源图片位于 `wenyihao/照片/`。网站不展示文件名为 `正面照` 的原图，源文件仍保留在本地目录；提示词 TXT 不参与照片生成清单。

新增或替换图片后，在本机执行：

```sh
python -m pip install Pillow
python scripts/build-photos.py
```

脚本生成两种 WebP：最长边 640 像素的缩略图和最长边 1920 像素的大图，不放大小尺寸原图。生成时应用 EXIF 方向并省略源元数据，不修改原照片。

将生成的 `public/photos/images/` 和 `public/photos/data.json` 一并提交，Cloudflare 构建无需安装 Python。原始文件是否提交到公开仓库由维护者自行决定；不在 `public/` 中只代表不会作为网站静态资源发布，不代表不会通过公开 Git 仓库被下载。

| 修改内容 | 文件 |
| --- | --- |
| 首页精选及轮播顺序 | `scripts/build-photos.py` 的 `featured` 列表，修改后重新生成 |
| 展示标题、场景描述、分类 | `public/photos/gallery.js` 的 `catalog` |
| 首页轮播间隔与交互 | `public/photos/carousel.js` |
| 照片页布局与大图样式 | `public/photos/photos.css` |
| 照片生成与文件名配置 | `scripts/build-photos.py` |

删除源照片后重新生成，清单会取消展示。脚本不会自动清理所有历史 WebP 文件；若需撤下图片的直接访问地址，还要移除对应的已生成文件。正面照的两个已生成版本会由脚本明确移除。

照片页使用单独的展示标题，不修改源文件名。支持分类与搜索组合筛选、空结果提示、大图方向键与触摸切换、Esc 关闭和打开图片。页面注明包含编辑写真。

`wenyihao/照片/风格写真/` 中保存风格提示词。网站运行和照片压缩均不需要图片生成 API；如另行使用图片 API，密钥只在本机环境变量中配置，不写入代码或提交 Git。

## 项目目录

```text
public/
  index.html                 首页
  style.css                  全站与首页样式
  site.js                    游戏卡片数据及顺序
  photos/                    照片清单、WebP、照片页和轮播
  games/
    go/                      围棋
    mahjong/                 麻将
    billiards/               台球
    catwhere/                找猫
  shared/realtime.js         同源 WebSocket 兼容层
worker/index.js              房间服务及静态资源入口
scripts/                     照片生成、代码检查与浏览器检查
test/                        房间服务测试
GAME/refs/                   原始游戏参考代码
GAME/legacy-support/         旧中继和局域网服务参考
wenyihao/照片/               源照片与风格提示词
docs/                        设计记录
wrangler.jsonc               Cloudflare 配置
```

`GAME/`、源照片和提示词不属于生产静态目录。运行版本的修改应落在 `public/games/`；围棋与找猫新增的全屏布局文件独立于原样式，台球额外使用 `latency.js` 显示网络状态。

## 联机方式与延迟

围棋、麻将和台球以游戏名与三位房间号隔离，每个房间对应一个 Durable Object。浏览器使用同源 WebSocket 长连接；原游戏调用的 `/api/poll` 经兼容层转成 WebSocket 消息，空闲时约每秒返回在线状态，消息到达会唤醒等待中的客户端，不经过 D1 数据库查询。找猫是单机游戏，不连接房间服务。

房间请求 `apac` 区域放置，但这是提示，不保证具体数据中心。Cloudflare 域名托管和付费套餐本身不保证大陆低延迟；公网表现取决于运营商、区域与实际路由。本地测试结果不能代表公网质量。

台球独立显示的网络 RTT 来自 WebSocket ping，不含等待游戏事件的时间。未连通时显示未连接；高 RTT 不一定等于本地击球同等程度的卡顿，台球保留了本地预测机制。

当前规则继续由房主浏览器裁决。麻将支持定向手牌、检查点与房主断线后接管；双人游戏断线恢复仍受当前客户端会话状态限制。活跃连接使用普通 WebSocket，尚未实现休眠计费优化，需观察 Cloudflare 用量。

本项目面向个人与朋友体验。三位房间号可猜测，房主可访问客户端对局状态；尚未实现邀请密码、完整服务端规则裁决及完善的流量限制。

## 检查

```sh
npm run check
npm test
node --test public/games/catwhere/tests/engine.test.cjs
```

麻将规则测试需要在游戏目录运行：

```sh
cd public/games/mahjong
node test-v30-rules.mjs
```

台球回归测试从仓库根目录运行：

```sh
node public/games/billiards/test/core.test.js
node public/games/billiards/test/match.test.js
node public/games/billiards/test/rolling.test.js
node public/games/billiards/test/render.test.js
node public/games/billiards/test/skid.test.js
```

`scripts/browser-smoke.mjs` 是基础联机冒烟检查，使用 Playwright 和本机 Chrome，需要先启动本地服务。可通过 `PLAYWRIGHT_MODULE` 指定现有 Playwright 模块路径。它覆盖首页与手机布局、围棋双人落子、麻将四人开局和台球双人入房，不替代所有照片、全屏布局或公网网络测试。截图保存到被 Git 忽略的 `artifacts/`。

## 敏感文件扫描告警

`GET /.env` 等请求通常表示有人尝试探测敏感文件，告警本身不能证明文件泄露。应结合当时的响应状态与内容判断；`fetch` 调用也可能只是本项目的 `env.ASSETS.fetch(request)` 静态资源读取。

`.gitignore` 已忽略 `.env*` 与 `.dev.vars`（保留 `.env.example` 例外）。不要把密钥放入 `public/`；忽略规则不会移除已经被 Git 跟踪的文件。若确认响应或仓库历史中泄露过真实密钥，应撤销密钥并处理泄露内容。
## B 站主页与 GitHub

`/bilibili/` 直接嵌入 https://space.bilibili.com/51126650 。页面由 B 站提供，可能受登录、风控或第三方嵌入策略影响；页面始终保留外部打开入口，不通过 Worker 代理 B 站网页。

`GET /api/github` 从 GitHub REST API 分页读取 `WilburWin` 的公开仓库，包含 Fork 和归档仓库，不需要访问令牌。Worker 缓存 10 分钟；接口异常时前端提供重试与 GitHub 主页入口。

## 免登录留言板

`GET /api/guestbook` 按时间倒序读取，每页 25 条；`POST /api/guestbook` 提交昵称和正文。昵称可空（默认匿名旅人），最多 24 字；正文 1–200 字。内容以纯文本显示，不解析 HTML。每个网络地址每分钟最多提交一次，全站每天最多 500 条；含隐藏诱捕字段、请求体大小限制和同源提交校验。限流仅保存按日哈希后的网络标识，不保存原始 IP。

留言使用新增的 `Guestbook` Durable Object，绑定 `GUESTBOOK`，迁移标签 `v2-guestbook`。配置已写入 `wrangler.jsonc`，正常执行 `wrangler deploy` 会应用迁移，无需手动创建数据库。生产留言独立于本地 `.wrangler` 数据，GitHub 更新不会清空生产留言。

留言提交后直接公开，不设登录或审核。站长可在 Cloudflare 中设置 Worker Secret `GUESTBOOK_ADMIN_TOKEN`，通过带该令牌的 `DELETE /api/guestbook?id=<便签编号>` 移除留言；请求需同时发送 `Origin: https://wenyihao.cn` 和 `Authorization: Bearer <令牌>`。便签编号由读取接口返回。未设置此密钥时删除接口关闭。令牌只保存在 Worker Secret，勿放入前端或提交到仓库。

## 本地歌单工作室

运行 `npm run music:studio`，打开 http://127.0.0.1:8790 。首次读取根目录 `歌单.txt`，支持 B站候选搜索、优先 UP 主排序、手动锁定、分P、试听、自动保存及导出。搜索按随机 12–20 秒间隔执行、保留本地候选缓存，412 后先冷却 10 秒；连续触发逐步加长，最长 10 分钟，且不自动重试。详细说明见 [tools/music-studio/README.md](tools/music-studio/README.md)。

网站音乐页为 `/music/`，当前发布的是本地歌单中已锁定的 16 首歌曲。页面使用独立音轨和自定义网页播放器，MV 按钮打开 B站原视频。支持播放/暂停、进度拖动、音量、列表/单曲循环、随机播放、系统媒体键和当前可用音质选择，默认选择浏览器能解码的最高码率。

界面参考 Spotify 与 BiliTune：黑灰三栏布局、真实歌曲封面、歌单拼图、固定播放条、可收起的播放详情与下一首队列，手机端使用单栏。支持当前浏览器内的喜欢与最近播放，不修改 B站收藏夹。封面已缓存到本站；新增歌曲后执行 `python scripts/music-artwork.py` 补齐（需要 Pillow，顺序低频请求，遇到风控停止）。设计记录见 [docs/music-design.md](docs/music-design.md)。

取流使用锁定版本的 `@bryan-kuang/bilibili-audio-extractor@0.1.0`。该包依赖 Node 的 `crypto`、`fs` 和服务端请求头，不能直接放进第三方网页运行。现有 Cloudflare Worker 适配其 WBI 签名和音轨提取，并流式转发音频；访客只需浏览器，无需本地程序或扩展。

- `GET /api/music/resolve?id=<已发布歌曲ID>`：读取指定分P、时长及音质列表，临时地址仅在服务端短期缓存。
- `GET /api/music/audio?id=<ID>&quality=<音轨ID>`：流式转发音轨，保留 Range / 206；CDN 地址失效时最多重新解析一次。
- 只允许已发布歌曲及受限的 B站媒体域名，不接受任意上游 URL。遇到风控停止解析，提示稍后重试。

播放器提供可选的「登录 B站」按钮：使用 B站 App 扫码建立独立网页登录会话，不会自动读取浏览器已有的 B站 Cookie。账号会话以 AES-GCM 加密后保存在当前浏览器的 HttpOnly Cookie 中，最多 8 小时；Worker 在请求音轨时解密使用，不写入数据库、日志或共享缓存。不同浏览器账号的取流缓存隔离，退出后清除本站会话并按访客权限重新获取歌曲。

只有接口实际返回且浏览器支持的音轨才会出现在音质菜单中，登录不能保证 Hi-Res。歌曲标题标有「Hi-res」也不代表提供无损音轨。接口风控或变化、Cloudflare 生产节点出网仍可能影响播放；本地成功不等于生产已经验证。

本地先运行 `node scripts/music-session-key.mjs --local` 生成 `.dev.vars` 中的加密密钥，再用 `npm run dev`，完整音乐预览为 http://127.0.0.1:8787/music/ 。静态服务不能运行取流及登录接口。Cloudflare 已配置 `nodejs_compat`；生产环境需一次性设置名为 `MUSIC_SESSION_KEY` 的 Worker Secret：

```powershell
node scripts/music-session-key.mjs | npx wrangler secret put MUSIC_SESSION_KEY
```

这条命令生成的是随机加密密钥，不是 B站账号凭据；不要提交真实密钥或 `.dev.vars`。修改生产密钥会使旧会话失效。未配置密钥时访客播放仍可使用，扫码登录关闭。实现说明及来源见 [docs/music-playback.md](docs/music-playback.md)。
