# 子计划：Today GLM 高保真一致性整改

## 元信息

- 子计划 ID：`sub-003`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 3 - 重新整改 Today 并撤销旧 B1 视觉通过
- 创建时间：`2026-08-26T14:59:04+08:00`
- 状态：已完成 ✓
- 完成时间：`2026-08-26T15:49:20+08:00`
- AI 评分：96/100
- 创建原因：涉及 Today view、controller、route CSS、浏览器测试、真实数据任务和三联证据，超过 3 个文件且属于高风险样板页面

## 保护边界

- 保留 U0-U4、Session、API、权限、Workspace、Space、Vault、sync-v1、证据与人工验收语义，不改变 payload、调用顺序或错误合同。
- 以隔离 GLM Today specs、Target PNG 与 Conformance Contract 为视觉/IA 基线，不复制 fixture store、hash router、overlay 或 mock 数据。
- 只整改 Today；Search、Records 与 Gate 1 后路由不得提前施工。
- 保持每个可见交互层最多一个 primary，结束会话不等于完成任务，证据不等于人工验收。
- 移动触达至少 44x44px；任何相对 GLM Target 的 WCAG 或正式语义偏离必须写入逐页报告。

## 步骤分解

### 步骤 1：冻结 Today Target 与当前实现差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T15:08:00+08:00`
- **结果**：确认当前正式页虽有三栏，但 GLM 首屏要求的证据/人工验收、今日信号和 14 天趋势被移除或降入 Sheet；移动端错误使用 single-pane switcher，且额外 Workspace/Space Select Toolbar 改写了批准交互路径。Target 320 PNG 存在重复拼接伪影，仅用于已冻结哈希/尺寸，不做像素匹配，结构验收以 specs 与 390/1024/1440 Target 为准。
- **目标**：对照 GLM Today specs、1440/390 Target、正式 route/function contract 和当前真实页面，形成可执行的布局树、首屏信息、primary、状态与交互差异清单。
- **涉及文件**：隔离 GLM Today specs/PNG、`docs/product/GLM_DESIGN_CONFORMANCE.md`、`apps/web/src/features/execution/today-workbench.tsx`、`today-workbench.module.css`、`tests/browser/today-workbench.spec.ts`、`reports/ui-refactor/b1-today-workbench.md`。
- **验证方法**：差异清单覆盖 Queue Master、NEXT ACTION、Task Context Inspector、今日信号、证据/人工验收、执行趋势、Context/Toolbar、移动 pane 和 11 类状态；不以当前 DOM 反推目标。

### 步骤 2：按 GLM 信息层级整改 Today 主体

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T15:22:03+08:00`
- **结果**：移除 Workspace/Space Select Toolbar 与 Header 信号入口，恢复首屏连续的下一动作、真实证据/人工验收、4 格今日信号和 14 天真实会话趋势；`<720px` 改为 Queue → Main → Inspector 连续纵向流，1024px 保留 Master/Main 与可达 Inspector；复用 Persona dashboard model，不新增 API、依赖或业务副作用。
- **目标**：在真实 controller 数据下恢复 GLM 首屏信息层级、密度和操作编排，去除旧 Center/表单式残留及与共享 Workbench 冲突的页面规则。
- **涉及文件**：`apps/web/src/features/execution/today-workbench.tsx`、`today-workbench.module.css`、必要时最小修改 `use-today-controller.ts` 与定向 tests。
- **验证方法**：桌面持续呈现三栏，移动端 Queue、NEXT ACTION、Inspector 连续可达且不使用 single-pane switcher；当前页唯一 primary 起始 80% 高频任务；上下文自动回显；低频输入进入 Sheet/Popover 且最多两层；全部真实命令和状态仍可达。

### 步骤 3：建立 Today 真实任务与可访问性验收门

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T15:42:03+08:00`
- **结果**：真实账号完成任务创建、专注开始/结束、证据、显式人工验收和关闭闭环；四断点 GLM 6 区域、Shell/Workbench 几何、连续移动顺序、overflow、primary、Axe、reduced-motion 通过；跨路由 21 项 Playwright 回归 2.5 分钟全过；应用内 Browser 暗色移动走查与 Sheet Escape 焦点恢复通过，console 日志为空。
- **目标**：扩展 Today E2E，覆盖选择/新建任务、专注、结束会话、证据、人工验收、关闭、冲突与恢复，并接入 GLM region/geometry/primary、四断点、Axe、键盘、焦点和 reduced-motion。
- **涉及文件**：`tests/browser/today-workbench.spec.ts`、`tests/browser/glm-conformance.ts`、必要的 component/controller tests。
- **验证方法**：真实 Session/API/权限/Vault/Sync 下 Function Reachability 100%；320/390/1024/1440 无溢出、遮挡或不可达操作；不以 mock 或静态截图替代任务验收。

### 步骤 4：重建 8080、生成三联证据并准备 Gate 1

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T15:49:20+08:00`
- **结果**：无挂载 Web production 镜像已重建并在真实 8080 运行；四视口 After、GLM Target 哈希、Before/Target/After 三联表、布局树、主任务、交互路径、组件映射、Function Reachability 100%、可访问性与镜像新鲜度均写入逐页报告。Product Owner 结论保持待 Gate 1，未由 AI 代签。
- **目标**：构建无挂载 production Web 镜像，在真实 8080 生成 Today 的 Before/GLM Target/After 同视口证据、结构差异和运行摘要，形成可供 Product Owner 在 Gate 1 签字的逐页报告。
- **涉及文件**：`reports/ui-refactor/b1-today-workbench.md`、`reports/ui-refactor/after/`、GLM target manifest 引用。
- **验证方法**：记录 Git SHA/dirty 摘要、image ID/CreatedAt、container StartedAt、真实 URL；1440/390 可见走查及 320/1024 自动检查通过；偏离项含原因、范围、恢复路径和审批状态。

## 执行记录

| 时间             | 操作                           | 结果                                                                                       |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| 2026-08-26 14:59 | 创建子计划并进入步骤 1         | 执行中；冻结 Today 范围，Search/Records 与 Gate 1 后路由不动                               |
| 2026-08-26 15:08 | 步骤 1：冻结差异               | 完成；锁定首屏信息缺失、移动 pane 偏差、冗余 Toolbar 与 320 Target 伪影                    |
| 2026-08-26 15:22 | 步骤 2：整改 Today 主体        | 完成；真实信号/趋势与证据验收恢复，移动连续流落地，46 文件 172 测试、typecheck、lint 通过  |
| 2026-08-26 15:42 | 步骤 3：真实任务与可访问性验收 | 完成；Today E2E 11.7 秒、跨路由 21 项 2.5 分钟、应用内 Browser 可见走查全部通过            |
| 2026-08-26 15:49 | 步骤 4：重建与三联证据         | 96/100；真实 8080 镜像与四断点 After 已冻结，逐页报告完成，Shrimp 子任务已同步为 completed |
