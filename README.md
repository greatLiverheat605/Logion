# Logion

[![Main candidate](https://github.com/greatLiverheat605/Logion/actions/workflows/main.yml/badge.svg)](https://github.com/greatLiverheat605/Logion/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Logion 是一个面向长期学习与研究的离线优先工作系统。它把目标、计划、任务、学习会话、笔记、资料、证据、复习、考试、自学、研究和小规模协作连接成可追溯的闭环。

项目定位是个人及最多 10 人的小规模自托管使用。Logion 保留多用户 Workspace、邀请、角色权限和审计能力，但不包含计费、套餐、公开注册、公共营销站或 SaaS 运营后台。

> 当前版本适合本地开发、自动化测试和封闭环境验证，尚未作为公开稳定生产版本发布。真实邮件投递、域名与 TLS、异地不可变备份、生产告警和生产容量验证仍需由部署者完成。

## 目录

- [主要能力](#主要能力)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [注册策略](#注册策略)
- [本地开发](#本地开发)
- [测试与质量](#测试与质量)
- [安全与数据边界](#安全与数据边界)
- [项目文档](#项目文档)
- [参与贡献](#参与贡献)
- [已知限制](#已知限制)
- [许可证](#许可证)

## 主要能力

### 学习与研究工作流

- 目标、版本化计划、阶段、任务和学习会话管理
- Markdown 笔记、链接资料、PDF 元数据、页码索引和附件
- 证据提交、人工验收、掌握度确认、复习排程、测验和错题记录
- 可配置的备考、自学、研究、导师与小组协作入口
- 模板导入、只读分享快照、搜索、通知和日历订阅

### 离线与同步

- 浏览器 IndexedDB 本地存储和加密 Vault
- Outbox 驱动的离线编辑与恢复
- `sync-v1` 幂等 Push/Pull、断点 Bootstrap 和设备隔离
- Markdown 笔记的 Yjs 增量合并
- 对权限、删除、层级和验收等高风险冲突进行显式处理

### 身份与协作

- Cookie 会话、CSRF/Origin 校验和速率限制
- TOTP、恢复码和 Passkey（WebAuthn）
- 受邀或关闭的注册策略，以及仅用于初始化的 Owner 邮箱
- Workspace、私有/共享 Space、角色权限、邀请和审计日志

### 数据与自动化

- 独立可读的数据导入导出和可恢复账户删除
- 可配置的 OpenAI-compatible AI Provider
- Provider 凭据服务端加密、模型发现、任务路由和持久草稿
- 加密备份、恢复验证、SBOM、依赖扫描和发布门禁

AI 是可选增强层。生成结果不能直接修改正式记录、掌握度、验收状态或权限；需要用户确认后才能进入正式数据。

## 系统架构

```text
Browser / PWA
      │
      ▼
Reverse proxy ── Web (Next.js)
      │
      ├────────── API (FastAPI) ── PostgreSQL
      │                    │
      │                    └────── Redis
      │
      └────────── Worker / encrypted backup
```

仓库采用 monorepo：

```text
apps/web       Next.js Web/PWA 与离线客户端
apps/api       FastAPI API、认证、同步与 Alembic 迁移
apps/worker    后台任务和维护作业
packages/      OpenAPI/同步契约、离线库和共享配置
examples/      可选的公开示例数据
infra/         Compose、反向代理、备份恢复和部署说明
docs/          ADR、安全模型、离线存储和同步规范
tests/         跨模块、容量、供应链与发布验证
```

服务端始终重新判定 Workspace 和 Space 权限，不信任客户端传入的授权结果。

## 快速开始

### 环境要求

- Git
- Docker Engine 与 Docker Compose v2
- 至少 4 GB 可用内存用于本地构建和完整服务启动

### 1. 获取代码与配置

```bash
git clone https://github.com/greatLiverheat605/Logion.git
cd Logion
cp .env.example .env
mkdir -p secrets
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > secrets/backup.key
```

PowerShell 可使用：

```powershell
Copy-Item .env.example .env
New-Item -ItemType Directory -Force secrets | Out-Null
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" |
  Set-Content -NoNewline -Encoding ascii secrets/backup.key
```

`.env.example` 中的密钥和密码只用于本地示例。任何长期运行环境都必须生成独立值，并确保 `.env` 与 `secrets/` 不进入版本控制。

### 2. 选择本地访问地址

Compose 通过 `http://localhost:8080` 提供统一入口。请在 `.env` 中设置：

```dotenv
LOGION_ALLOWED_ORIGINS=["http://localhost:8080"]
LOGION_WEBAUTHN_ORIGINS=["http://localhost:8080"]
```

### 3. 启动服务

```bash
docker compose config
docker compose up --build
```

服务就绪后访问：

- Web：`http://localhost:8080`
- 组合健康检查：`http://localhost:8080/healthz`
- Web 健康检查：`http://localhost:8080/health`

### 4. 创建本地测试账户

默认配置使用 `invite`，适合封闭部署。首次本地体验可二选一：

1. 在 `.env` 设置 `LOGION_BOOTSTRAP_OWNER_EMAIL=owner@example.com`，并接入邮件投递后通过注册页面完成验证。
2. 仅在本机开发环境临时设置 `LOGION_REGISTRATION_MODE=open`，重启 API 后使用开发注册接口创建账户。

本地开发注册示例：

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Origin: http://localhost:8080" \
  -H "Content-Type: application/json" \
  --data '{"email":"owner@example.com","password":"replace-with-a-local-password","device_name":"Local browser"}'
```

`open` 模式不得用于生产环境；生产配置会拒绝启动。

停止服务：

```bash
docker compose down
```

如需同时删除本地数据库、附件和缓存卷，请先确认数据不再需要，再执行 `docker compose down --volumes`。

## 注册策略

`LOGION_REGISTRATION_MODE` 支持三种模式：

| 模式     | 行为                                                    | 适用范围               |
| -------- | ------------------------------------------------------- | ---------------------- |
| `open`   | 允许本地/测试环境自行注册                               | 仅开发和自动化测试     |
| `invite` | 仅有效邀请或引导 Owner 邮箱可注册；其他邮箱得到统一响应 | 默认自托管模式         |
| `closed` | 关闭普通自助注册；引导 Owner 邮箱仍可初始化             | 已完成初始化的封闭部署 |

`LOGION_BOOTSTRAP_OWNER_EMAIL` 用于建立首个 Owner。完成初始化后应清空该值，并通过 Workspace 邀请管理后续成员。

## 本地开发

### 工具链

- Node.js `>=24.14.0`
- pnpm `>=11.9.0`
- Python `>=3.12,<3.13`
- [uv](https://docs.astral.sh/uv/)
- Docker Compose（集成测试和完整服务需要）

### 安装依赖

```bash
pnpm install --frozen-lockfile
uv sync --all-packages --group dev --frozen
```

### 启动开发服务

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:worker
```

这些命令通常在三个终端中运行。API 与 Worker 需要可访问的 PostgreSQL 和 Redis；连接地址通过 `.env` 配置。Web 默认位于 `http://localhost:3000`，API 默认位于 `http://localhost:8000`。

数据库迁移：

```bash
uv run --package logion-api alembic -c apps/api/alembic.ini upgrade head
```

## 测试与质量

提交前至少运行：

```bash
pnpm ci:fast
```

该命令覆盖格式、Lint、类型检查、Python/TypeScript 单元测试、生产构建和契约一致性。

浏览器测试需要一个已启动的 Web 服务：

```bash
LOGION_E2E_BASE_URL=http://127.0.0.1:3000 pnpm test:browser
```

Windows PowerShell：

```powershell
$env:LOGION_E2E_BASE_URL = "http://127.0.0.1:3000"
pnpm test:browser
```

完整 CI 还会执行 PostgreSQL/Redis 集成测试、迁移往返、跨租户负向测试、镜像构建、许可证与密钥扫描、浏览器可访问性、备份恢复和候选产物验证。

OpenAPI 或同步契约发生有意变更时：

```bash
pnpm contracts:generate
pnpm contracts:check
```

## 安全与数据边界

- Cookie 认证配合可信 Origin、CSRF、防重放和速率限制。
- TOTP、邮件、AI Provider、导出和备份使用相互独立的版本化密钥。
- 凭据、Cookie、令牌、笔记正文、研究正文和 AI 提示词/响应不得进入日志或审计元数据。
- 受保护的离线正文通过本地 Vault 引用，不以明文写入同步 Outbox。
- 用户输入的 Markdown 以安全文本边界呈现；外链和 Provider 网络访问受 SSRF 约束。
- 设备撤销会停止新的服务端访问，但不能远程擦除长期离线设备已有的数据。

请勿在公开 Issue 中提交漏洞、访问令牌、日志中的个人数据或可利用细节。安全问题请遵循 [安全政策](SECURITY.md)。

## 项目文档

- [架构决策记录](docs/adr/README.md)
- [安全设计与威胁模型](docs/security/)
- [离线存储规范](docs/offline/)
- [同步协议说明](docs/sync/)
- [可观测性约定](docs/operations/observability-contract.md)
- [基础设施与部署](infra/README.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)

涉及权限、数据寿命、同步、加密或部署边界的变更，应同步更新对应 ADR 或安全文档。

## 参与贡献

欢迎提交可复现的缺陷报告、文档改进和范围清晰的 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

项目坚持以下边界：

- 面向个人和最多 10 人的小规模自托管协作
- 不引入计费、定价、套餐、公开营销或 SaaS 运营功能
- 权限、同步和数据契约变更必须有测试和设计依据
- AI 输出保持草稿性质，不能绕过人工确认和权限检查

## 已知限制

- 仓库尚未包含可直接用于真实外发的邮件服务适配器。
- 域名、TLS、云端密钥管理和异地不可变备份由部署者配置。
- 物理 iOS/Safari、人工屏幕阅读器和真实低配服务器容量仍需在目标环境验证。
- Compose 是参考自托管拓扑，不代表对任意云平台的生产承诺。

## 许可证

Logion 采用 [MIT License](LICENSE)。第三方依赖和公开示例可能使用各自许可证，使用时请保留对应声明。
