# 子计划：Exam GLM 一致性整改

## 元信息

- 子计划 ID：`sub-009`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 8 - Planning、Review 与 Exam（本子计划仅 Exam）
- 创建时间：`2026-08-27T05:10:00+08:00`
- 状态：已完成 ✓（Product Owner 独立验收通过）
- 创建原因：Review 已获 Product Owner 独立验收；Exam 解锁。现有 `ExamCenter` 仍是旧 `ProductPageHeader + ProductPanel + planning-form` 纵向页面，必须按批准 Target 重构为 `Exam Master / Coverage Main / Exam Inspector`。

## 保护边界

- 保留正式 Session、Workspace/Space、Vault、BootstrapRepository、ProtectedOfflineRepository、SyncClient、sync-v1、离线本地保存、请求编号、权限与错误语义；不修改 API、contracts 或权限模型。
- 保留 `exam`、`exam_subject`、`syllabus_node`、`mock_exam`、`score_record` payload、客户端倒计时投影、目标分/满分校验、父节点依赖和同步副作用顺序。
- 考试数据继续只在当前用户的本地 Vault 解锁后可读写；Workspace、Space、Device、Sync、Vault 状态必须自动带入并持续回显。
- GLM fixture store、hash router、mock 数据、手写 overlay 和演示动作不得进入正式代码；复用现有 Radix adapters、Workbench primitives、State Notice 和双主题 token。
- 低频创建考试、科目、大纲节点、模考和成绩进入 Sheet 或局部编辑；当前可完成的选择、覆盖状态与补救动作保持可发现，不删除任何正式功能。

## 步骤分解

### 步骤 1：冻结 Exam 副作用、命令面与 GLM 差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T14:13:00+08:00`
- **AI 评分**：90/100
- **目标**：登记旧 `ExamCenter` 的上下文加载、Vault/bootstrap、五类实体读取、创建与同步动作，建立 `ExamMaster / CoverageMain / ExamInspector` 布局树、区域和状态合同。
- **涉及文件**：`apps/web/src/features/exam/exam-center.tsx`、`exam-workbench-model.ts`、GLM `prototype/src/pages/exam.tsx`、Exam Target 截图、Exam 浏览器测试。
- **验证方法**：characterization/unit 合同覆盖 payload、依赖、加密与同步顺序；确认状态、区域和唯一 primary 的预期。

### 步骤 2：实现 Exam Master / Coverage Main / Exam Inspector

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T14:16:00+08:00`
- **AI 评分**：86/100
- **目标**：将真实 Exam 状态接入 route-specific Workbench View；Master 展示考试列表与倒计时，Main 聚合覆盖、科目/大纲、模考/成绩、薄弱项，Inspector 回显考试范围、目标分、权限与同步状态。
- **涉及文件**：新增 `apps/web/src/features/exam/exam-workbench.tsx`、`exam-workbench.module.css`；按需要提取 `use-exam-controller.ts`；精简 `exam-center.tsx`；补充视图/状态测试。
- **验证方法**：每个可见交互层最多一个 primary；创建与解锁使用 Sheet 焦点管理；移动端按 Master → Main → Inspector 连续流展示；不渲染旧 ProductPanel 主体。

### 步骤 3：真实 Exam 任务、四断点与三联证据

- **状态**：已完成 ✓（Product Owner 独立验收通过）
- **执行时间**：`2026-08-27T14:36:00+08:00`
- **AI 评分**：96/100
- **目标**：以真实 Session/API/Vault/sync-v1 完成创建考试、添加科目/大纲、安排模考、记录成绩和覆盖/薄弱项查看，生成 Before/Target/After、Function Reachability 与运行摘要。
- **涉及文件**：新增 `tests/browser/exam-workbench.spec.ts`、`reports/ui-refactor/exam-conformance.md`、`reports/ui-refactor/after/`。
- **验证方法**：`320/390/1024/1440` 无溢出/遮挡/不可达；Axe、键盘、焦点、reduced-motion、唯一 primary、locked/empty/offline/error/stale/capability-disabled 状态和真实同步通过；完成后等待 Product Owner 独立验收。

## 执行记录

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 2026-08-27 05:10 | Review 独立验收通过，创建 Exam 子计划 | Product Owner 明确回复 `Review 独立验收通过`；Exam 解锁，后续其他路由不并行启动 |
| 2026-08-27 14:27 | 恢复真实验收 API 运行基线 | 复用持久化 PostgreSQL 实际密码 `logion-b1-db-password`，修正 8080 allowed origin / WebAuthn RP；API health 通过 |
| 2026-08-27 14:29 | 修复 Browser 测试匹配遗漏 | `playwright.config.ts` 将 `exam-workbench.spec.ts` 纳入 authenticated project；此前“无测试可执行”不再可能静默发生 |
| 2026-08-27 14:31 | 真实 Exam 任务与四断点验收 | 真实 Session/API/Vault/sync-v1 完成创建考试、科目、大纲、模考、成绩；`320/390/1024/1440` overflow、几何、唯一 primary、Axe、键盘、焦点、reduced-motion 全通过 |
| 2026-08-27 14:32 | 修复并复验无障碍缺陷 | 选中行成功标签对比度从 `4.35:1` 提升到 AA；覆盖率进度条补齐 `role=progressbar` 与 value 属性；最终镜像 Browser `1 passed / 9.4s` |
| 2026-08-27 14:36 | 生成 Exam 一致性报告并恢复正式注册模式 | 报告写入 `reports/ui-refactor/exam-conformance.md`；API 已恢复 `invite`，直接注册返回 `410 AUTH_REGISTRATION_UPGRADE_REQUIRED` |
| 2026-08-27 14:42 | Exam 独立验收通过 | Product Owner 明确回复 `验收通过`；Exam 三栏工作台、真实任务链、四断点和证据限制获批准，允许关闭子计划并解锁父计划步骤 9 |

## 完成条件

- Exam Workbench 实现与 AI 自检完成，真实 Browser 证据和一致性报告归档。
- Exam 原有考试、科目、大纲、模考、成绩、Vault、离线和 sync-v1 功能 100% 可达。
- Product Owner 已独立验收通过；父计划步骤 8 已完成并解锁步骤 9。

## Product Owner 验收

- **结果**：通过 ✓
- **原文**：`验收通过`
- **范围**：Exam Master / Coverage Main / Exam Inspector、考试/科目/大纲/模考/成绩真实闭环、四断点、Axe、键盘、焦点、reduced-motion、overflow 与证据限制。
