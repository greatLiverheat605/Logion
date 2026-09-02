# E3：GLM / Product Owner 统一视觉与流程验收包

状态：`SIGNED · GLM GATE 2 通过`（Product Owner 表态 `2026-08-29T00:41:13+08:00`，签字记录见 [`e3-product-owner-signoff.md`](./e3-product-owner-signoff.md)）

本文件是验收协调包，不是 Product Owner 结论。自动化测试、已有独立验收或截图存在都不代表 E3 通过；逐路由结论必须由 PO 在真实 `127.0.0.1:8080` 走查时原样记录。

## 1. 运行环境摘要

| 项目 | 值 |
| --- | --- |
| 验收入口 | `http://127.0.0.1:8080` |
| 本包生成时间 | `2026-08-28T19:26:32+08:00` |
| Git HEAD | `94ff87e4fc76fdfba91c5f582b3abbe5a40a1f6c` |
| Git 工作区 | dirty；保留计划内业务、测试、报告和证据变更，未清理或回滚 |
| Web image | `logion-web:0.1.0` / `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9` |
| Web image Created | `2026-08-28T10:44:10.572791156Z` |
| Web container StartedAt | `2026-08-28T10:57:09.332601338Z` |
| Web mounts | `[]`；无源码 bind mount |
| API image | `logion-api:dev` / `sha256:332323a6e2e9435e3480e54130fe085a2fa1888eb3d221068e4feee179803152` |
| API container StartedAt | `2026-08-28T10:56:58.092025989Z` |
| API mounts | 仅 named volume `/attachments`；无源码 bind mount |
| 健康检查 | Web/API/DB/Redis/Worker/Reverse Proxy `healthy`；`GET /healthz` = `200` |
| 业务数据 | 真实测试账号 Session、Workspace、Space、权限、Vault、API 和 sync-v1；无 fixture 注入、静态 mock 或数据库直写 |

Audit 补拍使用的真实页面是 `/app/audit`，点击页面“重新验证”恢复已有 Session 后等待时间线完成加载；截图中为真实 `50 / 50` 事件和事件 Inspector，不是 `0 / 0` loading 态。

## 2. 真相源和证据规则

- GLM 目标清单与哈希：[`../glm-target-manifest.json`](../glm-target-manifest.json)。表格中的 `manifest.routes[n]` 是该文件的稳定路由条目。
- GLM Target 根目录：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace\artifacts\screenshots`。
- After 截图和逐页报告均使用当前仓库文件；缺失项写为 `MISSING`，不得用相邻路由、自动化测试或 prototype fixture 代替。
- 不做全页像素匹配。PO 核验 GLM 布局树的可识别性、首屏层级、信息密度、唯一 primary、上下文回显、真实操作路径和恢复状态。
- 当前路由表仅准备证据与现场记录；“通过 / 有保留通过 / 不通过”列在 PO 走查前保持空白。

## 3. 32 条路由证据矩阵

`Target` 文件名来自 GLM manifest；`After` 只列当前仓库已存在的主要 390 / 1440 证据，若另有 320 / 1024 会注明。报告路径相对于本文件目录 `reports/ui-refactor/gate-2/`。

| # | Route | GLM 布局树 | 主任务 / Primary | 证据路径 | PO 现场结论 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `/app/today` | `AppShell → TodayWorkbench → QueueMaster → NextActionMain → TaskContextInspector` | 推进下一动作并附证据；`Start focus or end the active session` | Manifest `routes[0]`; Target `app_today-320x640.png`, `app_today-390x844.png`, `app_today-1024x768.png`, `app_today-1440x900.png`; After `../after/app-today-320x640.png`, `../after/app-today-390x844.png`, `../after/app-today-1024x768.png`, `../after/app-today-1440x900.png`; 报告 `../b1-today-workbench.md` | 待 PO |
| 2 | `/app/self-study` | `AppShell → StudyTabs → Inbox → RouteAndProjectBoard → DeliverableTimeline` | 分诊收件箱并推进项目；`Triage the next inbox item` | Manifest `routes[1]`; Target `app_self-study-390x844.png`, `app_self-study-1440x900.png`; After `../after/app-self-study-390x844.png`, `../after/app-self-study-1440x900.png`（另有 320/1024）；报告 `../self-study-conformance.md` | 待 PO |
| 3 | `/app/records` | `AppShell → RecordsWorkbench → DocumentTree → MarkdownEditor → MetadataInspector` | 新建笔记并关联资料；`Create note` | Manifest `routes[2]`; Target `app_records-320x640.png`, `app_records-390x844.png`, `app_records-1024x768.png`, `app_records-1440x900.png`; After `../after/app-records-320x640.png`, `../after/app-records-390x844.png`, `../after/app-records-1024x768.png`, `../after/app-records-1440x900.png`; 报告 `../b3-records-workbench.md` | 待 PO |
| 4 | `/app/review` | `AppShell → ReviewTabs → DueQueue → AnswerSheet → KnowledgeInspector` | 清空主动回忆队列；`Start recall` | Manifest `routes[3]`; Target `app_review-390x844.png`, `app_review-1440x900.png`; After `../after/app-review-390x844.png`, `../after/app-review-1440x900.png`（另有 320/1024）；报告 `../review-conformance.md` | 待 PO |
| 5 | `/app/exam` | `AppShell → ExamMaster → CoverageMain → ExamInspector` | 推进覆盖率或模考；`Create exam or start mock exam` | Manifest `routes[4]`; Target `app_exam-390x844.png`, `app_exam-1440x900.png`; After `../after/app-exam-390x844.png`, `../after/app-exam-1440x900.png`（另有 320/1024）；报告 `../exam-conformance.md` | 待 PO |
| 6 | `/app/planning` | `AppShell → GoalMaster → StageRouteMain → GoalInspector` | 将目标拆成可验收路线；`Create goal or create stage` | Manifest `routes[5]`; Target `app_planning-390x844.png`, `app_planning-1440x900.png`; After `../after/app-planning-390x844.png`, `../after/app-planning-1440x900.png`（另有 320/1024）；报告 `../planning-conformance.md` | 待 PO |
| 7 | `/app/templates` | `AppShell → CategoryMaster → TemplateList → TemplatePreview → InstallSheet` | 预览并安装独立副本；`Install independent copy` | Manifest `routes[6]`; Target `app_templates-390x844.png`, `app_templates-1440x900.png`; After `../after/app-templates-390x844.png`, `../after/app-templates-1440x900.png`（另有 320/1024）；报告 `../templates-conformance.md` | 待 PO |
| 8 | `/app/audit` | `AppShell → AuditCommandBar → AuditTimeline → InlineEventDetail` | 筛选并解释安全时间线；无写入 primary，首交互为筛选 | Manifest `routes[7]`; Target `app_audit-390x844.png`, `app_audit-1440x900.png`; After `../after/gate-2/audit-390x844.png`, `../after/gate-2/audit-1440x900.png`（补拍 SHA-256 `243cf63230ed8aaa762b2f3da093436ef7c2a43f03489dbb2b647754e7ff6bf3`）；报告 `../audit-conformance.md` | 待 PO |
| 9 | `/app/spaces` | `AppShell → SpaceDirectory → SpaceAccessDetail → MoveConfirmSheet` | 管理私有 / 共享边界；`Create space when permitted` | Manifest `routes[8]`; Target `app_spaces-390x844.png`, `app_spaces-1440x900.png`; After `MISSING`（当前 `../after/` 无 `app-spaces-*`）；逐页报告 `MISSING`（未发现 `spaces-conformance.md`） | 待 PO |
| 10 | `/app/settings` | `AppShell → GroupedSettingsList → SecondarySettingsSheet` | 调整画像、界面和交互偏好；当前 settings command | Manifest `routes[9]`; Target `app_settings-390x844.png`, `app_settings-1440x900.png`; After `MISSING`；报告 `../settings-conformance.md`（明确记录截图待补） | 待 PO |
| 11 | `/app/profile` | `AppShell → AccountSummary → PersonalActivity → AccountActions` | 查看身份与个人活动；无强制写入 primary | Manifest `routes[10]`; Target `app_profile-390x844.png`, `app_profile-1440x900.png`; After `MISSING`；报告 `../profile-conformance.md` | 待 PO |
| 12 | `/app/help` | `AppShell → HelpSearch → EnvironmentDiagnostics → RecoveryPaths → FAQ` | 诊断环境并恢复；`Search help` | Manifest `routes[11]`; Target `app_help-390x844.png`, `app_help-1440x900.png`; After `MISSING`；报告 `../help-conformance.md` | 待 PO |
| 13 | `/app/research` | `AppShell → ResearchTabs → ClaimsMain → EvidenceInspector` | 维护问题、论点与证据链；`Create research question or add claim` | Manifest `routes[12]`; Target `app_research-390x844.png`, `app_research-1440x900.png`; After `../after/app-research-390x844.png`, `../after/app-research-1440x900.png`（另有 320/1024）；报告 `../research-conformance.md` | 待 PO |
| 14 | `/app/collaboration` | `AppShell → ReviewRequestMaster → RubricAndFeedbackMain → MemberInspector` | 完成评审并转为行动；`Submit feedback` | Manifest `routes[13]`; Target `app_collaboration-390x844.png`, `app_collaboration-1440x900.png`; After `../after/app-collaboration-390x844.png`, `../after/app-collaboration-1440x900.png`（另有 320/1024）；报告 `../collaboration-conformance.md` | 待 PO |
| 15 | `/app/ai` | `AppShell → DraftProviderSegmented → DraftReviewSplit → RunAuditInspector` | 审查草稿或管理 Provider；`Adopt draft or test and discover models` | Manifest `routes[14]`; Target `app_ai-390x844.png`, `app_ai-1440x900.png`; After `MISSING`（报告明确未单独新增 After）；报告 `../ai-conformance.md` | 待 PO |
| 16 | `/app/sync` | `AppShell → SyncSummary → OperationalTabs → ConflictCompare` | 处理待同步操作和冲突；`Sync now or process conflict` | Manifest `routes[15]`; Target `app_sync-390x844.png`, `app_sync-1440x900.png`; After `MISSING`；报告 `../sync-conformance.md`（真实登录截图待补） | 待 PO |
| 17 | `/app/security` | `AppShell → SecurityChecklist → SecuritySettingsSections → RecentAuthSheet` | 完成安全清单并管理会话；首个未完成安全动作 | Manifest `routes[16]`; Target `app_security-390x844.png`, `app_security-1440x900.png`; After `MISSING`；报告 `../security-conformance.md` | 待 PO |
| 18 | `/app/data` | `AppShell → ExportSection → ImportSection → IsolatedDangerZone` | 创建可验证加密导出；`Create encrypted export` | Manifest `routes[17]`; Target `app_data-390x844.png`, `app_data-1440x900.png`; After `MISSING`；报告 `../data-conformance.md` | 待 PO |
| 19 | `/app/search` | `AppShell → StickySearchCommand → ModeSegmented → GroupedResults → UtilityInspector` | 从一个入口查找内容和下一动作；`Submit search; clear filters when no result` | Manifest `routes[18]`; Target `app_search-320x640.png`, `app_search-390x844.png`, `app_search-1024x768.png`, `app_search-1440x900.png`; After `../after/app-search-320x640.png`, `../after/app-search-390x844.png`, `../after/app-search-1024x768.png`, `../after/app-search-1440x900.png`; 报告 `../b2-search-workbench.md` | 待 PO |
| 20 | `/app/workspaces` | `AppShell → WorkspaceTabs → MembersDataView → WorkspaceSheets` | 管理成员、邀请和所有权；`Invite member` | Manifest `routes[19]`; Target `app_workspaces-390x844.png`, `app_workspaces-1440x900.png`; After `MISSING`；逐页报告 `MISSING`（未发现 `workspaces-conformance.md`，需以实际页面和 manifest 走查） | 待 PO |
| 21 | `/app/integrations` | `AppShell → CapabilitySummary → ConnectorList → ConnectorInspector` | 连接能力且不扩大权限；`Create calendar subscription` | Manifest `routes[20]`; Target `app_integrations-390x844.png`, `app_integrations-1440x900.png`; After `MISSING`（报告明确未单独新增 After）；报告 `../integrations-conformance.md` | 待 PO |
| 22 | `/auth/login` | `PublicShell → Identity → Credentials → RecoveryAndRegistrationLinks` | 建立设备 Session；`Sign in` | Manifest `routes[21]`; Target `pub_login-390x844.png`, `pub_login-1440x900.png`; After `../after/auth-login-390x844.png`, `../after/auth-login-1440x900.png`；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 23 | `/auth/register` | `PublicShell → RegistrationPolicyState → RegistrationForm` | 按部署 / 邀请策略注册；`Create account or use invitation` | Manifest `routes[22]`; Target `pub_register-invite-390x844.png` + 三个 1440 policy Target；After `../after/auth-register-390x844.png`, `../after/auth-register-1440x900.png`（策略状态未分状态截图）；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 24 | `/auth/verify` | `PublicShell → VerificationTokenState → CredentialSetup` | 验证邮箱并继续凭据设置；`Verify and continue` | Manifest `routes[23]`; Target `pub_verify-1440x900.png`; After `../after/auth-verify-1440x900.png`（另有 320/390/1024）；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 25 | `/auth/recover` | `PublicShell → RecoveryForm → PrivacyFeedback` | 请求 / 完成密码恢复；`Continue recovery` | Manifest `routes[24]`; Target `pub_recover-1440x900.png`; After `../after/auth-recover-1440x900.png`（另有 320/390/1024）；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 26 | `/auth/callback` | `PublicShell → TransientCallbackStatus → CallbackErrorRecovery` | 自动完成回调，失败回登录；自动 completion | Manifest `routes[25]`; Target 复用 `pub_login-390x844.png`, `pub_login-1440x900.png`; After `../after/auth-callback-390x844.png`, `../after/auth-callback-1440x900.png`（另有 320/1024）；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 27 | `/onboarding` | `PublicShell → OnboardingStepper → CurrentStep → PersistentContext` | 配置 Persona、Workspace、Space、Vault 和首个目标；`Continue the current step` | Manifest `routes[26]`; Target `pub_onboarding-390x844.png`, `pub_onboarding-1440x900.png`; After `../after/onboarding-390x844.png`, `../after/onboarding-1440x900.png`（另有 320/1024）；报告 `../auth-onboarding-conformance.md` | 待 PO |
| 28 | `/invitations/accept` | `PublicShell → InvitationSummary → AuthenticationOrAcceptAction` | 查看 Workspace / 角色并接受邀请；`Accept invitation` | Manifest `routes[27]`; Target `pub_invite-1440x900.png`; After `../after/public-invite-1440x900.png`（另有 320/390/1024）；报告 `../public-flows-conformance.md` | 待 PO |
| 29 | `/shares/[token]` | `WidePublicView → ShareMetadata → ReadOnlySnapshot` | 查看短期只读分享；`Open an allowed deep link` | Manifest `routes[28]`; Target `pub_share-valid-1440x900.png`, `pub_share-revoked-1440x900.png`; After `../after/public-share-invalid-1440x900.png`（valid / revoked 状态 After `MISSING`）；报告 `../public-flows-conformance.md` | 待 PO |
| 30 | `/account/deletion` | `PublicShell → DeletionImpact → RecoveryWindow → PhraseGate` | 确认删除或进入受限恢复；`Confirm deletion or recover account` | Manifest `routes[29]`; Target `pub_deletion-1440x900.png`; After `../after/public-deletion-unauthenticated-1440x900.png`（另有 320/390/1024，状态为未认证）；报告 `../public-flows-conformance.md` | 待 PO |
| 31 | `/offline` | `PublicShell → OfflineState → LocalAndSyncRecovery` | 解释离线边界并恢复；`Retry connection or open sync` | Manifest `routes[30]`; Target `pub_offline-390x844.png`, `pub_offline-1440x900.png`; After `../after/public-offline-390x844.png`, `../after/public-offline-1440x900.png`（另有 320/1024）；报告 `../public-flows-conformance.md` | 待 PO |
| 32 | `/404` | `PublicShell → NotFoundState → RecoveryLinks` | 从无效地址恢复导航；`Return to Today or login` | Manifest `routes[31]`; Target `pub_not-found-1440x900.png`; After `../after/public-not-found-1440x900.png`（另有 320/390/1024）；报告 `../public-flows-conformance.md` | 待 PO |

### 已识别证据缺口（不由协调员代 PO 接受）

1. `/app/audit` 的 GLM `app_audit-1440x900.png` 文件名和 hash 与 manifest 匹配，但画面疑似误标为 Research；补拍的 After 只能证明正式页面当前状态，不能替代 Target 裁定。
2. `/app/spaces` 没有独立逐页报告，且当前目录没有 After 截图；必须现场按 manifest 和真实页面核验，或补证后再签字。
3. `/app/settings`、`/app/profile`、`/app/help`、`/app/ai`、`/app/sync`、`/app/security`、`/app/data`、`/app/workspaces`、`/app/integrations` 当前没有对应 After 截图；相关逐页报告中的“待补”状态保持有效。
4. `/shares/[token]` 当前只有 invalid After，valid / revoked 状态缺少同状态 After；`/auth/register` 的 policy 状态也没有逐状态 After。
5. 历史 Before 同视口缺口、部分公共流程 Target 缺口、320 / 1024 缺少 GLM Target 等，必须逐项由 PO 明确“接受证据缺口”或要求补拍，不得默认放行。

## 4. 已批准偏离

| 范围 | 约束 / 原因 | 恢复或边界 | 审批来源 |
| --- | --- | --- | --- |
| 移动交互目标 | GLM 部分控件视觉为 40px；正式可访问性基线提升为至少 `44 × 44px` | 只扩大触达区，不改变信息层级和操作语义 | PO 批准的整改计划 |
| 行为与数据语义 | 正式 API、Session、Workspace、Space、权限、Vault、sync-v1、Yjs 和对象合同优先于 GLM fixture | 任何视觉后果记录在逐页报告，不弱化正式行为 | PO 批准的整改计划 |
| Passkey | `/auth/passkey` 是 prototype-only 路由，不加入正式 Next 路由 | Passkey 作为 `/auth/login` 内的可发现方法，保留 capability 和恢复路径 | PO 批准的整改计划 |
| Callback | GLM 没有独立 callback 画面 | 复用 Login PublicShell 几何，保留正式 transient callback、失败恢复和回登录 | PO 批准的整改计划 |
| Onboarding | 原型步骤顺序 / fixture 不是真实七步合同 | 保留 GLM stepper 层级，使用正式 API、Vault、Workspace、Space 和目标状态 | PO 批准的整改计划 |
| 证据缺口 | Before / 部分 Target 缺少同视口可追溯资产 | 不缩放、不裁切、不伪造；由 PO 在 E3 逐项接受或要求补证 | 待本次 E3 裁定 |

## 5. 待 Product Owner 裁定的两个决策项

走查当场记录 PO 原话和时间戳，不由协调员改写：

### D1：Audit 1440 × 900 证据

- 事实：Target `app_audit-1440x900.png` hash 匹配 manifest，但画面疑似 Research；当前正式页面补拍 After 为 `../after/gate-2/audit-1440x900.png`，SHA-256 `243cf63230ed8aaa762b2f3da093436ef7c2a43f03489dbb2b647754e7ff6bf3`。
- PO 原话：`待现场填写`
- 时间戳：`待现场填写`
- 裁定记录：`接受补拍版作为当前 After / 接受现有 Target 现状并记录偏离 / 要求补交正确 Target`（由 PO 选择并原样记录）。

### D2：追认 `94ff87e`

- 事实：`94ff87e chore(contracts): update generated API contract` 只包含计划内 OpenAPI 生成物；`pnpm contracts:check` 已通过，后续回归已通过。
- PO 原话：`待现场填写`
- 时间戳：`待现场填写`
- 裁定记录：`追认 / 不追认并指定后续处理`（由 PO 选择并原样记录）。

## 6. 非阻塞跟进项

这些项目不应被隐藏，但不自动改变 E3 结论：

- F-6：7 个视图的 controller 分层仍可继续收敛，保持 view 不越过 controller 访问 API / Vault 的边界。
- F-4：少量非关键区域 `data-testid` 余项继续补齐，不能替代现有稳定 Workbench 选择器。
- F-5：少量触达区域余项继续按 `44 × 44px` 基线巡检。

## 7. PO 走查脚本

### 走查规则

1. 使用真实 `http://127.0.0.1:8080`，沿用当前有效 Session；不要用静态截图、mock 数据或测试绿灯替代任务观察。
2. 以 `1440 × 900` 和 `390 × 844` 为主视口，抽查 `320 × 640`、`1024 × 768`；确认无溢出、遮挡或不可达操作。
3. 每页只核验四个要素：**首屏层级、信息密度、唯一 primary、Workspace / Space / 对象 / 权限上下文回显**。动态内容不作为像素缺陷。
4. 每页完成真实主任务或恢复动作后，由 PO 立即填写“通过 / 有保留通过 / 不通过”、原话、时间戳和复验条件。
5. 任何“不通过”原样记录，不由协调员折中、重命名或改成“建议”。

### Persona = 学：应用路由顺序

`/auth/login` → `/app/today` → `/app/self-study` → `/app/records` → `/app/review` → `/app/planning` → `/app/templates` → `/app/settings` → `/app/profile` → `/app/help`

每一步：

- 先确认页面身份和上下文条，再从页面唯一 primary 开始。
- 完成 manifest 中的主任务，检查失败 / pending / locked / offline / permission / 409 / stale / error 状态是否有解释与恢复动作。
- 在不离开当前页面的前提下检查 Inline / Popover / Sheet / Inspector 是否完成对应低频操作；只有正式流程要求跳转时才导航。
- 回到前一页时确认 Workspace、Space、Persona、对象选择和权限没有丢失。

### 公共流程顺序

1. `/auth/register`：按真实注册策略检查开放、邀请、关闭状态与隐私等价反馈。
2. `/auth/recover`：请求恢复、错误反馈、恢复链接 / MFA 二级路径和 Session 撤销说明。
3. `/shares/[token]`：有效、失效 / 撤销、过期和不可发现对象的安全等价反馈；不泄露对象存在性。
4. `/account/deletion`：未认证限制、影响范围、权限、确认短语、不可逆边界和恢复窗口。
5. `/offline`：离线边界、本地可做操作、Outbox / Sync 恢复入口和重新连接。
6. Next `404`：返回 Today 或登录，且不改变数据、权限和当前安全边界。

### 统一状态记录字段

对每个状态记录：触发步骤、页面实际文案 / 控件、影响范围、所需权限、恢复动作、request ID（如有）、PO 原话和时间戳。`loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 不得只写成“有提示”。

## 8. 现场签字结果入口

完成走查后，将本包的 PO 现场结论逐项转录到：

`reports/ui-refactor/gate-2/e3-product-owner-signoff.md`

该签字文件必须包含 21 条应用路由汇总结论、公共流程结论、D1 / D2 原话与时间戳、所有保留 / 不通过项的负责人和复验条件。只有 32 条路由和公共流程全部通过，才可写入 `GLM Gate 2 通过` 并关闭 Gate 2；否则明确写 `GLM Gate 2 未通过`，Gate 2 保持开启。
