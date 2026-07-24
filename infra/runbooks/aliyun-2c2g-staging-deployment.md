# 阿里云 2 核 2 GB 封闭测试部署手册

> 文档状态：可执行测试基线
>
> 最后核对：2026-07-24
>
> 目标环境：阿里云 ECS/轻量应用服务器、Ubuntu 24.04 LTS x86_64、2 核 2 GB
>
> 使用范围：个人使用与约 30 人低频封闭测试
> 环境性质：`staging / closed technical test`，不是 Production

## 0. 如何使用本手册

严格按编号逐步执行。每个检查点满足“预期结果”后再进入下一步；命中“停止条件”时立即停止，不要尝试跳过、降低安全限制或删除数据。

遇到问题时提供以下信息：

```text
步骤编号：
执行命令：
退出码或错误原文：
docker compose ps 输出（如已安装 Docker）：
free -h 和 df -h / 输出：
你已经尝试过的操作：
```

禁止发送以下内容：

- `.env` 的内容；
- 密码、AccessKey、GitHub Token、Cookie、TOTP 种子或恢复码；
- SSH 私钥、`secrets/backup.key`、数据库备份或用户附件；
- 带用户内容的完整日志。

需要日志时只提供与故障时间相邻的最小片段，并先去除邮箱、IP、令牌、Cookie 和用户内容。

本手册假设你已经能够通过 SSH 登录服务器。除非某一步明确要求，不要在服务器上运行 `docker compose build`、`pnpm` 或 `uv`。

## 1. 范围、限制与固定候选版本

### 1.1 本次部署包含

- Next.js Web；
- FastAPI API；
- Worker；
- PostgreSQL 17；
- Redis；
- Nginx 内部反向代理；
- 附件卷；
- 本机加密备份卷；
- 通过 SSH 隧道进行的浏览器验收。

### 1.2 本次部署不包含

- 公网 Production；
- 域名与 HTTPS；
- 阿里云邮件真实投递；
- OSS 自动异地复制；
- 高可用数据库、托管 Redis 或负载均衡；
- 真实 Production 容量证明；
- 自动批准或触发 Production。

当前代码能够生成加密的邮件发件箱记录，但还没有阿里云邮件推送投递适配器。在适配器完成前，邮箱验证和找回密码不能视为可用。当前备份服务只写入服务器 Docker 卷；复制到私有 OSS 之前，不具备异地灾备能力。

### 1.3 固定候选版本

本手册固定使用已经通过 Main candidate 的不可变候选：

```text
source commit: 0957bc14e6477da7dc145962e48615c1bf1df574
Main run:      30024715871
app version:   0.1.0
Alembic head:  0034_sync_conflicts
offline schema: 4
sync protocol: sync-v1
```

镜像必须按摘要引用：

```text
web:
ghcr.io/greatliverheat605/logion-web@sha256:7210702a926e34717fd5ec2fa942ff3822e1c6b04ce7b9f5eabb280e0f44a5ff

api:
ghcr.io/greatliverheat605/logion-api@sha256:7fdabaa65903dfdb306f206eeb028232b9ac7fff9d2d5163abc316d838a98626

worker:
ghcr.io/greatliverheat605/logion-worker@sha256:75ecdb9a81881959d9091c00adf3bad9a526af3d5899c1e75dbc0512ae3b2335

backup:
ghcr.io/greatliverheat605/logion-backup@sha256:d658a39e87d636053fd594e250f7d6cdcf4735cbae29feccb457668696e8860a
```

这些镜像当前允许匿名拉取。不要改成 `latest`，不要只写普通版本标签，也不要在 2 GB 服务器上重新构建。

## 2. 阿里云控制台预检查

### 2.1 实例要求

最低要求：

| 项目   | 要求                                  |
| ------ | ------------------------------------- |
| CPU    | 2 核                                  |
| 内存   | 2 GB                                  |
| 架构   | x86_64/amd64                          |
| 系统   | Ubuntu 24.04 LTS，Ubuntu 22.04 可接受 |
| 系统盘 | 最低 40 GB，建议 60 GB                |
| 公网   | 只用于 SSH 与拉取依赖                 |
| 备份   | 后续配置私有 OSS                      |

如果实例是 ARM64、Windows、CentOS 7 或已经存有其他重要业务，停止并先确认迁移方案。

### 2.2 安全组

“不开放”不是来源值，而是不要创建对应入方向规则。入方向只保留：

| 协议 | 端口 | 来源                    |
| ---- | ---: | ----------------------- |
| TCP  |   22 | 你的固定公网 IPv4 `/32` |

例如你的公网 IP 是 `203.0.113.10`，来源填写：

```text
203.0.113.10/32
```

不要为下列端口创建入方向规则：

```text
80
443
8080
5432
6379
```

删除或停用下列宽泛规则：

- 全部协议、全部端口；
- 来源 `0.0.0.0/0` 的 SSH；
- 端口范围 `1/65535`；
- 公网开放的 8080、5432 或 6379。

先确认新的 SSH `/32` 规则可用，再删除原有的 `22 + 0.0.0.0/0`，避免锁定自己。

### 检查点 A

- [ ] SSH 可以从你的电脑连接；
- [ ] 服务器是 x86_64；
- [ ] 系统盘至少 40 GB；
- [ ] 安全组没有公开 8080、5432、6379；
- [ ] 没有重要数据需要保留。

## 3. 服务器身份与资源检查

登录服务器后执行：

```bash
cat /etc/os-release
uname -m
uname -r
id
free -h
df -h /
lsblk
```

预期：

- `ID=ubuntu`；
- `VERSION_ID` 为 `24.04` 或 `22.04`；
- `uname -m` 为 `x86_64`；
- 当前用户为 `root`，或具有 `sudo`；
- 根分区可用空间至少 25 GB。

停止条件：

- 架构是 `aarch64`/`arm64`；
- 可用空间不足 25 GB；
- 系统不是受支持的 Ubuntu；
- 服务器已经运行其他数据库或生产服务。

## 4. 系统更新与时间同步

以 root 执行：

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
apt-get install -y ca-certificates curl gnupg git jq openssl chrony
systemctl enable --now chrony
timedatectl status
```

如果升级了内核，先重启服务器：

```bash
test -f /var/run/reboot-required && cat /var/run/reboot-required
```

存在 `/var/run/reboot-required` 时执行：

```bash
reboot
```

等待 1-3 分钟后重新 SSH 登录，并再次执行：

```bash
timedatectl status
```

预期包含：

```text
System clock synchronized: yes
NTP service: active
```

## 5. 配置 Swap

先检查：

```bash
swapon --show
free -h
```

没有 Swap 时创建 2 GB Swap：

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

设置换页策略：

```bash
cat >/etc/sysctl.d/99-logion-memory.conf <<'EOF'
vm.swappiness=20
vm.vfs_cache_pressure=100
EOF

sysctl --system
free -h
swapon --show
```

预期 Swap 约为 2 GB。

停止条件：

- `swapon` 报文件系统不支持；
- 根分区可用空间低于 20 GB；
- Swap 创建后仍未显示。

### 检查点 B

- [ ] 系统补丁已安装；
- [ ] 时间同步正常；
- [ ] Swap 约 2 GB；
- [ ] 根分区可用空间不少于 20 GB。

## 6. 安装 Docker Engine 与 Compose

使用 Docker 官方 Ubuntu 仓库：

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  >/etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
```

配置日志轮转，防止 2 GB 实例磁盘被容器日志填满：

```bash
test ! -e /etc/docker/daemon.json || cp -a /etc/docker/daemon.json /etc/docker/daemon.json.before-logion

cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker
```

验证：

```bash
docker version
docker compose version
docker run --rm hello-world
```

要求 Docker Compose 不低于 `2.24.4`。如果 `hello-world` 失败或 Docker 服务未运行，停止并提供：

```bash
systemctl status docker --no-pager
journalctl -u docker --since '10 minutes ago' --no-pager | tail -n 100
```

## 7. 获取固定版本部署文件

```bash
install -d -m 0750 /opt/logion
cd /opt

git clone https://github.com/greatLiverheat605/Logion.git logion
cd /opt/logion
git checkout --detach 0957bc14e6477da7dc145962e48615c1bf1df574
git status --short --branch
git rev-parse HEAD
```

预期 HEAD：

```text
0957bc14e6477da7dc145962e48615c1bf1df574
```

如果 `/opt/logion` 已经存在，不要覆盖或删除，先检查：

```bash
cd /opt/logion
git status --short --branch
```

## 8. 生成环境密钥

所有密钥在服务器本地生成。不要从示例文件复制开发密钥。

```bash
cd /opt/logion
umask 077
install -d -m 0700 secrets

random_urlsafe() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
}

POSTGRES_PASSWORD="$(random_urlsafe)"
LOGION_SECRET_KEY="$(openssl rand -hex 32)"
TOTP_KEY="$(random_urlsafe)"
EMAIL_KEY="$(random_urlsafe)"
AI_KEY="$(random_urlsafe)"
EXPORT_KEY="$(random_urlsafe)"
BACKUP_KEY="$(random_urlsafe)"

printf '%s' "${BACKUP_KEY}" >secrets/backup.key
chmod 600 secrets/backup.key

cat >.env <<EOF
LOGION_ENV=staging
LOGION_VERSION=0957bc14e6477da7dc145962e48615c1bf1df574
LOGION_LOG_LEVEL=INFO

POSTGRES_DB=logion
POSTGRES_USER=logion
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

LOGION_SECRET_KEY=${LOGION_SECRET_KEY}
LOGION_COOKIE_SECURE=false
LOGION_LEGACY_REGISTRATION_ENABLED=true

LOGION_ALLOWED_ORIGINS=["http://localhost:8080"]
LOGION_WEBAUTHN_RP_ID=localhost
LOGION_WEBAUTHN_RP_NAME=Logion
LOGION_WEBAUTHN_ORIGINS=["http://localhost:8080"]

LOGION_TOTP_ACTIVE_ENCRYPTION_KEY_ID=beta-v1
LOGION_TOTP_ENCRYPTION_KEYS={"beta-v1":"${TOTP_KEY}"}
LOGION_EMAIL_DELIVERY_ACTIVE_ENCRYPTION_KEY_ID=beta-v1
LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS={"beta-v1":"${EMAIL_KEY}"}
LOGION_AI_CREDENTIAL_ACTIVE_ENCRYPTION_KEY_ID=beta-v1
LOGION_AI_CREDENTIAL_ENCRYPTION_KEYS={"beta-v1":"${AI_KEY}"}
LOGION_DATA_EXPORT_ACTIVE_ENCRYPTION_KEY_ID=beta-v1
LOGION_DATA_EXPORT_ENCRYPTION_KEYS={"beta-v1":"${EXPORT_KEY}"}

LOGION_ATTACHMENT_MAX_BYTES=20971520
LOGION_ATTACHMENT_USER_QUOTA_BYTES=524288000
LOGION_FORWARDED_ALLOW_IPS=*

LOGION_BACKUP_RETENTION_DAYS=7
LOGION_BACKUP_SECRET_SOURCE=./secrets/backup.key
LOGION_BACKUP_KEY_ID=beta-v1

LOGION_WEB_IMAGE=ghcr.io/greatliverheat605/logion-web@sha256:7210702a926e34717fd5ec2fa942ff3822e1c6b04ce7b9f5eabb280e0f44a5ff
LOGION_API_IMAGE=ghcr.io/greatliverheat605/logion-api@sha256:7fdabaa65903dfdb306f206eeb028232b9ac7fff9d2d5163abc316d838a98626
LOGION_WORKER_IMAGE=ghcr.io/greatliverheat605/logion-worker@sha256:75ecdb9a81881959d9091c00adf3bad9a526af3d5899c1e75dbc0512ae3b2335
LOGION_BACKUP_IMAGE=ghcr.io/greatliverheat605/logion-backup@sha256:d658a39e87d636053fd594e250f7d6cdcf4735cbae29feccb457668696e8860a

NEXT_TELEMETRY_DISABLED=1
EOF

chmod 600 .env
unset POSTGRES_PASSWORD LOGION_SECRET_KEY
unset TOTP_KEY EMAIL_KEY AI_KEY EXPORT_KEY BACKUP_KEY
```

只检查权限与变量名：

```bash
stat -c '%a %U:%G %n' .env secrets secrets/backup.key
grep -E '^[A-Z0-9_]+=' .env | cut -d= -f1
```

预期：`.env` 与 `backup.key` 权限为 `600`，`secrets` 为 `700`。

禁止执行或发送：

```bash
cat .env
cat secrets/backup.key
env
docker compose config
```

`docker compose config` 会展开密钥；后续只运行 `docker compose config --quiet`。

## 9. 创建 2 GB 低内存覆盖配置

```bash
cd /opt/logion

cat >compose.beta.yaml <<'EOF'
services:
  postgres:
    mem_limit: 384m
    mem_reservation: 192m
    pids_limit: 160
    command:
      - postgres
      - -c
      - shared_buffers=96MB
      - -c
      - work_mem=4MB
      - -c
      - maintenance_work_mem=48MB
      - -c
      - max_connections=40

  redis:
    mem_limit: 96m
    mem_reservation: 48m
    pids_limit: 80
    command:
      - redis-server
      - --appendonly
      - "yes"
      - --save
      - "60"
      - "1"
      - --maxmemory
      - 72mb
      - --maxmemory-policy
      - noeviction

  attachment-init:
    mem_limit: 64m
    pids_limit: 50

  api:
    mem_limit: 320m
    mem_reservation: 160m
    pids_limit: 160

  worker:
    mem_limit: 256m
    mem_reservation: 96m
    pids_limit: 120

  web:
    mem_limit: 256m
    mem_reservation: 128m
    pids_limit: 120

  reverse-proxy:
    mem_limit: 64m
    mem_reservation: 24m
    pids_limit: 80
    ports: !override
      - "127.0.0.1:8080:8080"

  backup:
    mem_limit: 256m
    mem_reservation: 64m
    pids_limit: 120
EOF
```

定义一个简短命令，减少遗漏覆盖文件的风险：

```bash
cat >/usr/local/bin/logion-compose <<'EOF'
#!/bin/sh
set -eu
cd /opt/logion
exec docker compose -f compose.yaml -f compose.beta.yaml "$@"
EOF

chmod 0755 /usr/local/bin/logion-compose
```

静默验证：

```bash
logion-compose config --quiet
```

检查 8080 最终只绑定回环地址。该命令只投影 `reverse-proxy` 的端口字段，不输出服务环境变量：

```bash
logion-compose config --format json \
  | jq '.services["reverse-proxy"].ports'
clear
```

预期包含：

```text
host_ip: 127.0.0.1
published: "8080"
```

如果 `!override` 无法解析，停止并升级 Compose。不要删除 `!override` 后继续，因为原始 Compose 会把 8080 绑定到所有网卡。

### 检查点 C

- [ ] Docker 与 Compose 正常；
- [ ] Git HEAD 是固定候选提交；
- [ ] `.env` 与备份密钥权限正确；
- [ ] `config --quiet` 通过；
- [ ] 8080 只绑定 `127.0.0.1`。

## 10. 拉取不可变镜像

```bash
cd /opt/logion
logion-compose pull
```

拉取过程不能出现 `Building`。验证摘要：

```bash
docker image inspect \
  ghcr.io/greatliverheat605/logion-web@sha256:7210702a926e34717fd5ec2fa942ff3822e1c6b04ce7b9f5eabb280e0f44a5ff \
  --format '{{json .RepoDigests}}'

docker image inspect \
  ghcr.io/greatliverheat605/logion-api@sha256:7fdabaa65903dfdb306f206eeb028232b9ac7fff9d2d5163abc316d838a98626 \
  --format '{{json .RepoDigests}}'
```

如果 GHCR 返回 `401`，停止并确认包可见性；不要把 GitHub Token 写入 `.env` 或命令历史。

## 11. 启动底层服务与迁移数据库

先启动 PostgreSQL、Redis 和附件卷初始化：

```bash
logion-compose up -d --no-build postgres redis attachment-init
logion-compose ps -a
```

等待 PostgreSQL 与 Redis 为 healthy。查看有限日志：

```bash
logion-compose logs --tail 80 postgres redis attachment-init
```

执行迁移：

```bash
logion-compose run --rm --no-deps api \
  alembic -c apps/api/alembic.ini upgrade head
```

确认迁移：

```bash
logion-compose run --rm --no-deps api \
  alembic -c apps/api/alembic.ini current
```

预期包含：

```text
0034_sync_conflicts
```

迁移失败时不要重复执行、不要删除卷，提供迁移错误和：

```bash
logion-compose ps
logion-compose logs --tail 100 postgres
```

## 12. 启动应用

```bash
logion-compose up -d --no-build --wait --timeout 240 \
  api worker web reverse-proxy
```

应用健康后启动备份：

```bash
logion-compose up -d --no-build backup
logion-compose ps
```

停止条件：任一服务为 `restarting`、`unhealthy` 或非预期 `exited`。

## 13. 服务器本地验收

反向代理：

```bash
curl --fail --silent http://127.0.0.1:8080/healthz
echo
```

预期：

```text
ok
```

Web：

```bash
curl --fail --silent http://127.0.0.1:8080/health
echo
```

API 及其依赖：

```bash
logion-compose exec -T api python -c \
  "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
```

响应必须同时包含：

```text
"application":"ok"
"database":"ok"
"redis":"ok"
```

PostgreSQL：

```bash
logion-compose exec -T postgres pg_isready -U logion -d logion
```

Redis：

```bash
logion-compose exec -T redis redis-cli ping
```

预期：

```text
PONG
```

资源与 OOM：

```bash
free -h
df -h /
docker stats --no-stream

docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
```

所有容器必须为 `OOMKilled=false`。

## 14. 通过 SSH 隧道访问

在自己的 Windows 电脑新开 PowerShell，保持此命令运行：

```powershell
ssh -L 8080:127.0.0.1:8080 root@<SERVER_IP>
```

浏览器访问：

```text
http://localhost:8080
```

不要访问公网 IP 的 8080。服务器检查：

```bash
ss -lntp | grep ':8080'
```

预期只出现：

```text
127.0.0.1:8080
```

## 15. 创建第一个测试账户

邮件投递适配器未完成，因此先使用受限旧注册接口创建一个测试账户。密码至少 12 位；输入过程不会回显。

```bash
read -r -p '测试邮箱: ' LOGION_TEST_EMAIL
read -r -s -p '测试密码（至少 12 位）: ' LOGION_TEST_PASSWORD
echo

PAYLOAD="$(
  jq -nc \
    --arg email "${LOGION_TEST_EMAIL}" \
    --arg password "${LOGION_TEST_PASSWORD}" \
    '{
      email: $email,
      password: $password,
      device_name: "Initial server bootstrap",
      platform: "web"
    }'
)"

printf '%s' "${PAYLOAD}" \
  | curl --fail-with-body \
      --silent \
      --output /dev/null \
      --write-out 'HTTP %{http_code}\n' \
      --request POST \
      --header 'Origin: http://localhost:8080' \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      http://127.0.0.1:8080/api/v1/auth/register

unset LOGION_TEST_EMAIL LOGION_TEST_PASSWORD PAYLOAD
```

预期：

```text
HTTP 201
```

随后在浏览器打开 `http://localhost:8080/auth/login` 登录。

确认账户可登录后，关闭旧注册接口：

```bash
cd /opt/logion
sed -i \
  's/^LOGION_LEGACY_REGISTRATION_ENABLED=.*/LOGION_LEGACY_REGISTRATION_ENABLED=false/' \
  .env

logion-compose up -d --no-build --force-recreate api worker
```

阿里云邮件适配器完成前，不开放 30 人自由注册。需要额外测试账户时，由操作者临时启用旧注册、创建账户后立即再次关闭，并保留操作记录。

### 检查点 D

- [ ] 首页、登录页真实渲染；
- [ ] 第一个账户可以登录；
- [ ] 个人工作区已自动创建；
- [ ] 旧注册接口已经关闭；
- [ ] 容器没有 OOM 或反复重启。

## 16. 功能验收顺序

使用测试数据依次验证：

1. 登录与退出；
2. 工作区和 Space；
3. 目标、计划与任务；
4. 今日执行与证据；
5. 笔记、资源和附件；
6. 复习与测验；
7. 备考、自主学习和研究页面；
8. AI Provider 配置、模型发现、预算和草稿；
9. 离线编辑、Outbox 和重新联网同步；
10. 第二设备登录与同步；
11. 冲突中心；
12. 数据导出、导入预览与取消；
13. TOTP 与恢复码；
14. Passkey（仅通过 `localhost` SSH 隧道测试）；
15. 审计日志。

每完成一项记录：测试账户、设备、时间、操作、预期、实际、错误码和是否产生数据。不要在记录中保存密码、令牌或用户内容。

## 17. 备份验证

查看备份文件名与大小：

```bash
logion-compose exec -T backup sh -c 'ls -lh /backups'
```

选择一个确切文件验证：

```bash
logion-compose exec -T backup \
  logion-verify-backup \
  /backups/logion-<TIMESTAMP>-beta-v1.backup
```

必须同时存在 `.backup` 与 `.backup.sha256`。不要把备份密钥、备份文件或数据库 dump 发到聊天中。

当前仍是同机备份。进入多人测试前必须：

1. 创建私有 OSS Bucket；
2. 禁止公共读写；
3. 开启服务端加密、版本控制或保留策略；
4. 优先使用 ECS RAM 角色，不在服务器保存长期 AccessKey；
5. 每日复制加密备份及 `.sha256` 到 OSS；
6. 至少保留 7 天；
7. 完成一次空环境恢复演练。

恢复步骤遵循 [backup-restore.md](./backup-restore.md)，不要直接恢复覆盖当前数据库。

## 18. 日常监控

每天：

```bash
logion-compose ps
free -h
df -h /
docker stats --no-stream
```

检查近期错误：

```bash
logion-compose logs --since 24h \
  | grep -Ei 'error|exception|failed|oom' \
  | tail -n 100
```

2 GB 实例停止扩展用户的条件：

- 可用内存持续低于 100 MB；
- Swap 持续超过 1 GB；
- 任一容器 `OOMKilled=true`；
- 磁盘使用率超过 80%；
- API、Worker、Web 或数据库反复重启；
- p95 响应持续超过 1 秒；
- 附件或 AI 操作影响普通页面。

命中任一条件时应减少测试范围或升级到 4 GB，不能通过删除测试、关闭安全控制或扩大 Redis 淘汰策略解决。

## 19. 停止、重启与禁止命令

停止应用但保留数据：

```bash
logion-compose stop
```

重新启动：

```bash
logion-compose start
```

重新创建容器但保留卷：

```bash
logion-compose up -d --no-build
```

禁止未经备份和人工确认运行：

```bash
docker compose down --volumes
docker volume prune
docker system prune -a --volumes
rm -rf /var/lib/docker
rm -rf /opt/logion
```

这些命令可能删除数据库、Redis、附件、备份或部署证据。

## 20. 更新与回滚

更新前记录：

- 新源提交；
- 成功的 Main run ID；
- 四个镜像摘要；
- 当前和目标 Alembic head；
- 当前离线 schema 与同步协议；
- 最近加密备份文件、校验值与验证时间。

更新顺序固定为：

1. 验证当前备份；
2. 获取已审核的新候选证据；
3. 检出精确源提交；
4. 更新 `.env` 中四个镜像摘要；
5. 运行 `logion-compose config --quiet`；
6. `logion-compose pull`；
7. 检查数据库、离线和同步兼容性；
8. 执行迁移；
9. `--no-build` 启动；
10. 重跑健康、资源和人工 Smoke。

数据库迁移后不能假设旧镜像可回滚。旧二进制无法读取新 schema 时应保留兼容候选并前向修复，恢复数据库必须经过人工批准和恢复演练。

## 21. 常见故障路由

### 21.1 `no matching manifest for linux/arm64`

服务器是 ARM 架构。停止部署，换用 x86_64 实例或先构建并审核 ARM 候选，不能在服务器临时构建。

### 21.2 `!override` 无法解析

Compose 版本过旧。提供 `docker compose version`，升级 Compose 后重试。不要删除端口覆盖继续运行。

### 21.3 GHCR `401` 或 `denied`

先确认镜像包是否仍允许匿名拉取。若改为私有，使用只有 `read:packages` 权限的短期 Token，通过 `docker login ghcr.io --password-stdin` 输入；不要把 Token 写入 `.env`、脚本或聊天。

### 21.4 API ready 返回 503

执行：

```bash
logion-compose ps
logion-compose logs --tail 100 api postgres redis
```

不要重复迁移或删除卷。

### 21.5 浏览器打不开页面

依次检查：

```bash
curl -fsS http://127.0.0.1:8080/healthz
ss -lntp | grep ':8080'
```

然后确认本机 SSH 隧道仍在运行、访问的是 `http://localhost:8080`，而不是服务器公网 IP。

### 21.6 注册返回 403

确认请求头是：

```text
Origin: http://localhost:8080
```

不要通过放宽全部 CORS 来源解决。

### 21.7 容器被 OOMKilled

执行：

```bash
free -h
docker stats --no-stream
docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
```

停止新增用户和 AI/附件测试。持续 OOM 时升级到 4 GB。

### 21.8 Backup 反复退出

检查文件权限和有限日志：

```bash
stat -c '%a %U:%G %n' secrets/backup.key
logion-compose logs --tail 100 backup
```

不要显示 `backup.key` 内容。

## 22. 阶段完成标准

只有同时满足以下条件，才可称为“Logion 阿里云封闭技术测试环境已部署”：

- [ ] 固定提交与四个镜像摘要一致；
- [ ] 没有服务器本地构建；
- [ ] 8080 只监听 `127.0.0.1`；
- [ ] PostgreSQL、Redis、API、Worker、Web、Nginx healthy；
- [ ] Alembic head 为 `0034_sync_conflicts`；
- [ ] API ready 包含 application/database/redis；
- [ ] 第一个测试账户可以登录；
- [ ] 旧注册接口已关闭；
- [ ] 无 OOMKilled；
- [ ] 加密备份已生成并验证；
- [ ] 已记录邮件和 OSS 未完成项；
- [ ] 未开放 Production，未声称高可用。

30 人 Beta 前还必须补齐域名/HTTPS、阿里云邮件投递、OSS 自动异地备份、告警、真实双设备、实体 Safari/iOS、读屏和生产型容量验证。
