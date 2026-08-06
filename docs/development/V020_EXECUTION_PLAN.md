# v0.2.0 执行计划：自适应知识空间架构基础

> 状态：M0 与 V20-01/03/07 已批准，V20-02 隔离迁移证明和 V20-04 加法合同门均已完成并由 Codex 验收；V20-08 核心实现尚未开始。
> 协调基线：`08babebcd5a09861106c9b05accf32bd8f2ea01c`（`codex/v011-coordination`）。
> V20-02 migration/tests 与 V20-04 default-off 合同门已完成；ORM/产品服务、生产启用、同步扩展和 Provider 配置仍受后续门禁约束。
> 当前进度：见 [`V020_STATUS.md`](./V020_STATUS.md)。

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

| ID     | Owner / 状态                                 | 单一写入范围                                                                         | 输出与进入条件                                                                                                          | 完成证据                                                                                                  |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| V20-00 | Windows Codex / 已批准                       | `docs/adr/0029-*`、本威胁模型、本计划                                                | 已冻结复用 `Resource`、显式 typed citation、唯一 `TopicDependency`、online-only/additive/default-off 与共享写入关闭边界 | ADR-0029 Accepted；Orca M0 `task_5f8745a5770e` complete                                                   |
| V20-01 | Windows Codex / 设计已批准                   | 只读 schema/migration 设计；实现须另授权                                             | 已统一不可变 excerpt/citation、四类 typed FK、scope、32 KiB/512-byte/显式 locator、索引和关闭策略                       | `V020_SCHEMA_MIGRATION_DESIGN.md`；用户于 2026-08-05 批准                                                 |
| V20-02 | Windows Codex / 隔离证明已完成               | migration/tests 独占                                                                 | 已完成 PostgreSQL 往返、31 个拒绝/回滚断言、孤儿/非空降级停止、备份恢复和 10k/表规模估算；能力保持关闭                  | `V020_MIGRATION_PROOF.md`；无 commit/push；ORM/autogenerate 留待 V20-08                                   |
| V20-03 | Windows Codex / 设计已批准                   | 只读 permission/API 设计；合同实现另行授权                                           | 已统一 accept 职责分离、不可变资源 API、ETag/version、错误码、bounded query、HMAC key rotation                          | `V020_PERMISSION_API_DESIGN.md`；用户于 2026-08-05 批准                                                   |
| V20-04 | Windows Codex / 已完成并验收                 | API 合同 Schema/安全原语、休眠权限、默认关闭路由、直接测试与 `packages/contracts/**` | 9 个新增 Path、11 个 Operation、26 个新增 Schema；旧 Path/Schema 零变化；sync-v1 六项固定制品哈希不变；路由硬失败关闭   | 133 个聚焦测试、264 个 API 测试、Ruff/Mypy、合同包测试/类型检查、`pnpm contracts:check`；commit `5437135` |
| V20-05 | Kimi K3 / 第一版原型已完成                   | 独立 Mac worktree 内限定 UX 原型/直接 UI 测试；不触碰共享数据层                      | 已交付复用 Logion 外壳的单一整体动态知识空间原型；Kimi 本轮任务结束，不承接后续前端迭代                                 | 原型代码与浏览器 QA；保留 4 项已知修正，不视为正式产品实现                                                |
| V20-06 | 产品 owner + Windows Codex / 第一版已批准    | 无并行实现写入                                                                       | 第一版按 Kimi 原型方向施工；后续前端 owner 仍由用户另行指定，数据/权限/合同继续由 Codex 控制                            | 用户明确批准第一版方向；修正项进入独立前端任务                                                            |
| V20-07 | Windows Codex + 安全/隐私 owner / 设计已批准 | threat/retention 文档；生产策略需另授权                                              | 已冻结私有/共享、审计、备份、Provider、附件、本地 Worker 的推荐保留矩阵与停止线；所有敏感能力保持关闭                   | `V020_RETENTION_THREAT_SIGNOFF.md`；用户于 2026-08-05 批准；生产合规门另行执行                            |
| V20-08 | Windows Codex / 待 01–07 必要门禁            | 核心 API/domain/repository/tests；一 writer                                          | 实现 SourceExcerpt/citation、授权、版本、删除闭包、bounded read；能力默认关闭                                           | 目标 pytest/Ruff/mypy、DB 约束与跨租户测试、代码审查                                                      |
| V20-09 | Windows Codex / 待 V20-08                    | AI Gateway adapter/domain apply/tests 独占                                           | 新任务类型、数据最小化预览、schema、stale 检查、接受原子事务、幂等/未知外呼状态                                         | 故障注入、并发/重放、预算账本、未经接受正式写入为 0                                                       |
| V20-10 | 前端 owner 待用户另行指定；服务端由 Codex    | 前后端路径不重叠；共享合同由 Codex                                                   | 1–2 跳、150/400 默认、服务端硬限、浏览器布局、移动列表/树、安全呈现、词法黄金集                                         | 查询/DoS 测试、Recall@10、axe/键盘/390px、存储型 XSS 浏览器测试                                           |
| V20-11 | Windows Codex / 默认禁用                     | attachment migration/worker security，需单独任务                                     | Resource 绑定仍走安全上传；本地租约/检查点须独立设计；BitLocker 或等价证明前不启用                                      | attachment 负测；磁盘加密/ACL/恢复/残留清理证据；核心流程在 worker offline 时通过                         |
| V20-12 | Windows Codex / 集成树                       | 测试与必要修复                                                                       | 运行下节矩阵；先 bounded 后 repository gates；基础设施缺失记为 unrun，不算通过                                          | 原始命令、退出码、结果计数、失败现场和 unrun 原因                                                         |
| V20-13 | DeepSeek V4 Flash / 只读、待 V20-12          | 无写权限                                                                             | 独立审查完整 diff：租户逃逸、约束、stale acceptance、重放/计费、XSS、DoS、sync-v1、删除/回滚；不得修文件                | 结构化 findings（severity/path/evidence/fix）；零文件变更、无 merge/push                                  |
| V20-14 | Windows Codex / 待修完 findings              | staging/隔离恢复环境                                                                 | 演练每个 checkpoint；首个正式写入后只禁用+前向修复；验证备份恢复与引用闭包                                              | upgrade/downgrade/upgrade、恢复、feature-off、孤儿扫描的观测结果                                          |
| V20-15 | Windows Codex / 最后                         | 集成 worktree；ledger 仅 Codex                                                       | 复核所有 handoff/diff/secret/path；运行最终 gates；只有授权后 commit/merge/push                                         | acceptance manifest、commit SHA（若授权）、未运行项、残余风险、清理清单                                   |

### ZCode 状态

ZCode/GLM-5.2 为手工桌面客户端。它已在独立 Windows worktree 基于协调基线交付纯 Python
bounded graph kernel 候选。第三次交接完成了唯一边方向保留、同向重复保留、反向歧义规范化、
冲突优先级和文档/格式收口；Windows Codex 独立观察到 42 个目标 pytest、Ruff lint/format、
mypy、未跟踪文件空白检查、范围/秘密扫描以及四组关键运行时复现全部通过。因此该产物状态为
**纯图内核模块候选验收通过**，仍是 3 个未跟踪文件、无 commit、无 push。它不含授权、Space
scope、数据库生产者、安全游标、响应字节、超时、速率或配额治理，所以不计为 V20-08/V20-10
正式实现，也不得直接挂入 API。ZCode 继续不得处理 auth、迁移批准、合同所有权、Provider、
秘密、merge 或 push。

## 4. 迁移、OpenAPI 与回滚关口

1. **M0 设计冻结**：ADR-0029 接受或以新决策替代；Source 身份、target DDL、permission、保留和 API 版本表达明确。未完成停止。
   当前状态：**已通过**。Source 复用 `Resource`；target 类型、online-only/additive/default-off、sync-v1 不变与共享写入关闭均已冻结；V20-01/03/07 设计于 2026-08-05 获用户批准。
2. **M1 迁移前**：生产式备份/恢复演练、基线行数和孤儿检查；迁移只加法且可 downgrade。任何数据修复需独立审查。
3. **M2 schema-only**：部署表/约束/索引但能力关闭；实际 upgrade/downgrade/upgrade 通过，锁时长/磁盘预算可接受。
   当前状态：**隔离证明通过，生产门未通过**。临时 PostgreSQL 的备份恢复、往返、行数、孤儿停止、
   非空降级门和合成规模已验证；真实生产恢复点、行数、锁竞争和磁盘预算仍须在生产变更审批后重做。
4. **C1 OpenAPI**：运行 generate/check 并人工审查；只允许批准的加法。auth、Space permission、sync-v1 或非预期生成差异立即停止。
   当前状态：**已通过**。语义比较只有 9 个新增 Path 和 26 个新增 Schema，旧 Path/Schema 无删除、无变化；
   TypeScript 快照可重现，sync-v1 六项固定制品哈希与实施前完全一致。合同路由仍硬失败关闭，不能视为
   V20-08 数据路径或生产启用。
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

Kimi 只负责当前第一版整体审批原型及其原型代码：AI 虚线/正式实线、来源详情、接受/编辑/拒绝、online-only、移动列表/树、可访问性与响应式。本次原型交接后，Kimi 不再作为后续正式前端实现或版本迭代的默认 owner；后续模型由用户另行指定。Kimi 不定义共享数据模型、permission、迁移、OpenAPI、AI Provider/路由、保留或一级导航，也不 merge/push。

ZCode/GLM 默认由用户在桌面客户端中手工粘贴 Windows Codex 提供的完整任务包并启动执行；Windows Codex 只负责任务设计、Git 范围与独立验收。除非用户另外明确授权桌面控制，不由协调员远程操作 ZCode 图形界面。

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

## V20-08 当前执行覆盖（2026-08-06）

V20-08 已进入“核心实现完成、后续门禁未完成”状态。Codex 已在集成 worktree 完成并接受三个串行任务：

1. `task-v020-core`：知识空间 ORM（本包）、scoped service/repository、只读 bounded routes、ETag/HMAC cursor、行锁、速率/字节/候选行/时间限制、TopicDependency 图查询、负测与集成测试。
2. `task-v020-model-registration`：现有 `Space`/`Resource`/`Note`/`Topic`/`QuizItem`/`PaperRecord`/`AIOutputDraft` 的父级 scope ORM 登记及候选发布清单迁移头兼容性更新。
3. `task-v020-graph-kernel`：bounded graph kernel 回归测试的独立路径归属与 42 项测试验收。

三项任务共用 `codex/v020-integration` 单一 writer，writable paths 不重叠；完整事件、handoff、observation 和摘要 SHA-256 记录在 `.agents/coordination/runs/run-v020-core/`。本轮证据已通过：契约 23、图内核 42、迁移 3、核心集成 2、候选清单 7、整仓 Python 376，以及 Ruff/Mypy/前端/合同/`pnpm ci:fast`。

下一顺序固定为：最终 diff/secret/path review → 提交 `codex/v020-integration` → 推送 GitHub → 记录 commit/push 与未运行项 → 再进入 V20-09/V20-10/V20-12。Shared Write、删除、附件、本地 worker、AI Draft acceptance、生产启用和前端后续 owner 仍不得提前开启；DeepSeek 仅在 V20-12 后做只读终审。

本轮已完成 commit/push：`bacc747f2e16a22c1d53e38c05878583b6a1a11f`，远端分支为 `origin/codex/v020-integration`。后续工作必须从该 SHA 继续，并重新通过 V20-12 集成门后才能派发 DeepSeek 终审。
