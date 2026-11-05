# 内容维护与个人信息范围

## 本次整理范围

README、设计文档、测试用域名和开发示例已改为通用说明。本轮保留网站展示内容，包括姓名、简介、邮箱、账号链接、照片、歌单及来源素材，也没有重写 Git 历史。这不是匿名化模板发行版。

生产部署名称、对象绑定、迁移标签，以及运行时 Cookie 和浏览器存储键保持兼容，避免误建站点、影响留言数据或丢失本地收藏。它们有些带有旧项目缩写，属于保留的兼容标识。

## 修改入口

| 内容 | 主要文件 |
| --- | --- |
| 首页姓名、简介、联系图标与背景 | `public/index.html` 及首页引用的样式和素材 |
| 各页标题、页脚和个人署名 | `public/` 下各板块的 `index.html` |
| GitHub 抓取账号 | `worker/community.js` 中仓库 API 地址；同时更新 GitHub 页的主页链接 |
| B站 UID、内嵌地址与外部链接 | `public/bilibili/index.html`，以及首页的 B站入口 |
| 原始照片目录 | 被忽略的 `config/photos.local.json`；环境变量 `PHOTO_SOURCE_DIR` 优先 |
| 照片排序与排除规则 | `scripts/build-photos.py` 中 `featured` 和源文件过滤 |
| 已发布照片 | `public/photos/data.json` 与 `public/photos/images/` |
| 歌单选择与优先 UP 主 | 本地工作室界面；UID 名单位于 `.music-studio/project.json` 的 `preferred` 数组，直接改文件后重启工作室 |
| 实时 UP 主歌单 | 工作室“更新网站歌单”或 `npm run music:playlists` 发布名单；网站按需分页读取，不预统计投稿 |
| 已发布歌单标题与歌曲 | `public/music/playlist.json`；工作室发布时保留既有标题，封面由 Worker 自动获取 |
| 音乐页署名与文案 | `public/music/index.html` 及引用的 JavaScript |
| 共享导航布局 | `public/shared/navigation.css`，导航内容在各页面 HTML 中 |
| 游戏大厅卡片 | `public/games/index.html`、主题样式及脚本 |

源照片和歌单文本仍按现状保留在仓库。更换展示身份时应检查全站 HTML、脚本中的实际账号地址、图片内容和源文件，不能只替换 README。

## 本机配置与机密

`.dev.vars`、`.dev.vars.*`、`.env*`、`.music-studio/`、`config/*.local.json`、`assets-local/`、`artifacts/`、日志和 Python 缓存由 `.gitignore` 排除；安全示例 `.dev.vars.example` 和 `.env.example` 允许提交。Git 忽略规则不会撤回已经跟踪的文件。

照片配置示例见 `config/photos.example.json`，新站部署示例见 `config/wrangler.example.jsonc`。已有部署继续使用根目录 `wrangler.jsonc`，不要为了改显示名称而重命名生产资源。

音乐登录密钥和留言管理令牌放入 Worker Secrets。本机变量不自动成为生产变量，构建环境变量也不等于运行中的 Worker Secrets。不要复制真实 Cookie、密钥或带签名的播放地址到文档、截图和提交记录。

已发布的个人内容若后续需要撤回，还需分别处理静态文件、CDN 缓存和 Git 历史；本轮没有执行这些操作。
