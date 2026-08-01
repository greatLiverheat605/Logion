# Logion 全仓代码审查（2026-08-01）

## 结论摘要

Logion 已形成完整的离线优先学习与研究系统：33 个 Web 页面、126 条 OpenAPI 路径/151 个操作、66 个服务端模型和 35 个迁移，身份、权限、同步、数据主权、AI 草稿、备份恢复与供应链门禁均有明确实现。当前没有发现需要停止交付的 P0 越权、注入、明文凭据或契约破坏问题。

下一阶段的主要风险不在“缺少功能”，而在运行可靠性和复杂度控制：单 worker 的健康检查可能误报、固定优先级队列可能饥饿；认证浏览器套件在没有夹具凭据时会大量跳过；多个核心前后端模块已超过 1,000 行，继续叠加功能会显著提高回归成本。

## 审查范围与证据

- 审查范围：`apps/`、`packages/`、`tests/`、`.github/workflows/`、`scripts/`、`infra/` 和主要产品/安全/ADR 文档；生成的 OpenAPI 类型只核对契约，不逐行人工评审。
- 仓库规模：727 个源/配置/文档文件；33 个页面；126 条 API 路径、151 个操作；66 个 SQLAlchemy 模型；35 个 Alembic 迁移。
- 自动验证：`pnpm ci:fast` 通过；278 个默认 Python 测试、127 个 Web 测试、55 个离线包测试、12 个契约测试和 4 个移动壳测试通过。
- 浏览器验证：完整矩阵 70 通过、135 条按环境条件跳过、0 失败；认证路由另以单 worker 运行 10/10 通过；互操作真实流程 5/5 通过。
- 定向集成：Calendar、导入、导出 3/3 通过。
- 安全审计：`pnpm audit --audit-level high` 与 `pip-audit` 均未发现已知漏洞；本地 workspace 包按预期无法在 PyPI 审计。

优先级定义：P0 为立即停止交付；P1 为下一补丁版本必须处理；P2 为随后两个版本内安排；P3 为持续改进。

## 发现清单

### P1-01：worker 健康检查会在持续任务失败时仍报告健康

证据：`apps/worker/src/logion_worker/health.py` 无条件返回 `status: ok`；Compose healthcheck 只执行该模块。`apps/worker/src/logion_worker/main.py` 捕获所有任务异常后继续循环，并继续把同一 `health_payload()` 写入失败日志。本轮真实验收中，旧 worker 连续输出 `worker_job_failed / ProgrammingError`，Docker 仍显示 healthy。

影响：邮件、导出、AI 和删除任务可能长期不处理，而反向代理、部署平台和管理员仍认为 worker 正常。健康误报会推迟告警和恢复。

建议：拆分 liveness/readiness；记录最近一次成功轮询、连续失败次数、数据库/Redis 探测和每类队列最老任务年龄；达到阈值后 readiness 失败但进程保持可诊断。失败事件至少包含安全的任务类型、阶段、错误码和关联 ID，不能包含正文或 Token。

### P1-02：单 worker 的固定优先级可能使后续队列饥饿

证据：主循环严格按 Email → Portability → AI Execution → Account Deletion 顺序调用，并在前一类处理到任务后跳过后续类型。每轮只处理一个任务。

影响：持续邮件积压时，导出、AI 和账户删除可能得不到执行；持续导出也会延迟 AI 与删除。账户删除和数据导出包含时间承诺，不能只依赖“最终队列会变空”的假设。

建议：短期改为轮转起点或每类限额的公平调度，并暴露每类队列年龄；中期拆分独立 worker/队列和并发上限，保留幂等租约、重试和取消语义。

### P1-03：浏览器门禁在无认证夹具时会“绿色跳过”，有共享夹具时又会并发竞争

证据：`authenticated-shell.spec.ts`、`persona-system.spec.ts` 和 `prototype-productization.spec.ts` 在缺少 `LOGION_E2E_EMAIL/PASSWORD` 时整体跳过；本轮默认完整矩阵为 70 通过、135 跳过。`playwright.config.ts` 同时启用 `fullyParallel: true`，当多个 worker 共用一个账号时，本轮曾出现会话轮换竞争；单 worker 重跑后 10/10 通过。

影响：CI 的“浏览器通过”不一定覆盖认证工作台；以后补入一个共享账号又可能引入随机登录失败，形成错误的红/绿信号。

建议：增加全局夹具，在隔离数据库中为每个 worker 创建独立账号和 `storageState`；认证套件若在要求完整门禁的 workflow 中被跳过，应直接失败。PR 的纯前端可访问性任务与 Docker 真实栈任务应使用不同 Playwright project 标签。

### P2-01：关键业务模块已成为高耦合巨型文件

代表性文件：后端 `sync/push.py` 约 3,010 行、`sync/read.py` 约 1,289 行、`memory/service.py` 约 1,284 行；前端 Today、Review、Self-study 分别约 1,586–1,682 行，Exam、Content 和 Operational Tools 也超过 1,000 行。

影响：领域状态、数据访问、表单动作和渲染混在同一模块；局部改动需要加载大量上下文，难以做到独立性能测试和按功能所有权维护。

建议：按“查询/命令/状态模型/视图区域”垂直拆分，先抽纯函数和数据适配器，再拆组件；同步 push 按实体族注册处理器，保持现有契约测试作为重构守门。

### P2-02：Vault 解锁刷新逻辑在七个工作台重复并依赖 Hook 规则豁免

证据：Sync、Self-study、Planning、Today、Content、Exam、Review 都复制了 `queueMicrotask → refresh → status/error` 的 effect，并禁用 `react-hooks/exhaustive-deps`。

影响：新增依赖或刷新语义时容易只更新部分页面，闭包捕获差异也难通过 lint 发现。

建议：抽取 `useVaultWorkspaceRefresh`，显式传入稳定 callback、成功消息和错误映射；用 React 19 兼容的 effect event 或稳定 callback 消除规则豁免。

### P2-03：真实栈 E2E 的本地注册和限流状态缺少独立生命周期

证据：重复运行注册/登录测试会累积 Redis 限流键；本轮定向集成测试也因固定文档 IP 和共享 Redis 首先失败，需要隔离清理后才得到 3/3 的真实结果。

影响：开发者可能把夹具污染误判为产品失败，或为通过测试错误降低安全阈值。

建议：测试栈使用独立 Redis DB/前缀和数据库 schema；global setup 创建、global teardown 清理；测试不得清空非测试命名空间。远程环境必须显式凭据，禁止自动注册。

### P2-04：离线能力与产品页面覆盖仍不一致

现状：IndexedDB、加密 Vault、Outbox、Bootstrap 和冲突处理成熟，但 Service Worker 仍主要提供公共离线兜底；受保护工作台不能完整离线冷启动，部分二级工作台本质上要求在线 API。

影响：“离线优先”容易被理解成“所有页面完全离线可用”，移动端断网和清站点数据场景仍有预期差。

建议：建立页面级离线能力矩阵，明确 Offline Read / Offline Write / Queue / Online-only；优先实现今日、记录、复习的受保护壳冷启动和可恢复错误页面。

### P2-05：UI 自动化缺少稳定的视觉回归与实体设备门禁

现状：axe、明暗主题 token、横向溢出、reduced-motion 和多个 viewport 已覆盖，但没有基于批准基线的关键页面截图差异；实体 iPhone/Android、软键盘、触控和人工读屏仍在上线前清单。

影响：结构与可访问性可以通过，但密度、层级、折行和组件错位仍可能回归。

建议：只为 6–8 个核心状态建立低波动视觉基线；实体设备保持发布人工门禁，不把模拟器通过等同真机通过。

### P3-01：功能面已大于当前小规模自托管定位，需要收敛信息架构

33 个页面、151 个 API 操作和多套工作台已足够支撑完整闭环，但侧栏主路由、画像路由、二级工作台和命令面板形成多层发现模型。继续新增一级页面会降低学习效率。

建议：下一版本优先整合重复状态、建立跨对象跳转和“下一步”语义，新增能力尽量进入现有工作台或二级面板，而不是继续扩展主导航。

## 已确认的工程优势

- 服务端始终重新判定 Workspace/Space 权限，Persona 只控制 UI 可见性。
- 生产配置会拒绝开放注册、弱开发密钥、不安全 Cookie、非 HTTPS Origin 和不合规邮件配置。
- OpenAPI 与 sync-v1 都有生成和兼容性门禁；高风险同步冲突显式化。
- Markdown 预览使用 React 文本节点，不执行正文 HTML；Provider 网络访问、附件、分享和 Token 均有独立威胁模型。
- 导出、备份、TOTP、邮件、AI 凭据使用分离的版本化密钥；日志与审计坚持最小元数据。
- PR 流水线具备依赖审计、密钥扫描、迁移往返、PostgreSQL/Redis 集成测试、镜像构建和浏览器检查；Release/Nightly 还覆盖恢复演练和候选产物门禁。

## 建议处理顺序

1. v0.1.1 先修 worker 健康/公平调度和认证 E2E 夹具，形成可信运行与可信门禁。
2. 抽取 Vault 刷新 Hook，并从 Today/Review/Sync 开始拆分巨型模块。
3. 建立页面级离线矩阵和核心视觉基线。
4. 再进入学习洞察、论文研读或 Connector/Automation 等新能力，避免在运行基础未收口前扩大表面积。
