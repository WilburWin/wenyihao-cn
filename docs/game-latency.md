# 联机入口与延迟排查

游戏使用 WebSocket 连接 `GameRoom`，网络路径分成“玩家 → Cloudflare 入口”和“入口 → 房间对象”两段。CloudflareSpeedTest 的 TCP 延迟不能代替游戏 RPC 往返，更不能代表两位玩家之间完整的操作延迟。

## 实测优选入口

将本机 CFST 的 `result.csv` 放在根目录，执行：

```sh
python -m pip install websocket-client
python scripts/test-game-route.py --host your-site.example --limit 6 --samples 10
```

工具按零丢包、下载成功及低延迟挑选候选，保留真实域名的 TLS SNI、证书校验、HTTP Host 和 Origin，只改变 TCP 连接的 IP。对同一个房间先预热，再发游戏 `/api/ping`，报告中位数、P90 和最大值，最后重测默认 DNS。不会创建、加入游戏或发送游戏事件，也不修改 DNS/hosts。报告在被忽略的 `artifacts/game-route-results.json`。

CFST 结果可能过期，某个 IP 对一种运营商有效不代表对其他网络有效。候选以实际游戏 RTT 和尖峰为准，不按下载速度排名直接选第一行。

## 网站自动选择入口

`public/shared/realtime-config.json` 的 `enabledFor` 指定生效的网站来源，`endpoints` 填写独立 HTTPS 域名。开发环境不连接生产房间。浏览器加载游戏后，对本站和最多两个候选域名各做三次游戏 ping，丢弃首个预热结果，取后两次的较慢值比较；候选至少快 20ms 才切换。所有探测限时，失败后保留本站。正式建房/入房前决定线路，游戏期间不主动切换；候选连接失败会先回退本站，再发业务消息。

备用入口必须路由到**同一个 Worker 和同一套 ROOMS 绑定**，继续使用同样的游戏名和房间号，因此两位玩家可以走不同入口加入同一房间。`GAME_SITE_ORIGIN` 显式允许生产网页通过备用域名建立 WebSocket。整站的公开资源与读取接口另有只读镜像策略，账号、音频和留言写入仍要求原同源链路，见 [整站自动选线](site-network.md)。

浏览器 WebSocket 无法直接指定 IP 并同时自行设置 TLS SNI/Host。将 `wss://域名` 替换为 `wss://IP` 会带来证书和路由问题。必须先配置可用的 HTTPS 备用域名，再由网页选择。

## Cloudflare DNS 配置边界

本站使用 Workers Custom Domain 提供主站。主域名保留原配置；独立优选子域名最初仅提供 `/realtime/*`，整站选线接入后路由扩展为 `/*`，由同一 Worker 处理。将优选 IP 填入橙云 A 记录时，Cloudflare 对访客仍返回其分配的代理 IP，不能据此认定优选已经生效。

固定优选 IP 的 DNS-only 入口依赖 Cloudflare 边缘是否仍为该 Host 正确处理证书和 Worker 路由，属于需要实测的方案；官方 Workers Routes 要求代理 DNS 记录，因此不能承诺 DNS-only 与 Route 的组合长期可用。先在独立子域名测试，遇到 530、证书或 WebSocket 错误时保留主站回退，不把实验配置应用到主域名。Cloudflare 控制台若拒绝此组合，也不要通过修改主站规避。

部署后的验收必须用备用域名的**正常 DNS**连接，且 Origin 使用主站来源，再测试 ping 和双人建房/入房。只有 `--ip` 强制解析成功，还不能算网站访客自动获得优化。使用 DNS-only 时，不保留指向其他入口的 AAAA 记录，否则 IPv6 客户端可能走另一条线路。

## 房间位置

`locationHint: 'apac'` 已在现有房间路由中设置。Cloudflare 只在首次创建对象时考虑该提示，提示也不是固定机房承诺。修改提示不会迁移旧房间；不要为了反复测速提前遍历或创建所有房间对象。此次不修改对象 ID、绑定或存储，既有对局与留言数据保持兼容。

## 正常 DNS 验收记录

2026-11-06，独立联机域名的 A 记录配置完成后，使用系统 DNS、有效 TLS 证书和主站 Origin 重新测试，不使用强制 IP 或 hosts。台球同一房间预热后各采样 12 次：原入口经 LAX，中位数 389.77ms、最大 421.66ms；备用入口经 HKG，中位数 102.81ms、最大 150.64ms，中位数下降约 74%。结果仅代表当时测试网络，不代表所有运营商。

围棋、麻将、台球均通过两个不同域名创建/加入同一个房间、双向发送与读取事件及退出的公网协议检查；无关网站的 Origin 被拒绝，状态为 403。已确认线上发布的配置和适配脚本包含自动选线。检查使用两个测试客户端，没有完成真人双设备整局对战或真实浏览器 UI 验收。原始测量与协议检查保存在被忽略的 `artifacts/game-route-dns-verification.json` 和 `artifacts/game-cross-host-verification.json`。

参考：[CFST 使用说明](https://github.com/XIU2/CloudflareSpeedTest)、[Cloudflare 代理 DNS 行为](https://developers.cloudflare.com/dns/proxy-status/)、[Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)、[Durable Objects 位置提示](https://developers.cloudflare.com/durable-objects/reference/data-location/)。
