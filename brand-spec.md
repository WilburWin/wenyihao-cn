# 网站视觉规范

各板块以独立场景呈现，顶部导航的尺寸、顺序和位置统一。中文为主，英文为较小的辅助文字。首页保留已确认的月夜庭院背景、姓名、简介和联系图标。

| 板块 | 视觉语言 | 主要颜色 | 样式文件 |
| --- | --- | --- | --- |
| GitHub | 网格背景、仓库控制台、双列信息记录 | 深蓝 `#0d1929`、青色 `#7ad7ed` | `public/github/tech.css` |
| B站 | 蓝粉配色、小电视外框、天线与扬声器 | 浅蓝 `#f4fbff`、粉色 `#fb7299` | `public/bilibili/bili.css` |
| 游戏人生 | 霓虹招牌、彩色街机、透视地面 | 紫黑 `#130d1c`、粉绿灯光 | `public/games/neon.css` |
| 照片墙 | 暖白墙面、相纸、胶带、柔和投影 | 暖白 `#f4f1eb`、米白相纸 | `public/photos/wall.css` |
| 音乐 | 三栏播放器、封面网格、常驻播放条 | 黑灰 `#121212`、绿色 `#1ed760` | `public/music/music.css` |
| 留言板 | 浅灰蓝墙面、浅橡木框软木板、图钉便签 | 灰蓝 `#eef2f3`、浅木色、浅黄纸张 | `public/guestbook/notes.css` |

正文使用系统字体 Segoe UI / Microsoft YaHei；控制台辅助信息使用 Consolas；照片标题使用楷体回退字体。导航统一由 `public/shared/navigation.css` 控制，并在页面样式后加载。

## 本地素材

- GitHub 标志：`public/assets/design/github-mark.png`，来源：https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png
- B站图标：`public/assets/design/bilibili.ico` 与转换后的 `bilibili.png`，来源：https://www.bilibili.com/favicon.ico
- 灰泥、软木和木纹：`public/assets/design/plaster.webp`、`cork.webp`、`wood.webp`，本地生成的平铺纹理，无外部图片依赖。

B站主页内容由外部 iframe 提供，保留独立打开入口。装饰元素不进入辅助技术的朗读顺序；游戏卡片支持键盘聚焦，减少动态效果偏好会关闭动画。
