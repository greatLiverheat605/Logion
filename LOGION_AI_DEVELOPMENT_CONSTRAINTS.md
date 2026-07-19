# Logion AI 开发约束与工程验收规范

> 文档编号：LOGION-CONSTRAINT-001  
> 版本：1.1  
> 日期：2026-07-19  
> 状态：强制执行  
> 配套文档：`LOGION_EXECUTION_PLAN.md`

## 0. 使用方式

本文件是交给 AI 编码代理和人类开发者的工程护栏。`MUST/必须` 为发布阻断项，`SHOULD/应` 允许经 ADR 说明后偏离，`MAY/可` 为可选实现。任何 AI 在改动前必须先读取本文件和执行计划，确认任务所属里程碑、受影响领域、数据迁移、安全边界和验证命令。

AI 每次任务输出至少包含：需求 ID/目标、修改文件、设计选择、迁移影响、安全影响、测试结果、未完成项和回滚方式。不得将“代码已生成”“页面能打开”视为完成。

## 1. 最高优先级不变量

以下规则不可通过普通实现决策覆盖：

1. 本地业务写入与 Outbox 必须在同一事务提交；网络失败不得撤销已成功的本地编辑。
2. 同步重试必须幂等；冲突不得静默覆盖；删除、验收、权限和层级移动不能使用无条件最后写入获胜。
3. 所有业务对象必须归属 workspace；所有服务端对象访问必须根据当前身份重新校验 membership 和角色。
4. 客户端传入的 `workspace_id`、角色、价格、配额、所有权、版本和资源归属均不可信。
5. AI 只能创建草稿；未经用户明确确认，不得改变正式数据、任务状态、验收、掌握度、权限或发布状态。
6. AI API Key、TOTP secret、恢复码、令牌和加密主密钥不得出现在浏览器、普通日志、分析事件、导出或错误响应。
7. 核心流程在 AI、邮件、分析、支付或单一 Provider 不可用时仍可使用或明确降级。
8. 所有长期数据必须可导出、备份、恢复和迁移；数据迁移不得破坏历史语义。
9. PWA、离线、无障碍、移动端、空态/错态/权限态是功能的一部分，不得留到“以后统一补”。
10. 禁止伪造成功、吞掉异常、用示例数据掩盖缺失后端、跳过安全校验或删除失败测试以获得绿色构建。

## 2. 技术基线与仓库边界

默认栈：

- `apps/web`：Next.js App Router、React、TypeScript strict、PWA；
- `apps/api`：Python 3.12+、FastAPI、Pydantic、SQLAlchemy 2；
- `apps/worker`：与 API 共享领域包，只运行异步任务；
- `packages/contracts`：OpenAPI 生成类型、共享 schema 和错误码；
- `packages/ui`：可访问设计系统；
- `packages/offline`：IndexedDB、本地 repository、Outbox、客户端同步状态机和协议类型；
- `infra`：Docker Compose、反向代理、备份与部署配置；
- `docs/adr`：架构决策；`tests` 按单元、集成、契约、E2E、安全分类。

任何等价替换必须用 ADR 说明动机、迁移成本、离线能力、无障碍、长期维护和退出路径。不得在业务模块中直接调用第三方 AI、对象存储或邮件 SDK；必须经端口/适配器。Redis 不是权威数据库，浏览器状态管理不是长期数据源。

模块依赖方向：UI → application use case → domain → repository/port；基础设施实现 repository/port。领域层不得依赖 FastAPI、React、数据库 session 或具体 Provider。

## 3. 多租户、身份与授权

### 3.1 账户与工作区

- 允许公众邮箱注册、受邀注册和后续 Passkey 登录；生产环境必须有邮箱验证、速率限制和反滥用策略。
- 用户可拥有或加入多个 workspace；注册后创建个人 workspace，但不得假设永远只有一个。
- 规范角色固定为 `owner/admin/editor/contributor/reviewer/viewer`；旧资料中的 `member` 仅为迁移兼容别名，不得进入新契约。Owner 可转移所有权；最后一个 Owner 不得离开或被移除；Viewer 默认只读。
- 邀请必须使用一次性高熵 token 的哈希、明确 workspace/角色/邀请人/到期时间；接受时绑定实际账户；撤销或过期后不可重放。
- 分享快照与 membership 分离，默认只读、最小字段、可过期、可撤销；分享 token 仅保存哈希。

### 3.2 授权实现

每个 repository 查询必须显式带 `workspace_id`，每个 application use case 先解析当前 membership。不得先按对象 ID 查询再在响应层过滤。批量接口逐项验证归属；多态链接验证源和目标均属于同一 workspace。

角色权限至少覆盖：成员管理、计划写入、学习记录写入、研究数据写入、AI 配置、导出、备份、账单、分享和删除。前端隐藏按钮不是授权。所有拒绝路径写安全审计但不得记录敏感 payload。

必须有 IDOR 负向测试：用户 A 猜测用户 B 的 UUID、附件 key、冲突 ID、导出任务、分享记录、AI run 和同步 operation 时全部失败。响应不应暴露对象是否存在。

### 3.3 登录与设备

- 密码使用 Argon2id，参数版本化；Passkey/WebAuthn challenge 单次、短时、校验 origin/RP ID/sign counter；
- TOTP secret 加密；恢复码只存慢哈希且单次使用；新生成恢复码使旧码失效；
- access token 短期，refresh token 轮换并检测重用；Cookie 必须 HttpOnly、Secure、合理 SameSite；
- 写请求采用与认证方式匹配的 CSRF 防护；登录、注册、恢复和 Provider 测试分层限流；
- 设备可查看和撤销；撤销后 refresh token、同步权限和相关会话失效；
- 离线 PIN/设备凭据仅解锁本地副本，不代表重新获得服务端身份，也不能绕过服务端撤销。

## 4. 数据契约

### 4.1 通用字段与数据库规则

同步实体必须包含：

```text
id uuid(v7) primary key
workspace_id uuid not null indexed
version bigint not null default 1
created_at timestamptz not null
updated_at timestamptz not null
deleted_at timestamptz null
created_by uuid null
updated_by uuid null
```

事件表使用 append-only 思路，至少含 `workspace_id、sequence、event_type、actor_id、device_id、occurred_at、request_id、metadata`。`sequence` 在 workspace 内单调递增。客户端时间只用于显示和诊断，不决定服务端最终顺序。金额用最小货币单位整数，模型 token/用量用整数，哈希标明算法。

禁止无约束 JSONB 代替稳定字段。JSONB 仅用于 Provider 特有配置、版本化 payload、扩展 metadata；必须有 Pydantic/JSON Schema、大小上限和迁移策略。所有外键、唯一约束、状态一致性和关键跨字段规则尽可能落在数据库。

### 4.2 必备表域

- 身份：`users, workspaces, workspace_memberships, invitations, devices, passkey_credentials, totp_credentials, recovery_codes, refresh_tokens, share_snapshots`；
- 学习：`learning_plans, plan_versions, phases, milestones, topics, topic_dependencies, mastery_records, tasks, task_topic_links, task_dependencies, task_status_events, study_sessions, session_events`；
- 内容：`notes, note_updates, note_versions, note_links, resources, resource_links, pdf_indexes, attachments, evidence_items, verification_records, verification_evidence_links, tags, tag_links`；
- 复习：`review_schedules, quiz_items, quiz_attempts, error_patterns, audit_reviews, review_findings`；
- 研究：`papers, paper_relations, research_questions, research_question_versions, experiments, experiment_runs, experiment_metrics`；
- AI：`ai_providers, ai_models, ai_task_routes, ai_runs, ai_output_drafts`；
- 同步/审计：`processed_operations, change_log, sync_conflicts, audit_events, sync_snapshots`；
- 商业化预留：`subscriptions, entitlements, usage_counters`，不得让业务代码直接依赖支付供应商状态字符串。

### 4.3 状态枚举

枚举必须集中声明、生成前后端类型并有迁移：

- `task_status`: backlog, planned, in_progress, blocked, submitted, verified, done, cancelled；
- `mastery_level`: unknown, exposed, practicing, familiar, proficient, mastered；
- `verification_status`: pending, passed, failed, needs_revision；
- `review_status`: scheduled, due, in_progress, completed, skipped；
- `attachment_status`: local_only, pending_upload, uploading, verified, failed, deleted；
- `ai_run_status`: queued, running, succeeded, failed, cancelled；
- `ai_draft_status`: draft, accepted, rejected, expired；
- `sync_result_status`: applied, duplicate, conflict, rejected, retryable_error；
- `conflict_status`: open, resolved_local, resolved_remote, resolved_merge, dismissed；
- `membership_status`: invited, active, suspended, revoked；
- `paper_status`: inbox, reading, read, cited, archived；
- `experiment_status`: draft, ready, running, completed, failed, cancelled。

不得在未知状态时默认映射为成功；旧客户端收到不兼容 enum/schema 时必须提示升级。

### 4.4 状态不变量

- Task 进入 `verified/done` 必须存在通过的 Verification 及符合规则的已验证 Evidence；
- 会话计时使用 start/pause/resume/stop 事件计算，服务端校验负时长、异常重叠和极端值；
- Mastery 的系统建议与用户确认分开保存，任何降级/升级可追溯；
- Attachment 在 SHA-256、大小和内容类型校验成功前不能成为正式证据；
- Experiment 结论必须能追溯到运行、代码引用、数据引用和指标；失败运行不得被删除来美化结果；
- AI Draft 接受时必须比较目标实体当前 version，过期时要求重新生成或人工合并。

### 4.5 迁移和删除

Alembic 迁移必须可在生产数据副本验证；新增必填列采用 expand/backfill/contract；删列分至少两个版本；大表变更评估锁和索引构建。导入导出带 schema_version。

用户删除采用明确生命周期：立即撤销登录/分享 → 进入可恢复软删除期（由隐私政策确定）→ 后台物理清理主库、对象和搜索索引 → 备份按固定保留期自然过期。法律/安全需要保留的最小审计必须去标识化并在政策中说明。

## 5. API 契约

### 5.1 通用规则

- 前缀 `/api/v1`，OpenAPI 3.1 为可测试契约；实现生成的 schema 与仓库基线持续 diff；
- JSON 使用 snake_case，时间 RFC 3339 UTC，ID 为 UUID 字符串；列表使用游标分页；
- 创建支持 `Idempotency-Key`；更新使用 `version` 或 ETag/If-Match；
- 错误格式固定为 `code, message, details, retryable, request_id`；面向用户的 message 可本地化，代码稳定；
- 401 表示未认证，403 表示无权，404 可用于隐藏跨租户存在性，409 表示版本/幂等/状态冲突，422 表示字段语义错误，429 带 Retry-After；
- 请求体、批次、分页、附件和 AI 响应均有限制；取消和超时必须传播。

### 5.2 必备资源组

认证/设备、users/me、workspaces/members/invitations、plans/versions/phases/milestones、topics/dependencies/mastery、tasks/status-events、sessions/events、notes/updates/versions、resources/pdf-indexes、attachments、evidence/verifications、reviews/quizzes/errors/audits、papers/research-questions/experiments/runs/metrics、ai/providers/models/routes/runs/drafts、sync/bootstrap/push/pull/conflicts、imports/exports/backups、shares、subscriptions/entitlements。

OpenAPI 必须为请求和响应给出 schema、required、enum、最大长度、格式、错误响应和权限说明。不得返回数据库 ORM 对象或内部存储 key。

### 5.3 幂等与并发

同一身份、endpoint、Idempotency-Key 和请求哈希重复调用返回相同语义结果；同 key 不同哈希返回 409。更新必须携带基准 version；冲突响应给出 server_version、client_base_version、可安全展示的差异和解决动作，不返回其他租户数据。

## 6. 离线、同步与附件协议

### 6.1 客户端状态机

全局状态至少含 `offline, local_changes, syncing, synced, attention, auth_required, upgrade_required`；实体含 `clean, pending, pushing, conflict, error, tombstone`。UI 必须始终可见未同步数量、上次同步时间和需要人工处理的项目，不能只用颜色。

业务编辑事务：验证本地 schema → 更新本地实体/version 基线 → 追加 Outbox operation → 更新可观察同步状态。关闭浏览器或崩溃后 Outbox 仍存在。

### 6.2 Operation

每个 operation 至少包含：`operation_id, protocol_version, workspace_id, device_id, entity_type, entity_id, operation_type, base_version, client_occurred_at, payload, payload_hash, dependencies`。operation_id 使用 UUIDv7；payload 规范化后哈希；服务端验证 payload 中不得切换 workspace。

Push 在单个 operation 层面原子：业务写入、processed_operation、change_log 与 audit_event 同事务。批次可部分成功，但每项必须有稳定结果。幂等记录不得早于支持的最长离线窗口过期；默认至少两年，关键系统可永久保留哈希摘要。

Pull 使用 `(sync_epoch, cursor)`；变更按 workspace sequence 升序，分页结果带 `next_cursor, has_more`。cursor 只在本地成功应用整页后提交。被删除对象以 tombstone 下发。

### 6.3 Bootstrap 与恢复

首次同步和 schema 不兼容时下载带 checksum、schema_version、sync_epoch、snapshot_cursor 的快照；写入临时本地库，校验完成后原子切换。服务器从备份恢复、发生日志截断或租户迁移时提升 sync_epoch；旧客户端必须重新 bootstrap，并隔离旧 Outbox 供用户导出/人工恢复，不能直接重放。

### 6.4 冲突策略

- 可自动合并：集合去重、标签并集、独立计数事件、不同字段且基于同版本的非关键更新；
- Yjs：按 update 合并、去重并定期生成可读 Markdown 快照；保留版本与压缩前检查点；
- 必须人工确认：验收、任务关键状态、计划层级移动、权限、删除与更新竞争、研究结论、AI 草稿覆盖已编辑内容；
- 冲突中心必须展示来源设备、时间、字段差异和保留本地/服务端/合并/复制为新对象；解决动作本身是新版本和审计事件。

### 6.5 附件

离线选择后生成本地临时 ID、SHA-256、大小、声明 MIME 与状态。联网上传流程为 init → 限额校验 → 分块/直传 → complete → 服务端重新计算哈希/嗅探类型 → 原子移动到正式 key → `verified`。文件名不得用于拼接存储路径；下载使用授权后的短期 URL 或受控流。首发默认 20 MB/文件，具体配额由 entitlement 决定。

## 7. AI Provider 与草稿安全

### 7.1 适配器边界

首发实现 OpenAI-compatible，接口至少含 `test_connection, list_models, validate_capabilities, generate, stream, estimate_usage, normalize_error`。Anthropic、本地 Ollama/vLLM 和 Custom 仅通过明确适配器加入；Custom 不允许用户上传或执行服务器代码。

Provider 配置包含名称、类型、base_url、加密 credential 引用、组织/项目可选项、超时、重试、速率、预算、启用状态。模型登记区分 Provider 探测能力和用户覆盖值，记录来源与最后探测时间。

### 7.2 网络边界

自定义 Base URL 只允许 http/https；默认要求 https；解析 DNS 后阻止回环、链路本地、私网、保留地址、云元数据和 DNS rebinding；重定向逐跳复验；限制端口、响应大小和时间。若产品未来允许私网本地模型，必须由管理员显式启用独立出站策略并记录风险，不得通过普通 URL 字段绕过。

### 7.3 数据发送和提示注入

用户必须选择对象和字段；发送前展示 Provider、模型、字段摘要、敏感标签、估算用量/成本和是否可能离境。默认不发送凭证、私密附件、原始日志、未公开研究全文或第三方个人信息。

资源正文、网页、PDF、笔记和工具结果均视为不可信数据，不得让其中的指令改变系统权限、数据范围或工具调用。Prompt 分 system template、应用指令、用户目标和引用数据，并记录 prompt_version、模板哈希和输入对象版本。

### 7.4 路由、错误和草稿

路由按任务类型、能力、workspace 权限、预算和健康状态选择；只对超时、429、特定 5xx 做有限指数退避；认证失败、配额/预算超限、schema 不合法和用户取消不得盲目重试。每次运行有幂等 key 和取消能力。

结构化输出必须经 JSON Schema、大小、Markdown 安全和领域校验。输出先写 `ai_output_drafts`；用户查看差异后接受、编辑或拒绝。接受必须走与人工编辑相同的授权、版本和审计路径。日志记录 Provider/模型/耗时/token/成本/状态/错误分类，不保存原始密钥；输入正文是否保留由隐私设置决定。

## 8. Web、UX 与无障碍约束

### 8.1 设计系统

- 使用语义设计令牌管理颜色、字体、间距、圆角、阴影、层级、动效和断点；禁止在业务页面散落任意色值；
- 正文最小 16 px（密集辅助信息仍须可读），行高合理；内容宽度避免超长行；
- 颜色对比满足 WCAG 2.2 AA；焦点环明显；状态同时提供文本/图标；
- 触控目标至少 44×44 CSS px；所有交互可用键盘；对话框正确管理焦点和 Escape；
- 遵循 prefers-reduced-motion；不使用闪烁、强制自动播放或无法暂停的动画；
- 图表必须有文字摘要/数据表替代；图标按钮有可访问名称；表单错误与字段关联。

### 8.2 响应式

从 320 px 宽开始设计，至少验证 360、768、1024、1440 px。不得以隐藏核心功能解决小屏问题；复杂表格转为卡片/可横向滚动并保留标题；固定导航不得遮挡内容；安全区域和虚拟键盘不能阻断提交。

每个页面必须实现：加载骨架、首次空态、搜索无结果、错误可重试、离线可用/不可用说明、权限不足、同步冲突和成功反馈。危险操作使用明确对象名和后果，不用含糊的“确定吗”。

### 8.3 内容中立与国际化

默认示例覆盖语言、编程、考试、课程、论文和职业技能，不把“AI 研究生”写死为所有用户。原 47 天计划与 Agent 安全路线作为可选模板/示例数据。

界面字符串不得硬编码拼接；日期、数字、时区、复数和排序使用 locale API；数据模型保存 UTC 与用户 timezone。首发中文内容也必须保留英文扩展结构。不得使用性别、年龄、教育程度或身体能力假设。

### 8.4 公共站与推广

公共页必须服务端可渲染/静态生成，具有独立 title/description/canonical/Open Graph、sitemap、robots、结构化数据和语义 heading。性能目标以真实移动网络为准：优化 LCP、CLS、INP，图片有尺寸与替代文本。

任何增长事件不得携带笔记、研究内容、附件名、AI 输入、密钥或完整 URL 查询参数。Cookie/分析须符合适用的同意与退出要求。公开指标、安全认证和客户陈述必须可核验；路线图明确标“计划”。

## 9. 安全威胁控制

必须维护随代码变化的威胁模型，至少覆盖：撞库、WebAuthn 重放、refresh token 窃取、恢复滥用、设备撤销；IndexedDB 泄露、Service Worker 污染、浏览器清理、离线撤销滞后；operation 重放、伪造 version、跨租户、超大 CRDT、删除竞争、恢复后旧设备污染；Markdown XSS、恶意链接、提示注入；伪造 MIME、路径穿越、解析器漏洞和存储耗尽；AI Key 泄漏、SSRF、敏感外发、自动改正式数据、成本失控；SQL 注入、调试接口、供应链；备份泄漏/同机丢失/不可恢复；敏感日志和审计篡改。

强制控制：

- CSP、HSTS、frame-ancestors、nosniff、Referrer-Policy、Permissions-Policy；
- Markdown 禁止原始脚本和危险 URL scheme，外链提示；
- 所有数据库查询参数化，排序字段白名单；
- 依赖锁定、SCA、secret scan、SAST、容器和 IaC 扫描；
- 生产 API 文档、调试端点、metrics 和管理任务不公开或强认证；
- 备份加密、校验、独立卷，正式发布前必须有异地方案和定期恢复演练；
- 审计 append-only、限制修改、包含 actor/action/target/result/request_id，敏感字段脱敏；
- 日志不得记录 Authorization、Cookie、密码、TOTP、恢复码、API key、完整 AI payload 和私密正文。

已完全控制的本机/恶意浏览器扩展仍可能读取用户正在查看的内容；离线设备在撤销前可能继续访问本地副本。这些残余风险必须在安全说明中清晰披露，不得虚假承诺“绝对安全”。

## 10. 测试约束

### 10.1 分层测试

- 静态：TypeScript strict、ESLint、格式化、Python 类型检查、Ruff、迁移检查、OpenAPI diff、依赖与密钥扫描；
- 单元：状态机、权限矩阵、复习算法、验收规则、AI 路由、冲突分类、配额；
- 数据库集成：事务、唯一/外键/检查约束、workspace 过滤、并发 version、迁移升级/降级；
- 契约：前后端生成类型与 FastAPI schema、一致错误码、分页、幂等；
- 本地库：崩溃恢复、Outbox 原子性、schema 升级、浏览器清理提示；
- E2E：注册、邀请、每日闭环、研究、AI 草稿、导入导出、删除；
- 安全：RBAC/IDOR、CSRF/XSS/SSRF、文件、限流、token 重用、日志泄漏；
- 运维：备份恢复、回滚、sync_epoch、旧客户端、依赖服务故障。

测试不得依赖执行顺序或共享外部账户；时间、UUID、Provider 和存储通过可控接口注入。涉及同步和幂等必须包含重复、乱序、延迟、断线、部分成功、并发和崩溃点测试。

### 10.2 强制场景

至少覆盖执行计划第 9.2 节全部总场景，以及：两个 workspace 相同对象 ID 尝试、成员角色在会话中途降级、邀请重复接受、同幂等 key 不同 payload、附件 complete 重放、AI 草稿目标已更新、备份恢复后旧 cursor、Yjs 更新乱序/重复、tombstone 与离线更新竞争、浏览器配额耗尽、Provider 返回超大/恶意响应。

### 10.3 性能与容量

测试数据必须包含 10 万任务、100 万事件、5 万笔记/资源、1 万附件、5 千论文和 10 万 AI run 的查询/同步基线。非 AI API p95 目标 < 500 ms；同步必须分页并限制批次；大导出、备份和 AI 使用后台任务，不阻塞 Web worker。

## 11. CI、部署与发布

CI 顺序：依赖/密钥检查 → lint/type → 单元 → 构建 → 数据库与迁移 → OpenAPI 契约 → 集成/E2E → 安全扫描 → 镜像/SBOM → staging 部署 → smoke。受保护分支不得绕过必需检查。

环境分 development、test/staging、production；密钥与数据库隔离。Docker Compose 至少包含 web、api、worker、postgres、redis、reverse-proxy、backup；服务使用非 root、只读文件系统（可行处）、健康检查、资源限制和固定镜像版本。PostgreSQL、附件和备份不直接暴露公网。

发布流程：冻结候选版本 → 生成/验证备份 → staging 迁移与 E2E → 安全/隐私/无障碍门槛 → 小比例灰度 → 指标观察 → 扩大。回滚必须区分应用回滚与数据库前向修复；不得在不验证数据兼容性的情况下回滚二进制。

自动备份至少覆盖 PostgreSQL、附件、加密配置元数据和恢复所需版本信息；同服务器备份不能作为最终灾备。每月自动验证备份可读，至少每季度在空环境完整恢复。恢复报告记录 RPO/RTO、校验、缺失项和 sync_epoch 处理。

发布阻断：P0/P1、迁移不可复现、租户越权、密钥泄漏、静默冲突、数据丢失、备份不可恢复、核心离线不可用、关键无障碍阻断、法律页面/删除流程缺失。

## 12. AI 编码代理工作纪律

### 12.1 开始前

1. 读取两份根目录基线与相关 ADR；
2. 用一句话复述目标与非目标，列出受影响模块、schema、API、UI 状态和测试；
3. 检查工作区已有未提交修改，不覆盖他人工作；
4. 若需求会改变租户、安全、同步、数据寿命、付费或隐私语义，先提交 ADR/变更说明；
5. 优先做最小完整纵向切片，不同时重构无关模块。

### 12.2 实现中

- 先写/更新契约与失败测试，再实现；
- 数据迁移与代码必须兼容滚动发布窗口；
- 复用领域服务和设计系统，不复制权限、状态或校验逻辑；
- 不引入未经评估的大依赖；新依赖说明许可证、维护状态、包体/攻击面和替代方案；
- 不把 TODO、mock、hard-coded secret、测试后门、调试接口或演示数据带入生产路径；
- 注释解释“为什么”和约束，不复述代码；错误消息对用户可操作，对日志可定位且不泄密；
- 对不可恢复或外部副作用操作提供幂等、确认、审计和回滚/补偿。

### 12.3 完成时

AI 必须报告实际执行的测试及结果，不能声称未运行的检查已通过。提供：变更摘要、对应需求、文件清单、迁移和回滚、截图/可访问性结果（涉及 UI）、OpenAPI diff（涉及 API）、威胁模型变化、已知限制。

若因环境无法运行某项验证，明确标记“未验证”、原因、风险和开发者应执行的命令；不得用推测替代证据。

## 13. Definition of Done

一个功能只有同时满足以下条件才算完成：

- 对应执行计划范围和验收场景；正常/空/加载/错误/离线/权限/移动状态均实现；
- 数据模型、迁移、索引、约束、删除和导出语义完成；
- API schema、错误、幂等、并发和权限完成；
- 跨租户与滥用负向测试完成；日志和审计不泄密；
- 客户端本地事务、同步、冲突和 schema 升级路径完成（适用时）；
- 键盘、焦点、对比、读屏名称、触控、减少动效和响应式检查完成；
- 单元/集成/契约/E2E 按风险通过，覆盖率不降低；
- 监控、运行手册、备份/回滚影响和用户文档更新；
- 无未说明的 mock、TODO、死代码、警告或漂移；
- 代码经独立评审，交付说明可由下一位开发者直接复现。

## 14. 开发任务提示模板

向 AI 分配任务时使用以下结构：

```text
项目：Logion
基线：先读取 LOGION_EXECUTION_PLAN.md 与 LOGION_AI_DEVELOPMENT_CONSTRAINTS.md
里程碑/需求：<M# / 需求描述>
目标：<一个可验证结果>
非目标：<本次明确不做>
允许修改：<目录/模块>
输入契约：<API/schema/设计稿>
验收：<自动测试 + 人工场景 + 性能/无障碍/安全>
数据与迁移：<是否涉及>
安全与隐私：<威胁/敏感数据>
交付格式：变更摘要、文件、测试证据、迁移/回滚、风险与未完成项
```

禁止仅给出“做一个学习网站”“按原型实现”这类无边界任务。每次任务应能在一个合并请求内独立验证，并与其他工作流通过契约并行。

## 15. 最终审计清单

在版本候选发布前逐项签字：品牌与公共表述可核验；注册/邀请/RBAC 和跨租户测试通过；PWA 离线闭环和冲突中心通过；任务证据与验收不变量通过；研究数据可追溯和导出；AI 密钥、发送确认、草稿审批与预算通过；Markdown/URL/附件/Provider SSRF 控制通过；WCAG 2.2 AA 关键流通过；备份空环境恢复和旧设备重新 bootstrap 通过；账户删除与分享撤销通过；OpenAPI、迁移、SBOM、监控、告警、回滚和用户文档齐全。

## 16. 多用户 Space、资源权限与隐私硬约束

### 16.1 层级

必须实现并始终区分：

```text
User
└── WorkspaceMembership
    └── Workspace（租户/计费边界）
        └── Space（可见性边界：private/shared）
            └── Domain Object
```

- 每个业务对象除 `workspace_id` 外必须有 `space_id`，除非它是 workspace 级配置或明确的跨 Space 索引；
- `private` Space 只允许其 owner 访问，Workspace Owner/Admin 不因管理角色自动获得正文读取权；
- `shared` Space 按 membership 和角色授权；
- 跨 Space 引用保存显式引用或不可变快照，不能绕过目标 Space 权限；
- 从私人 Space 移动到共享 Space 属于数据披露，必须显示影响、最近认证并审计；
- 客户端缓存按 workspace/space 加密和过滤，被撤销后停止同步；
- 搜索索引、通知、导出、备份恢复、AI input_scope 与后台任务均必须遵守相同权限边界。

### 16.2 角色能力基线

| 能力 | Owner | Admin | Editor | Contributor | Reviewer | Viewer |
|---|---:|---:|---:|---:|---:|---:|
| 管理 workspace 安全/账单 | 是 | 否/按 entitlement | 否 | 否 | 否 | 否 |
| 管理成员和角色 | 是 | 是 | 否 | 否 | 否 | 否 |
| 创建/删除 shared Space | 是 | 是 | 可创建 | 否 | 否 | 否 |
| 编辑共享计划和结构 | 是 | 是 | 是 | 受限 | 否 | 否 |
| 提交任务产出/证据 | 是 | 是 | 是 | 是 | 否 | 否 |
| 审阅/反馈 | 是 | 是 | 是 | 否 | 是 | 否 |
| 查看共享内容 | 是 | 是 | 是 | 是 | 是 | 是 |
| 查看他人 private Space | 否 | 否 | 否 | 否 | 否 | 否 |
| 创建公共快照 | 是 | 按策略 | 按策略 | 否 | 否 | 否 |

角色矩阵是默认能力，不得直接写死为前端显示逻辑。服务端授权使用命名 permission，并允许 workspace 策略收紧。Owner 不可被其他成员降级；转移所有权必须双重确认。

### 16.3 对象级授权

- `ShareSnapshot` 是选定字段的不可变投影，不等于对象 ACL；
- 审阅任务只授予指定对象/字段的 Reviewer 能力；
- 私人笔记不能通过嵌入链接间接泄露给共享对象；渲染层显示“无权访问引用”；
- 聚合统计不得让小样本推断个人私密数据，成员少于阈值时隐藏或降低粒度；
- 所有对象 ID 都视为可猜测，任何读取/写入/导出/搜索必须执行服务端权限检查。

## 17. 备考、自学和研究场景数据契约

### 17.1 新增表域

- 备考：`exams, exam_subjects, syllabus_nodes, question_banks, questions, practice_sets, practice_attempts, mock_exams, mock_exam_attempts, score_records`；
- 自学：`learning_goals, learning_tracks, course_indexes, learning_projects, deliverables, inbox_items, portfolio_items`；
- 研究深化：`claims, claim_evidence_links, literature_matrices, literature_matrix_entries, dataset_records, experiment_protocols, experiment_baselines, experiment_run_groups, supervisor_feedback, manuscript_sections`；
- 协作：`spaces, space_memberships_or_policies, review_assignments, rubrics, rubric_items, feedback_threads, share_snapshots`；
- 平台：`notifications, notification_preferences, search_documents, calendar_events, template_packages, template_versions, template_installations, entitlements, subscriptions, quota_usage, operator_audit_events, support_cases`。

所有新增同步实体遵守 UUIDv7、workspace_id、space_id、version、软删除和审计约定。事件、尝试、分数和反馈历史优先追加，不覆盖旧值。

### 17.2 备考不变量

- `Exam` 必须有时区明确的考试日期或标记日期未定；
- 大纲覆盖率只由关联且达到指定状态的 SyllabusNode 计算，不由 AI 自报；
- Question 和版权/来源/许可证元数据绑定；公共发布前执行内容治理；
- 每次 Attempt 保存当时题目版本、答案、耗时、信心和评分规则快照；
- 修改标准答案不能重写历史成绩；如需重评创建新评分版本；
- 模考在开始时冻结题目与规则，离线完成后允许同步，但检测客户端时钟异常；
- 成绩、排名和错题默认 private，分享必须显式选择范围。

### 17.3 自学不变量

- InboxItem 只是待整理入口，不能永久替代 Task/Resource/Note；
- CourseIndex 只保存索引、用户进度和许可元数据，不擅自抓取/托管付费正文；
- Project 的完成必须至少关联一个 Deliverable；
- PortfolioItem 是显式发布快照，不自动暴露原任务、私人笔记和附件；
- 计划重排保留中断和延期历史，不伪造连续天数。

### 17.4 研究不变量

- Claim 必须区分 supporting、opposing、uncertain evidence；
- AI 生成 Claim 只能进入草稿并要求定位原文或用户证据；
- DatasetRecord 必须记录来源、许可证、版本、划分、敏感性和允许用途；
- ExperimentRun 不能在缺少代码/配置/数据版本时标记 reproducible；
- Baseline/Ablation 比较必须保存共同评测协议快照；
- 失败运行、负结果和导师反馈不可因后续成功被覆盖；
- 关闭 SupervisorFeedback 需要解决说明或证据，不能只改状态；
- 导出论文材料时保留引用和待核验声明标记。

## 18. 搜索、通知、日历和模板约束

### 18.1 搜索

- 搜索查询必须先解析 workspace/space 权限，再访问索引；
- 服务端全文索引不得包含用户无权查看的投影；
- 客户端离线索引只包含已同步且当前设备有权缓存的数据；
- 删除/撤销权限后生成索引 tombstone；
- 搜索结果包含对象类型、workspace、space、片段和权限来源；
- 不将敏感正文发送第三方托管搜索；
- 搜索日志默认不保存完整查询正文，尤其不保存研究关键词和 PII。

### 18.2 通知

- 类型分 learning、collaboration、sync、security、ai、billing、system；
- 安全通知不可完全关闭；
- 通知 payload 只保存最小摘要，不复制敏感正文；
- 邮件/Web Push 点击后仍需服务端授权，通知本身不是访问凭证；
- 邀请、分享和恢复 Token 使用高熵随机值，只存哈希并带过期；
- 学习提醒遵守用户时区、安静时间、频率上限和去重；
- 离线本地通知不得声称云端同步或 AI 已完成。

### 18.3 日历

- CalendarEvent 是领域对象的投影或用户事件，必须记录 source_type/source_id；
- iCalendar feed 使用可撤销秘密 URL，Token 只存哈希；
- feed 默认不包含私人笔记、附件和详细错题；
- 第三方日历导出显示时区和更新语义；
- 删除源对象时下发取消/删除，不保留误导的幽灵事件。

### 18.4 模板

TemplatePackage 至少包含：schema_version、product_min_version、author、license、locale、target_personas、objects、dependencies、changelog、content_hash 和风险元数据。

- 模板安装前预览将创建的对象和外部链接；
- 不得包含成员、Token、Provider Key、私人路径、真实用户数据和可执行脚本；
- 安装使用新 ID 映射并在单事务/可回滚导入中完成；
- 模板升级生成差异提案，不直接覆盖用户修改；
- 公共模板发布需要审核、链接检查、版权声明、举报和撤回机制；
- 模板被撤回不删除已安装用户内容，只阻止新安装并通知风险。

## 19. SaaS 运营、计费和系统管理约束

### 19.1 Entitlement

- 功能与配额由服务端 `entitlements` 决策，前端显示不构成授权；
- entitlement 输入包括 plan、subscription 状态、workspace、试用、运营赠送和功能开关；
- 任何付费回调必须验签、幂等、可重放测试并保存原始事件摘要；
- 客户端传入价格、套餐和配额不可信；
- 降级采用宽限/只读策略，禁止立即删除超额内容；
- 用户在欠费或降级状态仍可导出数据和管理安全设置。

### 19.2 Operator 控制面

- Operator 身份与普通 User/WorkspaceMembership 完全分域，使用独立角色和强认证；
- 默认只能查看账户/服务元数据、配额、队列、备份和脱敏错误；
- 读取用户正文属于 break-glass 操作，需要工单、原因、最近认证、双人批准（生产成熟阶段）和完整审计；
- Operator 不能获得 AI Key 明文、恢复码、TOTP secret 或密码；
- 停用用户/workspace、恢复数据、调整配额和处理删除均为审计操作；
- 后台不得提供任意 SQL、任意 URL 请求或任意文件读取界面。

### 19.3 隐私、年龄与分析

- 上线前确定适用地区和最低年龄；未建立法定监护同意前不得主动面向低龄儿童；
- 产品分析事件使用明确 schema 和允许列表，不采集笔记正文、题目答案、论文未公开内容、AI 输入和附件；
- 分析可关闭，安全/计费审计与产品分析分开；
- 账户删除、workspace 删除、备份保留和法律保留分别定义期限；
- 第三方邮件、支付、监控和 AI Provider 进入数据处理清单并在隐私说明披露；
- 不将用户内容用于模型训练，除非另有独立、可撤销的明确同意。

### 19.4 反滥用

- 注册、登录、邀请、分享、模板发布、附件、URL 检查和 AI 调用分别限流；
- 邮件邀请防枚举和批量垃圾；
- 公共分享支持举报、撤销、过期、搜索引擎索引开关；
- 恶意 workspace 隔离不能影响其他租户；
- 封禁不得破坏用户依法获得数据副本的流程，具体依条款和法律处理。

## 20. 原型到实现的契约

原型是交互和状态说明，不是业务事实。开发代理必须为每个原型动作映射：

```text
原型元素 → 用户故事/权限 → API → 本地事务 → 同步行为 → 审计 → 测试
```

以下演示行为不得照抄为生产逻辑：

- 前端直接切换 `done/verified/mastery`；
- `setTimeout` 模拟同步或 AI 成功；
- 硬编码用户、价格、角色、Provider 健康和指标；
- 没有服务端验证的 workspace/space 切换；
- 本地计时器直接成为最终有效时长；
- 静态按钮暗示已完成邀请、备份、分享、删除或支付。

原型实现阶段必须补齐：

- 正常、空、加载、离线、待同步、冲突、权限不足、配额、错误和恢复状态；
- 备考、自学、研究和导师四种 profile track 的内容差异；
- private/shared Space 明确标识；
- 搜索、通知、日历、模板和运营边界；
- 对话框焦点管理、Escape、焦点返回、ARIA 状态和键盘可用；
- iOS PWA、窄屏、横屏、200% 缩放和减少动效检查。

## 21. AI 开发代理附加执行规则

### 21.1 任务切片

每个合并请求只交付一个可验证纵向能力，例如“创建考试 + 本地保存 + 同步 + 权限 + 测试”，不能一次提交“完成备考模块”。新增对象时同步更新 schema、迁移、OpenAPI、本地模型、导出、权限、审计和测试。

### 21.2 强制证据

AI 代理完成任务时必须提供：

- 需求/约束编号；
- 实际修改文件；
- 数据迁移与兼容性；
- 自动测试命令和原始结果摘要；
- UI 的桌面/移动/键盘/离线状态证据；
- API/OpenAPI diff；
- 新增威胁、控制和残余风险；
- 未验证项和人工复核步骤；
- 回滚/功能开关策略。

### 21.3 禁止行为

- 不得自行缩减多租户、离线、权限、安全、无障碍和备份要求；
- 不得以 mock 通过、静态 JSON、硬编码角色或前端校验替代服务端实现；
- 不得删除或重写不属于当前任务的用户改动；
- 不得为了测试通过关闭约束、跳过迁移、清空数据库或吞掉异常；
- 不得运行未经授权的破坏性命令或生产数据操作；
- 不得把归档文档重新作为并行真相源；
- 遇到基线冲突必须停止扩张实现，提交问题与最小可逆建议。

### 21.4 统一任务提示词

```text
你正在开发 Logion。只以根目录以下两份文件为产品和工程基线：
1. LOGION_EXECUTION_PLAN.md
2. LOGION_AI_DEVELOPMENT_CONSTRAINTS.md

任务：<单一纵向能力>
目标用户/场景：<备考/自学/研究/导师/平台>
需求与约束编号：<章节>
允许修改：<明确目录>
非目标：<明确排除>

开始前：审查现有改动、相关 schema/API/本地模型/权限/测试；如涉及租户、数据寿命、同步、安全、付费或隐私，先提出 ADR。
实现要求：契约和失败测试先行；服务端授权；本地事务与同步；正常/空/加载/离线/冲突/权限/配额/错误状态；无障碍；审计；迁移和回滚。
验收：列出自动测试、E2E、性能/安全/无障碍门槛及人工场景。
交付：变更摘要、文件、测试证据、OpenAPI diff、迁移/回滚、风险、未验证项。不得声称未运行的测试已通过。
```

## 22. 仓库模块、依赖与所有权硬约束

### 22.1 规范目录

代码实施采用以下顶层边界；新增顶层目录或在边界间移动职责必须先提交 ADR：

```text
apps/
  web/                 # Next.js、PWA、页面与前端 feature
  api/                 # FastAPI、application/domain、持久化适配器
  worker/              # 异步任务入口，复用 API 的领域用例
packages/
  contracts/           # OpenAPI 快照/生成类型/错误码/事件/同步 schema
  ui/                  # 设计令牌与可访问组件
  offline/             # IndexedDB、Outbox、同步客户端、冲突状态机
  config/              # lint/type/test/build 共享配置
infra/                 # 容器、部署、监控、备份和恢复
tests/                 # 跨模块契约、E2E、安全、性能、恢复
docs/adr/              # 架构决策
```

API 与 Web 内部领域名统一使用 `identity、workspaces、planning、content、memory、exam、research、collaboration、ai_gateway、integrations、audit`。前后端可采用各自语言惯用结构，但同一业务概念、状态枚举、权限名和错误码必须来自 `packages/contracts` 的权威来源或生成链。

### 22.2 依赖方向

- Web 页面只能通过 feature/application client 调用契约化 API；不得读取服务端内部类型、数据库模型或把响应缓存当作权威状态；
- 后端依赖方向固定为 transport → application use case → domain → port；数据库、队列、AI、邮件、对象存储是 port 的 adapter；
- Worker 只能调用可复用 use case，不得复制权限、配额、状态迁移或审计逻辑；
- `packages/contracts` 不依赖业务实现；`packages/ui` 不依赖领域模块；`packages/offline` 依赖契约但不依赖页面；
- 禁止跨领域直接访问对方表、repository 私有实现或内部组件；跨领域写入通过公开 use case，异步副作用通过版本化事件；
- 新增循环依赖、重复 DTO、重复枚举、重复权限判断、业务模块直接引用第三方 SDK均为合并阻断。

### 22.3 共享契约单写者

以下资产在任一时间只能有一个明确 owner/工作包写入：Alembic 迁移序列、OpenAPI 权威快照、错误码注册表、同步协议、IndexedDB schema、权限注册表、顶层锁文件、根级构建配置和部署基线。

- 其他代理先提交变更提案或消费已合并契约，不得在各自分支创建冲突版本；
- 生成文件只能由固定生成命令产生，不得手工修补；CI 必须在重新生成后检查工作树无漂移；
- 数据库迁移文件一经进入共享主分支不得改写历史；修正使用新迁移；
- 同一业务对象的数据库 schema、API schema、本地 schema、导出 schema 和事件 schema 必须在一个兼容性说明中一起审查；
- 租户、权限、同步、安全、数据寿命或隐私语义变更必须先有 ADR，后有实现。

### 22.4 动态用户上下文

禁止在生产路径写死真实姓名、导师、课题组、学校、考试、课程、研究方向、公司、成员、目标、资料或学习日期。包括但不限于“郝老师课题组”、特定考试和 Agent 安全路线，均只能存在于可删除的示例夹具、演示种子或用户主动安装的版本化模板中，并与生产默认数据隔离。

- `profile_track` 是可组合能力配置，不是账户永久类型；
- 导航推荐可根据已启用模块和用户数据变化，但服务端权限不依赖 profile 文案；
- 空账户必须显示可操作的空状态，不能自动创建含个人背景的对象；
- 示例/测试夹具不得在生产迁移中执行，且不得包含真实凭证或未经许可内容；
- 导入模板前必须预览，安装后使用新 ID，用户可编辑、导出和删除。

## 23. CI/CD 强制规范

### 23.1 可迁移的执行入口

Phase 0 必须为格式、静态检查、单元、集成、契约、E2E、安全、构建、迁移、镜像和恢复分别定义仓库内的规范命令。CI 提供商只负责编排这些命令；核心校验不能只写在某个供应商的 YAML 中。开发者必须能在本地或干净容器复现同一检查。

锁文件、Python/Node 版本、容器基础镜像和系统依赖必须固定。依赖安装使用冻结模式；CI 不得在构建过程中悄悄更新依赖。测试夹具、时钟、UUID、AI Provider、邮件和对象存储必须可控，不使用个人外部账户。

### 23.2 PR 门禁

所有合并请求至少执行：

1. 基线文件与工作包范围检查、冲突目录检查、禁止文件检查；
2. Secret scan、依赖漏洞与许可证策略检查；
3. Ruff、Python 格式和类型检查；ESLint、格式和 TypeScript strict；
4. 单元测试与覆盖率差异检查，不允许通过排除关键文件提高数字；
5. OpenAPI/错误码/事件/生成类型重新生成与漂移检查；
6. 受影响应用构建、数据库迁移空库升级和现有版本升级；
7. 命中高风险目录时自动增加集成、权限负测、IndexedDB 升级、同步协议和受影响 E2E；
8. UI 变更增加键盘、自动无障碍、320/360/768/1440 响应式和 PWA 离线 smoke；
9. 输出测试报告、覆盖率、OpenAPI diff、迁移报告和安全扫描产物。

保护分支禁止直接 push、禁止跳过必需检查、禁止 AI 自行批准、禁止用管理员权限强行合并。合并使用短生命周期分支和合并队列；队列在最新主分支上重新验证高风险检查。

### 23.3 高风险兼容性门禁

涉及相应路径时必须额外满足：

- **Alembic**：空库 upgrade、从最近生产版本 upgrade、schema 对比；可逆迁移验证 downgrade，不能安全 downgrade 时提供前向修复和应用回滚兼容说明；采用 expand/backfill/contract；
- **OpenAPI**：检测删除 endpoint/字段、收紧 required、缩窄 enum/格式、改变错误和分页语义等 breaking change；破坏性变更必须新版本或双写过渡；
- **IndexedDB**：从仍受支持的每个 schema 版本升级，验证崩溃点、配额不足、重新打开、回退到旧应用的明确行为；
- **同步协议**：验证 `protocol_version/min_supported_version`、重复/乱序/部分成功/重放、旧 cursor、tombstone、epoch 变化和未知 enum；
- **权限与租户**：对每个新资源生成用户 A/B、Workspace A/B、Private/Shared Space、角色降级和撤销后的负向矩阵；
- **附件与网络**：MIME 欺骗、路径、大小/解压炸弹、恶意 Markdown、XSS、CSRF、SSRF、DNS rebinding 和日志泄漏；
- **AI**：Provider 密钥、敏感字段确认、提示注入、超大响应、预算、取消、幂等、草稿过期和核心降级。

任何 AI 不得以 mock 响应、静态 JSON、关闭检查、降低阈值、删除失败测试、吞掉异常或标记 allow-failure 的方式使门禁变绿。临时隔离不稳定测试必须有 owner、问题编号、到期日和不降低安全/数据保障的替代检查。

### 23.4 Main、Nightly 与发布候选

- `main` 构建一次不可变、可追溯、带源码版本和依赖清单的候选产物；后续环境只晋级同一产物，不重新构建；
- 主分支生成镜像、SBOM、来源证明/签名（平台支持时）、镜像与 IaC 扫描，并部署短期环境做 smoke；
- Nightly 执行多浏览器 E2E、离线/同步故障注入、安全/模糊、可访问性、性能容量和长时间稳定性；
- 连续 Nightly 失败、未知高危漏洞或兼容性基线漂移时不得创建 Release Candidate；
- RC 必须在 staging 执行生产等价迁移、完整 E2E、备份、空环境恢复、sync_epoch、旧客户端和应用回滚/数据库前向修复演练；
- 所有报告按 commit、镜像 digest、数据库版本和协议版本关联，不能只保留截图或“已通过”文字。

### 23.5 生产发布与回滚

生产发布必须人工批准，AI 和 CI 均无权自动批准生产。顺序固定为 preflight → 备份与校验 → 兼容迁移 → 5% 灰度 → 观测 → 25% → 100%。百分比可由基础设施能力改为实例批次，但必须保留小范围验证。

灰度至少监控错误率、p95、登录失败、同步冲突/重试、队列积压、数据库锁、附件失败、AI 成本异常和跨租户安全告警。触发阈值自动停止扩大并通知人工；涉及数据写入错误时优先停写/关闭功能开关并前向修复，禁止盲目回滚到不理解新 schema 的旧二进制。

每个发布候选必须提供：变更清单、迁移/兼容矩阵、风险、监控链接、开关、回滚/前向修复、备份校验、人工 smoke、责任人和观测时长。P0/P1、租户越权、数据丢失、静默冲突、密钥泄漏、核心离线失效或恢复失败一票阻断。

## 24. 多 AI/多人并行开发协议

### 24.1 角色与责任

并行执行与具体模型厂商无关，至少区分：

- **Coordinator**：拆任务、维护依赖图、分配目录租约、决定合并顺序；
- **Contract owner**：管理共享 schema、迁移序列、权限、协议和生成链；
- **Implementer**：只在工作包允许目录交付一个纵向切片；
- **Independent reviewer**：复核安全、同步、权限、迁移或可访问性；不得由原实现代理自我批准；
- **Release owner（人类）**：批准 RC 和生产，接受残余风险。

一人可兼任 Coordinator 与 Contract owner，但实现者不能绕过独立复核要求。AI 可以提供审查意见和测试证据，最终合并与生产批准仍由人类负责。

### 24.2 工作包必填字段

每个 AI/人员开始前必须拿到唯一 `work_package_id`，并明确：

```text
work_package_id / milestone / objective
user_story / acceptance_scenarios
requirements_and_constraints
allowed_paths / forbidden_paths
contract_owner / input_contract_version
dependencies / assumed_commits
non_goals
data_migration / offline_sync / security_privacy impact
required_tests / manual_checks
feature_flag / rollback_or_forward_fix
handoff_format / reviewer
```

字段缺失时代理只能做只读审查和提出补全建议，不得扩展实现范围。工作包最大尺寸为一个可独立验证的纵向能力；预计超过 2–3 个工作日或需要多个无关领域时必须继续拆分。

### 24.3 路径租约与并发规则

- Coordinator 在任务系统中记录允许修改目录、共享文件和依赖 commit；同一路径只能有一个写入工作包；
- 不允许两个代理同时创建 Alembic head、修改同一 OpenAPI 权威文件、同步协议、IndexedDB schema、权限表或根锁文件；
- 契约 owner 先合并小型 contract PR，其他代理更新基线后分别实现 API、offline 和 UI；
- 每个代理使用独立短分支/工作树，不在共享工作树执行格式化全仓、批量移动或清理；
- 发现用户或其他代理的未提交改动时保留现场并报告，不得 reset、checkout 覆盖或“顺手修复”；
- 只允许最小范围机械生成；生成命令造成范围外变化时停止并交由 owner 处理。

### 24.4 合并顺序与冲突处理

默认合并顺序：失败契约测试 → 契约/迁移 → 服务端 use case → offline/sync → Web UI → E2E/运行手册。独立模块可以并行，但进入合并队列后必须在最新主分支重跑门禁。

若产生语义冲突，不按“最后提交者获胜”。Coordinator 应：冻结相关工作包 → 保存双方差异和测试 → 由 contract owner 选择兼容方案/ADR → 更新契约版本 → 两侧重新基线和验证。禁止通过复制一份相似 schema、临时适配层或硬编码分支来逃避冲突。

### 24.5 强制交接包

代理完成任务时必须交付：

1. 工作包 ID、目标和明确未做事项；
2. 修改文件清单及范围外变化为零的声明；
3. 需求到实现与测试的映射；
4. 实际执行命令、退出码、结果摘要和报告位置；
5. OpenAPI/数据库/IndexedDB/同步/权限差异与兼容矩阵；
6. 安全与隐私变化、威胁控制和残余风险；
7. UI 的桌面、移动、键盘、离线、空/错/权限/冲突证据（适用时）；
8. 功能开关、迁移、回滚或前向修复步骤；
9. 未验证项、阻塞、后续任务和建议 reviewer。

“代码完成”“测试应该能过”“与原型一致”不是有效交接。未执行的验证必须明确标为未验证，不能由另一个 AI 的推断替代。

### 24.6 必须独立复核的领域

身份恢复、Passkey/TOTP、Workspace/Space 授权、租户过滤、同步幂等/冲突、数据库迁移、IndexedDB 升级、附件处理、AI 密钥/SSRF、数据导出删除、备份恢复和生产发布必须由非原实现者复核。复核者应尝试推翻实现：构造跨租户 ID、撤销中的会话、重复/乱序 operation、恢复后的旧设备、恶意 URL/文件、旧客户端和部分失败，而不是只阅读成功路径。

## 25. 正式编码启动与阶段关闭规则

### 25.1 Phase 0 启动批准

在用户批准 `LOGION_EXECUTION_PLAN.md` 版本 1.1 与本文件版本 1.1 后，可创建工程骨架和 CI。批准前不得把原型演示逻辑迁入生产代码，也不得擅自安装大量框架或生成全量业务表。

Phase 0 的第一批变更仅限：目录/工具链、环境示例、健康检查、最小容器、契约生成、测试框架、CI、ADR、CODEOWNERS/等价所有权、监控和恢复骨架。任何业务实现需等 Phase 0 退出证据通过。

### 25.2 阶段关闭

阶段不能仅因时间到期或代码量完成而关闭。Coordinator 必须逐项核对执行计划的退出条件、CI 证据、迁移/兼容、未验证项、已知 P0/P1、运行手册和下一阶段输入契约。未达标项要么完成，要么由人类记录带期限、owner 和残余风险的范围调整；安全、租户隔离、离线数据完整性、备份恢复和生产人工批准不可豁免。
