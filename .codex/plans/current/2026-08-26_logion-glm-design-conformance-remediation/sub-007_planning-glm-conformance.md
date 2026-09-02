# 子计划：Planning GLM 一致性整改

## 元信息

- 子计划 ID：`sub-007`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 8 - Planning、Review 与 Exam（本子计划仅 Planning）
- 创建时间：`2026-08-26T20:48:48+08:00`
- 状态：已完成，待 Product Owner 独立验收
- 完成时间：`2026-08-27T02:01:46+08:00`
- AI 评分：`96/100`
- Shrimp 父任务：`91d48508-7f23-42ea-b78e-f79351abb8d3`
- Shrimp 子任务：`184ec6cc-ccd0-465a-bcd6-dbfb8c498a77`
- 创建原因：Planning 当前为 826 行副作用与旧 ProductPanel 视图混合组件，范围覆盖 Workspace/Space、Vault、端侧加密实体、sync-v1、目标聚合与多断点工作台，涉及超过 3 个文件且具有高风险状态顺序，必须独立冻结 controller 后再替换 View

## 保护边界

- 保留正式 Session、Workspace/Space 选择、Vault 解锁、BootstrapRepository、ProtectedOfflineRepository、SyncClient、sync-v1 payload、离线本地保存与 request ID 语义；不修改 API、contracts 或权限模型。
- `learning_goal` payload 保持 `title`、`description`、`desired_outcome`、`weekly_minutes`、`target_date` 与首个阶段聚合结构；创建操作的字段、限制、默认值和副作用顺序不得丢失。
- 当前阶段合同只持久化 `position`，新版只能表达路线顺序与前序提示，不伪造显式强依赖、发布、阶段新增、拖拽排序或原型任务写入能力。
- 以 GLM `Goal Master / Stage Route Main / Goal Inspector`、Target PNG 与 Conformance Contract 为视觉/IA 基线，不复制 fixture、`useStore`、hash router、mock status、手写 overlay 或原型数据。
- 不新增依赖；复用现有 Radix Sheet/Dialog、`AppIcon`、Workbench primitives、状态视觉与双主题 token。
- Review 与 Exam 不在本子计划施工范围；Planning 完成独立验收后，父计划步骤 8 再分别创建后续子计划。

## 步骤分解

### 步骤 1：冻结 Planning 正式副作用、Function Reachability 与 Before/Target 差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T20:58:00+08:00`
- **AI 评分**：`96/100`
- **目标**：把现有 826 行 Center 的 context、Vault、bootstrap、commit、push/pull、错误与字段合同冻结为可执行 characterization tests，并记录 GLM 原型与正式能力的允许偏离。
- **涉及文件**：`apps/web/src/features/planning/planning-center.tsx`、`planning-workbench-model.ts`、相关 unit/browser tests、GLM `prototype/src/pages/planning.tsx`、Planning Before/Target PNG、正式路由合同。
- **验证方法**：目标创建字段与 payload、Workspace/Space 自动带入、Vault 解锁、sync 成功/离线保留、请求错误、position 前序提示和所有既有入口均有测试或证据；明确原型发布/新阶段/强依赖/fixture 不进入正式实现。

### 步骤 2：拆分 Planning controller 并保持正式副作用顺序

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T21:12:00+08:00`
- **AI 评分**：`96/100`
- **目标**：将数据加载、Vault、目标刷新、bootstrap、commit 与 synchronize 收敛到 route-specific controller，为工作台 View 提供稳定状态与动作，不改变 API 或本地数据语义。
- **涉及文件**：新增 `apps/web/src/features/planning/use-planning-controller.ts` 及测试，精简 `planning-center.tsx`。
- **验证方法**：Workspace/Space 切换、当前设备、locked/unlocked、loading/error/empty/stale、create success/offline/error、表单 reset 与目标选择状态通过；正式 unit/typecheck/lint 绿色。

### 步骤 3：实现 Goal Master / Stage Route Main / Goal Inspector 与 Sheet

- **状态**：已完成 ✓
- **执行时间**：`2026-08-26T21:40:00+08:00`
- **AI 评分**：`96/100`
- **目标**：用专属 Master-Detail-Inspector 工作台替换旧页面头、流程卡片、指标卡与纵向 Disclosure/Form；目标列表、路线、任务可见层和详情 Inspector 按真实数据呈现，低频创建字段进入 Sheet。
- **涉及文件**：新增 `planning-workbench.tsx`、`planning-workbench.module.css` 及测试，`planning-center.tsx` 只组合 controller 与 View。
- **验证方法**：每状态唯一 primary；目标选择、阶段顺序/前序提示、验收标准、投入、日期、sync 与 Vault 上下文持续回显；创建 Sheet 焦点锁定/关闭恢复/错误保留；不渲染旧 ProductPanel 主体。

### 步骤 4：真实 Planning 任务、四断点与三联证据

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T02:01:46+08:00`
- **AI 评分**：`96/100`
- **目标**：重建无挂载 `127.0.0.1:8080` Web 镜像，以真实 Session/API/Vault/sync-v1 完成 Planning 创建与离线恢复任务，生成 Before/Target/After 和 Function Reachability 报告。
- **涉及文件**：新增 `tests/browser/planning-workbench.spec.ts`、`reports/ui-refactor/after/`、`reports/ui-refactor/planning-conformance.md`，必要的最小测试辅助。
- **验证方法**：320/390/1024/1440 无 overflow/遮挡/不可达；键盘、焦点、Screen Reader、Axe、reduced-motion、双主题与 44x44 触达通过；Web unit/typecheck/lint/contracts/build、生产镜像摘要和 `/healthz=200` 通过；Planning Function Reachability 100%。

## 执行记录

| 时间             | 操作                                 | 结果                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-26 20:48 | 创建子计划并进入步骤 1               | Gate 1 已获 Product Owner 批准；Planning 因 826 行副作用混合与高风险 Vault/sync-v1 语义触发独立子计划；Review、Exam 暂不施工                                                                                                     |
| 2026-08-26 20:58 | 步骤 1：冻结正式合同与视觉差异       | 96/100；目标选择、阶段 position 前序提示、真实 task 归属、验收完整度与投入派生测试完成；Before/Target 哈希、Function Reachability 和原型偏离写入报告；Web `196/196` 通过                                                         |
| 2026-08-26 21:12 | 步骤 2：拆分正式 Planning controller | 96/100；Workspace/Space、Persona、权限、Vault、protected goal/task、conflict、bootstrap、commit、sync 与 offline retention 收敛到 route controller；payload/竞态/11 状态测试完成；Web `202/202`、typecheck、lint、Prettier 通过  |
| 2026-08-26 21:40 | 步骤 3：完成 Planning 三栏工作台     | 96/100；Goal Master、Stage Route Main、Goal Inspector、New Goal / Unlock Sheet 已替换旧 ProductPanel 主体；每层唯一 primary、position 前序提示、真实任务聚合、焦点恢复和 capability-disabled 边界通过                            |
| 2026-08-27 02:01 | 步骤 4：完成真实任务与证据验收       | 96/100；四断点 After、真实 Session/API/Vault/sync-v1、Function Reachability、Axe、键盘、焦点、reduced-motion 与 production 8080 通过；Browser 168 passed / 10 skipped，全量质量门禁通过；Before 同视口缺口已如实登记，待 PO 决定 |

## 完成结论

- Planning 实现及 AI 自检完成，独立 Product Owner 验收待确认。
- Shrimp 子任务 `184ec6cc-ccd0-465a-bcd6-dbfb8c498a77` 已按 `96/100` 完成；父任务继续保持 `in_progress`。
- 运行实例为无源码挂载的 production Web image `sha256:c799e88f0f6f3a684f0c06702601c8d64972c24ab90565d0150e90f591a8370f`，Web / reverse proxy healthy，`/healthz=200`。
- 全量门禁通过：Browser `168 passed / 10 skipped / 0 unexpected`，Web `204/204`，Offline `55/55`，Contracts `12/12`，Mobile `4/4`，Python `293 passed / 56 deselected`，并通过 format、lint、typecheck 与 35-route production build。
- 历史 Before 只有 1425x891 与 375x812，不能伪造成 1440x900 / 390x844；该证据限制已写入 `reports/ui-refactor/planning-conformance.md`，必须由 Product Owner 明确接受或要求补证。
- Review、Exam 不在本子计划范围，继续锁定；父计划步骤 8 保持执行中。
