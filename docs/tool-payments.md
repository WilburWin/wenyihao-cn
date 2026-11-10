# 工具按次收款

当前价格为 **0.50 元 / 文件下载地址授权**，由 Worker 固定计算，不采用浏览器传来的金额。朋友访问码继续保留免费使用。

## 使用流程

1. 没有访问码的人使用默认的“按次下载”入口。
2. 粘贴百度分享并导入，网页自动建立当前浏览器的订单会话，再选择其中一个文件。导入本身不收费，无需额外点击开启会话。
3. 点击“创建订单”，后端先验证文件能取得百度直链，再建立 0.50 元待支付订单。
4. 打开支付宝收银台付款。回到原网页查询到账结果，或由付款后的返回链接恢复订单。
5. 服务端收到并验证支付宝通知，或主动查询到已支付状态后，才交付百度地址。

一次授权对应一个文件；付款后 24 小时内，可为同一文件重取地址，失败重试不另收费。下载直达百度，站点无法统计百度 CDN 上实际发生了几次下载，也无法让已经签发的百度地址在点击一次后失效。界面不承诺固定速度或保证会员权益共享。文件变化、授权失效、网络风控等问题需人工处理；用户可凭订单号通过首页邮箱联系站长申请处理或退款。

游客只能查看其浏览器已经导入的目录，不能列出朋友共享目录，不能通过免费取链接口绕过订单。浏览器会话使用 7 天有效的 `HttpOnly; Secure; SameSite=Lax` Cookie；清除 Cookie、换浏览器或换设备后需凭支付宝账单联系站长恢复。切换到“我的订单”时自动读取记录，也可点击“找回订单”刷新。

## 当前开通状态

已完成页面、订单、签名回调、退款与取链权限的自动化测试，以及真实沙箱查询响应验签。用户选择跳过实际沙箱付款，并已确认正式环境付款与下载流程跑通。主站部署配置使用正式环境、公钥模式和 PKCS1，只有正式商家 PID、匹配私钥及支付宝验签公钥全部配置后，收款入口才启用。

需要在支付宝开放平台确认网页应用，并完成 AI 网页应用收款对应的产品开通与应用权限配置。当前接入统一使用 `alipay.trade.page.pay`，用于 PC 和手机浏览器。已有商家账号或证书不等于应用已经获得收款权限。

官方参考：[网站支付接入指南](https://aipay.alipay.com/docs/vibe-pay/ai-web-app-payment-qianyi/ai-web-app-payment-integration-guide.html)、[支付宝官方 Node.js SDK](https://github.com/alipay/alipay-sdk-nodejs-all)。使用官方 `alipay-sdk` 的签名、通知验签与响应验签；边缘 HTTP 传输使用 Workers 原生 `fetch`，不调用 SDK 的 Node HTTP 客户端。

## 商户应用配置

本实现支持 RSA2 公钥证书模式和普通公钥模式，必须与应用控制台一致。当前正式应用按最新提供的普通公钥配置接入，不沿用之前其他应用的三份证书。应用私钥仅存主站 Worker Secret；公钥或证书都不包含应用私钥。不接受个人收款码截图作为自动到账凭据。

在**主站 Worker** 中配置以下值，避免误填到独立音乐 Worker：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `ALIPAY_APP_ID` | Secret | 网页应用 APPID |
| `ALIPAY_SELLER_ID` | Secret | 收款商家 PID，2088 开头 |
| `ALIPAY_PRIVATE_KEY` | Secret | 应用私钥，默认 PKCS8 格式 |
| `ALIPAY_SIGN_MODE` | 文本变量 | 证书模式填写 `certificate`；普通公钥模式为 `public-key` |
| `ALIPAY_APP_CERT` | Secret | 应用公钥证书的完整 PEM 内容 |
| `ALIPAY_PUBLIC_CERT` | Secret | 支付宝公钥证书的完整 PEM 内容，保留证书链 |
| `ALIPAY_ROOT_CERT` | Secret | 支付宝根证书 PEM 内容；超过单变量限制时，在证书边界分段 |
| `ALIPAY_ROOT_CERT_2` | Secret | 可选，根证书包的后半段，代码按原顺序拼接 |
| `ALIPAY_PUBLIC_KEY` | Secret | 仅普通公钥模式使用的支付宝公钥，证书模式不需要 |
| `PAYMENT_SITE_ORIGIN` | 文本变量 | 主站的规范 HTTPS 来源，如 `https://example.com`，不含路径 |
| `ALIPAY_ENV` | 文本变量 | `sandbox` 或 `production`，两套应用与密钥不可混用 |
| `ALIPAY_KEY_TYPE` | 文本变量 | 可选，默认 `PKCS8`；实际为 PKCS1 时填 `PKCS1` |
| `TOOLS_PAYMENT_ADMIN_KEY` | Secret | 可选，独立的至少 32 字符运维凭证，仅用于服务端关单及退款，不能使用朋友访问码 |
| `TOOLS_PAYMENT_ENABLED` | 文本变量 | 完成联调后才填 `true`，缺省关闭 |

不要把实际私钥、支付宝账号、证书或订单数据写入 Git、前端代码或聊天记录。配置与正式联调尚未完成时，按钮显示“收款尚未开通”，原有朋友访问码下载正常使用。`/api/tools/payments/config` 只返回开关、价格和沙箱标记，不暴露商户配置。

生产私钥由站长自行填写到 Worker Secret，不向 Agent 提供私钥正文或文件。支付表单使用当前安装的支付宝官方 SDK `pageExec(..., 'POST', ...)` 生成；付款入口是本域 `/api/tools/payments/checkout?id=...`，核对浏览器订单归属后渲染并提交到固定的支付宝网关。手机与电脑共用此接口，不按屏幕宽度切换其他支付产品。

支付跳转页的 CSP `form-action` 同时允许 HTTPS 支付宝官方子域和本网站的返回来源。实际正式收银台链路会经过 `openapi.alipay.com` → `unitradeprod.alipay.com` → `excashier.alipay.com`；Chromium 还会检查表单后的重定向，只允许网关一个域名会让页面一直停在“正在前往支付宝”。沙箱额外允许 `*.alipaydev.com`，生产不开放此范围；页面提供手动提交按钮，仍使用原订单和原签名表单。

## 正式环境切换

本站代码使用 `ALIPAY_*`，而 AI 付页面导出使用 `AIPAY_*`，不能直接把导出字段名填到 Worker 中。

| 页面导出字段 | 主站 Worker 对应字段 |
| --- | --- |
| `AIPAY_APP_ID` | `ALIPAY_APP_ID` |
| `AIPAY_ALIPAY_PUBLIC_KEY` | `ALIPAY_PUBLIC_KEY`，用于支付宝响应和通知验签 |
| `AIPAY_PRIVATE_PKCS_KEY` | `ALIPAY_PRIVATE_KEY`，Node.js 使用匹配的 PKCS1 正式私钥 |
| `AIPAY_PUBLIC_KEY` | 应用公钥，仅用于核对私钥配对，不作为支付宝验签公钥 |

正式收款商家的 PID 单独配置为 `ALIPAY_SELLER_ID`，不能使用沙箱买卖家 UID。部署变量 `ALIPAY_ENV=production` 选择 `https://openapi.alipay.com/gateway.do`；主站规范来源生成 `/api/tools/payments/notify` 和 `/tools/?payment_order=...`，不需要在前端填写回调地址。Git 仓库不保存真实 APPID、公钥或私钥，正式应用配置通过主站 Worker Secret 保存。

Cloudflare 控制台：Workers 和 Pages → 主站 Worker → 设置 → 变量和机密 → 添加。正式私钥的变量名为 `ALIPAY_PRIVATE_KEY`，类型选 Secret，内容填写同一正式应用的非 Java 私钥原文，不填写说明或占位符。保存并部署；如界面只保存了配置，则从项目执行 `npm run deploy:site` 或重新触发主站构建。只修改音乐 Worker 不会更新收款配置。

配置后查看 `/api/tools/payments/config`：`sandbox=false` 表示正式环境，`configured=true` 表示所需字段齐备，`enabled=true` 表示入口启用。这些状态不代表已经验证真实付款或完成支付宝产品签约。正式环境不会读取 `.wrangler/alipay-sandbox/`；不要把沙箱私钥复制到正式配置。

SDK 会从证书内容计算 `app_cert_sn` 和 `alipay_root_cert_sn`，并提取支付宝验签公钥，无需手动填写序列号或另行索取支付宝私钥。Workers 不通过本机磁盘路径读取证书，而从受控绑定加载 PEM 内容。根证书包可能超过 Workers 单个变量 5 KB 限制，可按完整证书块拆入 `ALIPAY_ROOT_CERT` / `ALIPAY_ROOT_CERT_2`，不删除任何证书。证书和私钥不会进入公开资源目录。

上线还需确认：实际 APPID、收款商家 PID、应用上线状态、电脑网站支付签约及应用权限、证书所属正式/沙箱环境，以及匹配私钥的安全存储位置。证书生成成功不等于支付产品已开通。证书模式已使用公开证书在 workerd 中验证解析和序列号生成；完整签名回调另用临时 RSA 测试密钥验证，尚未用真实商户私钥或真实资金联调。

异步通知地址为：

```text
https://<主域名>/api/tools/payments/notify
```

同步返回地址由服务器生成：

```text
https://<主域名>/tools/?payment_order=<商户订单号>
```

`PAYMENT_SITE_ORIGIN` 应对应实际主域名。支付、Cookie 与回调始终使用此域名，不使用测速镜像、IP 地址或第三方跳转。回调不要求浏览器 Cookie 或 Origin，使用 RSA2 验签；浏览器订单写请求必须同源。

本地联调可使用现有 HTTPS 测试域名连接测试 Worker，配置沙箱 APPID/密钥后使用支付宝沙箱账号。不要把假密钥部署为生产配置，也不要为测试暂时关闭验签。确认真实沙箱的支付、通知、主动查询、页面返回和取链流程后，再切换生产应用并进行小额验收。

## 本机沙箱预览

本机启动命令为 `npm run payments:sandbox`，默认入口 `http://localhost:8791/tools/`，仅监听回环地址。配置从 `.wrangler/alipay-sandbox/secret-bindings.json` 读取，使用上表对应的 `ALIPAY_*` 字段，必须明确 `ALIPAY_ENV=sandbox`、`ALIPAY_KEY_TYPE=PKCS1`。该目录由 Git 忽略，实际密钥和测试账号不进入文档、代码或构建产物。Windows 应限制配置目录和文件仅当前用户可访问。

需要测试真实文件订单时，使用 `npm run payments:sandbox -- --bridge-config <本机下载私有配置路径>`。私有配置只需已有的 `accessCode`；程序从当前站点 Wrangler 配置确定共享文件接口来源，通过后端访问原有目录和分享导入接口，浏览器不会收到访问码。文件和下载内容仍直达百度，不由本机预览或 ECS 中转。

沙箱使用独立的本地 Durable Object 订单库，真实调用支付宝沙箱网关，不更新线上收款配置。仅沙箱允许 HTTP localhost/回环地址和本地端口；生产仍强制规范 HTTPS 域名。localhost 无法接收支付宝服务器通知，因此本机下单不发送 `notify_url`，由服务端主动查询及后台恢复确认状态，所有付款、订单归属和响应验签检查保持有效。浏览器完成付款后回到同一 localhost 地址查询订单。

将 AI 付页面资料映射到本站时注意：`AIPAY_PRIVATE_PKCS_KEY` 是 Node.js 使用的私钥；`AIPAY_ALIPAY_PUBLIC_KEY` 才是本站 `ALIPAY_PUBLIC_KEY` 的验签来源。页面中的 `AIPAY_PUBLIC_KEY` 是商户应用公钥，仅用于核对密钥对，不能代替支付宝公钥。取得接口的“订单不存在”响应只证明查询接口返回了业务结果，不代表响应验签或完整付款流程已通过。

自定义 Workers 请求传输仍遵循官方 SDK 的 `formatUrl` 规则：网关公共参数（包括 `charset=utf-8`）放入 URL，业务参数放入表单请求体。仅把编码参数放在请求体中，实际沙箱可能返回 GBK，导致中文被 UTF-8 解码后验签失败。响应会核对编码并验签，包括“交易不存在”的业务错误；不能通过更换密钥或关闭验签处理编码问题。SDK 同步签名调用过滤其调试日志，避免 workerd 默认启用的 `util.debuglog` 打印完整支付签名。

## 订单与交付

- 复用已有 `DOWNLOADS` Durable Object 存储，无需新建数据库或修改既有游戏迁移。
- 下单先写待支付记录再生成支付 URL；同一浏览器同一文件的重复下单优先复用未过期订单或仍可重试的已付订单。
- 待支付订单有效期 15 分钟，支付宝请求使用对应的绝对到期时间。建立新订单前，先向支付宝核对旧的过期订单，必要时关闭旧交易，避免尚未确认旧支付就再次收费。
- 通知先验 RSA2，再核对 APPID、收款 PID、订单号、金额和交易号。支付宝交易号不能绑定到另一订单。只有 `TRADE_SUCCESS` / `TRADE_FINISHED` 才能交付，浏览器提交 `paid: true` 或跳转到返回页均无效。
- 主动查单校验支付宝原始响应签名；每个订单至少间隔 10 秒查询上游。前端自动查询最长约 90 秒，之后可手动查询。Durable Object 的 alarm 在浏览器关闭后继续恢复未决订单和退款，每批至多处理 10 笔；查询失败保留记录等待重试，不生成新收费订单。
- 交付仅返回该订单绑定文件的 HTTPS 百度直链；失败不消耗额外机会，成功后的地址短暂缓存 10 分钟，24 小时内可重新获取。不会回退到 ECS 文件中转。
- 退款类通知即使携带 `TRADE_SUCCESS` 也不标记为付款成功；签名有效的退款通知会撤销后续取链，但无法撤销已经交付的百度 CDN 地址。暂停新收款后仍接收有效通知，保留已付款订单的查单和取链能力。
- 会话与订单不缓存到公开静态文件。订单和交易映射保留 180 天，作为交付与人工核对记录；现有 Durable Object 定时清理过期记录。上线后应安排受控备份和后续对账导出。

## 受保护的关单与退款接口

默认没有公开运维页面。可在支付宝商家平台人工退款，也可由站长使用以下 POST 接口，必须携带独立的 `Authorization: Bearer <TOOLS_PAYMENT_ADMIN_KEY>`，不能把该凭证放到浏览器网站代码或 URL：

| 路径（前缀 `/api/tools/payments/`） | 请求内容 | 用途 |
| --- | --- | --- |
| `admin/order` | `id` | 查看指定订单状态 |
| `admin/close` | `id` | 先查单，仅关闭未付款交易 |
| `admin/refund` | `id`, `amountCents: 50` | 对已付款订单全额退款 |
| `admin/refund-status` | `id` | 使用原退款号查询结果，至少间隔 10 秒 |

本工具只提供每笔 0.50 元订单的全额退款，不接受超额或部分退款。发送前先持久化退款号和金额；同一订单重试不会再次发起退款。未知结果由原退款号查询确认，期间暂停取链。只有核对原交易、订单、金额，且 `fund_change=Y` 或退款查询 `refund_status=REFUND_SUCCESS` 后才确认完成。没有得到确定成功结果时保留待确认状态；人工在商家平台操作前应先核对原记录。测试使用本地模拟响应，不主动发起生产退款或关单。

## 验收范围

单元测试使用动态生成的 RSA 密钥验证官方 SDK 的请求签名和通知验签；包含伪造通知、错误金额/APPID/PID、重复通知、并发下单、游客目录隔离、未付款取链、订单归属、暂停收款、退款与重取期限。浏览器测试使用模拟支付宝，覆盖从导入到下单、交付失败后免费重试、恢复订单以及手机布局。**这些不替代真实商户沙箱和生产验收。**

本机沙箱已通过浏览器实测：使用现有共享文件服务导入文件、建立独立本地订单、保存安全会话、恢复订单、拒绝未付款取链，手机布局无横向溢出。支付宝真实接口响应验签及实际付款须单独完成；接口可达或本地下单成功均不算付款验收通过。
