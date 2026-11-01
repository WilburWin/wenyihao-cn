# 文艺淏 · wenyihao.cn

文艺淏的个人网站，展示个人介绍、照片与 HTML 游戏。中文为主，英文辅助信息使用较小字号；学术论文、GitHub 项目和 B 站视频板块待补充。

- 网站：https://wenyihao.cn
- 仓库：https://github.com/WilburWin/wenyihao-cn
- 部署：Cloudflare Workers Builds 连接 GitHub，生产分支为 `main`。

## 页面与功能

| 页面 | 地址 | 功能 |
| --- | --- | --- |
| 首页 | `/` | 个人介绍、叠放照片轮播、游戏入口 |
| 照片 | `/photos/` | 原比例瀑布流、分类筛选、场景搜索、大图预览 |
| 游戏大厅 | `/games/` | 四个游戏入口，按屏幕宽度调整列数 |
| 星弈围棋 | `/games/go/` | 人机、双人联机、本地双人、棋谱练习 |
| 雀神麻将 | `/games/mahjong/` | 单机与最多四人联机，空位由电脑补齐 |
| 黑八台球 | `/games/billiards/` | 人机、训练、双人联机与网络 RTT 显示 |
| 猫咪在哪里 | `/games/catwhere/` | 单人逻辑解谜、三种难度、随机关卡 |

首页照片默认每秒切换，边缘渐隐、错位叠放；点击两侧透明区域切换，点击中间进入照片页，手机支持左右滑动。鼠标悬停、键盘聚焦和页面进入后台时停止自动切换；系统启用减少动态效果时不自动播放。

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