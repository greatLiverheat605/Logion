# 阿里云 2 核 2 GB 封闭测试部署手册

> 文档状态：历史无域名候选的可执行测试基线；`0.1.0-rc2` 使用生产发布与邮件预发布手册
>
> 最后核对：2026-07-27
>
> 目标环境：阿里云 ECS/轻量应用服务器、Ubuntu 24.04 LTS x86_64、2 核 2 GB
>
> 使用范围：个人使用与最多 10 人低频封闭测试
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

本手册固定的旧候选只能生成加密邮件发件箱记录，不包含阿里云投递适配器，因此该候选的邮箱
验证和找回密码不能视为可用。当前仓库的 `0.1.0-rc2` 已新增适配器，但必须改按
[`aliyun-production-release.md`](./aliyun-production-release.md) 和
[`aliyun-directmail-prerelease.md`](./aliyun-directmail-prerelease.md) 创建新候选并验收。备份复制到
私有 OSS 之前，任何候选都不具备异地灾备能力。

因此，若仍回放本手册固定的历史候选，服务器已有可登录 Owner 时应优先执行保留数据替换，既有账户可继续登录；全新安装或空环境重置无法通过正常产品链路创建并验证首个 Owner。不得通过开启 legacy/open 注册、读取数据库密文或手工伪造验证状态绕过。当前 `0.1.0-rc2` 不得继续照抄本手册的旧提交和旧镜像摘要，应切换到上面的两份 rc2 手册。

### 1.3 固定候选版本

本手册固定使用已经通过 Main candidate 的不可变候选：

```text
source commit: dd1382b12cfedabc5f57c99817268b46285053b2
Main run:      30196665349
app version:   0.1.0
Alembic head:  0034_sync_conflicts
offline schema: 4
sync protocol: sync-v1
```

四个应用镜像必须按摘要引用：

```text
web:
ghcr.io/greatliverheat605/logion-web@sha256:4adcdd82538b995dc41d4cdbfefed3a19c2d4d5932e38d7b01889503e1286427

api:
ghcr.io/greatliverheat605/logion-api@sha256:0cdda3f7c638101e784c650639f06d27d57f4beff1764d36136e304503a995a2

worker:
ghcr.io/greatliverheat605/logion-worker@sha256:c96a9d2eb7ad2e9e35eb6c3a559b95cd947f68d430a2cde4bbb92757a1b6cbd4

backup:
ghcr.io/greatliverheat605/logion-backup@sha256:e3aa881a0aca6ce5dafa3ea111a78d12c1643b30a3d576b1d6e648f1d65ccd67
```

三个直接运行的基础镜像通过 AWS Public ECR 的 Docker Official Images 镜像按摘要引用；下列摘要与对应 Docker Hub 官方标签的多架构 manifest 摘要一致：

```text
postgres 17.10-alpine:
public.ecr.aws/docker/library/postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

redis 8.6.1-alpine:
public.ecr.aws/docker/library/redis@sha256:2afba59292f25f5d1af200496db41bea2c6c816b059f57ae74703a50a03a27d0

nginx 1.29.6-alpine:
public.ecr.aws/docker/library/nginx@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0
```

阿里云部分地域无法直接连接 Docker Hub，专属镜像加速器也可能对新标签返回 `not found`。本手册因此不依赖 Docker Hub 在线拉取，且不使用来源不明的公共镜像站。GHCR 与 Public ECR 镜像当前允许匿名拉取；不要改成 `latest`，不要只写普通版本标签，也不要在 2 GB 服务器上重新构建。

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
- [ ] 已确认是全新服务器，或已为旧版本选择“保留数据替换/明确空环境重置”。

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

## 7. 识别旧版本并获取固定版本

本节分为两条路径：

- `/opt/logion` 不存在：执行 7.2 的全新安装路径；
- `/opt/logion` 已存在：执行 7.1 的旧版本处理路径，然后直接进入第 8 节。

默认保留 PostgreSQL、Redis、附件和备份卷。不要把“清除旧版本”理解为删除数据卷；旧源码目录只在新版本验收并稳定运行后清理。

### 7.1 已有旧版本：清点、停写、备份和归档

先创建仅 root 可读的升级记录目录，并确认旧部署位置：

```bash
install -d -m 0700 /root/logion-upgrade
date -u +%Y-%m-%dT%H:%M:%SZ | tee /root/logion-upgrade/started-at.txt

test -d /opt/logion
test -f /opt/logion/compose.yaml
test -f /opt/logion/.env
test ! -L /opt/logion/.env
test -f /opt/logion/secrets/backup.key
test ! -L /opt/logion/secrets/backup.key
stat -c '%a %U:%G %n' \
  /opt/logion/.env \
  /opt/logion/secrets \
  /opt/logion/secrets/backup.key
```

停止条件：旧目录不在 `/opt/logion`、`.env` 或备份密钥缺失、文件是符号链接、`.env`/密钥可被无关用户读取，或旧部署没有可验证的 Backup 服务。备份容器以非 root 用户运行；密钥必须由 `root` 持有，并仅向 Compose 已配置的专用补充组 `10001` 提供只读权限。此时不要生成新密钥，也不要删除旧目录或卷。

在同一个 Bash 会话中定义旧部署命令。`-p logion` 与仓库顶层 `name: logion` 共同固定 Compose 项目名，避免目录改名后生成另一组卷：

```bash
cd /opt/logion

OLD_COMPOSE=(docker compose -p logion -f compose.yaml)
if test -f compose.beta.yaml; then
  OLD_COMPOSE+=(-f compose.beta.yaml)
fi

grep -Eq '^name:[[:space:]]+logion[[:space:]]*$' compose.yaml
"${OLD_COMPOSE[@]}" config --quiet
"${OLD_COMPOSE[@]}" ps -a
docker compose ls
docker volume ls --filter label=com.docker.compose.project=logion
```

至少应看到 `logion_postgres_data`、`logion_attachments_data` 和 `logion_backup_data`。如果旧环境已有用户但这些卷缺失，停止；不要让新 Compose 自动创建空卷后继续。

记录不含秘密的版本和数据概况：

```bash
git status --short --branch
git rev-parse HEAD | tee /root/logion-upgrade/old-source-sha.txt

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"' \
  | tee /root/logion-upgrade/old-alembic-head.txt

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users"' \
  | tee /root/logion-upgrade/old-user-count.txt

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM workspace_memberships WHERE role = \$\$owner\$\$ AND status = \$\$active\$\$"' \
  | tee /root/logion-upgrade/old-active-owner-count.txt
```

升级前先确认旧环境仍健康。若任一核心服务异常，停止并先定位故障，避免把既有故障带入替换过程：

```bash
"${OLD_COMPOSE[@]}" ps
curl --fail --silent http://127.0.0.1:8080/healthz
echo
```

开始维护窗口。先停止入口和所有应用写入者，保留 PostgreSQL 与 Redis 运行：

```bash
"${OLD_COMPOSE[@]}" stop reverse-proxy web api worker backup
"${OLD_COMPOSE[@]}" ps -a
```

生成一次加密备份，并通过同一 Backup 镜像与同一密钥验证：

```bash
"${OLD_COMPOSE[@]}" run --rm --no-deps \
  -e LOGION_BACKUP_ONCE=true \
  backup

LATEST_BACKUP="$("${OLD_COMPOSE[@]}" run --rm --no-deps \
  --entrypoint sh backup -c \
  'find /backups -maxdepth 1 -type f -name "logion-*.backup" | sort | tail -n 1')"

test -n "${LATEST_BACKUP}"
"${OLD_COMPOSE[@]}" run --rm --no-deps \
  --entrypoint logion-verify-backup \
  backup "${LATEST_BACKUP}"
```

把加密备份和校验文件复制到 Compose 卷外。此步骤不解密数据：

```bash
EXPORT_CONTAINER=logion-upgrade-backup-export
docker rm -f "${EXPORT_CONTAINER}" 2>/dev/null || true

"${OLD_COMPOSE[@]}" run --name "${EXPORT_CONTAINER}" -d --no-deps \
  --entrypoint sh backup -c 'sleep 600'

docker cp \
  "${EXPORT_CONTAINER}:${LATEST_BACKUP}" \
  /root/logion-upgrade/
docker cp \
  "${EXPORT_CONTAINER}:${LATEST_BACKUP}.sha256" \
  /root/logion-upgrade/
docker rm -f "${EXPORT_CONTAINER}"

chmod 600 /root/logion-upgrade/logion-*.backup*
cd /root/logion-upgrade
sha256sum -c "$(basename "${LATEST_BACKUP}").sha256"
```

随后执行一次隔离恢复演练。恢复目标是临时空数据库，不是当前数据库：

```bash
cd /opt/logion
RESTORE_DB="logion_upgrade_restore_$(date -u +%Y%m%d%H%M%S)"

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'createdb -U "$POSTGRES_USER" "$1"' sh "${RESTORE_DB}"

"${OLD_COMPOSE[@]}" run --rm --no-deps \
  --entrypoint logion-restore-backup \
  backup \
  "${LATEST_BACKUP}" \
  "${RESTORE_DB}" \
  "/tmp/${RESTORE_DB}_attachments"

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$1" -Atc "SELECT version_num FROM alembic_version"' \
  sh "${RESTORE_DB}"

case "${RESTORE_DB}" in
  logion_upgrade_restore_*) ;;
  *) echo '拒绝删除未识别的恢复演练数据库' >&2; exit 1 ;;
esac

"${OLD_COMPOSE[@]}" exec -T postgres sh -c \
  'dropdb -U "$POSTGRES_USER" "$1"' sh "${RESTORE_DB}"
```

把 `/root/logion-upgrade/` 中最新的 `.backup`、`.sha256` 和旧版本记录复制到服务器外。备份密钥也必须通过独立的安全渠道保存；不要把密钥与备份放在同一个公开位置。未完成服务器外复制前，不得执行空环境重置或清理旧目录。

#### 可选：明确不要旧数据时执行空环境重置

默认跳过本小节。只有你确认旧 PostgreSQL、Redis、附件和服务器内备份全部不再需要，并且服务器外的加密备份、校验文件和对应备份密钥均已验证可用时，才执行以下命令。

先检查四个精确命名卷，不允许用 `prune` 代替：

```bash
docker volume inspect \
  logion_postgres_data \
  logion_redis_data \
  logion_attachments_data \
  logion_backup_data
```

关闭 `logion` 项目的全部容器，但尚不删除卷：

```bash
cd /opt/logion
"${OLD_COMPOSE[@]}" down --remove-orphans
docker volume ls --filter label=com.docker.compose.project=logion
```

需要人工输入完整确认词才能删除四个精确命名卷：

```bash
read -r -p '输入 DELETE_LOGION_LOCAL_DATA 确认清空旧数据: ' CONFIRM
test "${CONFIRM}" = DELETE_LOGION_LOCAL_DATA
unset CONFIRM

docker volume rm \
  logion_postgres_data \
  logion_redis_data \
  logion_attachments_data \
  logion_backup_data

touch /root/logion-upgrade/empty-reset-approved
docker volume ls --filter label=com.docker.compose.project=logion
```

任一卷提示仍在使用或名称不匹配时立即停止，不要改用 `docker volume prune`、`docker system prune -a --volumes` 或删除 `/var/lib/docker`。

归档旧源码并获取新版本。归档目录暂时保留旧 `.env` 与密钥，只允许 root 读取：

```bash
cd /opt
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OLD_DIR="/opt/logion.before-${STAMP}"
mv /opt/logion "${OLD_DIR}"
chmod 0700 "${OLD_DIR}"
printf '%s\n' "${OLD_DIR}" >/root/logion-upgrade/old-directory.txt

git clone https://github.com/greatLiverheat605/Logion.git /opt/logion
cd /opt/logion
git checkout --detach dd1382b12cfedabc5f57c99817268b46285053b2

if ! test -f /root/logion-upgrade/empty-reset-approved; then
  install -m 0600 "${OLD_DIR}/.env" /opt/logion/.env
  install -d -m 0700 /opt/logion/secrets
  install -m 0640 \
    "${OLD_DIR}/secrets/backup.key" \
    /opt/logion/secrets/backup.key
  chown root:10001 /opt/logion/secrets/backup.key
fi
```

如果保留了数据卷，此时旧应用写入者仍停止，继续执行 8.2，不要执行 8.1。如果明确执行了空环境重置，则继续执行 8.1，生成一套只用于新空环境的密钥。

### 7.2 全新安装：获取固定源码

只有 `/opt/logion` 不存在时执行：

```bash
test ! -e /opt/logion
cd /opt

git clone https://github.com/greatLiverheat605/Logion.git logion
cd /opt/logion
git checkout --detach dd1382b12cfedabc5f57c99817268b46285053b2
git status --short --branch
git rev-parse HEAD
```

预期 HEAD：

```text
dd1382b12cfedabc5f57c99817268b46285053b2
```

## 8. 生成环境密钥

所有密钥在服务器本地生成。不要从示例文件复制开发密钥。

### 8.1 全新安装

只有执行了 7.2 的全新安装路径，或在 7.1 明确完成空环境重置时，运行本小节：

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

read -r -p '首个 Owner 邮箱: ' LOGION_BOOTSTRAP_OWNER_EMAIL

printf '%s' "${BACKUP_KEY}" >secrets/backup.key
chown root:10001 secrets/backup.key
chmod 640 secrets/backup.key

cat >.env <<EOF
LOGION_ENV=staging
LOGION_VERSION=dd1382b12cfedabc5f57c99817268b46285053b2
LOGION_LOG_LEVEL=INFO

POSTGRES_DB=logion
POSTGRES_USER=logion
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

LOGION_SECRET_KEY=${LOGION_SECRET_KEY}
LOGION_COOKIE_SECURE=false
LOGION_REFRESH_REUSE_GRACE_SECONDS=10
LOGION_LEGACY_REGISTRATION_ENABLED=false
LOGION_REGISTRATION_MODE=invite
LOGION_BOOTSTRAP_OWNER_EMAIL=${LOGION_BOOTSTRAP_OWNER_EMAIL}

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

LOGION_WEB_IMAGE=ghcr.io/greatliverheat605/logion-web@sha256:4adcdd82538b995dc41d4cdbfefed3a19c2d4d5932e38d7b01889503e1286427
LOGION_API_IMAGE=ghcr.io/greatliverheat605/logion-api@sha256:0cdda3f7c638101e784c650639f06d27d57f4beff1764d36136e304503a995a2
LOGION_WORKER_IMAGE=ghcr.io/greatliverheat605/logion-worker@sha256:c96a9d2eb7ad2e9e35eb6c3a559b95cd947f68d430a2cde4bbb92757a1b6cbd4
LOGION_BACKUP_IMAGE=ghcr.io/greatliverheat605/logion-backup@sha256:e3aa881a0aca6ce5dafa3ea111a78d12c1643b30a3d576b1d6e648f1d65ccd67

NEXT_TELEMETRY_DISABLED=1
EOF

chmod 600 .env
unset POSTGRES_PASSWORD LOGION_SECRET_KEY
unset TOTP_KEY EMAIL_KEY AI_KEY EXPORT_KEY BACKUP_KEY
```

### 8.2 已有旧版本：保留密钥并更新非秘密配置

只有执行了 7.1 的保留数据替换路径时运行本小节。必须继续使用旧数据库对应的数据库密码、认证密钥、TOTP/邮件/AI/导出加密密钥和备份密钥；重新生成这些值会造成登录失效或既有密文、备份无法恢复。

先确认 7.1 已复制必要文件：

```bash
cd /opt/logion
test -f .env
test ! -L .env
test -f secrets/backup.key
test ! -L secrets/backup.key
test -f /root/logion-upgrade/old-active-owner-count.txt
```

仅替换候选版本、镜像和注册门控等非秘密项：

```bash
set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*$|${key}=${value}|" .env
  else
    printf '%s=%s\n' "${key}" "${value}" >>.env
  fi
}

set_env_value LOGION_ENV staging
set_env_value LOGION_VERSION dd1382b12cfedabc5f57c99817268b46285053b2
set_env_value LOGION_LEGACY_REGISTRATION_ENABLED false
set_env_value LOGION_REGISTRATION_MODE invite
set_env_value LOGION_BACKUP_SECRET_SOURCE ./secrets/backup.key

set_env_value LOGION_WEB_IMAGE \
  ghcr.io/greatliverheat605/logion-web@sha256:4adcdd82538b995dc41d4cdbfefed3a19c2d4d5932e38d7b01889503e1286427
set_env_value LOGION_API_IMAGE \
  ghcr.io/greatliverheat605/logion-api@sha256:0cdda3f7c638101e784c650639f06d27d57f4beff1764d36136e304503a995a2
set_env_value LOGION_WORKER_IMAGE \
  ghcr.io/greatliverheat605/logion-worker@sha256:c96a9d2eb7ad2e9e35eb6c3a559b95cd947f68d430a2cde4bbb92757a1b6cbd4
set_env_value LOGION_BACKUP_IMAGE \
  ghcr.io/greatliverheat605/logion-backup@sha256:e3aa881a0aca6ce5dafa3ea111a78d12c1643b30a3d576b1d6e648f1d65ccd67

OLD_OWNER_COUNT="$(tr -d '[:space:]' </root/logion-upgrade/old-active-owner-count.txt)"
case "${OLD_OWNER_COUNT}" in
  ''|*[!0-9]*) echo '旧 Owner 数量记录无效' >&2; exit 1 ;;
esac

if test "${OLD_OWNER_COUNT}" -gt 0; then
  set_env_value LOGION_BOOTSTRAP_OWNER_EMAIL ''
else
  read -r -p '首个 Owner 邮箱: ' LOGION_BOOTSTRAP_OWNER_EMAIL
  set_env_value LOGION_BOOTSTRAP_OWNER_EMAIL "${LOGION_BOOTSTRAP_OWNER_EMAIL}"
  unset LOGION_BOOTSTRAP_OWNER_EMAIL
fi

chmod 600 .env
chown root:10001 secrets/backup.key
chmod 640 secrets/backup.key
chmod 700 secrets
unset OLD_OWNER_COUNT
unset -f set_env_value
```

不要复制旧源码、旧 Compose 覆盖文件或示例密钥；只保留上述实际运行数据所必需的密钥与配置值。

只检查权限与变量名：

```bash
stat -c '%u:%g:%a %n' .env secrets secrets/backup.key
grep -E '^[A-Z0-9_]+=' .env | cut -d= -f1
```

预期：`.env` 为 `0:0:600`，`secrets` 为 `0:0:700`，`backup.key` 为 `0:10001:640`。`10001` 是备份容器的专用补充组；不得向该宿主机组添加登录用户。

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

创建阿里云网络使用的基础镜像注册表覆盖。该文件只改变镜像来源，不改变服务、端口、卷或数据模型：

```bash
cat >compose.registry.yaml <<'EOF'
services:
  postgres:
    image: public.ecr.aws/docker/library/postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

  redis:
    image: public.ecr.aws/docker/library/redis@sha256:2afba59292f25f5d1af200496db41bea2c6c816b059f57ae74703a50a03a27d0

  reverse-proxy:
    image: public.ecr.aws/docker/library/nginx@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0
EOF

chmod 0644 compose.registry.yaml
```

定义一个简短命令，减少遗漏低内存、端口和注册表覆盖文件的风险：

```bash
cat >/usr/local/bin/logion-compose <<'EOF'
#!/bin/sh
set -eu
cd /opt/logion
exec docker compose \
  -p logion \
  -f compose.yaml \
  -f compose.beta.yaml \
  -f compose.registry.yaml \
  "$@"
EOF

chmod 0755 /usr/local/bin/logion-compose
```

静默验证：

```bash
logion-compose config --quiet
logion-compose config --images
```

`config --images` 必须显示四个 `ghcr.io/greatliverheat605/logion-*` 摘要和三个 `public.ecr.aws/docker/library/*` 摘要，不能再显示 `docker.io/library/postgres`、`docker.io/library/redis` 或 `docker.io/library/nginx`。

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
- [ ] 三个基础镜像已由 `compose.registry.yaml` 固定到 Public ECR 摘要；
- [ ] 8080 只绑定 `127.0.0.1`。

## 10. 拉取不可变镜像

### 10.1 注册表连通性与正常拉取

先验证两个实际使用的注册表可连接。以下命令只输出 HTTP 状态码，不发送凭据：

```bash
curl -sS -o /dev/null -I \
  --connect-timeout 10 \
  -w 'Public ECR HTTP %{http_code}\n' \
  https://public.ecr.aws/v2/

curl -sS -o /dev/null -I \
  --connect-timeout 10 \
  -w 'GHCR HTTP %{http_code}\n' \
  https://ghcr.io/v2/
```

Public ECR 常见响应为 `401`，GHCR 对 `HEAD /v2/` 常见响应为 `405`；两者都表示 DNS、TCP 和 TLS 已连接。`000`、超时或连接拒绝必须停止处理网络问题。

```bash
cd /opt/logion
logion-compose config --quiet
logion-compose config --images
logion-compose pull
```

### 10.2 拉取过慢时的安全处理

只要下载字节仍在增加，优先等待完成。中断 `docker pull` 不会修改数据库或命名卷；连续 15 分钟没有任何进度时可按 `Ctrl-C`，随后重跑相同命令，Docker 会复用已经完整下载的内容层。

先检查磁盘，根分区可用空间低于 15 GB 时停止，不要通过删除数据卷腾挪空间：

```bash
df -h /
docker system df
```

2 核 2 GB 服务器可把并发限制为 2，并分组拉取，减少多条跨境连接互相争抢：

```bash
cd /opt/logion

COMPOSE_PARALLEL_LIMIT=2 logion-compose pull \
  postgres redis reverse-proxy

COMPOSE_PARALLEL_LIMIT=2 logion-compose pull \
  api worker web backup attachment-init
```

不要使用 `--ignore-pull-failures`，也不要在镜像未完整到位时执行迁移。阿里云实例有较低公网带宽上限时，可在控制台临时提高带宽，拉取和摘要验证完成后再恢复原值。

如果 Public ECR/GHCR 可以连接但传输速度无法接受，可以在一台可信且网络较快、安装了 Docker 的电脑上准备离线镜像包。先在服务器生成只包含镜像引用的清单：

```bash
cd /opt/logion
logion-compose config --images \
  | sort -u \
  >/root/logion-image-references.txt
```

把该清单和同一固定提交的部署文件复制到可信电脑。在可信电脑执行：

```bash
while IFS= read -r IMAGE; do
  docker pull "${IMAGE}"
  docker image inspect "${IMAGE}" >/dev/null
done <logion-image-references.txt

mapfile -t IMAGES <logion-image-references.txt
docker save "${IMAGES[@]}" \
  | gzip -1 \
  >logion-images-dd1382b.tar.gz

sha256sum logion-images-dd1382b.tar.gz \
  >logion-images-dd1382b.tar.gz.sha256
unset IMAGES IMAGE
```

通过私有 OSS（禁止公共读写，优先 RAM 角色或短期凭据）或受信任的 SSH 通道传到服务器。不要把镜像包上传到公开网盘。服务器端先验证再导入：

```bash
sha256sum -c logion-images-dd1382b.tar.gz.sha256
gzip -dc logion-images-dd1382b.tar.gz | docker load

while IFS= read -r IMAGE; do
  docker image inspect "${IMAGE}" >/dev/null
done </root/logion-image-references.txt
unset IMAGE
```

只有七个精确引用全部能被 `docker image inspect` 找到时，才可以跳过在线 `logion-compose pull` 并继续第 11 节。离线包校验失败、加载后缺少精确引用或来源不可信时必须停止。

### 10.3 拉取结果验证

拉取过程不能出现 `Building`，也不能再请求 `docker.io/library/*`。验证七个精确摘要：

```bash
for IMAGE in \
  public.ecr.aws/docker/library/postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193 \
  public.ecr.aws/docker/library/redis@sha256:2afba59292f25f5d1af200496db41bea2c6c816b059f57ae74703a50a03a27d0 \
  public.ecr.aws/docker/library/nginx@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0 \
  ghcr.io/greatliverheat605/logion-web@sha256:4adcdd82538b995dc41d4cdbfefed3a19c2d4d5932e38d7b01889503e1286427 \
  ghcr.io/greatliverheat605/logion-api@sha256:0cdda3f7c638101e784c650639f06d27d57f4beff1764d36136e304503a995a2 \
  ghcr.io/greatliverheat605/logion-worker@sha256:c96a9d2eb7ad2e9e35eb6c3a559b95cd947f68d430a2cde4bbb92757a1b6cbd4 \
  ghcr.io/greatliverheat605/logion-backup@sha256:e3aa881a0aca6ce5dafa3ea111a78d12c1643b30a3d576b1d6e648f1d65ccd67
do
  docker image inspect "${IMAGE}" --format '{{json .RepoDigests}}'
done
unset IMAGE
```

如果 Public ECR 无法连接，停止；不要退回无法访问的 Docker Hub，也不要临时改用来源不明的镜像站。如果 GHCR 拉取返回 `401` 或 `denied`，停止并确认包可见性；不要把 GitHub Token 写入 `.env` 或命令历史。

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

## 15. 引导首个 Owner 账户

首次启动前，`.env` 必须保持 `LOGION_REGISTRATION_MODE=invite`、`LOGION_LEGACY_REGISTRATION_ENABLED=false`，并将 `LOGION_BOOTSTRAP_OWNER_EMAIL` 设为首个 Owner 的邮箱。

已有旧版本且保留数据时，先用既有 Owner 打开 `http://localhost:8080/auth/login`，确认能够登录、原工作区可见且抽样数据完整。旧环境已有用户时，8.2 已清空 `LOGION_BOOTSTRAP_OWNER_EMAIL`，不要重新开放引导。

全新安装或空环境重置并严格使用本手册固定的历史候选时，该候选没有阿里云邮件投递适配器。你可以完成服务器、容器、数据库迁移、健康检查和页面渲染验收，但必须把“首个 Owner 注册/邮箱验证/登录”标记为阻断项。不要从 `email_outbox` 解密或提取 token，不要手工修改验证状态，也不要将注册模式改为 `open`。

`0.1.0-rc2` 已包含邮件投递适配器；改按当前生产发布和邮件预发布手册生成新候选并完成配置后，才能在正式 HTTPS 域名打开 `/auth/register`，使用引导邮箱提交注册，完成邮箱验证并设置密码。随后打开 `/auth/login`，确认可以登录且个人工作区已经创建。

Owner 创建成功后，立即清空引导邮箱并重启 API 与 worker，关闭引导口子：

```bash
cd /opt/logion
sed -i \
  's/^LOGION_BOOTSTRAP_OWNER_EMAIL=.*/LOGION_BOOTSTRAP_OWNER_EMAIL=/' \
  .env

logion-compose up -d --no-build --force-recreate api worker
```

需要额外账户时，由 Owner 在工作区内创建邀请并发送邀请链接。受邀者必须使用被邀请的邮箱完成注册，再通过现有邀请接受页加入工作区；不要重新开启 legacy 注册或将注册模式改为 `open`。

### 检查点 D

- [ ] 首页、登录页真实渲染；
- [ ] 保留数据替换时，既有 Owner 可以登录且原数据抽样正确；
- [ ] 全新空环境时，首个 Owner 注册已在邮件适配器可用后通过，或已明确记录为阻断项；
- [ ] 个人工作区已自动创建；
- [ ] 注册模式保持 `invite`，旧注册接口保持关闭；
- [ ] 已有 Owner 时 `LOGION_BOOTSTRAP_OWNER_EMAIL` 已清空；尚无 Owner 时只保留预定引导邮箱；
- [ ] 容器没有 OOM 或反复重启。

## 16. 功能验收顺序

只有既有 Owner 可以登录，或当前 rc2 邮件投递已经过真实验收且首个 Owner 已正常创建时，才执行本节。尚未满足时跳过本节并保留阻断记录，不能用未认证接口或数据库直改代替。

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

第 9、10 项必须按照 [阿里云真实同步验收手册](./aliyun-real-sync-acceptance.md) 执行。该手册覆盖真实 FastAPI 检查、双浏览器双向同步、离线 Outbox、恢复回读、Vault 锁定、失败路由和验收记录；本机 Mock Server 或只返回固定 JSON 的接口不能替代这项验证。

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

## 20. 新版本稳定后清理旧应用文件

只有满足以下全部条件后，才清理 7.1 创建的旧源码归档：

- 新版本已连续稳定运行至少 24 小时；
- 健康检查、登录、注册关闭、核心功能和资源检查均通过；
- 新版本至少生成并验证了一份加密备份；
- 加密备份、`.sha256` 和相应备份密钥已分别保存到服务器外；
- 不需要用旧目录核对配置差异。

先确认当前版本和运行容器，不读取 `.env` 内容：

```bash
cd /opt/logion
test "$(git rev-parse HEAD)" = dd1382b12cfedabc5f57c99817268b46285053b2
logion-compose ps
curl --fail --silent http://127.0.0.1:8080/healthz
echo
```

再读取并严格校验归档路径：

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

人工确认 `ls -ld` 只指向带 UTC 时间戳的 `/opt/logion.before-*` 后，删除该旧应用目录：

```bash
rm -rf --one-file-system -- "${OLD_DIR}"
test ! -e "${OLD_DIR}"
rm -f /root/logion-upgrade/old-directory.txt
unset OLD_DIR
```

该操作只清理旧源码及其中的旧配置副本，不删除 `logion_*` 数据卷。云盘和 SSD 上的文件删除不等同于密码学安全擦除；如果怀疑旧密钥曾泄漏，应按密钥轮换与恢复验证流程处理，不能依赖重复覆盖文件。

可选清理没有标签且不被任何容器引用的悬空镜像：

```bash
docker image prune
```

不要加 `-a` 或 `--volumes`。仍有标签的旧候选镜像可以保留，磁盘空间不足时再逐个核对容器引用后按精确镜像 ID 删除。

## 21. 更新与回滚

更新前记录：

- 新源提交；
- 成功的 Main run ID；
- 四个应用镜像和三个基础镜像摘要；
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

## 22. 常见故障路由

### 22.1 `no matching manifest for linux/arm64`

服务器是 ARM 架构。停止部署，换用 x86_64 实例或先构建并审核 ARM 候选，不能在服务器临时构建。

### 22.2 `!override` 无法解析

Compose 版本过旧。提供 `docker compose version`，升级 Compose 后重试。不要删除端口覆盖继续运行。

### 22.3 GHCR `401` 或 `denied`

先确认镜像包是否仍允许匿名拉取。若改为私有，使用只有 `read:packages` 权限的短期 Token，通过 `docker login ghcr.io --password-stdin` 输入；不要把 Token 写入 `.env`、脚本或聊天。

### 22.4 API ready 返回 503

执行：

```bash
logion-compose ps
logion-compose logs --tail 100 api postgres redis
```

不要重复迁移或删除卷。

### 22.5 浏览器打不开页面

依次检查：

```bash
curl -fsS http://127.0.0.1:8080/healthz
ss -lntp | grep ':8080'
```

然后确认本机 SSH 隧道仍在运行、访问的是 `http://localhost:8080`，而不是服务器公网 IP。

### 22.6 注册返回 403

确认请求头是：

```text
Origin: http://localhost:8080
```

不要通过放宽全部 CORS 来源解决。

### 22.7 容器被 OOMKilled

执行：

```bash
free -h
docker stats --no-stream
docker inspect $(logion-compose ps -q) \
  --format '{{.Name}} OOMKilled={{.State.OOMKilled}} RestartCount={{.RestartCount}}'
```

停止新增用户和 AI/附件测试。持续 OOM 时升级到 4 GB。

### 22.8 Backup 反复退出

检查文件权限、容器用户和有限日志：

```bash
stat -c '%u:%g:%a %n' secrets/backup.key
logion-compose exec -T backup id
logion-compose logs --tail 100 backup
```

预期密钥为 `0:10001:640`，容器用户的补充组包含 `10001`。如果密钥仍是 `0:0:600`，备份脚本会在读取密钥前静默退出并进入重启循环。只修复所有权与权限，不要读取、替换或重新生成密钥：

```bash
chown root:10001 secrets/backup.key
chmod 640 secrets/backup.key
logion-compose up -d --no-build --force-recreate backup
```

随后必须按第 17 节生成并验证一份加密备份。不要显示 `backup.key` 内容，也不要把密钥改成全局可读。

### 22.9 Docker Hub 超时或阿里云加速器返回 `not found`

阿里云部分地域直连 `registry-1.docker.io:443` 可能超时，专属 `mirror.aliyuncs.com` 也可能尚未同步新标签。先检查最终镜像投影：

```bash
logion-compose config --images
```

只要第 9 节的 `compose.registry.yaml` 已正确加载，PostgreSQL、Redis 和 Nginx 就应显示为 `public.ecr.aws/docker/library/*@sha256:...`，`logion-compose pull` 不再请求 Docker Hub。Public ECR 也不可达时停止；不得删除数据卷、降低摘要固定要求、使用 `latest` 或切换到来源不明的公共镜像站。

## 23. 阶段完成标准

### 23.1 技术栈部署完成

同时满足以下条件，可以记录为“Logion 阿里云封闭技术环境已启动”，但尚不代表账户与完整功能可用：

- [ ] 固定提交、四个应用镜像和三个基础镜像摘要一致；
- [ ] 没有服务器本地构建；
- [ ] 8080 只监听 `127.0.0.1`；
- [ ] PostgreSQL、Redis、API、Worker、Web、Nginx healthy；
- [ ] Alembic head 为 `0034_sync_conflicts`；
- [ ] API ready 包含 application/database/redis；
- [ ] 旧注册接口已关闭；
- [ ] 无 OOMKilled；
- [ ] 加密备份已生成并验证；
- [ ] 已记录邮件和 OSS 未完成项；
- [ ] 未开放 Production，未声称高可用。

### 23.2 封闭功能测试可用

在 23.1 全部通过的基础上，还必须满足：

- [ ] 保留数据替换时，既有 Owner 可以登录且原数据抽样正确；或
- [ ] 全新空环境已使用 rc2 邮件适配器通过首个 Owner 注册、邮箱验证与登录；
- [ ] 第 16 节中本次需要的功能 Smoke 已通过；
- [ ] 真实 FastAPI 环境中的双浏览器在线、离线、恢复与回读同步验收已通过；
- [ ] 注册模式保持 `invite`，引导完成后引导邮箱已清空。

历史候选的“邮件投递适配器未实现”只能作为技术栈部署的已知阻断记录，不能算作封闭功能测试可用；rc2 必须改用真实邮件投递结果关闭该门禁。

扩大到 10 人封闭测试前，还必须补齐域名/HTTPS、阿里云邮件投递、OSS 自动异地备份、告警、真实双设备、实体 Safari/iOS、读屏和面向该规模的容量验证。
