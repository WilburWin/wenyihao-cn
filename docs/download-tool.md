# 网盘下载工具

入口 `/tools/`，导航位于音乐与留言板之间。

## 使用

1. 所有者将文件放入百度网盘专用的 `/网站分享` 目录，可以建立子文件夹。目录缓存为一分钟，刚放入文件时稍后刷新。
2. 朋友打开工具页，选择“朋友入口”，输入分享者交付的本站访问码，可在“文件列表”直接选择文件，也可在“导入链接”整段粘贴百度分享文字，点击“解析并转存”。本站访问码与百度四位提取码不同。
3. 导入功能验证分享后，在百度云端转存到 `/网站分享/链接导入/share-<分享标识哈希>`。单文件自动准备下载地址，多文件和目录在文件区选择。支持 `/s/1…` 与 `/share/init?surl=…`；旧式 `/share/link` 需先在百度取得新式分享链接。
4. 选择直接下载、复制地址，或复制 Windows 下载命令到 PowerShell 执行。

工具页采用整屏工作台，切换“导入链接 / 文件列表 / 我的订单”完成操作。文件及订单列表按可用高度分页，不将所有条目堆成长页面；支付、下载地址及分享详情使用弹窗。手机端的两种使用方式位于工作区上方。

下载地址带时效签名，过期后重新获取。浏览器跳转不能修改 `User-Agent`；若百度拒绝浏览器请求，可使用页面生成的命令，或在下载工具设置 `User-Agent: pan.baidu.com`。不保证所有浏览器零配置下载，也不承诺固定速度或会员权益共享，以实际下载结果为准。

导入会占用所有者的百度网盘空间，没有自动删除机制。相同分享根据名称、类型及文件大小核对导入目录，优先复用，不同步后续改动；不递归核对目录中的每个文件。浏览器不能指定转存目的地，所有写入限定在配置的“链接导入”目录。转存使用同名冲突失败模式，不覆盖已有文件。每次最多读取分享根目录 100 项，超出时请缩小分享范围。

转存串行执行。提交前保存待确认记录，网络中断或百度仍在处理时显示“结果尚待确认”，不会立即重复提交；稍后重新点击会先核对目的目录。待确认保护期为十五分钟，之后仍使用同名冲突失败模式。错误提取码、失效链接、额外验证码、空间不足及授权失效均返回对应提示，不自动反复请求百度。

访问码只保留在当前页面内存，不放在 URL、浏览器存储或 Git；刷新页面后需重新输入。文件列表、直链与接口响应不缓存。转发已取得的直链仍可能让他人在有效期内下载，退出页面不能撤销百度已经签发的地址。

另有 [0.50 元按次订单入口](tool-payments.md)，正式收款默认关闭；开通并配置支付宝商户应用后可启用。付费游客使用独立 Cookie 会话，只能查看自己导入的目录和订单，不拥有朋友共享目录的浏览权限。原有朋友访问码继续免费使用。

## 数据流与流量

```text
朋友浏览器 → Cloudflare Worker → DownloadBridge Durable Object
                                      ↑
                      ECS 主动建立的已认证加密 WebSocket
                                      ↓
                         ECS 元数据代理 → 私有 AList → 百度 API
                               └──────→ 百度 OAuth 云端转存 API

朋友浏览器/下载工具 ─────── 文件内容 ─────── 百度 CDN
```

下载工具的 ECS 和 Cloudflare 接口均不请求文件内容，没有文件中转或失败后自动中转。ECS 仍产生少量元数据、连接心跳与更新检查流量。此说明不改变音乐板块原有的 Cloudflare 音频中转。

无需新增 DNS 或开放 ECS Web 端口。AList 只监听 `127.0.0.1:5244`，管理后台通过 SSH 隧道访问。本实现不公开 ECS 网站端口。

## 服务与配置

- AList 服务 `website-alist`，版本 3.66.0，程序 `/opt/website-alist/current/alist`，数据库 `/var/lib/website-alist`。Web 代理关闭、下载代理 URL 为空、WebDAV 为 `302_redirect`；游客和附加协议关闭。
- 存储根目录固定为分享目录，元数据代理再次限制到一个指定挂载。
- 独立只读 AList 角色：使用 `permission_scopes` 限制绝对路径，禁止上传、删除、管理与其他路径读取。3.66.0 不能仅依赖用户表的 `base_path` 做目录隔离。
- 下载服务 `website-download-agent`：非登录用户 `website-downloads`，无监听端口；内存上限 160 MiB，CPU 为单核 30%。
- 私有配置 `/etc/website-downloads/config.json`：目录 750、文件 640，root 与服务组可读；包含站点地址、桥接密钥、挂载路径和只读用户凭据，没有管理密码或百度原始令牌。
- 转存授权另存 `/etc/website-downloads/baidu-import.json`（640，root:服务组），由一次性配置脚本从已有 AList 挂载读取 OAuth 授权，网页不接触管理员凭据、令牌或 Cookie。OAuth 授权自身并非目录级权限；导入范围由代理代码和 root 所有的配置共同限定。
- `/var/lib/website-downloads` 由 systemd `StateDirectory` 创建，700、服务账号所有；保存刷新后的 OAuth 授权和最近 200 条导入记录。记录损坏时停止导入，避免丢失待确认状态后重复写入。备份与迁移时将其视为凭据文件。
- 主站 Secret `DOWNLOAD_BRIDGE_KEY`：连接与读取版本；`DOWNLOAD_ACCESS_CODE`：朋友访问。两者必须不同，不写入公开配置或前端。
- Worker 增加 `DOWNLOADS` 绑定与 `v4-download-bridge` 迁移，保留既有迁移。

接口只允许列目录、取地址和导入分享，不提供删除、移动或任意目的地写入。路径拒绝父目录、反斜线、百分号编码和控制字符；直链只接受 HTTPS 百度域名，拒绝账户令牌参数。分享验证只请求百度固定域名，拒绝跳转到任意其他主机。网页请求必须同源 POST 并携带访问码。每个 IP 哈希桶每小时最多 180 次请求；全站授权文件请求合计每天最多 2000 次。窗口从首次请求计时；这些额度不等于云厂商账单硬上限。

## GitHub 自动更新

Workers Git 构建保持以下设置：

| 配置 | 值 |
| --- | --- |
| 构建命令 | `npm run check` |
| 部署命令 | `npm run deploy` |

部署脚本从 `server/download-agent.mjs` 生成 `public/_backend/` 源代码与 SHA-256 清单，再按现有顺序更新音乐和主站。生成目录被 Git 忽略；`/_backend/*` 强制进入 Worker 返回 404，不能将它改为公开静态目录。

`website-download-update.timer` 每五分钟通过带密钥的 `/api/tools/agent-release` 读取版本。更新器校验 SHA-256，以非特权账号执行 `node --check`，安装 root 所有的版本文件，原子切换链接并重启。启动失败时恢复上一版本；网络或校验失败则保留当前版本。可信来源是 HTTPS 站点部署权限，哈希用于检测传输完整性。

正常修改网页、Worker 或代理源代码后推送 GitHub 即可更新，不需再次 SSH。**首次安装、调整系统服务或更新器本身、变更凭据或目录角色，仍需服务器管理操作。** 本地预览不连接生产 Durable Object；可以单独启动测试代理或模拟接口。

## 新服务器复现

先安装私有 AList、挂载专用分享目录，创建独立只读角色与用户。验证管理接口、写操作与其他目录均被拒绝。为主站添加两个随机 Secret，再安全交付以下私有配置，禁止提交 Git：

```json
{
  "origin": "https://example.com",
  "bridgeKey": "与 DOWNLOAD_BRIDGE_KEY 相同的随机密钥",
  "mountPath": "/专用挂载",
  "username": "独立只读用户",
  "password": "只读用户随机密码"
}
```

把 `server/install-downloads.py`、`download-agent.mjs`、`download-update.py` 及三个 `website-download-*` systemd 文件上传到同一 root-only 安装目录，执行：

```sh
python3 install-downloads.py /root/private-download-config.json
```

需要分享导入时，将 `configure-share-import.py` 一并上传。在 `/etc/website-alist-admin.json` 安全保存 AList 管理配置（`url`、`username`、`password`），权限 600；挂载根目录应为 `/网站分享`。然后执行：

```sh
python3 configure-share-import.py
systemctl restart website-download-agent
```

配置脚本不会打印授权；仅保存既有 OAuth 授权，不要求提供浏览器 Cookie。系统服务必须使用仓库中包含 `StateDirectory=website-downloads` 的版本，首次启用需安装单元并 `systemctl daemon-reload`。重新运行安装器会保留已有的 `importAuthFile`、`importStatePath` 配置。

需要系统 Node.js 24、Python 3、systemd。安装器会更新已有下载代理配置，操作前先备份；不能把安装目录或私有配置放在网站目录。新站采用示例配置时，先生成版本文件：

```sh
node --input-type=module -e "import {prepareDownloadAgent} from './scripts/prepare-download-agent.mjs'; await prepareDownloadAgent()"
npx wrangler deploy --config config/wrangler.example.jsonc
```

## 检查与恢复

```sh
systemctl is-active website-alist website-download-agent website-download-update.timer
journalctl -u website-download-agent -n 20 --no-pager
systemctl start website-download-update.service
systemctl status website-download-update.service --no-pager
```

日志只记录连接状态和通用错误，不记录百度原始响应、直链或凭据。停止后端：

```sh
systemctl disable --now website-download-update.timer website-download-agent
```

不会删除文件、AList 数据或授权。管理隧道：

```powershell
.\scripts\alist-tunnel.ps1 -ServerHost <服务器地址> -IdentityFile <本机私钥路径> -KnownHostsFile <已核验主机公钥文件路径>
```

隧道开启时打开 `http://127.0.0.1:15244/@login`。验证应覆盖错误访问码、目录边界、取链、客户端直连百度与自动更新。小文件验证不能代替大文件、不同网络、续传和速度测试。

## 本次验收（2026-11-10）

共享目录列表、访问码、越界路径、私有版本资源与自动更新已通过实测。导入示例在百度云端转存成功；公网浏览器再次粘贴分享后复用现有文件、打开导入目录并自动取得直链，客户端直接向百度发起 Range 请求，得到 HTTP 206 和完整的 27,131 字节测试文件。新版代理经更新器安装，运行版本 SHA-256 与源码一致。110 项 Node 测试通过，覆盖同名冲突参数、重复提交、网络结果不确定、重启后待确认保护和损坏记录停止写入；浏览器模拟测试另覆盖读取失败提示及键盘操作。真实浏览器无脚本错误，390 像素宽度无横向溢出。小文件验收不证明大文件和所有网络的速度或普通浏览器下载兼容性。
