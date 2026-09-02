# 任务计划：Logion GLM 设计一致性整改

## 元信息

- 计划 ID：`logion-glm-conformance-2026-08-26`
- 创建时间：`2026-08-26T06:00:00+08:00`
- 状态：执行中
- 开始时间：`2026-08-26T14:07:43+08:00`
- 预估复杂度：高
- 预估步骤数：16 步，分 Gate 1 / Gate 2 两个审批门
- 预估工作量：25-40 人日，以逐页真实任务验收为准
- MCP 同步：已选择性同步 20 项 Logion 整改任务；3 个旧条目标记 `SUPERSEDED`；未清理其他项目任务
- 替代计划：`2026-08-26_logion-glm-prototype-refactor.md`
- 正式仓库：`C:\Users\Administrator\.codex\worktrees\25db\ai_study`
- GLM 设计工作区：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace`

---

## 任务目标

以 Product Owner 已批准的 GLM 原型作为 Logion 的视觉、信息架构、页面布局树与交互路径基线，整改 21 条正式应用路由、9 条正式公共流程以及 `/offline`、404 辅助公共页面；保留 U0-U4、Session、API、权限、Workspace、Space、Vault、sync-v1、Yjs、附件队列和正式对象语义，Function Reachability 保持 100%。

本计划不是把 GLM 原型源码复制进生产工程。GLM 的 fixture store、hash router、手写 overlay 和演示路由不得进入正式代码；正式实现继续使用 Next 16、React 19、现有 route-specific controller/view-model、Radix adapter 和真实数据链路。

---

## 背景与根因

### 已确认事实

- GLM 已交付 21 条应用路由、公共流程、双主题 token、路由布局树、11 类状态及桌面/移动截图，设计目标是“安静、专业、紧凑的知识工作台”。
- 正式工程已完成路由与功能合同、Radix 选型、Workbench/Overlay primitives、Context Bar、11 类状态和四断点浏览器夹具，这些 A1-A5 成果继续复用。
- Today 已完成 controller/view 拆分和三栏结构，但当前列宽、圆角、密度、可见信号与 GLM Target 不一致，因此原 B1 只算功能/结构通过，视觉验收撤销。
- Search 仍由 `EngagementCenter` 使用 `ProductPanel` 与 `planning-form` 组织主体；Records 仍由 `ContentCenter` 混合 `ProductPanel`、编辑表单和附件表单，均未达到 GLM 布局树。
- Auth 仍使用带装饰侧栏的旧 `AuthFormShell`。根据最初强制流程，Auth 不能越过三样板 Gate 1 提前施工；Gate 1 后把 Auth/Onboarding 调整为最高优先级。
- `logion-b1-web-1` 使用无源码挂载的生产镜像；工作区改变不会自动反映到 `127.0.0.1:8080`，可见验收前必须重建并记录镜像摘要。

### 旧计划失效点

1. 将“布局结构存在、自动化通过”误当成“符合批准的 GLM 设计”。
2. Before/After 证据缺少 GLM Target 同视口对照，没有量化框架几何、密度和区域完整性。
3. Today 将部分 GLM 首屏信息移入 Dialog，虽然功能可达，但改变了批准的信息层级。
4. 运行容器没有 build freshness 证据，工作区与用户实际看到的 8080 页面可能不一致。

### 历史教训

- 本地 `.codex/lessons/` 不存在，无可复用项目教训。
- 当前事故形成新约束：视觉 Gate 必须引用批准 Target；真实浏览器验收必须记录运行镜像摘要，不能只引用工作区文件或测试结果。

---

## 设计一致性合同

### 真相源优先级

1. 正式 API、权限、安全、Vault、sync-v1、对象与路由合同决定行为语义。
2. GLM `specs/01-05`、`artifacts/screenshots` 和页面源码决定视觉、IA、布局树与交互路径。
3. 当前正式 DOM/CSS 只是待整改实现，不得反向覆盖已批准设计。

任何偏离 GLM Target 的实现必须在逐页报告记录“偏离项、正式语义原因、替代方案、PO 决定”。允许偏离仅限真实数据差异、安全/权限要求、WCAG 或正式路由差异。

### 固定视觉基线

- Light/Dark token 映射采用 GLM 值：中性表面、单一 `#3056d3 / #4a75e0` 强调色、4px 间距网格、4/6/10px 圆角、120/180ms 动效。
- 桌面框架目标：Sidebar 232px、Topbar 48px；工作台 Master 264px、Main `minmax(0,1fr)`、Inspector 316px。
- 字体目标：13px 正文、12px 辅助、11px 仅用于非关键标注；不得以小字号掩盖信息密度问题。
- 桌面控件沿用 GLM 28/34px 视觉高度；移动端可点击区域按现行质量标准提升到至少 44x44px，这是记录在案的无障碍偏离。
- 每个可见交互层最多一个 primary；Workspace、Space、Persona、权限、Vault、Sync 上下文自动带入并持续回显。
- 二级披露最多两层；危险操作必须包含对象、范围、权限、确认短语、可撤销性和恢复路径。

### 逐页验收证据

每条路由必须交付：

1. 同视口 `Before / GLM Target / After` 三联截图；GLM Target 保持在隔离工作区，正式报告记录路径与 SHA-256，不复制 fixture 或原型代码。
2. 布局树、主任务、primary、交互路径和组件映射差异表。
3. 框架尺寸、关键区域存在、overflow、遮挡、触达、焦点顺序、primary 数量的机器结果。
4. 使用真实 Session/API/权限/Vault/Sync 的任务脚本与 Function Reachability 表。
5. PO 对视觉层级、信息密度、首屏任务和交互路径的人工结论；自动化不能代替签字。

---

## 技术方案

### 复用与边界

- 继续复用 `workbench.tsx`、`headless-ui.tsx`、`product-workbench-state.tsx` 和现有 Radix 依赖，不新增 Headless UI、主题库或 command 依赖。
- Today 已有 `use-today-controller.ts`；Search、Records 及后续巨型 Center 仅在副作用和 JSX 缠绕时提取 route-specific controller，不建立万能页面 schema、通用领域 controller 或配置驱动页面生成器。
- 共享层只承载 token、Workbench 几何、Overlay、Context Bar、State Notice、Data/List/Tabs/Inspector 等无领域语义 primitives；每页保留专属布局和任务编排。
- 页面样式优先与 route view 同目录；全局 CSS 只保留 token、Shell 和共享 primitive，禁止继续向 `globals.css` 堆领域选择器。
- 视图不直接访问 API/database/Vault；controller 保持现有 payload、错误、权限和副作用顺序。

### 运行版本新鲜度

每次可见验收前执行 Web 镜像重建和强制重建容器，报告记录源码 Git SHA、dirty diff 摘要、Web image ID、CreatedAt、容器 StartedAt 和测试 URL。验收截图只接受该摘要对应的运行实例。

---

## 步骤分解

### 阶段 A：恢复正确的验收基线

#### 步骤 1：冻结 GLM Conformance Contract 与目标清单

- **状态**：已完成 ✓（via `sub-001`）
- **执行时间**：`2026-08-26T14:25:54+08:00`
- **AI 评分**：94/100
- **子计划**：[sub-001_glm-conformance-contract.md](2026-08-26_logion-glm-design-conformance-remediation/sub-001_glm-conformance-contract.md)
- **目标**：把批准的 GLM token、路由布局树、关键区域和截图哈希转成正式工程可审计合同。
- **涉及文件**：
  - `docs/product/GLM_DESIGN_CONFORMANCE.md` — 新建设计一致性合同
  - `reports/ui-refactor/glm-target-manifest.json` — 新建 Target 路由/视口/哈希清单
  - `tests/browser/glm-conformance.ts` — 新建几何与关键区域断言 helper
  - `tests/browser/prototype-productization.spec.ts` — 扩展 21 路由合同
- **具体操作**：登记 21 路由、公共流程、GLM 截图路径与 SHA-256；定义 sidebar/topbar/master/inspector 尺寸、区域 test id、唯一 primary 和允许偏离记录格式；不做像素级全页硬匹配。
- **验证方法**：Target manifest 可校验文件存在与哈希；所有正式路由都有布局树、主任务、primary 与关键区域合同；缺少 Target 或偏离说明时测试失败。

#### 步骤 2：校准全局 token、Shell 与共享 primitives

- **状态**：已完成 ✓（via `sub-002`）
- **执行时间**：`2026-08-26T14:57:02+08:00`
- **AI 评分**：96/100
- **子计划**：[sub-002_glm-token-shell-primitives.md](2026-08-26_logion-glm-design-conformance-remediation/sub-002_glm-token-shell-primitives.md)
- **目标**：让正式基础层与 GLM 设计系统同源，消除当前大圆角、非目标列宽和密度漂移。
- **涉及文件**：
  - `apps/web/src/app/globals.css`
  - `apps/web/src/components/app-shell/app-shell.tsx`
  - `apps/web/src/components/product/workbench.tsx`
  - `apps/web/src/components/product/workbench.css`
  - `apps/web/src/components/product/headless-ui.tsx`
  - 对应 component tests
- **具体操作**：映射 GLM light/dark token；固定 232/48/264/316 框架；保持 Radix 焦点、CSP nonce 和 reduced-motion；删除只为旧 Center 服务且不再有调用者的共享样式，不重写领域页面。
- **验证方法**：token 与几何合同测试通过；Shell 320/390/1024/1440 无溢出；Dialog/Sheet/Menu/Tabs 键盘与焦点恢复保持通过；bundle 不新增依赖。

### 阶段 B：三套高保真真实样板

#### 步骤 3：重新整改 Today 并撤销旧 B1 视觉通过

- **状态**：已完成 ✓（via `sub-003`）
- **执行时间**：`2026-08-26T15:49:20+08:00`
- **AI 评分**：96/100
- **子计划**：[sub-003_today-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-003_today-glm-conformance.md)
- **目标**：使正式 Today 在真实数据下达到 GLM Queue + NEXT ACTION + Task Context Inspector 的视觉、密度和首屏信息层级。
- **涉及文件**：
  - `apps/web/src/features/execution/today-workbench.tsx`
  - `apps/web/src/features/execution/today-workbench.module.css`
  - `apps/web/src/features/execution/use-today-controller.ts`（仅缺失真实 view-model 字段时修改）
  - `tests/browser/today-workbench.spec.ts`
  - `reports/ui-refactor/b1-today-workbench.md`
- **具体操作**：按 GLM 恢复首屏可见的下一动作、证据/人工验收、今日信号和执行趋势；去除多余原生上下文 Select 工具条或降级为正确的 Context/Popover；保持结束会话不等于完成、证据不等于验收和唯一 primary。
- **验证方法**：真实任务从选择到专注、证据、验收、关闭完整通过；四视口三联证据、几何、Axe、键盘、焦点、reduced-motion、11 状态和 Function Reachability 全过；PO 明确签字后 B1 才完成。

#### 步骤 4：实现 Search 高保真检索工作台

- **状态**：已完成 ✓（via `sub-004`）
- **执行时间**：`2026-08-26T16:56:44+08:00`
- **AI 评分**：96/100
- **子计划**：[sub-004_search-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-004_search-glm-conformance.md)
- **目标**：用 GLM Command/Search Bar + 类型/范围模式 + 分组结果 + Preview Inspector 替换旧 ProductPanel/表单堆叠。
- **涉及文件**：
  - `apps/web/src/features/engagement/engagement-center.tsx`
  - `apps/web/src/features/engagement/use-search-controller.ts` — 新建
  - `apps/web/src/features/engagement/search-workbench.tsx` — 新建
  - `apps/web/src/features/engagement/search-workbench.module.css` — 新建
  - `tests/browser/search-workbench.spec.ts` — 新建
- **具体操作**：保留服务端/离线搜索、通知偏好和 Calendar Feed；取消或忽略过期响应；搜索输入为主任务，结果支持键盘选中和 Inspector 预览；通知/订阅进入 GLM Tabs/Sheet，移动预览为全宽 Sheet。
- **验证方法**：空查询、loading、结果、无结果、offline、locked、permission、error、stale 与旧响应竞态通过；搜索/订阅/导航 100% 可达；四视口三联证据与 PO 视觉验收通过。

#### 步骤 5：实现 Records 高保真对象编辑工作台

- **状态**：已完成 ✓（via `sub-005`）
- **执行时间**：`2026-08-26T17:52:31+08:00`
- **AI 评分**：96/100
- **子计划**：[sub-005_records-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-005_records-glm-conformance.md)
- **目标**：用 GLM Object Master + Inline Editor + Metadata/Relation/Sync Inspector 替换旧 ProductPanel、重复编辑区和纵向附件表单。
- **涉及文件**：
  - `apps/web/src/features/content/content-center.tsx`
  - `apps/web/src/features/content/use-records-controller.ts` — 新建
  - `apps/web/src/features/content/records-workbench.tsx` — 新建
  - `apps/web/src/features/content/records-workbench.module.css` — 新建
  - `tests/browser/records-workbench.spec.ts` — 新建
- **具体操作**：保持 Markdown/Yjs 笔记、Links/PDF、附件队列、Vault revision 和 sync-v1；draft 局部化；新建/导入/附件进入 Sheet；保存、dirty、pending、success、409 和 stale 明确；外链继续走安全 URL 校验。
- **验证方法**：真实 Vault、离线保存、同步、附件 capability、Yjs、revision 冲突和权限路径通过；全部原功能可达；四视口三联证据与 PO 视觉验收通过。

#### 步骤 6：执行三样板 Gate 1

- **状态**：已完成 ✓（Product Owner 已验收）
- **执行时间**：`2026-08-26T18:33:21+08:00`
- **AI 评分**：98/100
- **审批记录**：[gate-1-product-owner-approval.md](../../../reports/ui-refactor/gate-1-product-owner-approval.md)
- **目标**：由 Product Owner 以真实任务批准 GLM 视觉方向和三类页面范式。
- **涉及文件**：`reports/ui-refactor/` 下三页报告、截图、结构差异、Function Reachability、bundle 与可访问性结果。
- **具体操作**：先重建无挂载 Web 镜像并记录摘要；分别以 1440 与 390 可见走查，抽查 320/1024；逐页对照 GLM Target，不以“看起来更漂亮”或测试绿色代替验收。
- **验证方法**：Today/Search/Records 均有 PO 明确通过记录；任一页未通过时只在样板范围整改，步骤 7-15 不得启动。

### 阶段 C：Gate 1 后优先统一公共入口

#### 步骤 7：Auth、Callback 与 Onboarding

- **状态**：已完成 ✓（via `sub-006`）
- **执行时间**：`2026-08-26T20:40:00+08:00`
- **AI 评分**：96/100
- **子计划**：[sub-006_auth-public-flow-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-006_auth-public-flow-conformance.md)
- **目标**：优先消除用户打开产品第一屏仍像旧版的问题，同时保持认证安全语义。
- **涉及文件**：
  - `apps/web/src/features/auth/auth-form-shell.tsx`
  - `apps/web/src/features/auth/login-form.tsx`
  - `apps/web/src/features/auth/register-form.tsx`
  - `apps/web/src/features/auth/verify-email-form.tsx`
  - `apps/web/src/features/auth/password-recovery-form.tsx`
  - `apps/web/src/features/onboarding/`
  - `apps/web/src/app/auth/callback/page.tsx`
  - 公共浏览器测试
- **具体操作**：实现 GLM 440px PublicShell、紧凑表单与恢复状态；保留 password manager/paste、MFA、Passkey、统一隐私错误、request ID、设备命名、token 和 Persona/Workspace/Space 引导；不创建原型的 `/auth/passkey`。
- **验证方法**：匿名真实注册/登录/恢复/回调/Onboarding 任务通过；320/390/1024/1440、键盘、读屏、错误恢复和 accessible authentication 通过。

### 阶段 D：知识工作路由

#### 步骤 8：Planning、Review 与 Exam

- **状态**：已完成 ✓（Planning、Review 与 Exam 均已通过 Product Owner 独立验收；Planning 的 Before 同视口证据缺口已获明确接受）
- **子计划**：[sub-007_planning-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-007_planning-glm-conformance.md)
- **Review 子计划**：[sub-008_review-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-008_review-glm-conformance.md)
- **Exam 子计划**：[sub-009_exam-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-009_exam-glm-conformance.md)
- **Planning 结果**：正式 Goal Master / Stage Route Main / Goal Inspector、真实任务与 Vault/sync-v1 路径、四断点 After 和全量质量门禁均已通过；历史 Before 不具备同视口原图，已在报告中登记为 PO 必须明确决定的证据限制。
- **Planning PO 验收**：`Planning 独立验收通过，并接受证据缺口`；允许启动 Review，Exam 继续锁定。
- **目标**：分别落地路线 Master-Detail、复习队列/作答 Sheet、备考覆盖分析，禁止共用通用卡片模板。
- **涉及文件**：`features/planning/planning-center.tsx`、`features/memory/review-center.tsx`、`features/exam/exam-center.tsx` 及领域 CSS/tests。
- **执行要求**：`/do-plan` 为每条路由建立独立子计划和 PO 验收记录；先冻结 controller 副作用，再替换 view；Exam 已由 `sub-009` 解锁施工，步骤 9 及其他路由仍保持串行锁定。
- **验证方法**：目标/阶段/任务、知识点/题目/自评、科目/大纲/模考/成绩功能 100% 可达；每页四断点三联证据通过。

#### 步骤 9：Self-study、Research、Collaboration 与 Templates

- **状态**：已完成 ✓（Self-study、Research、Collaboration、Templates 均已通过 PO 独立验收）
- **Self-study 子计划**：[sub-010_self-study-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-010_self-study-glm-conformance.md)
- **Research/Collaboration 子计划**：[sub-011_research-collaboration-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-011_research-collaboration-glm-conformance.md)
- **Templates 子计划**：[sub-012_templates-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-012_templates-glm-conformance.md)
- **目标**：形成收件箱/项目/成果、问题-声明-证据、Rubric-Review-Feedback、模板库/安装分享四套专属 IA。
- **涉及文件**：`features/self-study/self-study-center.tsx`、新增 research/collaboration controller/view、`features/growth/growth-center.tsx`、`features/growth/public-share.tsx` 及 tests。
- **执行要求**：Self-study、Research、Collaboration、Templates 均已通过 PO 独立验收；不伪造连接器或分享能力。全量路由完成后，统一提交 GLM 进行最终视觉/流程验收，再进行最终 review；在该 Gate 2 流程完成前不得归档计划。
- **验证方法**：四路由功能可达、权限/空间边界、来源 URL、实验指标、成员反馈、模板独立副本与 capability 状态通过；逐页 PO 验收。

### 阶段 E：Workspace、同步与治理

#### 步骤 10：Workspaces、Spaces 与 Sync

- **状态**：技术实现与自动化自检完成，等待真实 Session/PO 走查（Workspaces/Spaces/Sync via `sub-013`）
- **子计划**：[sub-013_sync-workspaces-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-013_sync-workspaces-glm-conformance.md)
- **目标**：拆开成员治理和空间上下文；按 GLM Tabs/Data View 完成 Outbox、冲突、附件、设备诊断。
- **涉及文件**：`features/workspaces/workspace-center.tsx`、两个 route page、`features/sync/offline-sync-center.tsx`、`features/sync/sync-system.css` 及 tests。
- **验证方法**：邀请/角色/最后 Owner/危险操作、Space 权限、bootstrap/push/pull/409 三选一/附件/设备撤销全可达；逐页四断点三联证据通过。

#### 步骤 11：AI 与 Integrations

- **状态**：技术实现与自动化自检完成，等待真实 Session / GLM 统一验收（via `sub-014`）
- **子计划**：[sub-014_ai-integrations-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-014_ai-integrations-glm-conformance.md)
- **目标**：按 GLM 草稿审查/模型设置 Tabs 和连接器 Master-Inspector 呈现真实 capability。
- **涉及文件**：`features/ai/provider-center.tsx`、`features/ai/run-center.tsx`、`features/ai/ai-governance.css`、`features/integrations/integration-hub.tsx`、`integration-hub.css` 及 tests。
- **验证方法**：Provider 密钥不回显、发送来源预检、预算、运行取消重试、草稿批准拒绝、连接器错误/request ID 全部保留；capability-disabled 不隐藏入口。

#### 步骤 12：Security、Data 与 Audit

- **状态**：技术实现与自动化自检完成；Audit 已完成真实 Session / 四视口证据，Security / Data 仍等待真实 Session / PO 走查（via `sub-015`）
- **子计划**：[sub-015_security-data-audit-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-015_security-data-audit-glm-conformance.md)
- **目标**：以 GLM settings list、Data View 和危险区隔离高风险操作。
- **涉及文件**：`features/security/security-center.tsx`、`features/portability/data-sovereignty-center.tsx`、`features/audit/audit-log.tsx` 及 tests。
- **验证方法**：最近认证、Passkey/TOTP/恢复码、导入导出、manifest/hash、审计筛选/分页/拒绝事件和删除恢复路径完整；危险五要素齐全。

#### 步骤 13：Settings、Profile 与 Help

- **状态**：技术实现与自动化自检完成，等待真实 Session / 四视口 / PO 走查（via `sub-016`）
- **子计划**：[sub-016_settings-profile-help-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-016_settings-profile-help-glm-conformance.md)
- **目标**：为偏好、身份和支持建立三套专属主体，停止复用 IntegrationHubEntry 或静态占位结构。
- **涉及文件**：三个 `apps/web/src/app/app/*/page.tsx`、`persona-settings.tsx`、相关 service/tests。
- **验证方法**：Persona、主题、用户设置、onboarding 状态、个人信息、安全入口、帮助搜索和环境诊断全可达；逐页 PO 验收。

### 阶段 F：剩余公共流程与最终发布

#### 步骤 14：Invitation、Share、Deletion、Offline 与 404

- **状态**：已完成 ✓（via `sub-017`；技术与真实浏览器审计完成，待统一 GLM/PO Gate 2）
- **子计划**：[sub-017_public-flows-glm-conformance.md](2026-08-26_logion-glm-design-conformance-remediation/sub-017_public-flows-glm-conformance.md)
- **目标**：按 GLM PublicShell/Wide Public View 完成邀请、只读分享、删除恢复及公共异常页面。
- **涉及文件**：`features/workspaces/accept-invitation-form.tsx`、`features/growth/public-share.tsx`、`features/portability/account-deletion-recovery.tsx`、`app/offline/page.tsx`、`app/not-found.tsx` 及 tests。
- **验证方法**：匿名/登录/过期/撤销/无权限/最近认证/恢复窗口/capability-disabled 状态真实可达；失效分享不泄露存在性；危险五要素通过。

#### 步骤 15：逐页清理旧 Center 主体与 CSS

- **状态**：已完成 ✓（2026-08-28；Shrimp `sub-017` 已验证 94/100）
- **目标**：仅在对应路由通过后删除旧 ProductPanel/长表单渲染分支和无调用样式，杜绝新外壳包旧 DOM。
- **涉及文件**：通过页面的旧 view 分支、`product-ui` 调用、`globals.css` 领域选择器及 tests。
- **具体操作**：使用 `rg` 证明旧分支无调用；删除未引用的 `DataSovereigntyCenter`、旧 ProductPanel 相关 primitives 与孤立领域 CSS；不做跨领域“大扫除”；共享组件仍有调用时保留。
- **验证方法**：21 路由不渲染旧 Center 主体；没有死代码、孤立 CSS 或不可发现功能；Web 70 个测试文件 / 254 项测试、typecheck、lint、Next 16 production build 和 `git diff --check` 全部通过。

#### 步骤 16：Gate 2 全量真实发布验收

- **状态**：已完成 ✓（2026-08-29；E3 Product Owner 统一验收通过，Gate 2 已关闭）
- **目标**：确认实际运行的 21 路由和公共流程符合 GLM、正式合同与发布质量标准。
- **涉及文件**：`tests/browser/`、业务/合同测试、`reports/ui-refactor/`、构建报告。
- **具体操作**：重建 Web 镜像并强制重建容器；记录 image ID/CreatedAt/StartedAt；运行 lint、typecheck、unit、contracts、build、Playwright；逐页真实角色/权限/Vault/在线/离线/409/capability 走查；人工键盘与 Screen Reader 验收。
- **验证方法**：所有完成条件通过，PO 对真实 8080 构建签字；不以工作区截图、fixture 或旧镜像替代。

---

## 依赖关系

```text
步骤 1 -> 步骤 2 -> 步骤 3 / 4 / 5 -> 步骤 6 (Gate 1)
步骤 6 -> 步骤 7 -> 步骤 14
步骤 6 -> 步骤 8 -> 步骤 9
步骤 6 -> 步骤 10 / 11 / 12 / 13
步骤 3-14 -> 步骤 15 -> 步骤 16 (Gate 2)
```

共享文件冲突约束：Today/Search/Records 在步骤 2 完成后可按独立目录推进；Self-study 必须先于 Research/Collaboration；Workspaces 必须先拆分再改 Spaces；AuthFormShell 由步骤 7 统一修改，其他公共流程不得并行改该文件。

---

## 风险评估

| 风险                                 | 可能性 | 影响 | 缓解措施                                                               |
| ------------------------------------ | ------ | ---- | ---------------------------------------------------------------------- |
| 再次把结构通过当成视觉通过           | 高     | 高   | 三联截图、几何合同、GLM Target 哈希和 PO 人工签字缺一不可              |
| 为追求截图一致破坏正式语义           | 中     | 高   | controller/view 分离；正式合同优先；偏离必须记录原因                   |
| 复制 GLM fixture/hash router/overlay | 中     | 高   | 只映射表现层；代码审查扫描原型 import、fixture 键名与 hash route       |
| 全局 token 调整破坏未迁移页面        | 高     | 高   | 步骤 2 做兼容映射；四断点全路由 smoke；Gate 1 前不删除旧 alias         |
| 巨型 Center 拆分改变副作用顺序       | 高     | 高   | 先加 characterization test；保持 payload、API、repository 和错误语义   |
| 通用 schema 再造 21 个模板页         | 中     | 高   | 只共享无领域 primitive；route-specific controller/view；每页独立布局树 |
| 移动密度牺牲触达和读屏               | 中     | 高   | 44x44 点击区、320/390 overflow、键盘、Axe、人工 Screen Reader          |
| 无挂载 Docker 镜像展示旧版本         | 高     | 高   | 每次可见验收强制 rebuild/recreate 并记录 image digest/timestamps       |
| MCP 中混有其他项目任务               | 高     | 中   | 只用 selective 更新 Logion 任务，不 clearAll/overwrite                 |
| dirty worktree 覆盖用户改动          | 中     | 高   | 每步先读 diff；增量编辑；禁止 reset/checkout/revert                    |

---

## 总体验收标准

- [ ] 21 条正式应用路由、9 条正式公共流程、Offline 和 404 均有专属布局树与 GLM Target 对照。
- [ ] 每页提供 Before/GLM Target/After 同视口证据及允许偏离记录。
- [ ] 80% 高频任务从当前可见层唯一 primary 开始，低频字段最多二级披露。
- [ ] Workspace、Space、对象、Persona、权限、Vault、Sync 上下文自动带入并持续回显。
- [ ] 11 类状态由真实 controller 驱动，并提供明确恢复动作。
- [ ] 320、390、1024、1440 无横向溢出、遮挡、布局位移或不可达操作。
- [ ] 键盘、焦点恢复、Screen Reader、对比度、reduced-motion 和移动触达通过。
- [ ] Function Reachability 100%，现有合同、业务、Session、权限、Vault、sync-v1、Yjs、附件、AI、Integrations 测试全部通过。
- [ ] 没有复制 GLM fixture、hash router、演示路由或手写 overlay；没有新增第二套 UI 体系。
- [ ] 实际 `127.0.0.1:8080` 构建摘要与验收报告一致。
- [x] Gate 1 与 Gate 2 都由 Product Owner 按真实任务明确批准。

### 推荐验证命令

```powershell
pnpm --filter @logion/web test
pnpm --filter @logion/web typecheck
pnpm --filter @logion/web lint
pnpm contracts:check
pnpm build
pnpm test:browser
docker compose -p logion-b1 build web
docker compose -p logion-b1 up -d --force-recreate web reverse-proxy
docker inspect logion-b1-web-1
```

---

## 执行记录

| 时间                   | 操作                                                                               | 结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26             | 审查 GLM 设计系统、路由矩阵、正式路由合同、现有 Center、Radix/Workbench 与真实容器 | 确认不是 Git 回退；根因是只迁移 Today 且视觉 Gate 缺失，Search/Records/Auth 未施工，运行镜像无源码挂载                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-26             | 生成整改计划                                                                       | 仅修改 `.codex/plans/`；未修改业务代码                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-26             | 同步 MCP 任务                                                                      | `selective` 新增/更新 20 项 Logion 任务；旧 Today 子任务、旧公共流程任务、旧发布 Gate 标记为 `SUPERSEDED`；其他项目任务未改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-26 14:07       | 执行 `/do-plan` 并启动步骤 1                                                       | 计划已批准并进入执行中；步骤 1 因涉及 4 个文件触发子计划 `sub-001`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-26 14:25       | 步骤 1：冻结 GLM Conformance Contract 与目标清单                                   | 94/100；32 个验收对象、66 个 Target、固定几何、偏离格式和机器失败门完成，MCP 父子任务已同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-26 14:57       | 步骤 2：校准全局 token、Shell 与共享 primitives                                    | 96/100；232/48/264/316 几何、双主题可访问 token、四断点、焦点、reduced-motion、Axe 与新 8080 镜像通过，MCP 父子任务已同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-26 15:49       | 步骤 3：重新整改 Today 并撤销旧 B1 视觉通过                                        | 96/100；真实证据/验收、信号、趋势与连续移动流完成，四断点真实任务和三联报告通过；PO 签字保留至 Gate 1，MCP 父子任务已同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-26 15:52       | 步骤 4：实现 Search 高保真检索工作台                                               | 执行中；因副作用拆分、竞态与六文件范围触发子计划 `sub-004`，Shrimp 子任务已同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-08-26 16:56       | 步骤 4：完成 Search 高保真检索工作台                                               | 96/100；正式 Search controller/view、通知与 Calendar、竞态、移动 Sheet 焦点恢复、四断点真实 E2E 和三联报告通过；PO 签字保留至 Gate 1，Shrimp 父子任务已完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-26 16:59       | 步骤 5：实现 Records 高保真对象编辑工作台                                          | 执行中；因 1081 行副作用混合、Vault/Yjs/附件/revision/sync-v1 与六文件范围触发子计划 `sub-005`，Shrimp 父子任务已同步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-26 17:52       | 步骤 5：完成 Records 高保真对象编辑工作台                                          | 96/100；正式 Records controller/view、Vault/Yjs/Link/PDF/真实附件 SHA-256/revision/sync-v1、四断点真实 E2E 与三联报告通过；light warning token 达到 5.365:1；API 误切旧镜像后已恢复原 `logion-api:dev` digest；PO 签字保留至 Gate 1，Shrimp 父子任务已完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-26 17:52       | 步骤 6：进入三样板 Gate 1                                                          | Today、Search、Records 实现与 AI 自检均完成；停止步骤 7-15，等待 Product Owner 按真实任务和同视口 Target 明确验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-26 18:33       | 步骤 6：三样板 Gate 1 通过                                                         | 98/100；Product Owner 明确回复 `Gate 1 通过`；三页真实任务、三联证据、四断点、无障碍与 Function Reachability 获批，运行 image digest/0 mounts/healthz 已记录；Shrimp Gate 任务完成，解锁步骤 7-15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-26 18:35       | 步骤 7：Auth、Callback 与 Onboarding                                               | 执行中；Login/Register/Verify/Recover/Callback/Onboarding 涉及多流程、认证安全与超过 3 个文件，创建子计划 `sub-006`；Shrimp 父任务已进入执行链                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-26 20:40       | 步骤 7：完成 Auth、Callback 与 Onboarding                                          | 96/100；440px PublicShell、Callback、620px 七步 Onboarding、真实安全语义和持久上下文完成；最终 production 公共矩阵 125 passed / 7 skipped，24 After、20 Auth Before、Target 哈希和证据限制已归档；Shrimp 父子任务完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-26 20:48       | 步骤 8：启动 Planning 独立整改                                                     | 执行中；Gate 1 已通过，Planning 因 826 行 controller/view 混合、Vault/sync-v1 与多文件范围创建子计划 `sub-007`；Review、Exam 保持锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-27 02:03       | 步骤 8：Planning 完成 AI 自检，进入独立 PO 验收                                    | 96/100；Goal Master / Stage Route Main / Goal Inspector、真实 Session/API/Vault/sync-v1、四断点 After、Function Reachability、无障碍与全量门禁通过；Before 同视口证据缺口已显式登记；Shrimp 子任务已完成，Review、Exam 继续锁定，父步骤与父任务保持执行中                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-27 02:23       | 步骤 8：Planning 独立 PO 验收通过，启动 Review                                     | PO 原文 `Planning 独立验收通过，并接受证据缺口`；Planning 证据限制正式接受；创建并启动 Review 子计划 `sub-008`；Exam 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-27 02:54       | 步骤 8：Review 主体实现与静态自检完成                                              | 删除 `review-center.tsx` 不可达旧 ProductPanel 主体；ReviewTabs / DueQueue / AnswerSheet / KnowledgeInspector 保留真实动作；Sheet action 仅在成功后关闭；TypeScript、ESLint、52 files / 204 tests、diff check 全部通过；进入真实 Browser 证据阶段，Exam 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-27 02:54       | 步骤 8：Review 真实运行环境检查                                                    | Docker Desktop daemon 不可连接；Compose 变量缺少 `LOGION_SECRET_KEY` 等必需值；生产镜像重建、四视口截图、Axe 与 Browser E2E 延后，不以静态结果代替验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-27 03:36       | 步骤 8：Review 真实任务、四断点与证据收口                                          | 96/100；无挂载 Web 镜像 `sha256:247bedbca17935e267da04521e94640912b5bd5b03f65eec59f547f6610a2b55`；真实注册/登录 → Review → Vault 解锁 → sync-v1 bootstrap → 新建知识点/主动回忆题 → 选择 → 先回答后确认 → 保存加密答题记录通过；320/390/1024/1440、Axe、键盘、焦点、reduced-motion、overflow、唯一 primary、runtime console 全通过；Review 报告与截图哈希已核对，等待 PO 独立验收，Exam 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-27 05:02       | Gate 1 后 Today/Planning 工作台底部对齐回归修正                                    | 合同测试先 RED 后 GREEN；两份工作台 CSS 从错误的 `calc(100dvh - 6.5rem)` 改为 `calc(100dvh - var(--topbar-height))`，桌面铺满与移动端 `min-height: 0` 均受合同约束；Web production build、typecheck、lint、53 files / 205 tests、diff check 全通过；以真实测试账号运行最终镜像上的 Planning 与 Today authenticated Playwright，各 `1 passed`（含四断点填充/overflow/无障碍与真实任务链）；8080 Web 镜像最终摘要 `sha256:c8a20a7fb16dc2d97f4f3ba744d769a3439f631e0f923b897e784770e7b0838a`，API/DB/Redis/Worker/Proxy 全部 healthy；Review PO 验收仍待确认，Exam 继续锁定                                                                                                                                                                                                                                                                                                          |
| 2026-08-27 05:10       | Review 独立 PO 验收通过，解锁 Exam 子计划                                          | PO 原文 `Review 独立验收通过`；创建并启动 `sub-009_exam-glm-conformance.md`，Exam 进入独立整改，步骤 9 及其他路由继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-27 14:36       | Exam 技术实现、真实任务与证据收口                                                  | 96/100；真实 Session/API/Vault/sync-v1 完成考试、科目、大纲、模考、成绩闭环；四断点 overflow/几何/Axe/键盘/焦点/reduced-motion/唯一 primary 全通过；修复成功标签对比度和进度条 ARIA 语义；无挂载 Web 镜像 `logion-web@sha256:9ae8ac6ce4f9c8599abf2519a1ef1b16633ad50770f2de0e8b8a476d50ea6c45`；报告已归档，等待 Exam PO 独立验收，步骤 9 及其他路由继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-27 14:42       | Exam 独立 PO 验收通过，关闭步骤 8                                                  | PO 原文 `验收通过`；Exam 真实任务、四断点、无障碍与证据报告获批准，父步骤 8 完成，解锁步骤 9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-27 14:45       | 启动步骤 9 Self-study 子计划 `sub-010`                                             | 现有 SelfStudyCenter 仍为旧 ProductPanel/长表单主体；先按 Inbox / Route & Project Board / Deliverable Timeline 重构，Research、Collaboration、Templates 保持锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-27 15:41       | Self-study 真实任务与四断点证据完成，等待独立 PO 验收                              | 手动解锁 Vault 后真实完成 Inbox → 路线 → 项目 → 成果；Inspector/Timeline 与 `100%` 项目进度回显；320/390/1024/1440 无溢出且唯一 primary；同步两次进入 offline 并保留 Outbox；报告与截图哈希已归档，Research、Collaboration、Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-27 15:50       | Self-study 独立 PO 验收通过，关闭 `sub-010` 并启动 `sub-011`                       | PO 原文 `Self-study 独立验收通过`；允许 Research/Collaboration 按串行子计划施工，Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-27 17:06       | Research 真实任务、四断点与独立验收证据完成                                        | 真实 Session/API/Vault/sync-v1 完成问题→论文→声明→反馈→实验→指标链路；修复解锁自动焦点与选中行 AA 对比度；`c11` 无挂载镜像、四断点 After、Axe/键盘/焦点/reduced-motion/overflow/唯一 primary/runtime console 全通过；等待 PO 回复 `Research 独立验收通过`，Collaboration 与 Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-08-27 17:17       | Research 独立 PO 验收通过，启动 Collaboration                                      | PO 原文 `Research 独立验收通过`；Research 门关闭，允许按 `sub-011` 施工 Collaboration；Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-27 17:45       | Collaboration 技术实现、真实任务与四断点证据完成                                   | 新增 Review Master / Rubric & Feedback Main / Member Inspector；真实 Rubric → Review → Feedback → PUBLISH Snapshot 闭环通过；`c12` 无挂载 Web 镜像、320/390/1024/1440、Axe/键盘/焦点/reduced-motion/overflow/唯一 primary/runtime console 全通过；报告已归档，等待 Collaboration PO 独立验收，Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-08-27 18:49       | Collaboration 最终镜像与环境复核完成                                               | 清理临时诊断并恢复正式超时；`logion-web:dev` 无挂载镜像 `sha256:ae2c201961d7fe5b0a5505ddccd49692e9af899e7f54723ddc2ca0a01a86c4c9` 强制重建，API origin/WebAuthn 配置与 `127.0.0.1:8080` 匹配；直接登录 200，真实闭环规格 `1 passed (18.5s)`，四断点/无障碍/overflow/唯一 primary/runtime console 全通过；等待 PO 回复 `Collaboration 独立验收通过`，Templates 继续锁定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-08-27 18:55       | Collaboration PO 独立验收通过，启动 Templates 子计划 `sub-012`                     | PO 原文 `Collaboration 独立验收通过`；关闭 Collaboration 独立验收门，按 GLM `Category Master / Template List / Install Sheet` 创建 Templates 子计划并开始副作用冻结；后续路由保持 Gate 1 串行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-08-27 20:06       | Templates 技术验收与证据收口，等待独立 PO 验收                                     | `sub-012` 完成 Category Master / Detail Main / Inspector、Create/Import/Install/Share/Revoke Sheets；真实版本→安装→导入→分享→撤销闭环通过；四断点、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary、runtime console 全通过；报告 [templates-conformance.md](../../../reports/ui-refactor/templates-conformance.md) 已新增；补齐只读 Goals GET，步骤 9 仍锁定步骤 10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-27 22:58       | Templates 官方目录审计与最新镜像重验                                               | 安装事件补充 `source_scope=official_catalog` 并由真实 API 集成断言覆盖；重建 Web/API 无源码挂载镜像（Web `sha256:138adcb3236d5b72c1e1670b07ae5e2a2a470f14184b486fe54ff3633edcb0e1`，API `sha256:e7b684d3584883222c97655c0ef16b89d38e9267f2dba24c16c44fc1f7182832`）；Templates Playwright `1 passed (15.8s)`，Web 230 tests/typecheck/lint、API ruff 通过；仍等待 Templates PO 独立验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-08-27 23:10       | Templates Product Owner 独立验收通过，解锁步骤 10                                  | PO 原文 `Templates 独立验收通过`；步骤 9 关闭；按用户决策登记“全量完成后统一 GLM 验收，随后进行最终 review”，不提前归档父计划；启动步骤 10 Workspaces、Spaces 与 Sync                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-28 00:26       | 步骤 10 Workspaces、Spaces 与 Sync 技术实现与自动化自检完成                        | `sub-013`；Workspaces/Spaces 成员治理与 Space Directory、Sync Summary + Outbox/冲突/附件/设备 Tabs 完成；Sync 修复真实 outbox_state/attempt_count、copyLocal、dismiss、Bootstrap/stale/permission/capability 状态和 `?tab=conflict` 深链；Web 62 files / 235 tests、typecheck、lint、production build 通过；新 Web image `sha256:a820997e3a5cade9852e0b5bc3a491a72a8278384896a9e0af9e023124f9c9b7` 无源码挂载、8080 health 200；真实浏览器因无登录 Session 未输入敏感凭据，四断点 After/PO 走查待补                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-08-28 01:31       | 步骤 11：AI 与 Integrations 技术实现与自动化自检完成                               | `sub-014`；AI 草稿审查 / Provider 设置双 Workbench、Integrations 能力目录 Master-Detail-Inspector 完成；修复 AI 草稿批准 submitter 语义，移除 Integrations 旧 ProductPanel 注释和重复表单提交按钮；新增 D3 路由合同；Web lint 通过、63 files / 238 tests 通过、Next build 35 页通过；MCP `verify_task` 90/100 已完成；真实 Session、四视口和 GLM/PO 统一验收按报告登记待补                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-28 01:51       | 步骤 12：Security 技术实现与自动化自检完成                                         | `sub-015` Security；新增安全三栏 Workbench、专属 CSS 与 route-specific Vitest；修复 AppIcon 契约与缺失 `main` prop 导致的运行时崩溃/空主体；typecheck、lint、64 files / 241 tests 通过；MCP `a2d3fa42-d957-4d9e-b656-3030481d19f2` 以 88/100 完成；真实 Session、四断点和 PO 走查待补                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-28 02:13       | 步骤 12：Data 技术实现与自动化自检完成                                             | `Data Workbench` 完成 Export / Import Master、Data View Main、Danger Inspector；导入二步确认、Private Space 边界、删除恢复、offline / permission / recent-auth / 409 / error / capability-disabled 保留；Web 66 files / 247 tests、typecheck、lint 通过；MCP `984ed501-8002-428d-9f6f-f5fdd66b3b57` 88/100 完成；真实 Browser/PO 证据待补                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-28 02:15       | 步骤 12：Audit 技术实现与自动化自检完成                                            | `Audit Workbench` 完成 Filter Command Bar、Audit Timeline、Inline Event Detail；保留 `/api/v1/audit/me` 分页 cursor、结果/目标筛选、事件 ID、拒绝解释和 request ID；Web 66 files / 247 tests、typecheck、lint、build 通过；MCP `ec251af5-0316-479e-afec-88efdae7200d` 88/100 完成；真实 Browser/PO 证据待补                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-28 02:44       | 步骤 13：Settings、Profile 与 Help 技术实现与自动化自检完成                        | `sub-016`；Settings Grouped Settings List + Secondary Sheet、Profile Account Summary / Personal Activity / Account Actions、Help Search / Environment Diagnostics / Recovery Paths / FAQ 完成；移除 Settings 旧 ProductPanel 主体与 Profile/Help 占位页；定向 3 files / 3 tests、全量 69 files / 250 tests、typecheck、lint、Next 16 production build 通过；MCP `3b9d11d3-03b4-4ef8-a2bc-0ca418d94465` 88/100 完成；真实 Session、四视口、Axe、键盘/读屏、reduced-motion 和 PO/GLM 走查待补                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-08-28 03:31       | 步骤 14：Invitation、Share、Deletion、Offline 与 404 技术完成                      | `sub-017`；五类公共流程切换为独立 PublicFlowShell/Wide Public View，真实 API/权限/隐私/恢复语义保留；5 流程 × 320/390/1024/1440 Playwright、Axe、溢出、唯一 primary、reduced-motion、键盘焦点和 runtime console 通过；Web image `sha256:05835b0b7c6ba349dc11c39ba0b2af64bee016921ce970ef46f4f051d1653d03` 无源码挂载；报告与 20 张 After 截图已归档；等待步骤 15 和统一 GLM/PO Gate 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-08-28 04:05       | 步骤 15：逐页清理旧 Center 主体与 CSS 完成                                         | 删除零调用 `DataSovereigntyCenter`、旧 ProductPanel/长表单 primitives 与孤立领域 CSS；保留 `ProductProgress`、`ProductMarkdownPreview`、认证入口和 App Shell 公共动作；Web 70 files / 254 tests、typecheck、lint、Next 16 production build、`git diff --check` 通过；MCP `sub-017` verify 94/100；Gate 2 真实镜像、四断点 Session/权限走查和 GLM/PO 统一验收仍待执行                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-08-28 08:23       | 步骤 16：CSP 跨浏览器诊断与测试夹具修正                                            | 根因确认为 Playwright WebKit 截图注入无 nonce 的 `body {}` style；截图期间暂停 console 收集，Firefox 仅精确豁免 `strict-dynamic` 规范 warning，生产 CSP 未放宽；Planning `list_goals` 局部变量重命名修复 mypy 可空类型收窄；Web 70 files / 254 tests、全仓 `pnpm test`（295 passed / 57 deselected）、typecheck、lint、production build 通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-08-28 08:48       | 步骤 16：真实发布镜像与 Gate 2 自动化证据收口                                      | Web 无源码挂载镜像 `sha256:0257d49b2ce7d983308462bca412c2a094571f5611dc1a077afb90f0b433f8a4`，Created `2026-08-27T23:36:18Z`，容器 Started `2026-08-28T00:34:35Z`；API/DB/Redis/Worker/Proxy healthy，`/healthz` 200；公共 5 project 串行 `5 passed (2.0m)`，authenticated 真实账号/Session/Vault 全量 `44 passed (3.6m)`；contracts 连续生成哈希一致，但 `contracts:check` 仍被当前计划内未提交 OpenAPI diff 阻挡；MCP E3 依赖任务仍待统一 GLM/PO 门关闭                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-28 08:53       | 继续中断计划：同步 Planning 验收状态                                               | MCP C1 已以 96/100 标记完成；本地步骤 8 修正为已完成。Gate 2 仍保持 pending，剩余未关闭项仅接受统一 GLM/PO 真实验收后收口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-08-28 15:14       | Gate 2 修复批次 F-1/F-2/F-3/F-4/F-5 代码回归与运行环境恢复                         | AI/Provider 成功刷新后清理 `recentAuthRequired`；新增恢复闭环测试并通过。定向 7 files / 39 tests、Web 全量 70 files / 262 tests、根仓库 `pnpm test` 295 passed / 57 deselected、typecheck、lint、production build、`git diff --check` 与动态上下文检查通过。重建 `logion-web:dev` 并恢复 API 到 `logion-api:dev` 原 secret/数据库绑定；当前 Web image `sha256:f2b050c3631cb0979e3c6e37cbf09fccbbd7592f782bd3f568ebf39dbb0ca691`，Created `2026-08-28T07:12:16.754267705Z`，容器 Started `2026-08-28T07:12:28.68115121Z`，Web mounts 0，API/DB/Redis/Worker/Proxy healthy，`/healthz` 200。真实 Audit Session/Vault/四断点走查等待本次登录确认；contracts 计划内 OpenAPI 差异仍未获 Product Owner 提交批准                                                                                                                                                                         |
| 2026-08-28 15:39       | Gate 2 Audit 真实验收与移动 primary 回归修复                                       | 使用已授权真实测试账号登录并解锁 Vault；`/app/audit` 读取本人事件 50 条，关键词筛选收敛为 1 条，cursor 分页 `50 → 100`，刷新恢复 50 条；proxy 日志确认 `/api/v1/audit/me` 首页与 cursor 请求均 `200`。全量 authenticated route 四断点回归首次发现 Audit `320x640` 的“加载更多” primary 位于视口外（`top=790`），新增回归测试先 RED；根因是 Audit 移动 CSS 覆盖共享 pane switcher 的 `display:none`，删除覆盖后专项测试与 21 路由 × 4 断点检查均 GREEN。Web 无源码挂载镜像 `sha256:1e79610e21c82df54450f71d220d1325426d8b2648683bdd91c8f66a42d3a1e8`，Created `2026-08-28T07:42:02.706136569Z`，Started `2026-08-28T07:42:17.541972081Z`，mounts 0，`/healthz` 200；Audit 四断点 After 截图与 hash 已写入 `reports/ui-refactor/after/gate-2/`。发现 GLM `app_audit-1440x900.png` hash 匹配但画面疑似误标为 Research，已在 Audit 报告登记，等待 GLM/PO 决策；未修改 Target manifest |
| 2026-08-28 16:23       | Gate 2 F-2/F-3 定向修复                                                            | AI 顶部导航改为现有 Radix `WorkbenchTabs` 的 Draft/Provider 分段控件，切换同步 `#ai-run-center/#ai-provider-center` 深链；Provider、Templates、AI 的 `AUTH_RECENT_LOGIN_REQUIRED` 与真实 403 分支分别保留重新认证入口、权限说明和 request ID。新增真实导航/权限分支回归，AI 工作台 `8 passed`；E3 仍因统一 GLM/PO 依赖未关闭保持 pending，未触碰 OpenAPI 合同产物                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-28 17:36       | Gate 2 证据链刷新与合同门复核                                                      | 使用真实测试账号在当前无源码挂载 `logion-web:dev`（`sha256:5e38201af7d6356f0b52f2eca8a8c5e56ee2394e3f00400efc5855b9af7ada59`，Created `2026-08-28T08:56:36.569477403Z`，Started `2026-08-28T08:56:38.780689293Z`）重新生成 Audit `320/390/1024/1440` 四断点 After 截图；采集用例 `1 passed (3.8s)`，hash 已同步 `audit-conformance.md`。AI / Integrations 报告更新为真实门禁 `8 passed` / `5 passed`，全量 authenticated Chromium `46 passed / 0 unexpected`；`pnpm contracts:check` 仍因计划内 OpenAPI 生成差异返回失败，未修改或提交合同产物；E3 继续保持 pending，等待 GLM / PO 统一验收                                                                                                                                                                                                                                                                                       |
| 2026-08-28 17:52-18:08 | Gate 2 完整矩阵限流诊断与最终复验                                                  | 固定真实账号首次完整矩阵在 Integrations Markdown 导入后命中服务端真实 `AUTH_RATE_LIMITED`（`data_portability_write` 计数 `11`，限额 `10/hour`），结果为 `43 passed / 2 skipped / 1 failed`；未改生产限额或业务数据，精确清理该测试账号单个 Redis 限流 key 后按默认 reporter 重跑，Integrations 导入与其余路由全部通过，最终 `46 passed / 0 skipped / 0 unexpected / 0 flaky (7.8m)`。`reports/browser/results.json` 已由默认 JSON reporter 更新；E3 仍保持 pending，等待 GLM / PO 统一验收                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-08-28 18:29-18:39 | F-6 合同产物执行与回归验证                                                         | 按本次授权运行 `pnpm contracts:generate`，确认仅 `packages/contracts/openapi/openapi.json` 与 `packages/contracts/src/openapi.d.ts` 发生计划内生成变化，并以独立提交 `94ff87e chore(contracts): update generated API contract` 落地；`pnpm contracts:check` 通过。提交后 Web `70 files / 263 tests`、根仓库 `pnpm test`（295 passed / 57 deselected）、`pnpm build`、typecheck、lint、`pnpm guard:context` 与 `git diff --check` 均通过；一次根仓库并发测试中的 AI Provider 异步等待超时重跑未复现，未修改业务代码。E3 仍保持 pending，等待 GLM / PO 统一视觉与流程验收                                                                                                                                                                                                                                                                                                           |
| 2026-08-29 00:41       | E3 Product Owner 统一验收与 Gate 2 关闭                                            | PO 原文 `通过`；D1 `接受现状（推荐）`，D2 `追认`，证据缺口 `接受并归档`；签字记录 `reports/ui-refactor/gate-2/e3-product-owner-signoff.md`，32 条路由与公共流程结论已归档，正式写入「GLM Gate 2 通过」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 用户确认

- [x] 我已确认 GLM 为视觉/IA 目标基线，正式合同为行为语义基线
- [x] 我接受 Gate 1 前只整改 Today/Search/Records，Gate 1 后优先 Auth/Onboarding
- [x] 我已审阅并批准此计划（以 `/do-plan 2026-08-26_logion-glm-design-conformance-remediation.md` 为批准记录）
- [x] Product Owner 已于 `2026-08-26T18:33:21+08:00` 明确确认 `Gate 1 通过`
- [x] Product Owner 已于 `2026-08-27` 明确确认 `Templates 独立验收通过`
- [x] Product Owner 决策：所有路由完成后统一交 GLM 验收，再进行最终 review；此前不归档父计划

**批准后执行**：`/do-plan 2026-08-26_logion-glm-design-conformance-remediation.md`

## 最近验证补充

- `2026-08-28`：Audit 移动 primary 与选中事件 WCAG 对比度回归均先 RED 后 GREEN；完整 authenticated Playwright 项目 `46 passed (6.7m)`，包含 21 条正式应用路由的真实 Session、权限、Vault、AI、Integrations、Workspace/Sync、Security/Data、Settings/Profile/Help 与各业务闭环。
- `2026-08-28`：F-2/F-3 定向回归先 RED 后 GREEN；AI 工作台 `8 passed`，Integrations 定向回归 `5 passed`，覆盖 Draft/Provider 分段切换、深链 hash、近期认证 request ID、真实权限 403、Calendar、Import、Export 与 capability-disabled 分支。
- 当前 Web 无源码挂载镜像：`sha256:5e38201af7d6356f0b52f2eca8a8c5e56ee2394e3f00400efc5855b9af7ada59`；Created `2026-08-28T08:56:36.569477403Z`，Started `2026-08-28T08:56:38.780689293Z`，mounts `[]`，`/healthz=200`；Audit 四断点截图于本镜像启动后重新生成并更新报告 hash。
- Gate 2 已关闭：Product Owner 于 `2026-08-29T00:41:13+08:00` 完成 E3 统一验收并签字通过；D1 接受 Audit 1440 现状，D2 追认 `94ff87e`，证据缺口接受并归档；GLM `app_audit-1440x900.png` 的证据异常按签字裁定收录，未修改 Target manifest。
- `2026-08-28 17:41`：根仓库 `pnpm test` 通过；Web `70 files / 263 tests`，Python `295 passed / 57 deselected`。`pnpm --filter @logion/web typecheck`、`lint`、`git diff --check` 均通过；`pnpm contracts:check` 明确因计划内 OpenAPI 生成差异失败，未修改或提交合同产物。
- `2026-08-28 18:08`：默认 Playwright reporter 完整 authenticated Chromium 结果已落盘至 `reports/browser/results.json`，`46 passed / 0 skipped / 0 unexpected / 0 flaky`，覆盖 21 条正式应用路由、真实 Session / Workspace / Space / Vault / 权限与关键业务闭环；运行镜像仍为无源码挂载 `sha256:5e38201af7d6356f0b52f2eca8a8c5e56ee2394e3f00400efc5855b9af7ada59`。
- `2026-08-28 18:39`：按授权提交计划内合同生成物 `94ff87e`；`pnpm contracts:check`、`pnpm test`、`pnpm build`、Web typecheck/lint、`pnpm guard:context`、`git diff --check` 均通过。合同发布前置已满足；此次提交仅包含两个 `packages/contracts` 生成文件。
- `2026-08-28 18:42`：复核当前 `8080` 栈实际容器名为 `logion-b1-web-1`；Web image `sha256:5e38201af7d6356f0b52f2eca8a8c5e56ee2394e3f00400efc5855b9af7ada59`、Created `2026-08-28T08:56:36.569477403Z`、Started `2026-08-28T08:56:38.780689293Z`、mounts `[]`；Web/API/Postgres/Redis/Worker/Reverse Proxy 均 `healthy`，`/healthz=200`。合同提交未改变运行镜像，既有 `46 passed` authenticated Chromium 证据仍对应本实例。
- `2026-08-28 18:45-18:53`：合同提交后按当前 Git SHA 重建并强制重建 `logion-b1-web-1` 与反代；最新 Web image `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9`，Created `2026-08-28T10:44:26.268360451Z`，Started `2026-08-28T10:44:39.841808549Z`，mounts `[]`；API/反代健康，`/healthz=200`。显式使用真实测试账号运行 authenticated Chromium 全量 `46 passed (7.6m)`，结果已刷新至 `reports/browser/results.json`，无失败或跳过。
- `2026-08-28 18:56-19:05`：发现上条复验因 Compose 默认值短暂重建了错误的 `logion-api:0.1.0`，该轮浏览器结果作废；随即显式恢复 `LOGION_API_IMAGE=logion-api:dev` 后重建 attachment-init/API/Web/反代。最终 Web image `sha256:8f798c17458ef9da17db9f4ded0f5ed4fa5c95af55aaae6d9be9865c975e2cb9`（container Created `2026-08-28T10:56:55.712773556Z`、Started `2026-08-28T10:57:09.332601338Z`、mounts `[]`），API image `sha256:332323a6e2e9435e3480e54130fe085a2fa1888eb3d221068e4feee179803152`（`logion-api:dev`），反代/API 健康、`/healthz=200`；在正确 API 镜像和真实测试账号下 authenticated Chromium 全量最终 `46 passed (7.5m)`，无失败或跳过，`reports/browser/results.json` 已刷新。错误 API 镜像轮次不计入任何验收证据。
- `2026-08-28 20:33`：Gate 2 非阻塞跟进 F-6/F-4/F-5 完成。8 个指定 view 均移除 `browserApiClient` 直连并通过 route-specific controller facade；新增 controller boundary 与冻结 testid 回归（Web 73 files / 267 tests）。移动端共享 Workbench 同步操作、AI/Sync 抽屉目录行均提升至 `44px`，桌面规则保留；typecheck、lint、production build、`git diff --check` 通过。按 `LOGION_API_IMAGE=logion-api:dev` 重建无源码挂载 Web，当前 Web image `sha256:31de8252373ff2bb9e801a8f8ff1ff685714e4c2475c344258cc5bd2b2eaf211`（Created `2026-08-28T12:33:45.229528454Z`，Started `2026-08-28T12:33:58.836208618Z`），API `logion-api:dev` image `sha256:332323a6e2e9435e3480e54130fe085a2fa1888eb3d221068e4feee179803152`，mounts `[]`，`/healthz=200`。真实 Session Audit 50 条事件、AI Draft/Provider 分区与冻结 testid 均通过；320/390px 下 Review 同步按钮 `44x44`、Sync 四个目录行 `44px`，运行时 error 日志为空。
