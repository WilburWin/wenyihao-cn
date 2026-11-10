# 独立游戏后端（准备阶段）

`server/game-server.mjs` 在普通 Node.js 服务器上运行围棋、麻将和台球的 WebSocket 房间。与 Cloudflare 复用 `worker/game-room.js`，消息协议、身份验证、麻将私密消息和房主接管保持一致。Cloudflare 的 `GameRoom` 导出、绑定和迁移记录保留。

该服务只负责联机，不包含网站、音乐接口或留言板。现有网页仍连接 Cloudflare；启动服务不会自动降低线上游戏延迟。

## 本地验证

使用 Node.js 24 和 npm：

```sh
npm ci
npm run games:server
node --test test/game-server.test.js test/rooms.test.js
```

默认监听 `127.0.0.1:8788`，健康检查 `GET /healthz`。房间地址为 `/realtime/<go|mahjong|billiards>/<三位房间号>`；WebSocket 要求匹配 `GAME_ORIGINS`，默认仅接受本地开发站点。可以通过 SSH 本地端口转发连接服务器内部的该端口进行测试，无需开放新的公网端口。

`node server/test-connection.mjs ws://127.0.0.1:8788 http://localhost:8787 --rooms` 可测量应用层往返时间，并实际建立三款游戏的双人测试房间。通过隧道测试时修改为本地转发端口。仅测延迟可省略 `--rooms`，不会创建房间。隧道测量包含 SSH 开销，不代表未来 HTTPS/WSS 公网连接的最终表现。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `GAME_HOST` | `127.0.0.1` | 监听地址，准备阶段保持本机 |
| `GAME_PORT` | `8788` | WebSocket 和健康检查端口 |
| `GAME_DATA_DIR` | `.game-data` | 房间持久化目录，不提交 Git |
| `GAME_ORIGINS` | 两个本地开发地址，端口 8787 | 允许的网页 Origin，英文逗号分隔 |

## Ubuntu 部署

先安装受支持的 Node.js 24，再将以下文件打包上传服务器：

```sh
tar -czf game-release.tar.gz package.json package-lock.json server worker/game-room.js test/game-server.test.js
```

解包安装脚本并以 root 运行；脚本安装生产依赖、执行真实 WebSocket 集成测试、建立专用低权限用户和 systemd 服务，然后检查健康状态。每次使用新的版本目录，旧版本保留。健康检查失败会恢复上一版本。安装器不会修改防火墙、SSH 或 DNS。

```sh
tar -xOf /tmp/game-release.tar.gz server/install-games.sh > /tmp/install-games.sh
bash /tmp/install-games.sh /tmp/game-release.tar.gz
systemctl status website-games --no-pager
journalctl -u website-games -n 50 --no-pager
curl http://127.0.0.1:8788/healthz
```

路径：程序 `/opt/website-games/current`，版本 `/opt/website-games/releases/`，数据 `/var/lib/website-games`，环境 `/etc/website-games.env`。备份数据时先 `systemctl stop website-games`，复制数据目录后重新启动。文件保存房间令牌和游戏状态，按私密数据处理。更新服务会断开连接；状态持久化可支持重连，不能保证重启后正在进行的对局完全无感恢复。

关闭服务：`systemctl disable --now website-games`。回退时将 `current` 符号链接指向保留的上一版本，再重启服务；不要删除房间数据。

## 上线前的连接切换

当前预算选择继续按流量计费。音乐音频目前由 Cloudflare 音乐 Worker 流式中转，ECS 仅运行内部游戏服务；迁移音乐到 ECS 前须先确定出站流量预算、并发限制和超额熔断，不能把纯音频界面误认为浏览器直连 B站。

大陆服务器上的公网服务须先完成适用的备案流程。准备阶段保持回环监听，通过 SSH 隧道测试。正式上线还需要域名、HTTPS/WSS 反向代理和相应网络规则；只有让玩家直连成都后端，才能实测相对 Cloudflare 的改善。流量按服务器套餐计费。

**不能直接把独立服务器加入当前的延迟择优候选。** 当前主域名和镜像域名共用同一个 Cloudflare Durable Object；每名玩家独立择优依然能进入同一房间。独立服务器保存另一份房间数据，若混入候选，不同玩家可能进入不同后端。正式切换需要统一指定所有玩家的房间后端，或实现能确定房间归属的调度。尚未实现该切换，网站的实时连接配置保持原样。

服务器按单进程运行，禁止以多个独立进程或副本共享同一数据目录。写入按房间顺序执行，通过临时文件重命名替换；暂不提供数据库级事务和跨机容灾。默认最多 256 个连接、256 个内存房间，空闲房间可卸载并从磁盘恢复。30 秒心跳清理失联连接，400 KB 入站消息上限，不启用压缩。
