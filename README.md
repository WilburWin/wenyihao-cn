# 文艺淏 · wenyihao.cn

个人网站与三个 HTML 游戏.首页及游戏大厅采用中文主文案、较小英文辅助文案.其他内容区后续扩展.

## 本地运行

需要 Node.js 22 或更新版本.

```sh
npm ci
npm run dev
```

打开终端显示的本地网址.游戏分别位于 `/games/go/`、`/games/mahjong/`、`/games/billiards/`,必须通过服务器访问,不能双击 HTML.

## Cloudflare 与 GitHub 自动部署

使用 **Workers + Static Assets + Durable Objects**,不是原来的 Pages/D1 中继.整个仓库一个 Worker 项目,无需额外中继域名和数据库.

1. 将此 Git 仓库推送到你自己的 GitHub 仓库.
2. 在 Cloudflare Workers 创建应用,连接该仓库,启用 Workers Builds.
3. 根目录使用仓库根目录;依赖通过 `npm ci` 安装;构建命令 `npm run check`;部署命令 `npx wrangler deploy`.选择 Node.js 22 或更新版本.
4. 首次部署会通过 `wrangler.jsonc` 的迁移创建 SQLite Durable Objects 命名空间.
5. 在 Worker 的域与路由中添加自定义域名 `wenyihao.cn`.如果已有同名 DNS/Pages 绑定,先核对并迁移,不能同时绑定两个应用.
6. 后续向生产分支推送提交,由 Cloudflare 自动部署.

手动部署可运行 `npx wrangler login` 后执行 `npm run deploy`.本仓库未包含账号凭据、远端仓库地址和正式域名绑定,尚未发布到公网.

## 内容维护

### 照片

照片页 `/photos/` 展示 `wenyihao/照片/` 中的图片，首页介绍区轮播手动指定的 4 张精选，点击进入照片页；正面照原图不发布。新增、替换照片后，在本机运行 `python scripts/build-photos.py`（需要 Pillow），将源照片、生成的 `public/photos/images/` 和 `public/photos/data.json` 一并提交。Cloudflare 无需安装 Python，直接部署已生成的 WebP 文件。脚本不会修改原图，也不会发布提示词 TXT 或正面照原图；网页版本移除元数据并处理 EXIF 方向。精选顺序在脚本的 `featured` 列表中修改，显示标题使用源文件名。删除照片时重新生成清单即可取消展示。

照片大图支持左右按钮、键盘方向键和手机左右滑动；Esc 或关闭按钮返回列表。风格写真标注为包含图像编辑作品。

- `public/index.html`:首页、个人介绍、其他板块预留.
- `public/site.js`:手动排列的游戏卡片.
- `public/style.css`:网站样式.
- `public/games/`:三个游戏的运行版本.
- `public/shared/realtime.js`:同源 WebSocket 适配器.
- `worker/index.js`:各游戏隔离的房间服务.
- `GAME/refs/`:原始参考代码,保留不改,不会部署为静态资源.

## 联机设计及限制

每个游戏、每个三位房间号对应一个 Durable Object.浏览器保持 WebSocket 长连接,事件到达立即唤醒等待中的客户端,不再经过 HTTP 定时轮询或 D1 查询.客户端内的 `/api/poll` 是兼容原游戏流程的函数调用,经适配器转成 WebSocket 消息;并非发出 HTTP 轮询请求.空闲时每秒返回一次在线状态.

房间首次放置请求 `apac` 区域.Cloudflare 的区域提示不是地域保证,域名托管也不会自动带来大陆境内节点.此设计消除旧方案的应用层等待,无法保证大陆各运营商的公网 RTT.上线后需要电信、联通、移动不同网络的跨设备试打;本地 RTT 不代表公网质量.

游戏继续使用原本的房主浏览器裁决机制,保留现有玩法与台球预测逻辑.麻将支持定向手牌、检查点与断线接管;双人游戏房主断线时需恢复连接或重新建房.页面退出关闭连接,服务端以连接状态判定在线.房间检查点按操作保存,突发断电可能回退未持久化的最后操作.活跃连接使用普通 WebSocket API,未实现休眠计费优化;应观察 Cloudflare 用量,不承诺零费用.

此版本适合个人与朋友体验,不是面向陌生流量的竞技平台:房主可查看客户端状态,三位房间号可猜测,暂未增加邀请密码、滥用流量限制与完整服务端规则裁决.不要将房间号作为访问机密.

## 检查

```sh
npm test
npm run check
```

现有麻将与台球测试分别保留在各自目录.麻将测试需要从 `public/games/mahjong` 运行 `node test-v30-rules.mjs`.台球目录使用 CommonJS,与网站的 ES modules 配置隔离.

`scripts/browser-smoke.mjs` 使用 Playwright 和本机 Chrome,验证首页、手机布局、围棋双人落子、麻将四人开局及台球双人入房.先启动本地服务,安装 Playwright 后运行;可使用 `PLAYWRIGHT_MODULE` 指向现有 Playwright 模块.截图输出到不提交的 `artifacts/`.
