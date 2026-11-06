# 个人网站与联机游戏

一个逐步搭建起来的个人网站：全屏首页、GitHub 仓库、B站主页、联机游戏、照片墙、音乐播放器和留言板。页面使用 HTML、CSS 和原生 JavaScript，Cloudflare Worker 同时提供静态资源、实时连接与 API，GitHub 提交可触发自动部署。

## 页面与功能

| 页面 | 路径 | 内容 |
| --- | --- | --- |
| 首页 | `/` | 全屏背景、个人简介、账号与邮箱图标入口 |
| GitHub | `/github/` | 分页抓取全部公开仓库，支持搜索与语言筛选，包含 Fork 和归档仓库 |
| B站 | `/bilibili/` | 小电视外框中的个人主页，保留外部打开入口 |
| 游戏人生 | `/games/` | 霓虹游戏厅，四张带主题动画的游戏卡片 |
| 照片墙 | `/photos/` | 拟真相纸、分类搜索、大图预览 |
| 音乐 | `/music/` | 独立音频播放、队列、随机与循环、音质选择、喜欢与最近播放、可选扫码登录、MV 跳转 |
| 留言板 | `/guestbook/` | 免登录便签、分页、持久化存储与管理删除接口 |

导航顺序为 GitHub、B站、游戏、照片墙、音乐、留言板。各页导航保持相同位置与尺寸；中文为主，英文辅助文字使用较小字号。

游戏包括星弈围棋、雀神麻将、黑八台球和猫咪在哪里。前三款支持联机，找猫是单人逻辑解谜。围棋与找猫采用中央棋盘或网格、两侧工具布局；窄屏允许重排和滚动。台球提供网络 RTT 显示。

## 本地运行

使用 Node.js 22 或更新的受依赖支持的版本，以及 npm：

```sh
npm ci
npm run dev
```

通常打开 `http://localhost:8787/`，以终端输出为准。联机、留言和音乐接口需要 Wrangler 运行时，普通静态服务器无法提供这些功能。本机地址只能用于本地测试，跨网络联机需要部署后的公网地址。

扫码登录是可选功能。本地启用时运行：

```sh
node scripts/music-session-key.mjs --local
```

脚本只在缺少密钥时写入被 Git 忽略的 `.dev.vars`。未配置时关闭扫码登录，访客音轨解析仍可使用。Python 与 Pillow 用于生成照片，启动网站无需安装。

## 部署

架构为 **Cloudflare Workers + Static Assets + SQLite Durable Objects**，平台入口为 `worker/entrypoint.js`，网站路由和房间在 `worker/index.js`，静态目录为 `public/`。主站配置为 `wrangler.jsonc`，独立音乐后端配置为 `wrangler.music.jsonc`。网页没有额外的打包步骤，Worker 依赖由 Wrangler 打包。

在 Workers 的 Git 构建配置中连接仓库，并核对生产分支、项目根目录及命令：

| 配置项 | 值 |
| --- | --- |
| 根目录 | 仓库根目录 |
| 构建命令 | `npm run check` |
| 部署命令 | `npm run deploy` |
| 依赖安装 | 使用 `package-lock.json` 安装依赖 |

绑定自定义域名后，向配置的生产分支推送即可触发更新。手动部署使用：

```sh
npx wrangler login
npm run deploy
```

`npm run deploy` 先更新独立音乐 Worker，再更新主站；若音乐部署失败则停止，不更新主站。已有 Git 集成也须将部署命令从 `npx wrangler deploy` 改为 `npm run deploy`，仅执行前者不会更新音乐后端。构建令牌需要能部署这两个 Worker。首次建立两者的服务绑定时使用 `node scripts/deploy.mjs --bootstrap`，先以旧音乐链路发布主站的私有会话入口，再部署音乐和最终主站。后续更新无需 `--bootstrap`。

已有站点继续使用根目录的配置。**保留 Worker 名称、Durable Objects 绑定和迁移记录**，避免部署到新目标或改变数据归属。全新站点可从 `config/wrangler.example.jsonc` 开始，替换名称后执行 `npx wrangler deploy --config config/wrangler.example.jsonc`；示例中的资源路径相对于该配置文件。

### 可选机密与音乐传输

| 配置 | 用途 |
| --- | --- |
| `MUSIC_SESSION_KEY` | 加密每位访客独立的 B站登录会话，未配置时禁用扫码登录 |
| `GUESTBOOK_ADMIN_TOKEN` | 留言删除授权，未配置时关闭删除接口 |
| `MUSIC_API_TRANSPORT` | 普通变量，默认 `socket`；可设为 `fetch` 后重新部署以回退传输 |
| `MUSIC_BACKEND_MODE` | 主站变量，`regional` 使用独立音乐服务；`local` 回退主站处理 |

生产音乐密钥可直接通过管道写入，避免手动复制：

```sh
node scripts/music-session-key.mjs | npx wrangler secret put MUSIC_SESSION_KEY
```

已有生产密钥无需重复生成；更换会使现有登录会话失效。不要把机密写进前端、示例配置或 Git。确认变量配置属于当前域名使用的 Worker，并已进入生效的部署版本。`/api/music/auth/status` 可以检查配置状态，不会返回密钥。

音乐 JSON API 使用 Socket 传输，媒体 CDN 保留原生流式请求。它仍从 Cloudflare 出口访问 B站，不能保证所有地区、歌曲或账号可用。独立音轨、CORS、会话加密、412 排查与实测边界见 [音乐实现](docs/music-playback.md)。

独立音乐服务采用香港区域偏好，浏览器仍访问主域名，无需新增 DNS 或重新配置登录密钥。主站保留会话加密和解密，服务绑定传递所需数据；账号凭据仍只在请求中临时使用。配置、验收与回退见 [音乐香港部署](docs/music-regional.md)。本地开发继续在本机处理音乐，无需启动第二个 Worker。

## 内容维护

网站展示内容目前保留；本轮整理只通用化文档和开发示例。姓名、账号、背景、照片目录与其他内容的修改入口见 [内容维护与个人信息范围](docs/customization.md)。

### 照片

复制 `config/photos.example.json` 为 `config/photos.local.json`，将 `source` 设置为源图片目录。相对路径以仓库根目录为基准；也可用环境变量 `PHOTO_SOURCE_DIR` 覆盖。现有本机配置已保留，配置文件不会提交。

```sh
python -m pip install Pillow
python scripts/build-photos.py
```

脚本生成 `public/photos/data.json` 及 WebP 图片：缩略图最长边 640px、大图最长边 1920px，不放大原图，应用 EXIF 方向但不携带原始元数据。当前规则排除名为 `正面照` 的源文件；TXT 提示词不参与生成。生成脚本不普遍清理旧图片，移除照片时还需检查已发布文件。仅删除索引不会撤回已提交的文件或历史版本。

### 歌单工作室

```sh
npm run music:studio
```

打开 `http://127.0.0.1:8790/`。首次读取根目录 `歌单.txt`，每行一首“歌曲 - 歌手”。工具提供候选搜索、优先 UP 主和 Hi-res 等标题关键词排序、自动或手动锁定、分P、试听及导出。已有手动锁定不会被搜索覆盖。

项目保存在被忽略的 `.music-studio/project.json`。点击“更新网站歌单”发布已确认结果到 `public/music/playlist.json`，保留原有歌单标题和未变更资源的已知时长。推送歌单 JSON 即可，不再需要下载或提交歌曲封面。

优选 UP 主 UID 位于 `.music-studio/project.json` 的 `preferred` 数组，也可在工作室中逐行填写。修改文件后重启工作室。发布时会同时生成按 UID 区分的 UP 主歌单，只保存名单，不提前统计数量或遍历投稿。仅更新 UP 主名单可运行 `npm run music:playlists`，保留现有歌曲选择。

音乐页点击 UP 主歌单后实时分页读取公开投稿，每页最多 100 条，“加载更多投稿”继续读取。总数来自同一次列表响应，不另行统计；随机播放根据该总数选中任意页中的视频，覆盖未加载投稿。列表搜索只匹配已经加载的内容，多分P视频默认播放第一P。投稿页边缘缓存 10 分钟、浏览器缓存 1 分钟；刷新页面重新读取，B站限制请求时可手动重试。

封面由 `/api/music/cover` 按需读取 B站视频封面，通过本站返回。浏览器懒加载，Cloudflare 按视频缓存 6 小时，浏览器缓存 1 小时；歌单拼图直接组合前四首的在线封面。失败显示音符占位，不影响音频播放。新歌曲播放时会读取实际时长，如需提前补齐列表时长，可选执行（仅需 Python 标准库）：

```sh
python scripts/music-metadata.py
```

工作室不设额外搜索冷却，一次只进行一个联网搜索；遇到风控停止，由用户手动重试。可选时长脚本独立采用顺序低频请求，遇到 412/429 停止。工作室不对公网开放，不自动提交或推送。详见 [工作室说明](tools/music-studio/README.md)。

### 游戏与留言

线上游戏代码位于 `public/games/`，实时兼容层为 `public/shared/realtime.js`，房间服务在 `worker/index.js`。`GAME/refs/` 和 `GAME/legacy/` 是参考与旧实现，不参与当前站点部署；`scripts/prepare.mjs` 是早期迁移工具，不是日常安装步骤。

联机支持独立入口实测与自动选择，保留本站回退。CloudflareSpeedTest 的结果先通过 `python scripts/test-game-route.py --host <网站域名>` 验证实际 WebSocket RTT；候选域名配置在 `public/shared/realtime-config.json`，需要对应 DNS、证书及 Worker Route。仅改代码或把 IP 填进橙云记录不会完成优选，详见 [联机延迟排查](docs/game-latency.md)。

整站页面、资源和公开读取接口也支持浏览器后台选线，配置位于 `public/shared/site-network-config.json`。地址栏不变，保留已有收藏和登录状态；首次访问完成 Service Worker 注册后，后续适合的请求可使用优选入口。音乐账号、音频与留言写入保持原同源链路，失败自动回退。部署、关闭与实测范围见 [整站自动选线](docs/site-network.md)。

留言无需登录，提交后公开。设置管理机密后，站长可向 `DELETE /api/guestbook?id=<便签编号>` 发送本站 `Origin` 和 `Authorization: Bearer <管理令牌>` 删除便签。编号由读取接口返回，令牌只用于管理请求，不放入网页。正常代码部署保留现有 Durable Objects 数据。

## 项目结构

```text
public/                 网页、样式、游戏及发布后的图片和歌单
worker/                 路由、游戏房间、留言、音乐及会话接口
scripts/                检查、照片处理、音乐工作室与封面工具
tools/music-studio/     本地工作室界面和说明
test/                   Worker、音乐与会话的自动测试
config/                 通用部署示例、图片配置示例和本机配置
docs/                   架构、设计、维护与建站经验
GAME/                   原始参考与旧游戏实现
wrangler.jsonc          当前站点部署配置与数据迁移
wrangler.music.jsonc    独立音乐后端与香港区域偏好
brand-spec.md           全站视觉规范及素材来源
```

## 检查与建站经验

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

语法检查、模拟接口测试和打包检查各有作用，不能替代公网联机、真实账号和实际音源验证。各游戏附带的规则测试与可选浏览器检查见 [架构与验证](docs/architecture.md)。

这次建站最有用的经验是：先确定内容与入口，再打磨各板块；保留成熟游戏规则，把改动集中在联机适配；区分浏览器权限、本地运行和云端出口；用实测定位延迟和 412，而不是凭本地成功推断线上可用。更完整的过程、取舍与排查记录见 [建站经验](docs/building-notes.md)。

- [当前页面设计](docs/design.md) · [视觉规范](brand-spec.md)
- [音乐页设计](docs/music-design.md) · [音乐播放实现与来源](docs/music-playback.md)
- [内容维护与个人信息范围](docs/customization.md) · [架构与验证](docs/architecture.md)

项目包含第三方依赖、游戏参考与素材，各自的来源和许可需分别保留；根目录尚未声明覆盖全部内容的开源许可证。
