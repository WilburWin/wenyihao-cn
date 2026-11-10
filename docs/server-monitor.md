# 公开运行观测台与月度出站保护

入口 `/admin/`，无需登录，无操作按钮。名字虽然使用 admin 路径，实际只提供公开状态；它不是服务器管理面板。页面每分钟读取约数 KB 的 Cloudflare 汇总数据，后台标签页暂停轮询。

## 展示和隐私

- 展示 CPU、内存、磁盘、运行时间、出站流量、额度、游戏服务状态、连接和内存房间数量。
- 不展示服务器 IP/主机名、所有者姓名和账号、访问日志、游戏玩家/房间编号、任何密钥、通知凭据或计费账号。
- 访客表使用 IPv4 /24 或 IPv6 /48 前缀，例如 `123.45.67.*`、`2001:db8:abcd::*`，并显示大致出口城市；不公开完整 IP，不关联留言、账号或访问路径，不设置追踪 Cookie。
- 城市来自 Cloudflare 请求元数据，出口与实际所在地可能不同。最多保留 500 个近 24 小时的网络/城市条目，对外返回最近 40 条。同一网络同一城市一分钟最多记一次。它是页面访问观察统计，不是精确 UV/PV，也不保证识别机器人。
- 原始 IP 仅用于当次请求脱敏，不写入本项目的持久存储。Cloudflare 自身的基础设施日志不在此承诺范围内。
- UI 和 API 均不提供重启、解封、执行命令或读取日志功能。上报密钥仅用于服务器上传白名单数据，不提供远程控制能力。

## 数据流

ECS 的 `server/monitor.py` 每分钟读取 Linux 本机状态，向 Cloudflare 主域名 `/api/status/ingest` 推送白名单快照；使用独立随机 `SERVER_STATUS_TOKEN` 授权。Cloudflare `ServerStatus` Durable Object 保存快照和最多 60 个历史点。`GET /api/status` 提供公开只读数据，短时缓存 30 秒。超过三分钟未更新会标记过期，不将旧数据当作在线证明。

因此当前无需等待主站迁到 ECS，就可从现有主站查看。ECS 只发少量采样上传，页面访客轮询不直接请求 ECS。此次未改 DNS、未开放新的 ECS 公网端口。

搬家时要保留 Cloudflare 状态接收入口、更新 `STATUS_PUSH_URL`，并在 ECS 主站接入公开状态读取与访客统计。现阶段 `/api/status/visit` 仅依赖 Cloudflare 的可信连接 IP 和城市元数据，不能在 ECS 直接信任客户端伪造的 `CF-Connecting-IP`。不要将目前的 `admin` 静态页孤立复制后误以为接口也迁好了。

## 统计口径与 1 GB 月额度

按北京时间自然月，1 GB = 1,000,000,000 字节。`eth0` 网卡 TX 包括 SSH、后台请求、监控推送、游戏和未来网站响应，也可能包含阿里云不计费的内网流量。它是偏保守的保护统计，不是云账单，不能保证云端精确费用上限。Cloudflare 音乐数据不通过 ECS，不计入本机统计。

首次接入若本次开机属于本月，就纳入本次开机累计 TX；否则从接入时开始，明确统计覆盖时间。无法恢复接入前已丢失的重启历史。计数每分钟持久化，正常重启后继续累计；突然掉电最多可能遗漏最近一个采样间隔的数据。跨日/月边界的一分钟增量近似归入新周期。重启不应被当作清零额度的方法。

80% 发月度预警，100% 触发网站响应保护。nftables 独立 `inet website_budget` 表在内核输出链按总出站累计配额，达到配额立即丢弃公网接口源端口 80、443、8788 的 TCP 响应和 443 UDP 响应。脚本保存保护状态以便重启恢复。SSH、主动发起的系统/API/微信请求及云代理不在丢弃列表；它们仍可产生少量出站。因此这不是全部公网流量或全部账单的硬封顶，也不防止被入侵程序换端口产生流量。

只管理自己的 nftables 表，不清空其他防火墙规则。达到额度会影响今后的 ECS 网站和游戏，不影响 Cloudflare 主站/音乐；当前游戏后端仅回环监听，现有公网游戏仍在 Cloudflare。下月第一次采样重置额度并解除本表限制。月内恢复要由服务器管理员经 SSH 核实并调整配置，不在公开页面提供按钮。

不通过改公网带宽为 0 来熔断，避免回收公网 IP。没有额外购买固定带宽、监控套餐或其他云产品。

## 微信通知

SendKey 从 root-only `/etc/website-monitor.env` 读取，不写入仓库、网页、快照或日志。使用用户已确认的 Server酱 Turbo 通道，仅发送服务器统计和状态；不推送完整访客 IP。

- 每天北京时间 22:00 后发送一条日报；若有更紧急告警或通知间隔限制，日报可延后。
- 月度 80% 预警、100% 保护各成功发送一次；近五分钟出站超过 50 MB 可触发每天一次异常提醒。
- 普通通知最多四次发送尝试/日，保留第五次给保护或手动测试；失败也计入尝试，避免重试风暴。普通通知间隔至少一小时，保护至少一分钟，成功后不重复。
- API 返回 `code=0` 只代表服务商接受，不能证明微信已收到；不将通知成功作为熔断前提。
- `TRAFFIC_PRICE_PER_GB` 未填写时显示“暂不估算”。不能使用未经核对的默认价格给出虚假账单。

## 配置、验收与回退

Python 3.10+，Linux 的 `/proc`、`/sys` 和 nftables；无需 pip 依赖。部署脚本、systemd 文件和环境示例位于 `server/`。将示例复制为 `/etc/website-monitor.env`，填写密钥与入口，权限 600。

```sh
python3 /opt/website-monitor/monitor.py --check-guard
python3 /opt/website-monitor/monitor.py --test-notification
systemctl status website-monitor.timer --no-pager
journalctl -u website-monitor -n 20 --no-pager
nft list table inet website_budget
```

环境文件、状态 `/var/lib/website-monitor/state.json` 和 `public.json` 都不能直接通过静态目录发布，后者也应经白名单上报接口发布。Cloudflare 上报密钥与 ECS 配置需一致。已发送成功的测试消息会去重。

完全撤销本地保护和采集：

```sh
systemctl disable --now website-monitor.timer
systemctl stop website-monitor.service
nft delete table inet website_budget
```

只有停 timer 不会移除已安装的内核规则。保留数据以便恢复，不随意删除统计文件。Cloudflare 监控页离线后会显示采样过期。

将来安装 Nginx 时须保证保护服务成功后才开放 Web 监听，并测试开机顺序；本次 ECS 未安装 Nginx、未开放 Web 端口。没有实现公网可达性独立探测，不能将游戏进程健康检查等同于用户能访问。
