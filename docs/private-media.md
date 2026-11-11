# 私人影音库

隐藏入口为 `/media/`，不在首页、站点导航或下载工具中展示。页面使用单独的主站 Worker Secret `MEDIA_ACCESS_CODE` 登录；会话由同一 DownloadBridge Durable Object 签发 HttpOnly、Secure、SameSite=Strict Cookie，12 小时失效。登录请求每个 IP 每小时最多 8 次，登录后的目录和播放地址请求全局每小时最多 240 次。访问码不写入 Git、URL 或浏览器存储。

生产环境需将 `MEDIA_ACCESS_CODE` 设置为你指定的影音库密码。应在当前主站 Worker 的 Settings → Variables and Secrets 中新增类型为 Secret 的变量，输入你在聊天中指定的密码并部署生效。该 Secret 属于 Cloudflare 主 Worker，独立音乐 Worker 不需要该值；不要把密码写入 Git、页面代码或普通变量。

## 存储隔离

影音库专用 AList 账号 `website-media-reader` 仅有 `/115` 路径作用域的只读角色；百度挂载不可访问。密码与下载代理配置保存在 `/etc/website-downloads/config.json`（root:服务组、0640），不提交 Git。影音库元数据请求由既有加密 WebSocket 代理转发，服务器未新增公网端口。AList 的 115 挂载使用 `302_redirect`，Web 代理保持关闭。

影音页只列出常见视频、音频、图片扩展名和文件夹。播放器从 AList 获取一次性地址后直接连接 115，不通过 Cloudflare Worker 或 ECS 传输文件内容。目录和取链由 `/api/tools/media/*` 处理；它与朋友访问码、付费下载会话完全独立。页面和资源设置 `no-store`、`no-referrer` 与 `noindex`，不会加入公共导航。

浏览器原生播放器不能自行设置任意 `Cookie` 请求头。AList 115 驱动的下载地址可能需要 115 账号 Cookie，因此目录浏览可用并不代表所有浏览器、视频格式或网络均可直接播放。若设备的浏览器能直连 115 并完成播放，媒体流量由设备与 115 之间传输；若失败，页面会显示提示，不会回退到 ECS 文件中转。可在对应 115 App 或官方客户端播放。不要把受版权限制的内容发布或共享给他人。

## 更新与回退

影音页为静态资源，Worker 接口与下载代理代码随仓库正常构建更新。常规改动推送 GitHub 后由现有 Workers 构建流程部署。移除站点页面前，应先禁用或移除 `MEDIA_ACCESS_CODE` Secret；移除服务器只读账号前，确认没有其他任务继续使用它。该页面没有修改原有百度挂载、下载权限或支付宝订单。
