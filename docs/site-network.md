# 整站自动选线

网站继续显示主域名，不跳转到优选域名。`site-network-sw.js` 使用浏览器内置 Service Worker，将适合的公开请求从速度较好的入口读取；没有扩展、安装提示或访客本地服务。

## 覆盖范围

| 请求 | 处理方式 |
| --- | --- |
| 首页、各板块 HTML、图片、CSS、JavaScript、公开歌单 | 可走优选入口 |
| GitHub 仓库、留言读取、B站封面、UP 主投稿读取 | 可走优选入口，凭据不发送到镜像 |
| 游戏 WebSocket | 继续使用已有的游戏 RTT 选线逻辑 |
| 音乐登录、取流和音频，留言提交及管理删除 | 保持原来的同源链路 |
| B站内嵌主页、外部网站及第三方资源 | 不改动 |

登录、音频和写入保留原链路，是为了继续使用主域名的 HttpOnly Cookie、加密会话、Origin 校验和既有账号权限。入口优化不改变 Worker 请求 B站的出口，也不能保证音轨解析不受风控影响。

地址栏和文档来源不变，因此音乐收藏、最近播放、游戏设置与本地进度继续使用原来的 localStorage；没有跨域复制用户数据。音乐和留言功能的页面与公开资源仍可从优选入口加载。

## 选择与回退

首次访问先正常打开网站，后台注册 Service Worker 并测速。安装和测速完成后由后续请求使用选线结果；首次 HTML 和注册前已发出的请求不会被加速，也不强制刷新页面。浏览器不支持或禁用 Service Worker 时保留原来访问方式。

对默认入口和最多两个候选 HTTPS 域名，各请求三次 `/network/ping`，丢弃首个预热值，比较后两次的较慢值。候选至少快 20ms 才切换，浏览器独立测量，不直接使用站长的 CFST 排名。探针禁止缓存并校验随机 nonce；HTTP 探针与游戏 WebSocket RTT 是不同的指标。

浏览器只缓存已完成的选线结果 5 分钟，不缓存整站文件、账号或响应内容。页面、脚本、图片和公开 API 仍遵守正常网络缓存策略。优选请求失败、超时、重定向或返回非成功状态时回退原域名，优选路线在当前浏览器退避 30 秒。取消的请求不会额外重试。页面不会等待后台测试结果。

经优选入口取得的内容以新的流式 Response 返回，文档地址、CSS 相对地址和模块 import 的基准仍使用原 URL。跨域读取使用 CORS 和 `credentials: omit`，不发送 Cookie、Authorization 或其他任意请求头。

## 配置与关闭

- `public/shared/site-network-config.json`：整站开关、允许的主站来源和最多两个候选域名。候选须是主域名下的 HTTPS 子域名。
- `public/shared/realtime-config.json`：独立的游戏 WebSocket 候选配置。
- `public/shared/site-network.js`：注册入口；更换主域名时同步更新其中的生产来源。
- `wrangler.jsonc`：候选域名路由到相同 Worker；整站候选路由覆盖 `/*`。`SITE_EDGE_ORIGINS` 指定公开镜像，`GAME_SITE_ORIGIN` 指定主站来源。
- `public/_headers`：静态资源允许主站 CORS 读取。更换主域名时同步修改；不设置允许携带凭据的 CORS。

公开镜像仅允许 GET/HEAD，动态 API 采用明确白名单。对登录、音频和其他 API 的访问返回 403，写入返回 405；先检查实际 Origin，再剥离凭据交给现有读取处理器。游戏 WebSocket 单独保留已有校验。

设置配置中的 `enabled` 为 `false` 并部署后，现有浏览器最迟在已保存结果的 5 分钟有效期结束时停止优选。原站一直是回退目标，关闭功能无须迁移或删除用户收藏和登录会话。游戏选线使用另一个配置，可独立保留。

开发调试可在生产页面控制台执行 `await siteNetworkStatus()`，只返回当前线路、测量值和过期时间，不返回凭据。浏览器路线数据保存在 `site-network-route-v1` Cache Storage，属于每个访客各自的浏览器。

## 验证范围

2026-11-06，通过正常 DNS 验证公开镜像的首页、照片页、音乐样式、台球脚本、Service Worker 及模块响应，均具有主站 CORS 读取头。公开留言读取成功，音乐登录和解析 API 在镜像入口被拒绝。相同测试网络中，预热后的 HTTP 探针中位数约 254ms（默认）和 81ms（优选）。直接运行选线核心连接生产接口时，选择了优选入口，并成功读取照片页、音乐样式和留言；主站登录状态接口保持原链路。

自动测试覆盖后台选线、20ms 切换阈值、已完成结果复用、只读凭据隔离、故障回退、首次访问、配置关闭与不合法候选。当前浏览器控制工具不可连接，因此这些公网协议和核心逻辑验证不等同于真实浏览器中的 Service Worker 注册和页面交互验收。不同地区、运营商与时间的结果可能不同。

参考：[Service Worker respondWith 的来源与响应类型规则](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith)、[Workers 静态资源响应头](https://developers.cloudflare.com/workers/static-assets/headers/)。
