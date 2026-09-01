# 子计划：Search GLM 高保真一致性整改

## 元信息

- 子计划 ID：`sub-004`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 4 - 实现 Search 高保真检索工作台
- 创建时间：`2026-08-26T15:52:20+08:00`
- 状态：已完成 ✓
- 完成时间：`2026-08-26T16:56:44+08:00`
- AI 评分：97/100
- Shrimp 任务：`ceaf9720-16e1-4e59-9620-c74766502113`
- 创建原因：涉及旧 Center 副作用拆分、Search view/CSS、请求竞态、通知与 Calendar 语义、浏览器测试及三联证据，超过 3 个文件且属于高风险样板页面

## 保护边界

- 保留正式 Session、API、权限、Workspace、Vault、OfflineSearchRepository、通知偏好、标记已读、Calendar Feed 与一次性 Token 语义，不改变 payload、错误合同或副作用顺序。
- 以隔离 GLM Search specs、Target PNG 与 Conformance Contract 为视觉/IA 基线，不复制 fixture store、hash router、navigate、overlay 或 mock 数据。
- 只整改 Search；Records 与 Gate 1 后路由不得提前施工。
- 搜索框是默认唯一 primary；无结果时“清除筛选”为唯一 primary。通知和日历是清晰分离的子模式。
- 移动触达至少 44x44px；结果支持键盘选择，移动预览使用全宽 Sheet；任何偏离必须写入逐页报告。

## 步骤分解

### 步骤 1：冻结 Search Target、正式语义与当前差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T16:11:37+08:00`
- **AI 评分**：94/100
- **目标**：对照 GLM Search specs、四视口 Target、正式 route/function contract 与当前 EngagementCenter，冻结布局树、主任务、状态、交互和 Function Reachability 清单。
- **涉及文件**：隔离 GLM Search specs/PNG、`docs/product/GLM_DESIGN_CONFORMANCE.md`、`docs/product/LOGION_ROUTE_FUNCTION_CONTRACT.md`、`engagement-center.tsx`、Before 截图。
- **验证方法**：覆盖 Sticky Search Command、Mode Segmented、Grouped Results、Preview/Utility Inspector、通知偏好/记录、Calendar Feed、移动 Sheet、请求竞态和 11 类状态；不以当前 DOM 反推目标。

### 步骤 2：提取真实 Search controller 与竞态合同

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T16:18:00+08:00`
- **AI 评分**：96/100
- **目标**：把 EngagementCenter 的数据读取、副作用和正式 commands 提取到 route-specific controller，View 不直接访问 API/Vault/database。
- **涉及文件**：`apps/web/src/features/engagement/use-search-controller.ts`、最小化后的 `engagement-center.tsx`、controller tests。
- **验证方法**：在线/离线搜索、Vault 解锁、Workspace 变化、通知偏好、标记已读、Calendar 创建/撤销语义不变；旧请求响应不能覆盖新查询。

### 步骤 3：按 GLM IA 实现 Search Workbench

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T16:20:00+08:00`
- **AI 评分**：96/100
- **目标**：以真实 controller 数据实现 sticky command、模式筛选、分组结果、预览/Utility Inspector 和通知/日历 Tabs/Sheet，删除旧 ProductPanel/表单堆叠主体。
- **涉及文件**：`search-workbench.tsx`、`search-workbench.module.css`、`engagement-center.tsx`、定向 component tests。
- **验证方法**：搜索输入为主任务；无结果有恢复；结果键盘选中；通知和日历全部能力可发现；320/390 连续单列且无横向溢出；1024/1440 保持目标密度。

### 步骤 4：真实任务、四断点与 Gate 1 证据

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T16:56:44+08:00`
- **AI 评分**：97/100
- **目标**：运行真实 Search 任务与可访问性门，重建无挂载 8080 镜像，生成四视口 After 和 Before/Target/After 报告。
- **涉及文件**：`tests/browser/search-workbench.spec.ts`、`reports/ui-refactor/b2-search-workbench.md`、`reports/ui-refactor/after/`。
- **验证方法**：真实结果/无结果/offline/locked/permission/error/stale/竞态、通知与 Calendar 闭环通过；GLM regions、primary、overflow、Axe、键盘、焦点、reduced-motion、Function Reachability 100%；PO 结论保持待 Gate 1。

## 执行记录

| 时间             | 操作                                           | 结果                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 15:52 | 创建子计划并进入步骤 1                         | 执行中；冻结 Search 范围，Records 与 Gate 1 后路由不动；Shrimp 子任务已建立                                                                                                                                           |
| 2026-08-26 16:11 | 步骤 1：冻结 Search Target、正式语义与当前差异 | 94/100；冻结 Sticky Command、正式五类型、权限范围、Grouped Results、Preview/Utility、移动 Sheet、11 状态和 Function Reachability；Shrimp 子任务保持执行中                                                             |
| 2026-08-26 16:18 | 步骤 2：提取真实 Search controller 与竞态合同  | 96/100；旧 586 行 Center 收敛为装配层，正式 API/Vault/通知/Calendar 命令集中到 Controller；竞态、范围、分组与深链 4 类合同测试通过，Shrimp 子任务保持执行中                                                           |
| 2026-08-26 16:20 | 步骤 3：按 GLM IA 实现 Search Workbench        | 96/100；Sticky Command、正式模式/范围、Grouped Results、Desktop Inspector、移动 Sheet、通知与 Calendar Tabs/Sheet 已实现；Web 48 文件 180 测试、typecheck、lint、production build 通过                                |
| 2026-08-26 16:56 | 步骤 4：真实任务、四断点与 Gate 1 证据         | 97/100；补齐未读通知与移动 Sheet 焦点恢复合同，Web 48 文件 182 测试、typecheck、lint、build、真实 Search E2E、四断点、Axe 与报告通过；无挂载镜像 `sha256:11b5077...3899`，PO 签字保留至 Gate 1，Shrimp 父子任务已完成 |
