# 子计划：Self-study GLM 一致性整改

## 元信息

- 子计划 ID：`sub-010`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 9 - Self-study、Research、Collaboration 与 Templates（本子计划仅 Self-study）
- 创建时间：`2026-08-27T14:45:00+08:00`
- 状态：已完成 ✓（Product Owner 独立验收通过）
- 创建原因：Exam 独立验收通过，步骤 9 解锁。现有 `SelfStudyCenter` 仍把 Inbox、路线、项目、成果和表单堆叠在 `ProductPanel` 页面中，必须按批准 Target 重构为 `Inbox / Route & Project Board / Deliverable Timeline Tabs`。

## 保护边界

- 保留正式 Session、Workspace/Space、Vault、BootstrapRepository、ProtectedOfflineRepository、SyncClient、sync-v1、离线本地保存、请求编号、权限与错误语义；不修改 API、contracts 或权限模型。
- 保留 `learning_track`、`study_project`、`inbox_item`、`deliverable` payload、项目/路线依赖、完成时间和仅追加证据语义；研究与协作实体不在本子计划改动。
- GLM fixture store、hash router、mock 数据、手写 overlay 和演示动作不得进入正式代码；复用现有 Radix adapters、Workbench primitives、State Notice 和双主题 token。
- Inbox 分诊、路线/项目创建、成果记录和项目完成均保持可发现；低频输入进入 Sheet，不能因视觉重构删除任务入口。

## 布局树与目标任务

```text
Self-study Workbench
├─ AppShell / Context Bar
├─ StudyTabs
├─ Inbox Master
├─ Route & Project Board Main
└─ Deliverable Timeline Inspector
```

主任务：从下一条未分诊 Inbox 开始，将想法分诊为路线/项目/任务，并用可验证成果推进项目。

## 步骤分解

### 步骤 1：冻结 Self-study 副作用、命令面与 GLM 差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T15:14:00+08:00`
- **AI 评分**：91/100
- **目标**：拆出 `OfflineLearningCenter(mode="self-study")` 的上下文加载、Vault/bootstrap、四类实体读取与提交动作，登记 `self-study-tabs`、`self-study-inbox`、`self-study-projects`、`self-study-deliverables` 区域及唯一 primary。
- **涉及文件**：`apps/web/src/features/self-study/self-study-center.tsx`、`self-study-workbench-model.ts`、GLM `prototype/src/pages/self-study.tsx`、Target 截图与现有 Self-study 测试。
- **验证方法**：characterization/unit 合同覆盖 payload、父子依赖、加密与同步顺序；确认分诊、完成和成果仅追加语义。

### 步骤 2：实现 Inbox / Route & Project Board / Deliverable Timeline

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T15:21:00+08:00`
- **AI 评分**：90/100
- **目标**：将真实 Self-study 状态接入 route-specific Workbench View；Inbox 负责选择与分诊，Main 聚合路线/项目推进，Inspector 呈现成果时间线与完成证据。
- **涉及文件**：新增 `apps/web/src/features/self-study/self-study-workbench.tsx`、`self-study-workbench.module.css`；必要时提取 `use-self-study-controller.ts`；精简 `self-study-center.tsx`；补充视图/状态测试。
- **验证方法**：每个可见交互层最多一个 primary；创建路线/项目/成果使用 Sheet 焦点管理；移动端按 Inbox → Board → Timeline 连续流展示；不渲染旧 ProductPanel 主体。

### 步骤 3：真实 Self-study 任务、四断点与三联证据

- **状态**：已完成 ✓（技术自检通过；live Axe/键盘/焦点/reduced-motion 证据缺口待 Product Owner 独立验收）
- **开始时间**：`2026-08-27T15:23:00+08:00`
- **完成时间**：`2026-08-27T15:41:00+08:00`
- **AI 评分**：96/100
- **目标**：以真实 Session/API/Vault/sync-v1 完成捕获 Inbox、分诊、创建路线/项目、记录成果和项目状态查看，生成 Before/Target/After、Function Reachability 与运行摘要。
- **涉及文件**：新增 `tests/browser/self-study-workbench.spec.ts`、`reports/ui-refactor/self-study-conformance.md`、`reports/ui-refactor/after/`。
- **验证方法**：`320/390/1024/1440` 无溢出/遮挡/不可达；Axe、键盘、焦点、reduced-motion、唯一 primary、locked/empty/offline/error/stale/capability-disabled 状态和真实同步通过；完成后等待 Product Owner 独立验收。

## 执行记录

| 时间             | 操作                                     | 结果                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-27 14:42 | Exam 独立验收通过，解锁步骤 9            | Product Owner 明确回复 `验收通过`；Exam 子计划关闭，后续按 Self-study → Research/Collaboration 顺序推进                                                                                                                                                                                                                                         |
| 2026-08-27 14:45 | 创建 Self-study 子计划                   | 锁定真实副作用、GLM 布局树和三步交付边界；Research、Collaboration、Templates 暂不改动                                                                                                                                                                                                                                                           |
| 2026-08-27 15:21 | 完成 Self-study Workbench 接线与静态验证 | 新增 Inbox / Board / Timeline / Inspector 视图、Radix Sheet、真实提交成功返回值；Web typecheck、lint、Self-study 与共享 Workbench 测试通过；真实 Browser 已确认登录但 Vault 仍锁定                                                                                                                                                              |
| 2026-08-27 15:41 | 完成真实 Self-study 任务与四断点证据     | 手动解锁后真实创建 1 条 Inbox、1 条路线、1 个项目、1 项成果；Inspector/Timeline 回显父依赖与 `100%` 进度；320/390/1024/1440 无横溢出、唯一 primary、三 Tabs、无 console 告警；同步两次进入 offline，Outbox 保留；截图与 SHA-256 已归档；live Axe/键盘/焦点/reduced-motion 用例因正式 invite 模式 `410` 在 global setup 阶段阻断，未冒充页面通过 |
| 2026-08-27 15:50 | Self-study 独立 PO 验收通过              | Product Owner 原文 `Self-study 独立验收通过`；Inbox → 路线 → 项目 → 成果工作台、真实任务证据和已登记的 offline/Playwright 证据边界获批准；允许启动 Research/Collaboration，Templates 继续锁定                                                                                                                                                   |

## 完成条件

- Self-study Workbench 实现与 AI 自检完成，真实 Browser 证据和一致性报告归档。
- Inbox、分诊、路线、项目、成果和项目完成状态 Function Reachability 100%。
- Product Owner 独立验收通过后，才创建并启动 Research、Collaboration 或 Templates 子计划。
- **Product Owner 验收**：通过 ✓；原文 `Self-study 独立验收通过`。
