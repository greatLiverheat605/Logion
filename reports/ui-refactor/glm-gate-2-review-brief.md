# Logion Gate 2：GLM 代码 Review 与统一验收 Brief

## 你的角色

你是 Logion 的 Product Design Reviewer 与 Staff Frontend Engineer。请基于批准的 GLM 原型、正式产品合同和真实运行环境，对当前实现进行最终视觉、交互、功能可达性与工程边界审查。

本次是 **review / acceptance**，不是实现任务。不要直接修改生产代码、测试、OpenAPI、数据库或计划文件；发现问题请输出可复现证据、严重级别和建议修复范围。

## 真相源与运行入口

- 真实验收入口：`http://127.0.0.1:8080`
- 代码仓库：`C:\Users\Administrator\.codex\worktrees\25db\ai_study`
- GLM 设计工作区：`C:\Users\Administrator\.codex\visualizations\2026\08\25\01a0391f-0946-7970-b640-e09e5cac089c\logion-glm-design-workspace`
- 视觉 / IA 合同：[docs/product/GLM_DESIGN_CONFORMANCE.md](C:\Users\Administrator\.codex\worktrees\25db\ai_study\docs\product\GLM_DESIGN_CONFORMANCE.md)
- 功能可达性合同：[docs/product/LOGION_ROUTE_FUNCTION_CONTRACT.md](C:\Users\Administrator\.codex\worktrees\25db\ai_study\docs\product\LOGION_ROUTE_FUNCTION_CONTRACT.md)
- Target 清单与哈希：[reports/ui-refactor/glm-target-manifest.json](C:\Users\Administrator\.codex\worktrees\25db\ai_study\reports\ui-refactor\glm-target-manifest.json)
- 逐页证据目录：[reports/ui-refactor](C:\Users\Administrator\.codex\worktrees\25db\ai_study\reports\ui-refactor)

GLM 原型的 fixture store、hash router、演示数据、手写 overlay 和 `/auth/passkey` 不得作为正式实现依据。正式 API、Session、Workspace、Space、权限、Vault、sync-v1、Yjs、附件和对象语义优先于原型演示数据。

## 审查范围

### 21 条正式应用路由

`/app/today`、`/app/self-study`、`/app/records`、`/app/review`、`/app/exam`、`/app/planning`、`/app/templates`、`/app/audit`、`/app/spaces`、`/app/settings`、`/app/profile`、`/app/help`、`/app/research`、`/app/collaboration`、`/app/ai`、`/app/sync`、`/app/security`、`/app/data`、`/app/search`、`/app/workspaces`、`/app/integrations`

### 公共与辅助流程

`/auth/login`、`/auth/register`、`/auth/verify`、`/auth/recover`、`/auth/callback`、`/onboarding`、`/invitations/accept`、`/shares/[token]`、`/account/deletion`、`/offline`、Next `404`。

## 必须执行的审查顺序

1. **确认运行新鲜度**：记录当前 Git SHA、dirty 摘要、Web image ID / digest、CreatedAt、container StartedAt、mounts 和 `/healthz`。截图只能来自当前 `8080` 实例。
2. **逐页比对设计**：使用 GLM Target、`specs/01-05`、正式合同和逐页报告，核对布局树、首屏层级、信息密度、主任务、唯一 primary、Master/Main/Inspector 或 PublicShell 结构。不要以颜色或圆角变化当作主体重构证据。
3. **执行真实任务**：使用真实 Session / 权限 / Vault / Sync 状态走通每个页面的主任务及关键恢复路径；不得用 fixture、静态截图或“测试通过”替代任务观察。
4. **覆盖状态与边界**：抽查 `loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale`，确认每种状态都有影响说明和可执行恢复动作。
5. **覆盖响应式和可访问性**：检查 `320x640`、`390x844`、`1024x768`、`1440x900`；确认无溢出、遮挡、不可达操作、焦点丢失、读屏语义问题、对比度问题和 reduced-motion 违规；移动端交互目标至少 `44x44px`。
6. **审查代码边界**：确认视图没有越过 controller 直接访问 API / database / Vault；没有复制 GLM fixture；没有引入第二套 UI 体系；旧 Center / ProductPanel / 长表单只要仍是实际主体渲染就列为问题。
7. **核对合同门**：确认 Function Reachability 为 `100%`。注意当前 `pnpm contracts:check` 对计划内 OpenAPI 生成差异会返回失败，请单独判断这是需要提交合同产物的发布阻塞，还是需要 Product Owner 明确接受的已知差异，不得静默忽略。

## 输出格式

请严格返回以下结构：

### 1. 总结结论

- `PASS`、`CONDITIONAL PASS` 或 `FAIL`
- 是否建议关闭 Gate 2
- 阻塞项数量：P0 / P1 / P2
- 是否接受已登记的 Before / Target 证据缺口
- 是否接受 `contracts:check` 的计划内 OpenAPI 差异

### 2. 路由验收矩阵

每条应用路由和公共流程一行，至少包含：

| Route | GLM 布局树 | 主任务 / Primary | 真实任务 | 状态与恢复 | 响应式 / A11y | 证据 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |

证据必须引用真实 URL、报告路径、截图路径或可复现步骤；缺证据写 `MISSING`，不要推测通过。

### 3. 代码 Review Findings

按严重度排序。每项包含：

- `ID`、严重度（P0/P1/P2/P3）
- 路由 / 文件 / 行号或稳定选择器
- 复现步骤
- 实际结果与期望结果
- 是否影响 Function Reachability、权限、安全或数据语义
- 建议修复范围

### 4. Gate 2 决策

只允许以下两种最终表达之一：

- `GLM Gate 2 通过`：列出接受的证据缺口和非阻塞建议。
- `GLM Gate 2 未通过`：列出必须修复的路由、问题 ID、复验条件。

不要因为自动化测试全绿、页面“看起来不错”或缺少真实任务证据而直接通过。

## 当前已知边界

- Planning 的 Before 同视口证据缺口已由 Product Owner 明确接受。
- 其他历史 Before 缺口、部分公共流程 Target 断点缺口和后半路由真实截图缺口，需要你明确判定接受、补证还是阻塞。
- 任何视觉偏离必须说明正式语义、WCAG 或安全原因，并给出恢复路径。
