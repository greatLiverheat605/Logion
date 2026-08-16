# 阿里云封闭生产发布与旧版本清理手册

> 适用范围：个人使用及最多 10 人的受邀协作。
>
> 部署形态：阿里云单台 ECS、单实例 PostgreSQL/Redis、不可变应用镜像。
>
> 当前阶段：先部署 `0.1.0-rc2` 预发布候选，完成 24 小时观察后再人工批准 Production。
>
> 本手册不提供高可用或 SLA 承诺；命中任一停止条件时不得上线。

配套文档：

- [0.1.0-rc2 预发布准备记录](../../docs/release/0.1.0-rc2-prerelease.md)
- [阿里云邮件推送接入与预发布验收](./aliyun-directmail-prerelease.md)
- [阿里云真实双设备同步验收](./aliyun-real-sync-acceptance.md)
- [备份与恢复操作手册](./backup-restore.md)

## 0. 本次预发布如何执行

本手册是 rc2 的主入口。`aliyun-2c2g-staging-deployment.md` 固定的是历史无域名候选，只能引用其中
的基础环境安装、旧数据清点和 2 GB 资源覆盖做法；不要复制其中的旧提交、旧镜像摘要、HTTP Origin
或“邮件未实现”结论。

开始前在纸面或仅 root 可读的发布记录中确定以下替换值：

| 占位符                | 实际值                                  |
| --------------------- | --------------------------------------- |
| `<DOMAIN>`            | 应用正式域名，例如 `logion.example.com` |
| `<ROOT_DOMAIN>`       | 根域名，例如 `example.com`              |
| `<CERT_NOTICE_EMAIL>` | 只用于证书到期通知的运维邮箱            |
| `<SOURCE_SHA>`        | 成功 Main candidate 的 40 位完整提交    |
| `<MAIN_RUN_ID>`       | 同一提交成功的 Main workflow run ID     |
| `<CAPACITY_RUN_ID>`   | 同一提交成功的 capacity workflow run ID |

不得把尖括号占位符原样写进 `.env`、Nginx 或 DNS。域名与邮件服务“已可用”只代表具备开始条件；必须看到
DNS、TLS、RAM、真实投递和退信状态的实际结果才算通过。

已部署过旧版本时不需要重新安装操作系统、Docker、Git、Nginx 或重新创建 Swap，也不得重新生成原有
数据库密码、认证密钥、TOTP/邮件/AI/导出 keyring 和备份密钥。先执行只读检查：

```bash
uname -m
. /etc/os-release && printf '%s %s\n' "$ID" "$VERSION_ID"
docker version --format '{{.Server.Version}}'
docker compose version
git --version
jq --version
nginx -v
command -v logion-compose
timedatectl show -p NTPSynchronized --value
free -h
df -h /
test -d /opt/logion
test -f /opt/logion/.env
test -f /opt/logion/secrets/backup.key
```

预期为 x86_64/amd64、Ubuntu 24.04、时间已同步且当前数据文件存在。任一工具缺失时，只补该项；
全新 ECS 才按[历史手册第 2–6 节](./aliyun-2c2g-staging-deployment.md#2-阿里云控制台预检查)
安装基础环境，然后返回本手册。

固定执行顺序：

1. 等本轮代码合并到 `main`，Main 与 capacity 工作流对同一 SHA 全绿；
2. 生成并下载经过验证的 rc2 candidate manifest、SBOM、provenance 和安全报告；
3. 完成域名解析、阿里云邮件发信域名/RAM、HTTPS、Windows 异机备份与告警准备；
4. 对旧版本停写，生成并验证加密备份，下载到受控 Windows 电脑；
5. 保留数据卷与原密钥，替换为 manifest 对应的源码和四个 digest 镜像；
6. 迁移、启动、健康检查、真实邮件、真实同步和实体手机验收；
7. 标记为 `prerelease` 并观察至少 24 小时；
8. 全部门禁关闭后由人工批准 Production；批准前不清理旧源码、旧镜像或任何数据卷。

任一步失败即停止在当前阶段，记录失败时间、候选 SHA、错误码与受影响服务；不要通过开放注册、关闭
TLS 校验、使用长期 AccessKey、删除卷或从数据库提取 Token 绕过。

## 1. 可以上线的边界

只有下列门禁全部通过，Logion 才能从封闭测试切换为封闭生产：

- 候选提交、四个应用镜像摘要和 CI 证据一一对应；
- API 全量测试、`pnpm ci:fast`、`pnpm test:browser` 全绿；
- OpenAPI 快照无非预期变更；
- 域名、HTTPS、Secure Cookie 和 WebAuthn 域名配置完成；
- 注册保持 `invite` 或 `closed`，旧注册入口关闭，引导 Owner 邮箱已清空；
- 邮箱验证、找回密码、安全通知和 Workspace 邀请已经接入真实邮件投递并通过测试；
- 未注册受邀者已完成“邀请邮件 → 邮箱验证 → 登录 → 接受邀请”的真实闭环；
- 已生成部署前加密备份，并把密文备份和校验文件下载到受控 Windows 电脑；
- 已在独立空环境完成一次恢复演练；
- API、容器、磁盘、内存、备份和证书到期告警已经送达真实接收人；
- 已有 Owner 完成登录、正常刷新、核心写入、同步和退出测试；
- 新版本稳定观察期结束前不删除旧源码、旧镜像或任何数据卷。

如果真实邮件投递、Windows 异机备份、恢复演练、实体手机验收或 24 小时观察尚未完成，只能继续
作为预发布环境，不能标记为生产就绪。

## 2. 推荐网络拓扑

```text
受邀用户浏览器
        |
      HTTPS 443
        |
阿里云安全组 / 可选 WAF
        |
宿主机 Nginx（TLS 终止）
        |
127.0.0.1:8080
        |
Compose reverse-proxy
        |---------------- Web
        |---------------- API
                         |---- PostgreSQL（内部网络）
                         |---- Redis（内部网络）
        |---------------- Worker（内部数据 + 独立出方向）
                                  |---- 阿里云邮件推送 HTTPS

Backup 加密产物 ---- 受限 SSH/SCP ---- Windows 异机密文副本
```

安全组入方向只允许：

| 端口 | 来源                                                             | 用途       |
| ---: | ---------------------------------------------------------------- | ---------- |
|   22 | 管理员固定公网 IP `/32`                                          | SSH 运维   |
|  443 | 受邀用户允许的来源；无法固定时才使用 `0.0.0.0/0` 并启用 WAF/限流 | HTTPS 应用 |
|   80 | 仅证书签发和 HTTP 到 HTTPS 跳转                                  | ACME       |

不得开放 `8080`、`5432`、`6379`。Compose 的 8080 必须通过部署覆盖文件绑定到 `127.0.0.1`。

## 3. 上线前云资源

最低建议：

| 资源   | 要求                                                                  |
| ------ | --------------------------------------------------------------------- |
| ECS    | Ubuntu 24.04 LTS、x86_64、2 核 2 GB；有 AI/附件并发时建议 4 GB        |
| 系统盘 | 60 GB，磁盘告警阈值 75%                                               |
| 域名   | 已备案且解析到 ECS 公网 IP                                            |
| TLS    | 有效证书、自动续期、TLS 1.2/1.3                                       |
| 备份   | Windows `F:\LogionBackups` 异机密文、SHA-256 校验和计划任务           |
| RAM    | ECS RAM 角色；不要在服务器保存长期 AccessKey                          |
| 日志   | 至少保留应用错误、容器事件和审计事件；禁止采集 Cookie、令牌和用户正文 |
| 告警   | 健康、5xx、OOM/重启、磁盘、备份超时、证书到期                         |

2 GB 实例只适合低频封闭使用。可用内存持续低于 200 MiB、Swap 持续超过 1 GiB或任一容器 OOM 时，停止增加用户并升级到 4 GB。

### 3.1 域名与 DNS

1. 为 `<DOMAIN>` 创建指向 ECS 公网 IP 的 `A` 记录；只有 ECS 已正确启用 IPv6 时才创建 `AAAA`；
2. 等公网递归 DNS 返回新地址，不只看阿里云控制台；
3. 安全组开放 80/443，22 仍只允许管理员固定公网 IP；
4. 在阿里云邮件推送控制台添加专用发信域名 `mail.<ROOT_DOMAIN>`；
5. 按控制台当前给出的值创建所有权、SPF、DKIM 和回信地址记录；
6. 为根域名创建 DMARC，先使用观察策略，确认正常后再收紧；
7. 等邮件推送控制台全部显示验证通过，再创建 `no-reply@mail.<ROOT_DOMAIN>`。

```bash
dig +short A <DOMAIN>
dig +short TXT mail.<ROOT_DOMAIN>
dig +short TXT _dmarc.<ROOT_DOMAIN>
dig +short CNAME <DKIM_SELECTOR>._domainkey.mail.<ROOT_DOMAIN>
```

`<DKIM_SELECTOR>` 与所有 TXT/CNAME 值必须来自当前控制台，不照抄示例。不要把应用域名的 A 记录
错误指向邮件域名，也不要在未配置 IPv6 时留下不可达的 AAAA。

### 3.2 邮件、RAM、异机备份与告警

- 按[邮件手册第 3 节](./aliyun-directmail-prerelease.md#3-阿里云控制台准备)创建只允许
  `dm:SingleSendMail` 的策略并绑定 ECS RAM 角色；
- 不创建或保存 RAM 用户长期 AccessKey，不把临时 Security Token 打印到终端；
- 项目不使用 OSS。按 [Windows 异机加密备份手册](./windows-off-host-backup.md)配置受限 SSH 密钥和
  Windows 计划任务，只下载加密 `.backup` 和 `.sha256`，绝不复制备份密钥；没有完成下载、校验
  和空环境恢复演练时保持 `prerelease`；
- 为健康、5xx、OOM/重启、磁盘、备份同步、证书、邮件积压、退信和投诉配置真实接收人。

## 4. 生产环境变量

以下只展示变量名和非敏感示例。不要把真实 `.env`、密码或密钥复制到聊天、Git 或工单：

```dotenv
LOGION_ENV=production
LOGION_ALLOWED_ORIGINS=["https://<DOMAIN>"]
LOGION_COOKIE_SECURE=true
LOGION_REFRESH_REUSE_GRACE_SECONDS=10
LOGION_REQUIRE_ORIGIN_HEADER=true
LOGION_LEGACY_REGISTRATION_ENABLED=false
LOGION_REGISTRATION_MODE=invite
LOGION_BOOTSTRAP_OWNER_EMAIL=
LOGION_WEBAUTHN_RP_ID=<DOMAIN>
LOGION_WEBAUTHN_ORIGINS=["https://<DOMAIN>"]
```

同时必须配置非开发值的：

- `LOGION_SECRET_KEY`；
- TOTP 加密密钥及活动 key ID；
- 邮件投递加密密钥及活动 key ID；
- AI 凭据加密密钥及活动 key ID；
- 数据导出加密密钥及活动 key ID；
- PostgreSQL 密码；
- 备份密钥及备份 key ID。

邮件投递必须配置：

```dotenv
LOGION_EMAIL_DELIVERY_PROVIDER=aliyun_directmail
LOGION_EMAIL_PUBLIC_BASE_URL=https://<DOMAIN>
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

ECS 角色只允许 `dm:SingleSendMail`。系统不读取长期 AccessKey 变量；完整控制台、DNS、RAM、
投递和故障处理步骤见[阿里云邮件推送接入手册](./aliyun-directmail-prerelease.md)。

`LOGION_REFRESH_REUSE_GRACE_SECONDS` 允许范围为 1–30 秒，生产建议保持 10 秒。它只用于恢复页面重载中断或并发造成的合法令牌轮换；有效 CSRF、同一会话、唯一活动刷新令牌和有效设备仍是必要条件。窗口外的旧令牌重放会继续撤销整个会话。

配置后只检查键名，不输出值：

```bash
cd /opt/logion
chmod 600 .env
grep -E '^[A-Z0-9_]+=' .env | cut -d= -f1 | sort
logion-compose config --quiet
```

## 5. HTTPS 入口

### 5.1 首次签发证书

已有有效证书时不要重复签发，直接检查自动续期。首次签发时先确认 `<DOMAIN>` 的 A 记录已经指向
本机公网 IP，且 80/443 已开放：

```bash
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx
install -d -m 0755 /var/www/html

cat >/etc/nginx/sites-available/logion <<'EOF'
server {
    listen 80;
    server_name <DOMAIN>;
    server_tokens off;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 "certificate bootstrap\n"; }
}
EOF

ln -sfn /etc/nginx/sites-available/logion /etc/nginx/sites-enabled/logion
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/html \
  -d <DOMAIN> \
  -m <CERT_NOTICE_EMAIL> \
  --agree-tos --no-eff-email
```

签发失败时不要关闭防火墙或改用自签名证书继续。先检查 DNS、80 端口、CAA、系统时间和 Certbot
错误。证书成功后再写入下面的最终代理配置。

### 5.2 最终 Nginx 配置

宿主机 Nginx 只代理到本机 8080。证书路径由实际签发方式确定：

```nginx
server {
    listen 80;
    server_name <DOMAIN>;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name <DOMAIN>;
    server_tokens off;

    ssl_certificate /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

上线前执行：

```bash
nginx -t
systemctl reload nginx
certbot renew --dry-run --non-interactive --no-random-sleep-on-renew
systemctl status certbot.timer --no-pager
curl --fail --silent https://<DOMAIN>/health
curl --fail --silent --head https://<DOMAIN>/ | grep -i '^strict-transport-security:'
ss -lntp | grep -E ':(80|443|8080) '
```

预期：公网只使用 80/443，8080 只出现 `127.0.0.1:8080`，HTTPS 响应包含一年有效期的 HSTS。先确认 HTTPS、自动续期和回滚域名均稳定，再考虑 `includeSubDomains` 或 preload，不能直接照搬开启。

最终 80 端口配置必须长期保留 `/.well-known/acme-challenge/` 的 Webroot 例外，只把其他请求跳转到
HTTPS。已有证书若最初使用 Nginx 插件签发，可先执行以下命令把续期方式切换到固定 Webroot；命令会
先通过测试环境验证，成功后才保存配置：

```bash
certbot reconfigure \
  --cert-name <DOMAIN> \
  --webroot -w /var/www/html \
  --non-interactive \
  --no-random-sleep-on-renew
grep -E '^(authenticator|webroot_path) *=' \
  /etc/letsencrypt/renewal/<DOMAIN>.conf
```

应看到 `authenticator = webroot` 和 `/var/www/html`。若测试环境报告 `During secondary validation`
连接超时，但从独立公网出口访问实际挑战文件成功，先检查安全组 80 端口来源是否为 `0.0.0.0/0`、
云防火墙和 Nginx ACME 访问日志，再重试一次；不要开放 8080、关闭 TLS 校验或改用自签名证书。
只有 `certbot renew --dry-run --non-interactive --no-random-sleep-on-renew` 明确显示全部模拟续期成功，
续期门禁才算通过。持续失败时保持预发布状态并处理网络问题。

宿主机必须覆盖客户端提交的 `X-Forwarded-For`，Compose 代理只能信任来自宿主机的转发头。预发布时
从两个不同公网出口检查服务端限速身份，并用伪造 `X-Forwarded-For` 的请求确认不能绕过限速；若
所有用户被错误识别为同一代理地址或伪造头能改变身份，记录为 Production 阻断项，不通过扩大限额
绕过。

## 6. 发布前备份

不要先清理旧版本。先创建 root 专用升级目录，验证旧服务，再进入维护窗口停止所有应用写入者；
PostgreSQL 与 Redis 暂时保持运行：

```bash
set -euo pipefail
install -d -m 0700 /root/logion-upgrade
date -u +%Y-%m-%dT%H:%M:%SZ | tee /root/logion-upgrade/started-at.txt
cd /opt/logion
test -f compose.yaml
test -f .env
test ! -L .env
test -f secrets/backup.key
test ! -L secrets/backup.key
grep -Eq '^name:[[:space:]]+logion[[:space:]]*$' compose.yaml
stat -c '%a %U:%G %n' .env secrets secrets/backup.key
logion-compose config --quiet
docker volume inspect \
  logion_postgres_data \
  logion_redis_data \
  logion_attachments_data \
  logion_backup_data >/dev/null
logion-compose ps
curl --fail --silent http://127.0.0.1:8080/health
echo

git rev-parse HEAD | tee /root/logion-upgrade/old-source-sha.txt
logion-compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"' \
  | tee /root/logion-upgrade/old-alembic-head.txt
logion-compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM workspace_memberships WHERE role = \$\$owner\$\$ AND status = \$\$active\$\$"' \
  | tee /root/logion-upgrade/old-active-owner-count.txt

logion-compose stop reverse-proxy web api worker backup
logion-compose ps -a

logion-compose run --rm --no-deps \
  -e LOGION_BACKUP_ONCE=true \
  backup

LATEST_BACKUP="$(logion-compose run --rm --no-deps \
  --entrypoint sh backup -c \
  'find /backups -maxdepth 1 -type f -name "logion-*.backup" | sort | tail -n 1')"

test -n "${LATEST_BACKUP}"
logion-compose run --rm --no-deps \
  --entrypoint logion-verify-backup \
  backup "${LATEST_BACKUP}"
```

`.env`、备份密钥、Compose 项目名或四个数据卷任一缺失时立即停止。不要让新 Compose 自动创建空卷后
继续，也不要在升级过程中生成新的替代密钥。

把加密备份和校验文件复制到 Compose 卷外；这一步不会解密数据：

```bash
EXPORT_CONTAINER=logion-prerelease-backup-export
docker rm -f "${EXPORT_CONTAINER}" 2>/dev/null || true
logion-compose run --name "${EXPORT_CONTAINER}" -d --no-deps \
  --entrypoint sh backup -c 'sleep 600'
docker cp "${EXPORT_CONTAINER}:${LATEST_BACKUP}" /root/logion-upgrade/
docker cp "${EXPORT_CONTAINER}:${LATEST_BACKUP}.sha256" /root/logion-upgrade/
docker rm -f "${EXPORT_CONTAINER}"

chmod 600 /root/logion-upgrade/logion-*.backup*
cd /root/logion-upgrade
sha256sum -c "$(basename "${LATEST_BACKUP}").sha256"
```

再按[备份恢复手册](./backup-restore.md#空环境演练)恢复到独立空数据库验证，不得覆盖当前数据库。
随后按 [Windows 异机加密备份手册](./windows-off-host-backup.md)把本次确切的加密 `.backup` 与
`.sha256` 下载到 `F:\LogionBackups\encrypted`，从 Windows 重新计算 SHA-256。备份密钥必须通过
独立安全渠道保存在 `F:\LogionRecoveryKey\backup.key`，不得放入备份目录。

本节成功前旧应用已经停止写入。若决定中止升级且尚未移动 `/opt/logion`，执行
`logion-compose start` 并重新检查 `/health`；不要在半完成状态继续对外服务。

停止条件：

- 备份验证失败；
- 没有异地副本；
- 最近一次恢复演练失败或没有记录；
- SSH host key 变化、下载哈希不一致或需要关闭校验才能复制。

## 7. 不可变候选替换

### 7.1 获取并验证候选证据

只有本轮代码合并且成功 Main/Release candidate 已生成后才执行。下载同一 source SHA 的
`candidate-manifest.json`、Main/Release run 记录、SBOM、provenance 和安全报告；不要部署本地构建物或
Pull Request 临时镜像。把 manifest 通过 SSH/SCP 传到：

```text
/root/logion-upgrade/candidate-manifest.json
```

第 7 节所有命令应在同一个 root Bash 会话中按顺序执行；如果 SSH 重连，重新读取 `MANIFEST`、
`SOURCE_SHA`、`TARGET_ALEMBIC_HEAD` 和 `/root/logion-upgrade/old-directory.txt` 后再继续，不要凭记忆输入。

记录以下证据：

- source commit；
- Main candidate run ID；
- capacity 与 Release candidate run ID；
- API、Worker、Web、Backup 四个镜像摘要；
- 当前和目标 Alembic head；
- 最近加密备份文件名、校验值和异地复制时间。

先检查 manifest 只有四个 digest 固定的 GHCR 应用镜像：

```bash
set -euo pipefail
MANIFEST=/root/logion-upgrade/candidate-manifest.json
test -f "${MANIFEST}"
jq -e '
  .schema_version == 1
  and (.source.commit | test("^[0-9a-f]{40}$"))
  and (.images | keys | sort == ["api", "backup", "web", "worker"])
  and ([.images[].reference | test("^ghcr\\.io/.+@sha256:[0-9a-f]{64}$")] | all)
' "${MANIFEST}" >/dev/null

SOURCE_SHA="$(jq -r '.source.commit' "${MANIFEST}")"
TARGET_ALEMBIC_HEAD="$(jq -r '.compatibility.migration_head' "${MANIFEST}")"
printf '%s\n' "${SOURCE_SHA}" | tee /root/logion-upgrade/new-source-sha.txt
printf '%s\n' "${TARGET_ALEMBIC_HEAD}" | tee /root/logion-upgrade/new-alembic-head.txt
```

### 7.2 归档旧源码并检出候选

本节默认保留旧数据。确认第 6 节备份、异地复制、空环境恢复演练均成功，且旧应用写入者已经停止。
归档目录暂时包含旧 `.env` 和备份密钥，只允许 root 访问：

```bash
cd /opt
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OLD_DIR="/opt/logion.before-${STAMP}"
mv /opt/logion "${OLD_DIR}"
chmod 0700 "${OLD_DIR}"
printf '%s\n' "${OLD_DIR}" >/root/logion-upgrade/old-directory.txt

git clone https://github.com/greatLiverheat605/Logion.git /opt/logion
cd /opt/logion
git checkout --detach "${SOURCE_SHA}"
test "$(git rev-parse HEAD)" = "${SOURCE_SHA}"

python3 scripts/release/candidate_manifest.py verify \
  --manifest "${MANIFEST}" \
  --expected-commit "${SOURCE_SHA}" \
  --expected-repository greatLiverheat605/Logion

install -m 0600 "${OLD_DIR}/.env" /opt/logion/.env
install -d -m 0700 /opt/logion/secrets
install -m 0640 "${OLD_DIR}/secrets/backup.key" /opt/logion/secrets/backup.key
chown root:10001 /opt/logion/secrets/backup.key
```

不要复制旧源码、Node/Python 依赖目录或未知 Compose 覆盖。按照
[2 GB 手册第 9 节](./aliyun-2c2g-staging-deployment.md#9-创建-2-gb-低内存覆盖配置)重新创建
`compose.beta.yaml`、`compose.registry.yaml` 和 `logion-compose`；其中四个应用镜像必须来自本次 manifest，
三个基础镜像仍须使用经候选安全扫描的精确摘要。若服务器已升级到 4 GB，资源上限可另行审核调整，
但 8080 的 `127.0.0.1` 绑定不能删除。

### 7.3 保留密钥并更新 rc2 非秘密配置

只更新候选、域名、注册门控和邮件 Provider 等非秘密值。下列函数不会显示 `.env`；如果已有 Owner，
`LOGION_BOOTSTRAP_OWNER_EMAIL` 必须保持为空。没有 Owner 时才写入预定 Owner 邮箱，完成注册后立即清空。

```bash
cd /opt/logion
APP_ORIGIN='https://<DOMAIN>'

set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*$|${key}=${value}|" .env
  else
    printf '%s=%s\n' "${key}" "${value}" >>.env
  fi
}

set_env_value LOGION_ENV production
set_env_value LOGION_VERSION "${SOURCE_SHA}"
set_env_value LOGION_WEB_IMAGE "$(jq -r '.images.web.reference' "${MANIFEST}")"
set_env_value LOGION_API_IMAGE "$(jq -r '.images.api.reference' "${MANIFEST}")"
set_env_value LOGION_WORKER_IMAGE "$(jq -r '.images.worker.reference' "${MANIFEST}")"
set_env_value LOGION_BACKUP_IMAGE "$(jq -r '.images.backup.reference' "${MANIFEST}")"
set_env_value LOGION_ALLOWED_ORIGINS "[\"${APP_ORIGIN}\"]"
set_env_value LOGION_COOKIE_SECURE true
set_env_value LOGION_REQUIRE_ORIGIN_HEADER true
set_env_value LOGION_LEGACY_REGISTRATION_ENABLED false
set_env_value LOGION_REGISTRATION_MODE invite
set_env_value LOGION_WEBAUTHN_RP_ID '<DOMAIN>'
set_env_value LOGION_WEBAUTHN_ORIGINS "[\"${APP_ORIGIN}\"]"
set_env_value LOGION_EMAIL_DELIVERY_PROVIDER aliyun_directmail
set_env_value LOGION_EMAIL_PUBLIC_BASE_URL "${APP_ORIGIN}"
set_env_value LOGION_ALIYUN_DIRECTMAIL_REGION_ID cn-hangzhou
set_env_value LOGION_ALIYUN_DIRECTMAIL_ENDPOINT ''
set_env_value LOGION_ALIYUN_DIRECTMAIL_ACCOUNT_NAME 'no-reply@mail.<ROOT_DOMAIN>'
set_env_value LOGION_ALIYUN_DIRECTMAIL_FROM_ALIAS Logion
set_env_value LOGION_ALIYUN_DIRECTMAIL_RAM_ROLE_NAME LogionDirectMailSender
set_env_value LOGION_ALIYUN_DIRECTMAIL_TAG_NAME ''
set_env_value LOGION_ALIYUN_DIRECTMAIL_CONNECT_TIMEOUT_SECONDS 5
set_env_value LOGION_ALIYUN_DIRECTMAIL_READ_TIMEOUT_SECONDS 15
set_env_value LOGION_BACKUP_SECRET_SOURCE ./secrets/backup.key

OLD_OWNER_COUNT="$(tr -d '[:space:]' </root/logion-upgrade/old-active-owner-count.txt)"
case "${OLD_OWNER_COUNT}" in
  ''|*[!0-9]*) echo '旧 Owner 数量记录无效' >&2; exit 1 ;;
esac
if test "${OLD_OWNER_COUNT}" -gt 0; then
  set_env_value LOGION_BOOTSTRAP_OWNER_EMAIL ''
else
  read -r -p '首个 Owner 邮箱: ' BOOTSTRAP_OWNER_EMAIL
  set_env_value LOGION_BOOTSTRAP_OWNER_EMAIL "${BOOTSTRAP_OWNER_EMAIL}"
  unset BOOTSTRAP_OWNER_EMAIL
fi

chmod 600 .env
chmod 700 secrets
chown root:10001 secrets/backup.key
chmod 640 secrets/backup.key
unset APP_ORIGIN
unset OLD_OWNER_COUNT
unset -f set_env_value
```

上例按杭州地域和 `LogionDirectMailSender` 角色编写。若实际邮件推送地域、角色名、发信地址或已创建的
Tag 不同，使用阿里云控制台中已经验证的真实值；不要为让配置通过而填写不存在的名称。

不要修改原 PostgreSQL 密码、`LOGION_SECRET_KEY`、任何活动 key ID/keyring 或备份密钥。只检查变量名和
权限，不运行会展开值的 `docker compose config`：

```bash
stat -c '%u:%g:%a %n' .env secrets secrets/backup.key
grep -E '^[A-Z0-9_]+=' .env | cut -d= -f1 | sort
logion-compose config --quiet
logion-compose config --images
```

`config --images` 必须显示本次 manifest 的四个 GHCR 摘要和三个审核过的基础镜像摘要，不得出现
`latest`。检查端口投影时只输出端口字段，随后清屏：

```bash
logion-compose config --format json | jq '.services["reverse-proxy"].ports'
clear
```

必须看到 `host_ip: 127.0.0.1` 和 `published: "8080"`。

### 7.4 拉取、迁移与启动

镜像必须使用审核过的 digest，不使用 `latest` 或服务器临时构建。执行：

```bash
cd /opt/logion
logion-compose config --quiet
COMPOSE_PARALLEL_LIMIT=2 logion-compose pull
logion-compose up -d --no-build postgres redis attachment-init
logion-compose ps -a
logion-compose run --rm --no-deps api \
  alembic -c apps/api/alembic.ini upgrade head
ACTUAL_ALEMBIC_HEAD="$(logion-compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"')"
test "${ACTUAL_ALEMBIC_HEAD}" = "${TARGET_ALEMBIC_HEAD}"
unset ACTUAL_ALEMBIC_HEAD
logion-compose up -d --no-build --wait --timeout 240 \
  api worker web reverse-proxy
logion-compose up -d --no-build backup
```

Compose 项目名必须继续为 `logion`，这样新目录会复用经过备份验证的 PostgreSQL、Redis、附件和
备份卷。迁移或启动失败时停止，不重复迁移、不删除卷；先收集 `logion-compose ps` 和相关服务最近
100 行去敏日志。除非已经单独批准空环境重置，不得删除这些卷。

不得运行：

```text
docker compose down --volumes
docker volume prune
docker system prune -a --volumes
```

## 8. 上线验收

### 8.1 服务与资源

```bash
logion-compose ps
curl --fail --silent https://<DOMAIN>/health
logion-compose exec -T api python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
free -h
df -h /
docker stats --no-stream
docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
```

### 8.2 浏览器

使用 HTTPS 域名完成：

保留旧数据且已有 Owner 时，先确认 `LOGION_BOOTSTRAP_OWNER_EMAIL` 为空并用既有 Owner 登录；不要重新
开启引导。全新空环境没有 Owner 时，只允许预定引导邮箱注册，收到验证邮件并完成首次登录后立即
关闭引导：

```bash
cd /opt/logion
sed -i \
  's/^LOGION_BOOTSTRAP_OWNER_EMAIL=.*/LOGION_BOOTSTRAP_OWNER_EMAIL=/' \
  .env
logion-compose up -d --no-build --force-recreate api worker
```

再次提交相同引导邮箱的自助注册必须被注册门控拒绝；后续账户只能由 Owner 创建邀请。

1. Owner 登录；
2. 正常刷新和连续快速刷新；
3. 16 个应用路由；
4. 工作区与 Space；
5. 计划、任务和今日执行；
6. 笔记、附件、复习和测试；
7. 双浏览器在线同步、离线写入、恢复联网与冲突处理；
8. 邀请注册、邮箱验证和找回密码；
9. TOTP/Passkey；
10. 数据导出、备份和审计日志。
11. Secure/HttpOnly/SameSite Cookie、CSP、HSTS、frame 限制与敏感页面缓存策略；
12. 两个公网出口的真实客户端 IP/限速，以及伪造转发头不能绕过。

记录预期和实际结果，不记录密码、Cookie、令牌、备份密钥或用户正文。

### 8.3 真实邮件

使用专用预发布账户完成：

1. 受邀注册与邮箱确认；
2. 重复确认链接被拒绝；
3. 密码找回、旧会话撤销和 MFA 不降级；
4. 密码更新安全通知；
5. SPF、DKIM、DMARC 与阿里云投递状态检查；
6. Outbox 状态聚合和日志去敏检查。

不得对真实 Owner 做失败上限测试。完整步骤和证据模板见
[邮件推送预发布验收手册](./aliyun-directmail-prerelease.md#6-真实投递验收)。

### 8.4 预发布状态

首次部署 `rc2` 后环境标记为 `prerelease`，不立即宣布 Production。记录开始时间并连续观察至少
24 小时；期间只允许受邀测试者使用，不清理旧源码、旧镜像、部署前备份或数据卷。

## 9. 监控与告警

至少配置：

| 指标                                  | 建议告警                       |
| ------------------------------------- | ------------------------------ |
| `/health` 或 API ready                | 连续 3 次失败                  |
| HTTP 5xx                              | 5 分钟内超过 2% 或超过 5 次    |
| 容器重启/OOM                          | 任意一次                       |
| CPU                                   | 持续 15 分钟超过 80%           |
| 可用内存                              | 持续 5 分钟低于 200 MiB        |
| Swap                                  | 持续 15 分钟超过 1 GiB         |
| 磁盘                                  | 使用率达到 75%/85% 两级告警    |
| 加密备份                              | 26 小时未成功或校验失败        |
| Windows 异机备份                      | 48 小时无新校验成功记录        |
| TLS 证书                              | 距到期 30/14/7 天              |
| 邮件 Outbox                           | 最老 pending 超过 5 分钟       |
| 邮件永久失败/退信/投诉                | 任意新增                       |
| `identity.refresh_rotation_recovered` | 短时明显增加时调查客户端或网络 |
| `identity.refresh_reuse_detected`     | 任意出现时调查账户安全         |

日志只保留排障所需字段，禁止记录授权头、Cookie、令牌、密码、TOTP 种子、AI 密钥或学习内容。

## 10. 观察期与旧测试版本清理

新版本上线后至少观察 24 小时。期间保留：

- 上一个源代码目录；
- 上一个候选的不可变镜像；
- 部署前和部署后的加密备份；
- 数据库、Redis、附件和备份数据卷。

只有同时满足以下条件才清理旧源码：

- 新版本连续稳定运行至少 24 小时；
- 登录、刷新、核心写入、同步、备份和告警均通过；
- 无 OOM、反复重启或持续 5xx；
- 部署后备份已验证并下载到 Windows 异机目录；
- 不再需要旧目录核对配置差异。

读取部署时记录的旧目录，并严格校验路径：

```bash
OLD_DIR="$(cat /root/logion-upgrade/old-directory.txt)"
case "${OLD_DIR}" in
  /opt/logion.before-20??????T??????Z) ;;
  *) echo '拒绝清理未识别的旧目录' >&2; exit 1 ;;
esac

test "${OLD_DIR}" != /opt/logion
test -d "${OLD_DIR}"
test "$(dirname "${OLD_DIR}")" = /opt
ls -ld "${OLD_DIR}"
```

人工确认 `ls -ld` 只指向预期的 UTC 时间戳目录后执行：

```bash
rm -rf --one-file-system -- "${OLD_DIR}"
test ! -e "${OLD_DIR}"
rm -f /root/logion-upgrade/old-directory.txt
unset OLD_DIR
docker image prune
```

`docker image prune` 不得增加 `-a` 或 `--volumes`。不得删除 `logion_postgres_data`、`logion_redis_data`、`logion_attachments_data` 或 `logion_backup_data`。

## 11. 回滚与前向修复

应用替换失败且数据库 schema 仍兼容时，可以把四个应用镜像摘要恢复到上一候选，再重新创建应用容器。不要回滚 PostgreSQL 数据卷。

如果已执行不向后兼容的迁移：

- 不启动无法读取新 schema 的旧镜像；
- 保持写入冻结；
- 使用审核过的兼容候选或前向修复；
- 只有在人工批准并完成恢复演练后，才从部署前备份恢复到独立环境。

怀疑密钥泄露、租户隔离失效或数据损坏时，立即停止对外服务，轮换受影响密钥和会话，并按安全事故处理；不要依赖删除旧目录来消除泄露影响。

## 12. 发布完成记录

发布记录至少包含：

- 发布时间和操作员；
- source commit、CI run 和镜像摘要；
- Alembic head；
- 生产域名和证书到期日；
- 备份验证及 Windows 异机同步时间；
- 浏览器、同步和恢复验收结果；
- 容器 OOM/重启、资源快照；
- 告警测试结果；
- 邮箱验证、找回、安全通知和邮件积压结果；
- 实体 iOS Safari 与 Android Chrome 结果；
- 24 小时预发布观察起止时间与异常摘要；
- 旧版本最早清理时间；
- 已知问题、负责人和处理期限。

记录中不得包含任何凭据、Cookie、令牌、备份密钥或用户内容。
