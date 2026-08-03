# v0.2.0 执行计划：自适应知识空间架构基础

> 状态：设计待审（ADR-0029 Proposed）；不得据此直接上线。  
> 基线：`173eb5bd8bb082977eca4e64616cba43617eba48`。  
> 本计划保持文档-only；迁移、OpenAPI、产品代码、同步和 Provider 配置均需后续独立批准。

## 1. 不可变边界

- 复用现有 `Space`；Private/Shared permission、当前认证/session、AI Gateway ownership 不变。
- 新知识实体首版 online-only，不进入 sync-v1 wire、vectors、bootstrap、IndexedDB/Vault 或 Outbox。
- `TopicDependency` 是唯一 Topic 先修关系。
- AI 输出始终是 Draft/Suggested；只有用户接受事务可写正式知识、typed citation、幂等收据和审计。
- 不增加一级导航目的地；考、学、研、导仅投影同一图谱/引擎。
- 外部 worker 不合并、不推送；Windows Codex 负责架构、敏感后端、迁移/合同、集成、最终测试、提交和推送，并且是本地 coordination ledger 唯一写入者。
- 任何秘密、Provider endpoint、私有主机数据、用户目录、终端记录或 dispatch capability 不得进入仓库或协调状态。

## 2. 有序任务 DAG

```text
V20-00 design approval
  ├─> V20-01 schema/migration design ─> V20-02 migration proof ─┐
  ├─> V20-03 permission/API design ──> V20-04 OpenAPI gate ─────┤
  ├─> V20-05 Kimi UX prototypes ─────> V20-06 UI selection ─────┤
  └─> V20-07 threat/retention review ────────────────────────────┤
                                                               v
                 V20-08 bounded core implementation
                   ├─> V20-09 AI apply/idempotency
                   ├─> V20-10 graph/search/rendering
                   └─> V20-11 attachment/local-worker prerequisites
                                  └──────────────┬───────────────┘
                                                 v
                 V20-12 negative/security/integration gates
                   └─> V20-13 DeepSeek read-only review
                         └─> V20-14 rollback rehearsal
                               └─> V20-15 Codex acceptance/integration
```

没有依赖完成和可核验证据，不得提前启动下游。V20-11 的本地 Worker 可保持禁用而不阻塞纯在线知识功能，但任何本地执行路径上线都必须先满足加密前提。

## 3. 任务包、所有权与门禁

| ID     | Owner / 状态                                  | 单一写入范围                                                    | 输出与进入条件                                                                                                                             | 完成证据                                                                          |
| ------ | --------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| V20-00 | Windows Codex / 当前                          | `docs/adr/0029-*`、本威胁模型、本计划                           | 对 ADR、开放决策、威胁和拆分边界评审；需要产品/安全明确接受 ADR 状态变化                                                                   | 评审记录；所有开放决策有 owner/后续 gate，不伪装实现事实                          |
| V20-01 | Windows Codex / 待批准                        | API models + 新 migration，仅在新任务授权后                     | DDL 设计 typed citation 四类 FK、恰好一个目标、scope、版本、hash、索引、删除策略；先决定 Source 身份                                       | migration review、DDL diff、约束清单、upgrade/downgrade 计划                      |
| V20-02 | Windows Codex / 待 V20-01                     | migration/tests 独占                                            | 隔离 PostgreSQL upgrade/downgrade/upgrade；种子与生产规模估算；孤儿/跨范围数据检查                                                         | 实际命令、通过结果、前后 schema/行数、备份恢复点                                  |
| V20-03 | Windows Codex / 待批准                        | API domain/routes/schemas/tests 独占                            | 决定命名 permissions、ETag/version、错误码、分页、接受事务；不得改变 auth/Space semantics                                                  | 权限矩阵、事务序列、负测设计、安全复核                                            |
| V20-04 | Windows Codex / 待 V20-03                     | `packages/contracts/**`、生成快照及直接测试                     | 仅加法 OpenAPI；生成后审查客户端/快照；证明 sync-v1 无 diff                                                                                | `pnpm contracts:generate`、快照 diff、`pnpm contracts:check` 及 sync golden diff  |
| V20-05 | Kimi K3 / 可在设计批准后派发                  | 独立 Mac worktree 内限定 UX 原型/直接 UI 测试；不触碰共享数据层 | 两款同信息架构原型：1440/390、明暗、Today/Review/Records 中的图谱投影、接受/编辑/拒绝、空/错/加载/online-only、列表/树替代；不新增一级导航 | 可交互原型、截图/录屏、键盘/移动状态清单、无后端假设清单                          |
| V20-06 | 产品 owner + Windows Codex / 待 V20-05        | 无并行实现写入                                                  | 人工选择 UX 方向；冻结信息架构和状态语义，数据/权限/合同仍由 Codex 控制                                                                    | 明确选择与修改项；未选择则停止 UI 实现                                            |
| V20-07 | Windows Codex + 安全/隐私 owner / 待评审      | threat/retention 文档；生产策略需另授权                         | 决定共享贡献、审计、备份、本地缓存、Provider 保留；确认附件残余风险和 Beta 停止线                                                          | 签核的保留矩阵、数据流/删除清单、残余风险接受                                     |
| V20-08 | Windows Codex / 待 01–07 必要门禁             | 核心 API/domain/repository/tests；一 writer                     | 实现 SourceExcerpt/citation、授权、版本、删除闭包、bounded read；能力默认关闭                                                              | 目标 pytest/Ruff/mypy、DB 约束与跨租户测试、代码审查                              |
| V20-09 | Windows Codex / 待 V20-08                     | AI Gateway adapter/domain apply/tests 独占                      | 新任务类型、数据最小化预览、schema、stale 检查、接受原子事务、幂等/未知外呼状态                                                            | 故障注入、并发/重放、预算账本、未经接受正式写入为 0                               |
| V20-10 | UI 可由已批准 Kimi scope 实现；服务端由 Codex | 前后端路径不重叠；共享合同由 Codex                              | 1–2 跳、150/400 默认、服务端硬限、浏览器布局、移动列表/树、安全呈现、词法黄金集                                                            | 查询/DoS 测试、Recall@10、axe/键盘/390px、存储型 XSS 浏览器测试                   |
| V20-11 | Windows Codex / 默认禁用                      | attachment migration/worker security，需单独任务                | Resource 绑定仍走安全上传；本地租约/检查点须独立设计；BitLocker 或等价证明前不启用                                                         | attachment 负测；磁盘加密/ACL/恢复/残留清理证据；核心流程在 worker offline 时通过 |
| V20-12 | Windows Codex / 集成树                        | 测试与必要修复                                                  | 运行下节矩阵；先 bounded 后 repository gates；基础设施缺失记为 unrun，不算通过                                                             | 原始命令、退出码、结果计数、失败现场和 unrun 原因                                 |
| V20-13 | DeepSeek V4 Flash / 只读、待 V20-12           | 无写权限                                                        | 独立审查完整 diff：租户逃逸、约束、stale acceptance、重放/计费、XSS、DoS、sync-v1、删除/回滚；不得修文件                                   | 结构化 findings（severity/path/evidence/fix）；零文件变更、无 merge/push          |
| V20-14 | Windows Codex / 待修完 findings               | staging/隔离恢复环境                                            | 演练每个 checkpoint；首个正式写入后只禁用+前向修复；验证备份恢复与引用闭包                                                                 | upgrade/downgrade/upgrade、恢复、feature-off、孤儿扫描的观测结果                  |
| V20-15 | Windows Codex / 最后                          | 集成 worktree；ledger 仅 Codex                                  | 复核所有 handoff/diff/secret/path；运行最终 gates；只有授权后 commit/merge/push                                                            | acceptance manifest、commit SHA（若授权）、未运行项、残余风险、清理清单           |

### ZCode 状态

ZCode/GLM-5.2 为手工桌面客户端，当前状态是 **manual/pending**：本计划不宣称已 dispatch、启动或交付。若后续分派，只能给独立 Windows worktree 中非敏感、模块化且不与 Codex/Kimi 重叠的实现（例如批准后的纯 schema DTO 或局部测试夹具）；必须由操作者手动 Open Workspace，以 Git handoff 返回，不能被记录为 Orca worker telemetry，也不得处理 auth、迁移批准、合同所有权、Provider、秘密、merge 或 push。

## 4. 迁移、OpenAPI 与回滚关口

1. **M0 设计冻结**：ADR-0029 接受或以新决策替代；Source 身份、target DDL、permission、保留和 API 版本表达明确。未完成停止。
2. **M1 迁移前**：生产式备份/恢复演练、基线行数和孤儿检查；迁移只加法且可 downgrade。任何数据修复需独立审查。
3. **M2 schema-only**：部署表/约束/索引但能力关闭；实际 upgrade/downgrade/upgrade 通过，锁时长/磁盘预算可接受。
4. **C1 OpenAPI**：运行 generate/check 并人工审查；只允许批准的加法。auth、Space permission、sync-v1 或非预期生成差异立即停止。
5. **R1 read-only**：先上线授权读取和 bounded query；观察错误率、P95、内存、跨租户缓存和截断行为。
6. **W1 write/acceptance**：在 staging 启用写入和接受；故障注入证明正式知识/citation/receipt/audit 原子性与幂等。
7. **P1 首个生产写入前**：可回滚代码和 schema。首个正式写入后禁止破坏性 downgrade；关闭 feature、保持数据可读/可导出并前向修复。

## 5. 验证矩阵

最低必须实际运行并观察：

- 数据库：所有 typed target 的零/多目标、跨 Workspace/Space/个人 owner、错类型、删除/恢复、孤儿扫描；migration upgrade/downgrade/upgrade。
- 授权：每资源跨用户/Workspace/Space、Private Space 对 Admin、角色矩阵、撤权后、移动/分享竞态、不可枚举响应。
- 并发/幂等：stale version、双标签接受、同键同/异 payload、N 并发、Worker 重投、每个事务写点故障。
- AI/费用：未勾选数据不发送、Prompt injection、无权/伪造 citation、schema/长度/hash/version 失败、running 未知不自动外呼、预算只结算一次。
- 删除/隐私：立即撤权、宽限取消、终态清理、共享贡献/去标识化、缓存/租约/附件、备份恢复后清理、日志敏感标记扫描。
- 附件/呈现：扩展名/MIME/魔数/hash/polyglot/超限/部分上传、父对象撤权；HTML/Markdown/URL/文件名 XSS 与 CSP。
- 图/DoS：环、稠密图、超深/超宽、慢查询、游标 scope、响应字节/超时/速率/配额；核心 API P95 回归小于路线图 20% 且无 OOM。
- UX：1440/390、明暗、键盘、焦点、读屏、axe、loading/error/empty/locked/online-only、移动等价接受路径；无一级导航新增。
- 合同/同步：OpenAPI generate/check；sync-v1 operation、wire、vectors、bootstrap 和 Vault 快照无新实体且 golden diff 为零。
- 质量：目标 pytest、Ruff、mypy、Vitest/typecheck/build、相关 Playwright；集成树 `pnpm ci:fast`，用户可见行为且环境可用时 `pnpm test:browser`。

未运行的基础设施相关检查必须记录命令、缺失前提和风险，不能写入 passed。写了测试、worker 声称通过或计划运行都不是验收证据。

## 6. Kimi 与 DeepSeek 的明确范围

跨机器正式派发还有一层协作门禁：只有在用户授权 Windows Codex 发布共同基线、目标 Mac 已验证可检出同一完整 SHA 后，Mac 任务才能从 `pending` 进入 `assigned`。Kimi 和 DeepSeek 必须复用已经验证过的固定启动器终端，并在分派前记录与角色表一致的模型证据；Kimi 不恢复导致客户端失败的 Claude hooks，DeepSeek 不接受会回退到其他 Provider 的裸 `opencode` 启动，且继续使用只读权限和逐次批准。任一条件不满足时保留任务包但不建立正式 Dispatch。

Kimi 只负责已冻结信息架构下的 UX 概念或明确限定的前端呈现：AI 虚线/正式实线、来源详情、接受/编辑/拒绝、online-only、移动列表/树、可访问性与响应式。Kimi 不定义共享数据模型、permission、迁移、OpenAPI、AI Provider/路由、保留或一级导航，也不 merge/push。

DeepSeek 只执行最终候选 diff 的只读安全/合同/回归审查。它不得编辑、启动破坏性命令、访问外部目录、提交、合并或推送；finding 必须由 Windows Codex 复现、修复和验证，worker claim 不自动成为 accepted evidence。

## 7. 接受证据清单

最终 acceptance manifest 至少包括：

- 不可变 base、各 worktree/branch、实际模型证据、task/dispatch 与最终 commit（如获授权）；
- 每个任务的 owner、唯一 writable paths、changed files、完整 diff 和 handoff SHA-256；
- 实际命令、退出码、结果计数/快照；失败、跳过和 unrun 原因单列；
- migration/OpenAPI/sync-v1 diff、权限矩阵、威胁模型负测、日志脱敏、删除/恢复和回滚证据；
- Kimi 人工选择、DeepSeek findings 及 Codex 处置；ZCode 若仍 pending 明确记录，不伪造完成；
- 开放决策、残余风险、feature flag 状态、生产容量停止线和剩余 worktree/branch 清理；
- Git status 与 secret/path review。只有 Windows Codex 可更新 `.agents/coordination/runs/` 并做最终 acceptance/commit/push。

## 8. 显式停止条件

- base/branch 不符、允许路径有不明改动、并行 worker writable paths 重叠；
- 需要改变当前 auth/session、Space permission、Private 默认、AI Gateway ownership 或 sync-v1；
- migration/OpenAPI 未单独批准，生成 diff 含删除/重命名/未预期 auth 或 sync 变化；
- typed FK/恰好一目标、接受原子性、乐观并发、删除闭包或 bounded query 无法在 DB/API 层证明；
- 任何秘密、生产配置、Provider endpoint 或本地 dispatch 能力需进入仓库/任务包；
- 外部请求不确定会自动重放、重复计费不能排除、日志脱敏或跨租户负测失败；
- 需要新增常驻云图/向量/OCR/模型服务，或容量停止线只能靠放宽安全限制解决；
- 本地 Worker 未证明 BitLocker/等价加密、短期租约和残留清理；
- UI 要求新增一级导航、移动端无等价审核路径，或把 Draft/accepted 错示为已应用；
- required gate 失败或环境不可用却无法安全隔离。停止后保留现场、记录 unrun/风险并交由 Windows Codex/owner 决策。
