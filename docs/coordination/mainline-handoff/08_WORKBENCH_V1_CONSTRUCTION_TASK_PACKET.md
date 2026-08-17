# Workbench v1 正式施工任务包

状态：I1 覆盖矩阵已通过独立对抗复审并获产品 Owner 批准；正式前端施工仍待单独授权
日期：2026-08-17
工作目录：由用户在运行环境中指定，不把本机绝对路径写入仓库
分支：`codex/product-workbench-v1-spec`

## 1. 目标

在不破坏现有 Workspace Role、Space ACL、SessionBoundary、正式对象归属和默认关闭生产能力的前提下，把已批准的 Workbench v1 原型转化为可验收的前端施工计划，并按批次迁移现有页面。

四个固定工作台为：学习、研究、考试、导师；支持受控自定义工作台；Today 始终统一。工作台是已授权对象的界面投影，不是新的权限域、数据副本或对象所有权边界。

## 2. 已批准基线

施工方必须先阅读并以这些文件为准：

- `docs/adr/0030-workbench-v1.md`
- `docs/product/WORKBENCH_V1_PRODUCT_SPEC.md`
- `docs/design/workbench-v1/PROTOTYPE_SPEC.md`
- `docs/design/workbench-v1/logion-workbench-v1-prototype.html`
- `docs/development/AGENT_DELIVERY_WORKFLOW.md`
- `docs/development/V020_EXECUTION_PLAN.md`
- `docs/development/V020_STATUS.md`
- `docs/development/TENCENTDB_AGENT_MEMORY_HANDOFF.md`

原型不是全站完整页面和操作原型。正式施工前必须先完成全站覆盖矩阵，补齐认证、搜索、命令面板、通知、项目/任务/来源 CRUD、协作管理、设置、安全、备份恢复、集成、离线同步和所有正式路由的状态分支。

## 3. 分批施工顺序

### I1：全站覆盖与只读适配器

- 建立“路由 × 页面 × 操作 × 状态 × 视口 × 权限”矩阵；
- 盘点现有 21 条正式路由、认证外页面和未来功能；
- 只读盘点现有 API、SessionBoundary、Space 和权限合同，不修改正式前端或服务端实现；
- Today、学习工作台、Knowledge Base Review/Graph 作为首批高频只读路径；
- 不新增 API、数据库表、迁移、OpenAPI 字段或权限绕过；
- 完成后做一次对抗复审并请求用户批准 I1；进入 I2 仍需单独的施工范围与写入授权。

### I2：研究与考试领域流程

- 研究：Research Question、Source、Claim/Evidence、Experiment Run、版本和证据关系；
- 考试：Exam、覆盖矩阵、复习缺口、模拟考试和结果轨迹；
- 保持统一 Shell、Context Bar、Inspector、反馈语义和可访问键盘操作；
- 研究的技术感只能来自证据链、版本、关系和实验轨迹，不使用霓虹、粒子或无意义装饰；
- 失败、锁定、权限拒绝、离线、409 冲突、能力关闭必须就地说明并提供恢复动作。

### I3：导师与自定义工作台

- 导师：Shared Space、Workspace Role、待审队列、Rubric、反馈和发布边界；
- 自定义工作台：只允许注册模块的组合、顺序、密度和有限视觉配置；
- 保存必须有 `saving → success receipt`，409 必须展示本地/远端差异并由用户选择合并；
- 删除只删除配置和引用，先展示影响预览，不删除正式对象；
- 自定义名称、说明、图标和文本必须按纯文本渲染并进行 XSS 防护。

### I4：完整状态与质量门禁

- 为每个页面补齐 ready/loading/empty/saving/success/error/offline/locked/permission denied/409/disabled/stale 等状态；
- 1440、1024、390、320 四种视口下无横向溢出，移动端操作目标至少 44px；
- Light/Dark、reduced-motion、axe、键盘导航、焦点陷阱、Inspector 模态和 Escape/焦点返回全部通过；
- 使用真实 API/认证栈做 Playwright 回归，不以静态原型或单元测试替代；
- 记录请求 ID、恢复动作和未运行检查的明确原因。

## 4. 不变量与禁止事项

- 不改变 Workspace Role、Space ACL、SessionBoundary、对象归属或数据共享语义；
- 不复制对象来实现工作台隔离；同一正式对象可被多个工作台引用；
- 未经用户对具体施工批次明确授权，不修改 `apps/web/src/**`；
- 不新增生产能力，不打开 Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 或 AI Acceptance；
- 不启动本机 Docker 作为验收捷径，不绕过认证，不把静态演示写成真实通过；
- 不提交、推送、合并或部署，除非用户对当前动作明确授权；
- 不把 TencentDB Agent Memory 当作权威账本，不把密钥、密码或生产数据写入记忆服务或仓库。

## 5. 每批次交付物

施工方每轮只返回结构化 handoff：

```text
Outcome: complete | partial | blocked
Base commit:
Working branch:
Changed files:
Commands actually run:
Observed results:
Unrun checks and reason:
Known risks or assumptions:
Working tree status:
Suggested next action for the coordinator:
```

每轮完成后必须派发独立对抗复审，至少检查：权限/对象边界、状态闭环、响应式与可访问性、XSS/敏感信息、旧路由回归、任务包范围外修改。复审发现问题时先退回小修，不扩大范围。

## 6. 协调员验收流程

1. 核对 `git status --short --branch`、HEAD、基线和允许写入路径；
2. 核对任务包中的真实命令并逐项重跑，Worker 声明不等于通过；
3. 审查 diff、未跟踪文件、敏感信息和生产开关；
4. 记录 coordinator observation 和 handoff receipt，不覆盖历史；
5. 产品语义通过且所有必要门禁有真实证据后，才请求用户批准下一批；
6. 用户批准后才允许相应的 commit/push/merge/release 动作。

## 7. 当前下一步

I1 全站覆盖矩阵已完成独立对抗复审并于 2026-08-18 获产品 Owner 批准。当前只允许形成脱敏的 Workbench 文档基线提交；TencentDB Agent Memory 仍单独处于“部署待验收”，I2 和任何正式前端迁移必须等待新的明确授权。
