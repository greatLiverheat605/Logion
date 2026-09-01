# 子计划：Records GLM 高保真一致性整改

## 元信息

- 子计划 ID：`sub-005`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 5 - 实现 Records 高保真对象编辑工作台
- 创建时间：`2026-08-26T16:59:31+08:00`
- 状态：已完成 ✓
- 完成时间：`2026-08-26T17:52:31+08:00`
- Shrimp 任务：`159a0b30-def2-462a-8ec4-3344cc460621`
- 创建原因：现有 `ContentCenter` 1081 行同时处理 Workspace/Space、Vault bootstrap、ProtectedOfflineRepository、Yjs、Links/PDF、附件 SHA-256 队列、revision 与 sync-v1，且需要 controller/view/CSS/tests/证据，超过 3 个文件并属于高风险样板页面

## 保护边界

- 保留正式 Session、API、权限、Workspace、Space、Vault、IndexedDB、ProtectedOfflineRepository、YjsNoteRepository、附件队列、revision 和 sync-v1，不改变 payload、repository 或副作用顺序。
- 以隔离 GLM Records specs、Target PNG 与 Conformance Contract 为视觉/IA 基线，不复制 fixture store、hash router、navigate、overlay 或 mock 数据。
- 只整改 Records；Gate 1 后路由不得提前施工。
- 新建笔记是页面唯一 primary；编辑保存是当前选中对象的局部命令。登记资料与添加附件为 secondary Sheet。
- 外链继续只允许 HTTP(S)；附件继续只允许 PNG、JPEG、纯文本并计算真实 SHA-256；移动触达至少 44x44px。

## 步骤分解

### 步骤 1：冻结 Records Target、正式语义与当前差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T17:03:00+08:00`
- **AI 评分**：95/100
- **目标**：对照 GLM Records specs、四视口 Target、正式 route/function contract 与当前 ContentCenter，冻结布局树、主任务、对象类型、状态、交互与 Function Reachability 清单。
- **涉及文件**：隔离 GLM Records specs/PNG、`docs/product/GLM_DESIGN_CONFORMANCE.md`、`docs/product/LOGION_ROUTE_FUNCTION_CONTRACT.md`、`content-center.tsx`、Before 截图。
- **验证方法**：覆盖 Document Tree、Inline Editor/Safe Preview、Metadata/Relation/Sync Inspector、新建笔记、Links/PDF、附件队列、搜索筛选、rename、Vault/bootstrap/sync、Yjs/revision 和 11 类状态；不以当前 DOM 反推目标。

### 步骤 2：提取真实 Records controller 与行为合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T17:27:03+08:00`
- **AI 评分**：96/100
- **目标**：把 ContentCenter 的数据读取、副作用和正式 commands 提取到 route-specific controller，View 不直接访问 API、Vault、database 或 repository。
- **涉及文件**：`apps/web/src/features/content/use-records-controller.ts`、最小化后的 `content-center.tsx`、controller tests。
- **验证方法**：Workspace/Space、Vault unlock/bootstrap/refresh/sync、ProtectedOfflineRepository commit、Yjs update、Link/PDF、rename、附件 SHA-256 队列与 revision 语义不变；Workspace/revision 变化不会应用过期刷新。

### 步骤 3：按 GLM IA 实现 Records Workbench

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T17:30:41+08:00`
- **AI 评分**：96/100
- **目标**：以真实 controller 数据实现 Object Master、Inline Markdown Editor/Safe Preview、Metadata/Relation/Sync Inspector，并用 Sheet 承载新建、资料与附件输入，删除旧 ProductPanel/重复编辑区/纵向附件表单主体。
- **涉及文件**：`records-workbench.tsx`、`records-workbench.module.css`、`content-center.tsx`、定向 component tests。
- **验证方法**：新建笔记是唯一页面 primary；选中对象可编辑、保存并显示 dirty/pending/success；Links/PDF/附件/rename/sync 全可发现；320/390 连续单列或全宽 Sheet 且无横向溢出；1024/1440 保持目标密度。

### 步骤 4：真实任务、四断点与 Gate 1 证据

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T17:52:31+08:00`
- **AI 评分**：96/100
- **目标**：运行真实 Records 任务与可访问性门，重建无挂载 8080 镜像，生成四视口 After 和 Before/Target/After 报告。
- **涉及文件**：`tests/browser/records-workbench.spec.ts`、`reports/ui-refactor/b3-records-workbench.md`、`reports/ui-refactor/after/`。
- **验证方法**：真实 Vault、笔记新建编辑、Yjs、安全预览、Link/PDF、附件队列、rename、sync、offline/locked/permission/409/error/stale 通过；GLM regions、primary、overflow、Axe、键盘、焦点、reduced-motion、Function Reachability 100%；PO 结论保持待 Gate 1。

## 执行记录

| 时间             | 操作                                            | 结果                                                                                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 16:59 | 创建子计划并进入步骤 1                          | 执行中；冻结 Records 范围，Gate 1 后路由不动；Shrimp 父子任务已进入执行链                                                                                                                                                                                                                |
| 2026-08-26 17:03 | 步骤 1：冻结 Records Target、正式语义与当前差异 | 95/100；冻结 Document Tree、单对象 Inline Editor/Safe Preview、Metadata/Relation/Sync Inspector、唯一新建笔记 primary、移动连续流，以及 Vault/Yjs/Links/PDF/附件/revision/sync-v1 的 Function Reachability                                                                               |
| 2026-08-26 17:26 | 步骤 2：提取真实 Records controller 与行为合同  | 96/100；ContentCenter 从 1081 行收敛为 8 行装配层，Vault/bootstrap/ProtectedOfflineRepository/Yjs/附件 SHA-256/revision/sync-v1 已迁入 route controller；竞态、Space 隔离、保存分支和 11 状态均有合同测试，Web 49 文件 188 测试、typecheck、lint 通过                                    |
| 2026-08-26 17:30 | 步骤 3：按 GLM IA 实现 Records Workbench        | 96/100；正式数据驱动的 Document Tree、单对象 Inline Editor/Safe Preview、Metadata/Relation/Sync Inspector 和 Radix Sheets 完成；320/390 连续流、1024 两栏+Inline Inspector、1440 三栏；唯一页面 primary 与全部 secondary commands 有组件测试，Web 50 文件 193 测试、typecheck、lint 通过 |
| 2026-08-26 17:52 | 步骤 4：真实任务、四断点与 Gate 1 证据          | 96/100；正式 8080 一次性账号完成 Vault/Yjs/Link/PDF/附件 SHA-256/rename/sync-v1 真实 E2E；四视口 regions/primary/overflow/Axe/键盘/焦点/reduced-motion 全过，修复 light warning token 对比度，四张 After 与 B3 三联报告已生成；Shrimp 父子任务完成，PO 结论保留至 Gate 1                 |
