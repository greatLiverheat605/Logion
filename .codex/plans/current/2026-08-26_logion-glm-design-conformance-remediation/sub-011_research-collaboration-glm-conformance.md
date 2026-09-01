# 子计划：Research / Collaboration GLM 一致性整改

## 元信息

- 子计划 ID：`sub-011`
- 父计划：[2026-08-26_logion-glm-design-conformance-remediation.md](../2026-08-26_logion-glm-design-conformance-remediation.md)
- 关联步骤：步骤 9 - Self-study、Research、Collaboration 与 Templates（本子计划仅 Research、Collaboration）
- 创建时间：`2026-08-27T15:50:00+08:00`
- 状态：已完成 ✓（Research、Collaboration 均获 Product Owner 独立验收）
- 依赖：`sub-010` 已获 Product Owner 独立验收；MCP C5 `82a5fe9c-4343-42b1-b41e-76b0531b3541`

## 保护边界

- 保留正式 Session、Workspace/Space、Vault、BootstrapRepository、ProtectedOfflineRepository、SyncClient、sync-v1、离线 Outbox、请求编号、权限和错误语义；不修改 API、contracts 或权限模型。
- Research 保留 `paper_record`、`research_claim`、`research_question`、`experiment_run`、`metric_record`、`research_feedback` 的父子依赖、来源 URL 校验、立场和仅追加证据语义。
- Collaboration 保留 `rubric`、`group_review`、`group_feedback`、`report_snapshot` 的 Shared Space 边界、角色能力、成员可见性、反馈追加和不可变快照语义；Private Space 不得进入共享视图。
- 不复制 GLM fixture store、hash router、mock 数据、手写 overlay 或演示动作；复用现有 Radix adapters、Workbench primitives、State Notice 和双主题 token。
- 两条路由串行施工：先 Research 完成并独立验收，再 Collaboration；Templates 继续锁定。

## GLM 目标布局

### Research

```text
Research Workbench
├─ AppShell / Context Bar
├─ Research Question Master
├─ Claims Main
│  ├─ Question Header
│  └─ Tabs: 声明与证据 / 论文 / 实验与指标
└─ Evidence Inspector
   ├─ 来源与立场
   ├─ 支持 / 反证 / 不确定证据
   └─ 反馈与覆盖率
```

主任务：从一个可检验问题开始，沿来源 → 声明 → 证据 → 实验 → 指标形成可追溯链路。

### Collaboration

```text
Collaboration Workbench
├─ AppShell / Shared Space Context Bar
├─ Review Master
│  ├─ Shared Space summary
│  └─ Review queue
├─ Rubric & Feedback Main
│  ├─ Review Header
│  ├─ Rubric criteria
│  ├─ Feedback timeline
│  └─ Immutable report snapshots
└─ Member Inspector
   ├─ 当前角色与能力
   ├─ Shared Space scope
   └─ Private data exclusion
```

主任务：在明确共享对象上发起审阅，按 Rubric 收集反馈，形成下一步行动并发布不可变报告快照。

## 步骤分解

### 步骤 1：冻结 Research / Collaboration 副作用与 GLM 差异

- 状态：已完成 ✓
- 执行时间：`2026-08-27T16:12:00+08:00`
- AI 评分：88/100
- 登记旧 `OfflineLearningCenter(mode="research|collaboration")` 的上下文加载、Vault/bootstrap、实体读取、提交和权限分支。
- 建立 route-specific 区域、稳定 `data-testid`、唯一 primary、11 类状态和允许偏离记录；禁止 Self-study 文件再引入新副作用。
- 验证：`research-collaboration-contract.test.ts` 覆盖 payload、父依赖、来源 URL、Shared/Private Space、角色能力和不可变快照；`pnpm --filter @logion/web typecheck` 与 Web Vitest 全量 `56 files / 216 tests` 通过。

### 步骤 2：Research 问题-声明-证据工作台

- 状态：已完成 ✓
- 开始时间：`2026-08-27T16:12:00+08:00`
- 完成时间：`2026-08-27T16:38:00+08:00`
- AI 评分：92/100
- 依赖：步骤 1 ✓
- 新增 Research controller/view 与模块 CSS；从共享 Center 中提取真实副作用。
- 实现问题 Master、声明/证据 Tabs、论文索引 Sheet、实验与指标 Sheet、Evidence Inspector；保留 `research-workbench-model` 与 `ResearchExperimentComparison`。
- 删除 `self-study-center.tsx` 中已不可达的旧 Research `ProductPanel` / `planning-form` 主体，保留正式 `commitMutation`、来源 URL 校验、父依赖和同步语义。
- 新增 `research-workbench.test.tsx` 与 `tests/browser/research-workbench.spec.ts`；Web 全量单测 `57 files / 218 tests`、typecheck、lint、Docker build 均通过。
- 验证：问题、论文、声明、支持/反证/不确定证据、实验、指标、反馈入口均保留；低频输入最多两层；失败保留输入，成功才关闭 Sheet。

### 步骤 3：Research 真实任务、四断点与独立验收

- 状态：已完成 ✓（Product Owner 独立验收通过）
- 开始时间：`2026-08-27T16:38:00+08:00`
- 完成时间：`2026-08-27T17:06:12+08:00`
- AI 评分：96/100
- 依赖：步骤 2
- 真实 Session/API/Vault/sync-v1 已完成创建问题、论文、声明、反馈、实验和指标，检查来源 URL、父依赖、覆盖率和 Inspector；解锁 Sheet 的口令输入具备自动焦点并恢复触发按钮。
- 生成 `reports/ui-refactor/research-conformance.md` 与 `reports/ui-refactor/after/app-research-*` 四张 After 截图；运行 `320/390/1024/1440`、Axe、键盘、焦点、reduced-motion、overflow、唯一 primary 和 runtime console 检查，全部通过。
- 完成后暂停，等待 Product Owner 回复 `Research 独立验收通过`；未通过不得施工 Collaboration。
- 质量修复记录：首轮真实验收发现选中问题行的 tertiary 辅助文字在浅色背景对比度为 `4.36:1`；已将选中行辅助文字提升为 `var(--text-secondary)`，`c11` 镜像重建后四断点 Axe 全部通过。
- 运行摘要：Web `logion-web:0.1.0-local-c11`，image `sha256:3a97c4262c5a0abf4e35fd0485e43f7be6f086f54d0ec5b0276502418a8b238c`，无源码挂载；真实规格 `1 passed (10.4s)`。

### Research Product Owner 验收

- 验收结果：通过
- PO 原文：`Research 独立验收通过`
- 验收时间：`2026-08-27`
- 解锁范围：允许启动 Collaboration；Templates 继续锁定。

### 步骤 4：Collaboration 共享审阅工作台

- 状态：已完成 ✓
- 开始时间：`2026-08-27T17:17:46+08:00`
- 完成时间：`2026-08-27T17:45:48+08:00`
- AI 评分：96/100
- 依赖：Research 独立验收通过
- 新增 Collaboration controller/view 与模块 CSS；Shared Space 过滤必须在 controller 与 view 双重生效。
- 实现 Review Master、Rubric criteria、Feedback timeline、Report snapshot 和 Member Inspector；创建、反馈、快照发布分别使用 Sheet/Popover/Confirm，危险操作显示影响范围、权限和恢复路径。
- 新增 `collaboration-workbench.tsx`、模块 CSS、静态组件合同测试和真实浏览器规格；补齐 GLM 区域 `collaboration-queue`、`collaboration-rubric`、`collaboration-feedback`、`collaboration-snapshot`、`collaboration-inspector`。
- 修复协作实体联合类型导出、ProductTag tone 类型和临时无用占位；保留真实 `commitMutation`、Shared Space 校验、Vault、sync-v1 和权限语义。
- 验证：Owner/Admin/Editor/Reviewer/Contributor 的真实能力差异可见；Private Space 不可选、不读取、不写入；不可变快照只能新增版本；typecheck、lint、Vitest、build 通过。

### 步骤 5：Collaboration 真实任务、四断点与独立验收

- 状态：已完成 ✓（技术验收通过，等待 Product Owner 独立验收）
- 完成时间：`2026-08-27T17:45:48+08:00`
- AI 评分：96/100
- 依赖：步骤 4
- 真实 Shared Space 完成创建 Rubric、发起 Review、提交反馈、发布不可变报告并检查成员权限 Inspector。
- 生成 `reports/ui-refactor/collaboration-conformance.md` 与 `reports/ui-refactor/after/app-collaboration-*`，运行四断点、Axe、键盘、焦点、reduced-motion、overflow、唯一 primary 和 runtime console 检查。
- 清理临时诊断日志并恢复正式 `300_000` 测试超时；在最终无挂载 `logion-web:dev` 镜像上重新运行真实规格，Shared Space → Rubric → Review → Feedback → Immutable Snapshot 闭环再次通过。
- 最终运行摘要：Web image `sha256:ae2c201961d7fe5b0a5505ddccd49692e9af899e7f54723ddc2ca0a01a86c4c9`，Web mounts `[]`，API `sha256:50091724b45d088a276466b483addb4619555c8d640e4887694f0e975dcd8f12`，API/DB/Redis/Worker/Proxy healthy；直接登录 `200`，真实规格 `1 passed (18.5s)`。
- 重建初始因 Compose 默认 origin 导致 `403 AUTH_ORIGIN_INVALID`，并因 WebAuthn RP ID 不匹配导致 API unhealthy；已在本次进程环境补齐 `127.0.0.1:8080` allowed origin 与匹配的 WebAuthn RP 配置，未写入 secrets 或仓库文件。
- 完成后等待 Product Owner 回复 `Collaboration 独立验收通过`；Templates 在独立验收前保持锁定。

### Collaboration Product Owner 验收

- 验收结果：通过
- PO 原文：`Collaboration 独立验收通过`
- 验收时间：`2026-08-27`
- 解锁范围：允许创建并启动 Templates 子计划 `sub-012`；步骤 10 及其它 Gate 1 路由继续保持串行。

## 统一验收标准

- 两条路由均不渲染旧 `ProductPanel` 主体，不共享 Self-study 的视觉模板。
- Function Reachability 100%；Workspace、Space、权限、Vault、Sync 上下文持续回显。
- `loading`、`empty`、`pending`、`success`、`offline`、`locked`、`permission`、`409`、`error`、`capability-disabled`、`stale` 由真实 controller 状态驱动并提供恢复动作。
- `320/390/1024/1440` 无溢出、遮挡或不可达操作；每个可见交互层最多一个视觉 primary。
- 真实 API/Session/Vault/sync-v1 证据、同视口截图、运行镜像摘要和已知证据缺口全部进入独立报告。

## 变更记录

| 时间             | 操作                                                    | 结果                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-08-27 15:50 | Self-study PO 独立验收通过，创建 sub-011                | Research/Collaboration 解锁并保持串行；Templates 继续锁定                                                                                                                                                                                                                                              |
| 2026-08-27 16:12 | 步骤 1：冻结 Research / Collaboration 副作用与 GLM 差异 | 新增正式语义契约与 characterization tests；MCP C5 已完成，88/100                                                                                                                                                                                                                                       |
| 2026-08-27 16:38 | 步骤 2：Research Workbench 实现与旧主体清理             | 新增 route-specific Workbench、Sheet、Inspector、组件测试和浏览器规格；57 files / 218 tests、typecheck、lint、Docker c8 通过                                                                                                                                                                           |
| 2026-08-27 17:06 | 步骤 3：Research 真实任务、四断点与质量修复             | 使用显式本地测试账号完成问题→论文→声明→反馈→实验→指标链路；修复选中行 AA 对比度并补齐解锁自动焦点；`c11` 无挂载镜像、四断点截图、Axe/键盘/焦点/reduced-motion/overflow/唯一 primary/runtime console 全部通过，等待 PO 独立验收                                                                         |
| 2026-08-27 17:17 | Research 独立验收通过，启动 Collaboration               | PO 原文 `Research 独立验收通过`；关闭 Research 门并解锁 Collaboration，Templates 继续锁定                                                                                                                                                                                                              |
| 2026-08-27 17:45 | 步骤 4：Collaboration 共享审阅工作台完成                | 新增 route-specific Review Master / Rubric & Feedback Main / Member Inspector；Shared Space 双重过滤、角色能力、不可变快照确认与恢复路径保留；typecheck、lint、220 tests、build 通过                                                                                                                   |
| 2026-08-27 17:45 | 步骤 5：Collaboration 真实任务与四断点证据完成          | `c12` 无挂载 Web 镜像；真实 Rubric → Review → Feedback → PUBLISH Snapshot 闭环通过；320/390/1024/1440、Axe、键盘/焦点、reduced-motion、overflow、唯一 primary、runtime console 全通过；报告与截图哈希已归档，等待 PO 独立验收                                                                          |
| 2026-08-27 18:49 | 步骤 5：清理诊断并复核最终镜像                          | 删除 Collaboration 诊断日志、恢复 300 秒超时；最终无挂载 `logion-web:dev` 重新构建并强制重建 Web/proxy（依赖链同步修复 API origin/WebAuthn 配置）；直接登录 200，真实 Rubric → Review → Feedback → PUBLISH Snapshot 与四断点无障碍规格再次通过；报告已更新最终 digest 与截图哈希，继续等待 PO 独立验收 |
| 2026-08-27 18:55 | Collaboration Product Owner 独立验收通过                | PO 原文 `Collaboration 独立验收通过`；Research/Collaboration 两条路由均关闭独立验收门，允许启动 Templates `sub-012`，本子计划完成                                                                                                                                                                      |

## 完成条件

- Research 与 Collaboration 均完成实现、真实任务和独立 PO 验收。
- MCP C5 与本子计划步骤状态同步；未获 PO 验收前不创建 Templates 子计划。
