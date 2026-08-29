# 微信支付充值接入

## 当前实现的真实链路

适用于 Windows 桌面端的微信支付 Native 扫码支付：

1. 桌面端读取 `GET /v1/billing/packages`。
2. 用户选择套餐，调用 `POST /v1/billing/orders`。
3. 后端创建本地 `PaymentOrder`，签名请求微信支付 Native 下单，返回 `codeUrl`。
4. 桌面端将 `codeUrl` 生成为二维码，供用户微信扫码。
5. 微信支付向 `/v1/billing/wechat/notify` 发出异步通知。
6. 后端验证通知 RSA 签名、解密 API v3 资源、核验 AppID、商户号、订单号和金额。
7. 在同一个 PostgreSQL 事务中，将订单更新为 `SUCCESS` 并写入额度账本 `CREDIT`。
8. 桌面端轮询 `GET /v1/billing/orders/:id`，成功后刷新 `GET /v1/quota`。

重复通知、用户轮询查单、人工重试均使用 `outTradeNo` 和账本幂等键 `payment:<outTradeNo>`，不会重复增加额度。

## 已提供 API

- `GET /v1/billing/packages`
- `POST /v1/billing/orders`
- `GET /v1/billing/orders/:id`
- `POST /v1/billing/orders/:id/close`
- `POST /v1/billing/wechat/notify`（仅供微信支付服务器调用）

## 云端环境变量

不要把以下内容发进聊天，也不要放进 U 盘或桌面端代码：

```env
WECHAT_PAY_ENABLED=true
WECHAT_PAY_APPID=
WECHAT_PAY_MCHID=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY_B64=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_PLATFORM_SERIAL_NO=
WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64=
WECHAT_PAY_NOTIFY_URL=https://你的公开HTTPS地址/v1/billing/wechat/notify
QUOTA_PACKAGES_JSON=[]
```

`WECHAT_PAY_PRIVATE_KEY_B64` 和 `WECHAT_PAY_PLATFORM_PUBLIC_KEY_B64` 应分别为 PEM 文件内容进行 Base64 编码后的结果，不是文件路径。

## 商户侧需要准备

- 已绑定商户号的 AppID；
- 商户 API 证书序列号和商户私钥；
- API v3 密钥（32 字节）；
- 微信支付平台证书/公钥与对应的平台证书序列号；
- 已开通 Native 支付能力；
- 一个可被微信服务器访问的公开 HTTPS `notify_url`。

虽然桌面软件和 U 盘本身不需要域名，但微信支付的服务端通知必须访问公网 HTTPS 地址。建议为云服务器配置一个稳定域名和证书；只用裸 IP 会让证书、变更和运营都更脆弱。

## 套餐配置示例

金额单位为分，`credits` 是用户可用的创作额度，不等于模型 API token：

```json
[
  {"key":"starter","name":"100 创作额度","credits":100,"amountFen":990},
  {"key":"creator","name":"500 创作额度","credits":500,"amountFen":3990}
]
```

将以上 JSON 压成一行写入 `QUOTA_PACKAGES_JSON`。价格和赠送额度必须由你们确认后再写入生产环境。

## 任务消耗与支付的联通原则

- 支付成功：额度账本写入 `CREDIT`。
- 用户开始生成：服务端预留 `RESERVE`。
- 生成成功：服务端结算 `DEBIT`。
- 生成失败或用户取消：服务端释放 `RELEASE`，用户不被扣除。

当前六大视频类型的自动工作流和定价规则尚未提供，因此**不要让生产客户端自行提交可扣除的 `credits` 数字**。最终应由服务端根据“视频类型、时长、画幅、素材数量、工作流版本”等参数生成不可篡改报价，再允许创建任务与预留额度。

当前后端已默认拒绝客户端直接提交任务扣费额度（`ALLOW_CLIENT_TASK_CREDITS=false`）。这是为了防止篡改请求绕过真实扣费；等你提供六大工作流与定价规则后，将替换为服务端报价单机制。
