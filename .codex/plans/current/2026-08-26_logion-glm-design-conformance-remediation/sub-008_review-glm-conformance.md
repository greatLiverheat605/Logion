# 子计划：Review GLM 一致性整改

## 元信息

- 子计划 ID：`sub-008`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 8 - Planning、Review 与 Exam（本子计划仅 Review）
- 创建时间：`2026-08-27T02:23:39+08:00`
- 状态：已完成（待 Product Owner 独立验收）
- Shrimp 任务：`6b3d8dd5-eaeb-4756-b89f-8bb8a57c2ca7`
- 创建原因：Planning PO Gate 已通过；Review 仍为 60KB 的副作用与 ProductPanel/长表单混合 Center，需要独立冻结复习语义后替换为 GLM ReviewTabs / DueQueue / AnswerSheet / KnowledgeInspector 工作台。

## 保护边界

- 保留正式 Session、Workspace/Space、Vault、BootstrapRepository、ProtectedOfflineRepository、SyncClient、sync-v1、离线本地保存、请求编号和权限语义；不修改 API、contracts 或权限模型。
- 保留 `topic`、`topic_dependency`、`mastery`、`review_schedule`、`quiz_item`、`quiz_attempt`、`error_pattern`、`audit_review`、`review_finding` 正式 payload 和副作用顺序。
- 答题 Sheet 必须先收集回答，再披露服务端判定/参考答案/解析；掌握度、错因、审查完成和发现解决仍需显式人工确认。
- 共享空间图谱编辑继续遵循 owner/admin/editor 角色；不能编辑时入口保持可发现并显示 capability-disabled，不伪造权限。
- GLM fixture store、hash router、mock 状态、手写 overlay 和演示数据不得进入正式代码；复用现有 Radix adapters、Workbench primitives、状态视觉和双主题 token。
- Exam 不在本子计划范围；Review 完成独立验收后才允许创建 Exam 子计划。

## 步骤分解

### 步骤 1：冻结 Review 副作用、命令面与 GLM 差异

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T02:54:45+08:00`
- **AI 评分**：92/100（静态与源码边界完成；真实镜像证据待步骤 3）
- **目标**：登记旧 Center 的加载、Vault、bootstrap、commit、同步和所有正式命令，建立 Review 布局树、区域与 Before/Target 证据基线。
- **涉及文件**：`apps/web/src/features/memory/review-center.tsx`、`review-workbench-model.ts`、GLM `prototype/src/pages/review.tsx`、Review Target 截图、相关浏览器测试。
- **验证方法**：确认复习全链路与状态边界不丢失；确认 Target 哈希、四断点约束、唯一 primary 和 Sheet 焦点合同。

### 步骤 2：实现 ReviewTabs / DueQueue / AnswerSheet / KnowledgeInspector

- **状态**：已完成 ✓
- **执行时间**：`2026-08-27T02:54:45+08:00`
- **AI 评分**：96/100
- **目标**：将真实 Review 状态与动作接入 route-specific 工作台 View，移除旧 ProductPanel 主体渲染；低频新建知识点、题目、依赖、审查与解锁进入 Sheet。
- **涉及文件**：新增 `apps/web/src/features/memory/review-workbench.tsx`、`review-workbench.module.css`；精简 `review-center.tsx`；必要的单元测试。
- **验证方法**：每个可见层最多一个 primary；Tabs/Sheet 键盘、焦点恢复、答题先回答后披露、错因/掌握/审查显式确认通过。

### 步骤 3：真实 Review 任务、四断点与三联证据

- **状态**：已完成 ✓（AI 自检；待 Product Owner 独立验收）
- **开始时间**：`2026-08-27T02:54:45+08:00`
- **完成时间**：`2026-08-27T03:36:26+08:00`
- **AI 评分**：`96/100`
- **目标**：重建无挂载 Web 镜像，以真实 Session/API/Vault/sync-v1 完成到期复习、作答、掌握确认、错因解决、周期审查与图谱任务，生成 Before/Target/After 与 Function Reachability 报告。
- **涉及文件**：新增 `tests/browser/review-workbench.spec.ts`、`reports/ui-refactor/after/`、`reports/ui-refactor/review-conformance.md`。
- **验证方法**：320/390/1024/1440 无溢出/遮挡/不可达；Axe、键盘、读屏、reduced-motion、双主题、11 状态、真实同步和旧响应保护通过；完整质量门禁通过。

## 执行记录

| 时间             | 操作                                     | 结果                                                                      |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| 2026-08-27 02:23 | Planning PO 验收通过，创建 Review 子计划 | `Planning 独立验收通过，并接受证据缺口`；Review 获授权启动，Exam 继续锁定 |
| 2026-08-27 02:54 | Review 主体清理与静态门禁                 | 删除 `review-center.tsx` 不可达旧 ProductPanel 主体；Sheet action 仅在成功后关闭；TypeScript、ESLint、52 files / 204 tests、diff check 全部通过 |
| 2026-08-27 02:54 | 真实运行环境检查                           | Docker Desktop daemon 不可连接；Compose 变量也未提供，真实镜像重建与 Browser E2E 延后，不以静态结果代替 |
| 2026-08-27 03:36 | Review 真实 Browser、四断点与证据收口       | 无挂载 Web 镜像 `sha256:247bedbca17935e267da04521e94640912b5bd5b03f65eec59f547f6610a2b55`；真实注册/登录、Vault 解锁、sync-v1 bootstrap、新建知识点/主动回忆题、选择、先回答后确认、加密答题记录闭环通过；320/390/1024/1440、Axe、键盘、Sheet 焦点、reduced-motion、overflow、唯一 primary、runtime console 均通过；报告与 After 截图哈希已核对 |

## 完成条件

- Review 实现与 AI 自检完成，PO 独立验收待确认。
- Review Before / GLM Target / After、布局差异、Function Reachability 与正式运行摘要已归档。
- Shrimp Review 任务将以 `>=80` 分验证完成；父计划步骤 8 仍保持执行中，直到 Review PO 验收后再启动 Exam。
