# Logion

Logion 是一个面向长期学习与研究的离线优先、证据驱动工作系统。它将目标、计划、任务、学习会话、笔记、资料、证据、复习、考试、自学、研究和协作连接成可追溯闭环，并允许用户自定义学习场景，而不是预装某位导师、课程、考试或课题组内容。

> 当前状态：Phase 0–6 的仓库实现与自动化验收已完成，项目可用于本地和封闭测试环境验证；**尚未批准 Production 或公开稳定版**。域名/HTTPS、真实邮件适配器、阿里云异地备份、生产告警、生产等价容量验证及真实 Beta 仍待完成。

## 适用人群

- **备考学习者**：管理考试、科目、大纲、模考、成绩和复习计划。
- **自主学习者**：从收集箱建立学习路线、项目和可验证产出。
- **研究者**：管理论文、论点、研究问题、实验、指标和反馈证据。
- **导师与小组**：在用户创建的共享空间内使用量规、评审请求、反馈和不可变报告快照。

模式只决定能力入口和导航，不写死业务上下文。诸如“郝老师课题组”、课程、研究方向和目标均由用户或工作区成员创建。

## 核心能力

- 目标、版本化计划、阶段、任务与学习会话管理
- Markdown 笔记、链接资料、PDF 元数据及页码索引、少量附件
- 证据提交、人工验收、掌握度确认、复习排程、测验与错题模式
- 备考、自学、研究、导师/小组四类可配置工作流
- 多用户 Workspace、私有/共享 Space、角色权限、邀请与审计
- 邮箱账户、Cookie 会话、TOTP、恢复码和 Passkey（WebAuthn）
- 模板、只读分享快照、搜索、通知、日历订阅、数据导入导出与账户删除
- 可配置的 OpenAI-compatible AI Provider、模型发现、路由、预算、持久任务和草稿审批
- 加密备份、候选镜像、供应链扫描、恢复演练和分阶段发布门禁

AI 是可选增强层。AI 不可直接修改正式记录、掌握度、验收状态或权限；生成结果必须作为草稿由用户确认。Provider 密钥只在服务端加密保存，不进入浏览器、日志或导出。

## 离线优先与多设备同步

浏览器使用 IndexedDB、Outbox 和本地加密 Vault 保存可离线编辑的数据。联网后通过 `sync-v1` 执行幂等 Push/Pull、断点 Bootstrap、设备隔离和冲突处理。Markdown 笔记支持 Yjs 增量合并；状态、层级、权限、删除和验收等高风险冲突必须由用户明确选择，不采用静默最后写入覆盖。

设备撤销能立即停止服务端访问，但无法远程擦除始终离线的浏览器副本。共享设备需使用本地清除功能；恢复备份后 `sync_epoch` 会变化，旧设备必须重新 Bootstrap，旧 Outbox 会被隔离。

## 架构

```text
apps/web       Next.js Web/PWA 与离线客户端
apps/api       FastAPI 业务 API、认证、同步和 Alembic 迁移
apps/worker    后台任务、AI、邮件、导出和维护作业
packages/      OpenAPI/同步契约、离线库和共享配置
infra/         Compose、部署说明、备份恢复与发布手册
docs/          ADR、安全模型、同步规范和阶段验收证据
tests/         跨模块、集成、容量与发布验证
```

参考部署由反向代理、Web、API、Worker、PostgreSQL、Redis 和 Backup 服务组成。服务端始终重新判定 Workspace/Space 权限，不能信任客户端传入的授权结果。

## 技术栈

- Web：Next.js、React、TypeScript、PWA、IndexedDB、Yjs
- API/Worker：Python 3.12、FastAPI、SQLAlchemy、Pydantic、Alembic
- 数据：PostgreSQL、Redis、服务器附件目录、AES-256-GCM 加密备份
- 工程：pnpm workspace、uv、Pytest、Vitest、Playwright、Docker Compose
- CI/CD：GitHub Actions、GHCR、SBOM、provenance/attestation、Trivy、依赖与密钥扫描

## 本地开发

### 环境要求

- Node.js 24.14 或更高版本
- pnpm 11.9 或更高版本
- Python 3.12
- [uv](https://docs.astral.sh/uv/)
- Docker Compose（运行完整服务时需要）

### 安装与启动

```bash
pnpm install --frozen-lockfile
uv sync --all-packages --group dev --frozen
Copy-Item .env.example .env
pnpm dev:web
```

另开终端启动 API 和 Worker：

```bash
pnpm dev:api
pnpm dev:worker
```

默认 Web 地址为 `http://localhost:3000`，API 地址为 `http://localhost:8000`。开发示例密钥只适用于本地环境；部署前必须更换 `.env` 中所有密码、Cookie 密钥和加密 keyring。

## Docker Compose

```bash
Copy-Item .env.example .env
docker compose config
docker compose up --build
```

首次运行前请先按 [基础设施说明](infra/README.md) 配置密钥和持久卷。2 核 2 GB 阿里云服务器的封闭技术测试请遵循 [详细部署手册](infra/runbooks/aliyun-2c2g-staging-deployment.md)。该规格适合约 30 名早期用户的功能验证，不等同于生产容量结论。

## 测试与质量门禁

常用检查：

```bash
pnpm contracts:check
pnpm ci:fast
pnpm test:browser
```

`pnpm ci:fast` 包含动态上下文防写死检查、格式、Lint、类型、单元测试、构建及契约一致性。CI 还覆盖 PostgreSQL/Redis 集成测试、迁移往返、跨租户负向用例、镜像构建、依赖/许可证/密钥扫描、浏览器与可访问性测试、容量基线、备份恢复和不可变候选产物。

合并 Phase 不代表允许生产发布。Production 必须另行完成真实云环境、异地备份、告警、隐私/法务、物理 iOS/Safari、人工无障碍和 5% → 25% → 100% 灰度审批。

## 安全、隐私与数据主权

- Cookie 认证配合 Origin、CSRF、速率限制和服务端权限校验。
- TOTP、AI Provider、邮件、导出及备份分别使用独立的版本化加密 keyring。
- 受保护的离线正文只以 Vault 引用进入实体、Outbox 和冲突表。
- 日志和审计不得记录笔记、研究正文、AI 提示词/响应、令牌、Cookie 或凭据。
- 导出可独立读取；账户删除有宽限期、撤销和备份保留边界。
- 用户输入的 Markdown 以文本方式呈现；外链和 Provider 网络访问有明确 SSRF 边界。

安全设计与残余风险见 [安全文档](docs/security/)；架构决定见 [ADR 索引](docs/adr/README.md)。

## 文档导航

- [产品与研发执行计划](LOGION_EXECUTION_PLAN.md)：产品范围、阶段、验收和发布路径
- [AI 开发约束](LOGION_AI_DEVELOPMENT_CONSTRAINTS.md)：工程、安全、协作和交付硬约束
- [代码所有权](docs/OWNERSHIP.md)：模块与审查责任
- [架构决策记录](docs/adr/README.md)：长期架构、同步、安全和数据寿命决策
- [离线存储规范](docs/offline/) 与 [同步协议说明](docs/sync/)
- [阶段验收记录](docs/phase-reviews/)
- [基础设施与运行手册](infra/README.md)

根目录两份基线文件是唯一有效的产品与工程决策输入。`archive/` 仅用于历史追溯，不是当前实现依据。跨模块、数据寿命、权限、同步或部署语义的变化必须先更新基线或新增 ADR。

## 已知未完成项

- 尚无阿里云邮件投递适配器，邮箱验证/找回不能直接用于真实外发。
- 域名、HTTPS 证书与生产反向代理策略尚未落地。
- 备份仍需接入 OSS 等异地、不可变存储和真实密钥托管。
- 2 核 2 GB 部署仅用于封闭测试；生产等价容量和真实 Beta 尚未完成。
- 物理 iOS/Safari PWA、人工屏幕阅读器、隐私/法务与正式值班告警仍是 Production 阻塞项。

## 贡献与许可证

提交前请阅读两份根目录基线和相关 ADR，保持契约优先、最小权限、离线数据完整性与人工审批边界。变更须通过对应 CI 门禁和独立审查，不得绕过受保护分支或以降低测试标准换取通过。

当前仓库未提供开源许可证。在许可证明确前，不能推定代码可被复制、修改或再分发。
