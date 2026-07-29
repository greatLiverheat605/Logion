# 阿里云邮件推送接入与预发布验收手册

> 适用范围：Logion 个人及最多 10 人受邀协作部署。
>
> 文档状态：`0.1.0-rc2` 预发布候选操作基线。
>
> 安全原则：只发送身份事务邮件，不保存长期 AccessKey，不记录邮箱、令牌或正文。

## 1. 实现边界

邮件 Worker 当前投递三类邮件：

- 邮箱验证；
- 密码找回；
- 密码找回完成或失败上限触发的安全通知。

Workspace 邀请 Token 仍由 Owner 通过可信渠道一次性交付。系统不会声称已经发送邀请邮件；
受邀者启动注册后，邮箱所有权确认邮件才由阿里云邮件推送发送。

投递链路如下：

```text
API 数据库事务
  -> 加密 email_outbox
  -> Worker 领取租约
  -> ECS RAM 角色获取短期凭据（仅 IMDSv2）
  -> ACS3-HMAC-SHA256 签名
  -> HTTPS SingleSendMail
  -> 成功/终止后清空 Outbox 密文
```

邮件链接把一次性 Token 放在 URL fragment：

```text
https://<APP_DOMAIN>/auth/verify#<TOKEN>
https://<APP_DOMAIN>/auth/recover#<TOKEN>
```

Fragment 不会发送给 Web 服务器。确认和找回仍必须由浏览器页面通过可信 Origin 的 POST
完成，邮件扫描器访问链接不会改变账户状态。

## 2. 为什么不使用长期 AccessKey

ECS RAM 角色由阿里云元数据服务签发短期凭据，Worker 自动刷新。这样无需把 AccessKey ID、
AccessKey Secret 或临时 Security Token 写入 `.env`、Compose、镜像、Git 或运维记录。

本实现使用阿里云官方 `alibabacloud-credentials` 凭据组件，并自行按官方 ACS3 规范签名
`SingleSendMail` 请求。没有使用旧版 DirectMail SDK，原因是该 SDK限制 `cryptography <49`，
而 Logion 的加密安全基线要求 `cryptography >=49`。不得为安装邮件 SDK 而降低核心加密库。

## 3. 阿里云控制台准备

### 3.1 发信域名与地址

在阿里云邮件推送控制台完成：

1. 添加专用发信域名，例如 `mail.<ROOT_DOMAIN>`；
2. 按控制台当前给出的值添加 SPF、DKIM、域名所有权和回信地址 DNS 记录；
3. 建议同时配置 DMARC，从 `p=none` 观察开始，确认正常后再收紧；
4. 等待控制台全部显示验证通过；
5. 创建事务邮件发信地址，例如 `no-reply@mail.<ROOT_DOMAIN>`；
6. 发件人名称设置为 `Logion`；
7. 如需 `TagName`，先在控制台创建；未创建时环境变量必须留空。

不要使用个人邮箱作为发信地址，不要把学习、研究或 Workspace 正文放进邮件主题、标签或
模板变量。

DNS 验证示例：

```bash
dig +short TXT mail.<ROOT_DOMAIN>
dig +short TXT _dmarc.<ROOT_DOMAIN>
dig +short CNAME <DKIM_SELECTOR>._domainkey.mail.<ROOT_DOMAIN>
```

以阿里云控制台显示的主机记录和值为准，不要照抄示例选择器。

### 3.2 创建最小权限 RAM 策略

在 RAM 控制台创建自定义权限策略：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dm:SingleSendMail"],
      "Resource": "*"
    }
  ]
}
```

DirectMail 的该动作不支持更细资源范围时才使用 `Resource: "*"`；不要改成 `dm:*`，不要附加
RAM、ECS 或其他管理权限。

### 3.3 创建并绑定 ECS RAM 角色

1. 创建可信实体为“阿里云服务 / ECS”的 RAM 角色，例如 `LogionDirectMailSender`；
2. 只给该角色附加上一步的自定义策略；
3. 把角色绑定到运行 Logion 的 ECS 实例；
4. 不创建 RAM 用户 AccessKey；
5. 不在 `.env` 中添加任何 AccessKey 变量。

在 ECS 宿主机仅检查 IMDSv2 能返回角色名，不读取凭据正文：

```bash
IMDS_TOKEN="$(curl --fail --silent --show-error \
  --request PUT \
  --header 'X-aliyun-ecs-metadata-token-ttl-seconds: 60' \
  http://100.100.100.200/latest/api/token)"

test -n "${IMDS_TOKEN}"
curl --fail --silent --show-error \
  --header "X-aliyun-ecs-metadata-token: ${IMDS_TOKEN}" \
  http://100.100.100.200/latest/meta-data/ram/security-credentials/
echo
unset IMDS_TOKEN
```

预期只输出绑定的角色名。不要访问角色名下一级地址，也不要把临时凭据输出到终端或日志。

## 4. 生产环境变量

先备份旧 `.env` 到 root 专用升级目录。已有部署必须保留原数据库密码和全部旧密钥代际；
重新生成旧密钥会导致会话失效或已有密文、备份不可恢复。

```dotenv
LOGION_ENV=production
LOGION_ALLOWED_ORIGINS=["https://<APP_DOMAIN>"]
LOGION_COOKIE_SECURE=true
LOGION_REQUIRE_ORIGIN_HEADER=true
LOGION_WEBAUTHN_RP_ID=<APP_DOMAIN>
LOGION_WEBAUTHN_ORIGINS=["https://<APP_DOMAIN>"]

LOGION_EMAIL_DELIVERY_PROVIDER=aliyun_directmail
LOGION_EMAIL_PUBLIC_BASE_URL=https://<APP_DOMAIN>
LOGION_EMAIL_DELIVERY_MAX_ATTEMPTS=5
LOGION_EMAIL_DELIVERY_LEASE_SECONDS=120

LOGION_ALIYUN_DIRECTMAIL_REGION_ID=cn-hangzhou
LOGION_ALIYUN_DIRECTMAIL_ENDPOINT=
LOGION_ALIYUN_DIRECTMAIL_ACCOUNT_NAME=no-reply@mail.<ROOT_DOMAIN>
LOGION_ALIYUN_DIRECTMAIL_FROM_ALIAS=Logion
LOGION_ALIYUN_DIRECTMAIL_RAM_ROLE_NAME=LogionDirectMailSender
LOGION_ALIYUN_DIRECTMAIL_TAG_NAME=
LOGION_ALIYUN_DIRECTMAIL_CONNECT_TIMEOUT_SECONDS=5
LOGION_ALIYUN_DIRECTMAIL_READ_TIMEOUT_SECONDS=15
```

同时必须使用非开发的邮件 Outbox 加密 keyring：

```dotenv
LOGION_EMAIL_DELIVERY_ACTIVE_ENCRYPTION_KEY_ID=production-v1
LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS={"production-v1":"<BASE64URL_32_BYTE_KEY>"}
```

要求：

- `LOGION_EMAIL_PUBLIC_BASE_URL` 必须与允许 Origin 完全一致；
- Production 必须使用 HTTPS；
- Endpoint 留空时，杭州地域使用官方 `dm.aliyuncs.com`；
- 自定义 Endpoint 只接受官方 `dm*.aliyuncs.com` 主机；
- 邮件租约必须长于连接超时、读取超时和安全余量；
- Worker 显式清空 HTTP/HTTPS 代理并只为元数据地址设置 `NO_PROXY`；
- DirectMail 客户端不会读取系统代理或跟随重定向，Provider 响应限制为 64 KiB。

只检查变量名，不显示值：

```bash
cd /opt/logion
chmod 600 .env
grep -E '^(LOGION_EMAIL|LOGION_ALIYUN_DIRECTMAIL)_[A-Z0-9_]+=' .env \
  | cut -d= -f1 \
  | sort
logion-compose config --quiet
```

禁止运行或发送 `cat .env`、`env`、展开后的 `docker compose config`。

## 5. 候选部署

邮件适配器只有进入成功的 Main candidate 并产生新 Worker 镜像摘要后才能部署。不要把本地工作区
构建物当作预发布候选。

```bash
cd /opt/logion
logion-compose config --quiet
logion-compose config --images
COMPOSE_PARALLEL_LIMIT=2 logion-compose pull
logion-compose up -d --no-build --wait --timeout 240 api worker web reverse-proxy
logion-compose up -d --no-build backup
```

确认 Worker 既连接内部 `backend` 网络，也拥有单独 `egress` 网络；API、PostgreSQL 和 Redis
不得加入 `egress`：

```bash
docker inspect "$(logion-compose ps -q worker)" \
  --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}'
docker inspect "$(logion-compose ps -q api)" \
  --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}'
```

检查 Worker 启动和投递事件，不打印完整环境：

```bash
logion-compose logs --since 10m --tail 200 worker \
  | grep -E 'worker_started|email_delivery_(succeeded|failed|discarded)' || true
```

## 6. 真实投递验收

使用专用预发布邮箱和测试账户，不使用管理员主邮箱作为破坏性找回测试对象。记录 UTC 时间、
候选提交、Worker 镜像摘要和结果，不记录邮箱、密码、Cookie 或 Token。

### 6.1 邮箱验证

1. Owner 创建只读或普通成员邀请；
2. 通过已确认的可信渠道把一次性邀请 Token 交给测试者；
3. 测试者在 HTTPS 域名启动注册；
4. 确认收到 `确认您的 Logion 邮箱`；
5. 检查 From、SPF、DKIM、DMARC 结果；
6. 点击链接，确认地址栏 Fragment 立即被页面清除；
7. 设置密码后显式登录；
8. 重复使用同一链接必须失败；
9. 邮件扫描器或直接 GET 不得激活账户。

### 6.2 密码找回

1. 对专用测试账户发起找回；
2. 不存在邮箱发起同一请求时，页面响应不得暴露账户是否存在；
3. 使用邮件链接完成重置；
4. 旧密码、旧 Session 和旧 Refresh Token 必须失效；
5. 已启用 TOTP 的账户仍必须提供 TOTP 或恢复码，邮件不能绕过第二因素；
6. 重复使用找回链接必须失败。

### 6.3 安全通知

对专用测试账户完成一次密码找回，确认收到安全通知。不要为了测试而对真实 Owner 连续提交
错误第二因素；失败上限场景只在隔离测试账户执行。

### 6.4 服务端聚合检查

只查询状态汇总，不读取邮箱或加密 payload：

```bash
logion-compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT status, count(*) FROM email_outbox GROUP BY status ORDER BY status"'
```

通过条件：

- 新测试邮件最终为 `sent`；
- 没有持续增长的 `pending` 或 `leased`；
- 过期、已使用或撤销 Token 不发送；
- 日志没有邮箱、Token 或正文；
- 阿里云控制台没有未处理的退信/投诉异常。

## 7. 监控与故障处理

建议告警：

| 信号                    | 预发布阈值                    |
| ----------------------- | ----------------------------- |
| `email_delivery_failed` | 任何不可重试失败立即调查      |
| 连续可重试失败          | 5 分钟内 3 次                 |
| `pending + leased` 积压 | 超过 10 或最老一封超过 5 分钟 |
| `failed` / `dead`       | 任意新增均复核原因            |
| 阿里云退信/投诉         | 任意新增均调查                |

常见错误：

- `EMAIL_PROVIDER_CREDENTIAL_UNAVAILABLE`：检查 ECS 角色绑定、信任策略和 IMDSv2；
- `EMAIL_PROVIDER_REJECTED`：检查 RAM 动作、发信地址、域名验证、地域和 Tag；
- `EMAIL_PROVIDER_UNAVAILABLE`：检查 DNS、443 出方向、DirectMail 服务状态和超时；
- `EMAIL_PROVIDER_INVALID_RESPONSE`：保留去敏事件信息，停止晋级，不把异常 2xx 当作成功。

不要通过改用长期 AccessKey、关闭 TLS 校验、允许任意 Endpoint、启用系统代理或降低加密库版本
来排障。

## 8. 重试、重复邮件与回滚边界

Worker 使用数据库租约和有界退避。超时或临时服务错误会重试，永久拒绝会终止并清空密文。
DirectMail `SingleSendMail` 没有供本实现使用的业务幂等键；若进程在 Provider 已接受邮件后、
数据库标记成功前崩溃，恢复后可能出现重复邮件。一次性 Token、用途绑定和原子消费确保重复邮件
不会造成重复激活或绕过认证。该残余风险适用于最多 10 人的封闭部署，必须监控但不通过放宽
Token 规则解决。

邮件故障时：

1. 保持注册为 `invite` 或临时切换 `closed`；
2. 不开启 legacy/open 注册；
3. 保留 Outbox、数据库和日志证据；
4. 修复配置或部署新 Worker；
5. 不回滚数据库迁移、不删除 Outbox 表；
6. 只有确认旧 Worker 与当前 schema 兼容时才回滚 Worker 镜像。

## 9. 预发布证据模板

```text
测试 ID：
UTC 开始/结束：
Source commit：
Worker image digest：
应用域名：仅记录域名，不记录账号
发信域名验证：SPF / DKIM / DMARC
ECS RAM 角色名：
长期 AccessKey：未使用
邮箱验证：通过 / 失败
重复验证链接：被拒绝 / 未验证
密码找回：通过 / 失败
旧会话撤销：通过 / 失败
MFA 不降级：通过 / 失败
安全通知：通过 / 失败
Outbox 积压：
日志泄漏检查：通过 / 失败
退信/投诉：
结论：通过 / 阻断
阻断项与复测时间：
```
