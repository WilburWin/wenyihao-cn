# 音乐后端的香港区域部署

浏览器继续访问本站的 `/api/music/*`，主站通过 `MUSIC_BACKEND` 的 HTTP service binding 转发原 Request，URL、Origin、Cookie、请求方法和音频 Range 保持不变。后端默认 fetch 处理器设置 `placement.region: "aws:ap-east-1"`，表示靠近香港区域执行。该标识只用于定位，不需要 AWS 账号或服务器。

## 服务划分

| 服务 | 职责 |
| --- | --- |
| 主站 `worker/entrypoint.js` | 原网页、游戏、留言和同源入口；保管原有登录密钥 |
| `worker/music-backend.js` | 请求 B站登录、详情、投稿、取流与 CDN，流式返回音频 |
| 主站私有 `MusicSiteSupport` | 只读当前发布歌单，报告密钥是否配置，按原来源与用途执行会话加解密 |

音乐 Worker 的 workers.dev、预览地址关闭，没有 DNS 或公开路由。私有会话入口只暴露给同账号的命名服务绑定，不存在对应的公网 API。密钥不传给音乐 Worker；会话 Cookie 仍为原站点的 HttpOnly 密文。音乐 Worker 在请求中会接触解密后的账号凭据，以调用 B站，沿用现有内存隔离和不记录凭据的规则。

状态和退出在主站处理，因为它们不访问 B站。取码、轮询、登录核验、匿名与账号取流走后端。空 Cookie 和过大 token 在调用远端加解密之前拒绝，减少匿名播放往返。静态歌单通过私有服务读取，不重新从公网主站下载；原来 30 秒的进程内歌单缓存保持不变。

后端不可用时返回安全的 503，不自动将登录或取流动作重复发送至另一个出口。配置回退由维护者控制。原有重试、风控退避、CDN 主机限制、Range 验证与账号缓存隔离保持有效。

## 部署

首次建立服务绑定：

```sh
node scripts/deploy.mjs --bootstrap
```

之后在 Git 自动构建的部署命令使用 `npm run deploy`，本地部署也使用该命令。脚本验证两个配置的服务名称，先部署音乐 Worker、成功后部署主站。两个 Worker 不是一个原子部署，更新接口时应保持新旧服务兼容。

Workers Builds 会注入主站专用的 `WRANGLER_CI_OVERRIDE_NAME` 和 `WRANGLER_CI_MATCH_TAG`。部署脚本只在音乐 Worker 子进程中移除这两个变量，保留认证、账号、分支和其他 CI 配置；主站子进程继续保留原名称和 tag 校验。每个阶段同时明确传入目标名称，且在开始前拒绝非主站的 CI 项目。不要修改音乐配置的名称来匹配主站，也不要删除 `GameRoom` / `Guestbook` 或增加删除类的迁移。

可用 `node scripts/deploy.mjs --dry-run` 检查两个打包目标，不上传或改变部署。`npm run deploy:music` 与 `npm run deploy:site` 使用同一部署包装，分别只更新一个目标。

不要继续只用 `npx wrangler deploy` 更新整个项目，否则仅主站更新，音乐逻辑和香港配置不会更新。已有自动构建命令需在 Cloudflare 控制台的主站 Worker → 设置 → 构建中修改；构建令牌需具有两个 Worker 的部署权限。CLI 当前登录权限与构建令牌是不同的。

`npm run dev` 不需要第二个服务，也不继承生产登录密钥。开发配置将转发 Host 明确设为 `localhost`，避免 Wrangler 根据生产路由把本地 HTTP 当成线上域名，从而误用区域后端或触发 HTTPS 检查；预览使用终端给出的 `http://localhost:<端口>/`。

## 检查与回退

- 音乐取流与音频响应有 `X-Music-Backend: regional`。
- Cloudflare 在服务响应上附加 `Cf-Placement: remote-HKG` 时，证明该次后端在香港执行。`CF-RAY` 的机房码可能属于访客入口，不能代替后端位置。
- `/api/music/auth/status` 仍在主站，返回 `X-Music-Backend: local` 是正常的。不能用这个接口的机房来判断 B站请求的位置。
- `Cf-Placement` 证明执行位置，不证明所有 TCP / fetch 出口 IP 固定、被 B站识别为香港或永远不受 412 限制。
- 如需回退，将 `wrangler.jsonc` 的 `MUSIC_BACKEND_MODE` 设为 `local` 后执行 `npm run deploy:site`。现有密钥、Cookie 和收藏不需要迁移；独立 Worker 可暂时保留。

自动测试覆盖现有密文跨服务读取、新密文在主站读取、来源和用途隔离、私有歌单读取范围、退出 Cookie、同源检查、匿名跳过 RPC，以及服务失败不重复发送登录动作。真实扫码确认与账号 Hi-Res 需要用户本人验收。

## 2026-11-06 验收

76 项自动测试通过，56 个站点 JavaScript 文件语法检查通过，两个部署包 dry-run 通过。线上 API 确认音乐 Worker 启用 targeted placement，主站不启用 placement；生产音乐取流、音频、取码和轮询响应均观察到 `Cf-Placement: remote-HKG`。

同一网络两首歌曲的切换前首次观测取流为 2049ms、1404ms，区域部署后首次观测为 1659ms、901ms。随后使用缓存的区域请求约 401–734ms，原链路缓存请求约 253–256ms，说明额外跨区域转发也有成本，不能据此声称所有切歌都更快。这里是少量顺序样本，没有控制 CDN 缓存、连接预热和时段，不能作为稳定加速比例。

两首歌曲均返回 AAC 64K / 132K / 192K；各自 1MB 的 Range 读取返回 206 和正确数据，包含响应头等待的总耗时约 1.88 秒、1.13 秒。二维码生成返回 200，轮询为 waiting，退出清除由主站完成；未进行真实账号扫码确认。优选入口上三款游戏的 ping 中位数仍约 100–103ms。本地 localhost 单进程验证会话配置和取流均为 200。

本次已直接部署两个 Worker；没有推送 Git。当前 CLI 登录不能读取或修改 Workers Builds 触发器（API 403），桌面控制工具也未连接，因此控制台中将部署命令改为 `npm run deploy` 仍需站点维护者完成。

同日的 Git 构建曾因上述 CI 名称覆盖，将音乐包误指向主站，Cloudflare 以缺少现有 `GameRoom` 的 10064 错误拒绝上传。修复后 79 项测试通过，带主站名称覆盖和 tag 的模拟 CI dry-run 通过；使用真实主站 CI 名称和 tag、当前本机 OAuth 权限实际部署也成功，两个目标分别更新，主站仍包含原有 Durable Objects。随后首页、登录配置状态和香港取流均返回 200。此验证没有使用云端构建令牌，Git 构建仍需新提交触发以验收其环境。将修复提交到 GitHub 后由新提交触发构建；重试旧提交不会取得新脚本。

参考：[Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/)、[HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/)。
