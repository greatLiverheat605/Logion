# 阿里云封闭生产发布与旧版本清理手册

> 适用范围：个人使用及最多 10 人的受邀协作。
>
> 部署形态：阿里云单台 ECS、单实例 PostgreSQL/Redis、不可变应用镜像。
>
> 本手册不提供高可用或 SLA 承诺；命中任一停止条件时不得上线。

## 1. 可以上线的边界

只有下列门禁全部通过，Logion 才能从封闭测试切换为封闭生产：

- 候选提交、四个应用镜像摘要和 CI 证据一一对应；
- API 全量测试、`pnpm ci:fast`、`pnpm test:browser` 全绿；
- OpenAPI 快照无非预期变更；
- 域名、HTTPS、Secure Cookie 和 WebAuthn 域名配置完成；
- 注册保持 `invite` 或 `closed`，旧注册入口关闭，引导 Owner 邮箱已清空；
- 邮箱验证、邀请和找回密码已经接入真实邮件投递并通过测试；
- 已生成部署前加密备份，并把密文备份和校验文件复制到私有 OSS；
- 已在独立空环境完成一次恢复演练；
- API、容器、磁盘、内存、备份和证书到期告警已经送达真实接收人；
- 已有 Owner 完成登录、正常刷新、核心写入、同步和退出测试；
- 新版本稳定观察期结束前不删除旧源码、旧镜像或任何数据卷。

如果真实邮件投递、OSS 异地备份或恢复演练尚未完成，只能继续作为已有 Owner 的封闭测试环境，不能标记为生产就绪。

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
| OSS    | 私有 Bucket、服务端加密、版本控制或保留策略                           |
| RAM    | ECS RAM 角色；不要在服务器保存长期 AccessKey                          |
| 日志   | 至少保留应用错误、容器事件和审计事件；禁止采集 Cookie、令牌和用户正文 |
| 告警   | 健康、5xx、OOM/重启、磁盘、备份超时、证书到期                         |

2 GB 实例只适合低频封闭使用。可用内存持续低于 200 MiB、Swap 持续超过 1 GiB或任一容器 OOM 时，停止增加用户并升级到 4 GB。

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

`LOGION_REFRESH_REUSE_GRACE_SECONDS` 允许范围为 1–30 秒，生产建议保持 10 秒。它只用于恢复页面重载中断或并发造成的合法令牌轮换；有效 CSRF、同一会话、唯一活动刷新令牌和有效设备仍是必要条件。窗口外的旧令牌重放会继续撤销整个会话。

配置后只检查键名，不输出值：

```bash
cd /opt/logion
chmod 600 .env
grep -E '^[A-Z0-9_]+=' .env | cut -d= -f1 | sort
logion-compose config --quiet
```

## 5. HTTPS 入口

宿主机 Nginx 只代理到本机 8080。证书路径由实际签发方式确定：

```nginx
server {
    listen 80;
    server_name <DOMAIN>;
    return 301 https://$host$request_uri;
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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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
curl --fail --silent https://<DOMAIN>/health
curl --fail --silent --head https://<DOMAIN>/ | grep -i '^strict-transport-security:'
ss -lntp | grep -E ':(80|443|8080) '
```

预期：公网只使用 80/443，8080 只出现 `127.0.0.1:8080`，HTTPS 响应包含一年有效期的 HSTS。先确认 HTTPS、自动续期和回滚域名均稳定，再考虑 `includeSubDomains` 或 preload，不能直接照搬开启。

## 6. 发布前备份

不要先清理旧版本。先验证当前服务并生成新备份：

```bash
cd /opt/logion
logion-compose ps
curl --fail --silent http://127.0.0.1:8080/health
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

选择本次生成的确切备份文件，运行仓库现有 `logion-verify-backup`。随后只把加密 `.backup` 和 `.sha256` 上传到私有 OSS，使用 ECS RAM 角色，不要上传备份密钥。

停止条件：

- 备份验证失败；
- OSS 对象不是私有；
- 没有异地副本；
- 最近一次恢复演练失败或没有记录；
- 需要把长期 AccessKey 写入 `.env` 才能上传。

## 7. 不可变候选替换

记录以下证据：

- source commit；
- Main candidate run ID；
- API、Worker、Web、Backup 四个镜像摘要；
- 当前和目标 Alembic head；
- 最近加密备份文件名、校验值和异地复制时间。

镜像必须使用审核过的 digest，不使用 `latest` 或临时构建。按现有部署手册更新候选文件和 `.env` 中的镜像摘要后执行：

```bash
cd /opt/logion
logion-compose config --quiet
logion-compose pull
logion-compose run --rm --no-deps api \
  alembic -c apps/api/alembic.ini upgrade head
logion-compose up -d --no-build --wait --timeout 240 \
  api worker web reverse-proxy
logion-compose up -d --no-build backup
```

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

记录预期和实际结果，不记录密码、Cookie、令牌、备份密钥或用户正文。

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
| OSS 异地复制                          | 26 小时无新对象                |
| TLS 证书                              | 距到期 30/14/7 天              |
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
- 部署后备份已验证并复制到 OSS；
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
- 备份验证及 OSS 复制时间；
- 浏览器、同步和恢复验收结果；
- 容器 OOM/重启、资源快照；
- 告警测试结果；
- 旧版本最早清理时间；
- 已知问题、负责人和处理期限。

记录中不得包含任何凭据、Cookie、令牌、备份密钥或用户内容。
