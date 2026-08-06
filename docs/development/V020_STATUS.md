# v0.2.0 当前进度快照

> 更新时间：2026-08-06（Asia/Shanghai）。
> 当前阶段：**M0、V20-01/03/07 设计包、V20-02 隔离迁移证明与 V20-04 加法合同门已通过**。
> 正式实现状态：**V20-04 已由 Codex 验收并推送检查点；合同路由继续硬失败关闭，V20-08 核心实现尚未开始**。
> 协调基线：`08babebcd5a09861106c9b05accf32bd8f2ea01c`；集成工作树分支 `codex/v020-integration`。

> 恢复记录：用户于 2026-08-06 明确要求从 V20-02 断点继续。Codex 已重新复核现有差异、PostgreSQL
> 往返/失败关闭和两项整仓遗留门禁，并补齐 handoff 与独立 observations；仍未提交或推送。

> 后续记录：用户于 2026-08-06 授权按计划继续并在必要时提交 GitHub。Codex 完成 V20-04，建立
> 默认关闭合同、休眠权限、严格 Schema、权限策略、HMAC 游标、ETag 与双桶限流原语；聚焦门禁、
> 生成门和 sync-v1 隔离门均通过。设计、迁移和合同拆为 3 个提交并已推送
> `origin/codex/v020-integration`，当前合同提交为 `5437135`。

## 总体判断

多 Agent 协调基础设施已经建立。Kimi 第一版整体动态知识空间原型已结束，用户批准按该原型
方向推进；浏览器 QA 发现的 4 项修正继续等待用户指定下一位前端模型。M0 已按推荐方案通过：
首版复用 `Resource`，citation 显式指向四类目标，`TopicDependency` 保持唯一先修关系，API
只加法、online-only、默认关闭且 sync-v1 不变，共享知识写入继续保持关闭。V20-01、V20-03 和
V20-07 已完成协调复核并获用户批准；用户随后单独授权 V20-02，Windows Codex 已完成隔离
PostgreSQL 往返、约束负测、孤儿停止、非空降级停止、备份恢复和合成规模估算。V20-04 又完成了
加法 OpenAPI/TypeScript 快照、休眠 Permission、默认关闭 Route、严格输入输出 Schema 和可独立测试的
安全原语。ORM/核心服务、生产策略和产品实现仍须按后续门禁推进。GLM
纯图内核仍只是无授权、无数据库、无游标和无服务端资源治理的候选，不计 V20-08/V20-10 完成。

不要使用虚构百分比衡量当前进度。按门禁判断：**架构 M0、第一版 UX 方向以及 V20-01/03/07
设计基线、V20-02 迁移证明与 V20-04 合同门已冻结；V20-08 正式数据路径、集成和发布门均未开启。**

## 阶段状态

| 范围                              | 状态                         | 已有证据                                                                                                                     | 下一门禁                                                          |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 多 Agent 协调闭环                 | 已完成基础能力               | `AGENTS.md`、协调 Skill/contract、状态 Schema/校验器、可验证 Runs；`codex/v011-coordination` 已推送                          | 持续按本 SOP 更新账本和快照                                       |
| V20-00 / M0 架构基础              | 已批准                       | ADR-0029 Accepted；Orca `task_5f8745a5770e` complete；五项推荐边界已冻结                                                     | 执行 V20-01/03/07 设计门，不扩大为实现授权                        |
| 旧 Kimi A/B 原型                  | 技术验收通过、产品方向已否决 | 9 个限定原型文件；23/23 Vitest、lint、typecheck、build 通过；A/B 评审包完整                                                  | 仅保留历史证据，不进入施工                                        |
| 整体动态知识空间原型              | 第一版已完成                 | Kimi 原型代码与真实浏览器 QA；Kimi 本轮任务结束                                                                              | 4 项修正等待用户指定下一位前端模型                                |
| V20-06 UI 冻结                    | 第一版方向已批准             | 用户批准按 Kimi 第一版原型规划推进                                                                                           | 前端 owner 确定后执行限定修正；不影响后端设计门                   |
| GLM bounded graph kernel          | 纯图内核模块候选验收通过     | 42 个 pytest、Ruff lint/format、mypy、空白/范围/秘密检查及四组关键运行时复现均由 Codex 独立通过                              | 保持未提交候选；正式接入须等待设计门及授权、scope、游标和资源治理 |
| V20-01/02 schema 与迁移           | V20-02 隔离证明已完成        | [`V020_MIGRATION_PROOF.md`](./V020_MIGRATION_PROOF.md)；往返/负测/恢复/规模证据已通过；migration commit `91451bd`            | ORM 登记和 `alembic check` 收口留给 V20-08                        |
| V20-03/04 permission/API/OpenAPI  | V20-04 已完成并验收          | 9 Path/11 Operation/26 Schema 纯加法；133 个聚焦测试、264 个 API 测试、合同生成/检查、sync-v1 固定哈希一致；commit `5437135` | 进入 V20-08 前复核硬失败关闭边界；不得直接启用主 Flag             |
| V20-07 保留/隐私签核              | 设计与推荐矩阵已批准         | [`V020_RETENTION_THREAT_SIGNOFF.md`](./V020_RETENTION_THREAT_SIGNOFF.md)；用户于 2026-08-05 批准，敏感能力保持关闭           | 生产启用前完成独立合规证据与 Owner 门禁                           |
| V20-08～11 核心实现               | 未开始                       | GLM 候选不计正式实现                                                                                                         | V20-00～07 必要门禁全部满足                                       |
| V20-12～15 集成、终审、回滚、发布 | 未开始                       | 无候选集成树                                                                                                                 | 核心实现完成并通过目标门禁                                        |
| DeepSeek 最终审查                 | 已打通、未派发正式终审       | 固定 OpenCode/DeepSeek V4 Flash 路径已验证                                                                                   | 等 V20-12 完整候选 diff                                           |

## 当前等待点

当前执行顺序：

1. 在基于 `08babeb…` 的隔离 Codex 集成工作树固化 M0，保持无 commit、无 push。
2. V20-01 与 V20-03 已通过异常交付恢复结算；正常 `worker_done` 未送达，不伪造该消息。
3. Windows Codex 已协调两份结果的冲突并完成 V20-07 retention/security 决策包。
4. 用户于 2026-08-05 单独授权 V20-02；迁移证明已完成，能力仍关闭，候选未提交、未推送。
5. V20-04 已完成并在本地 Run/Orca 双重结算；3 个可审查提交已推送 `codex/v020-integration`。
6. 下一后端关口是 V20-08：登记 ORM、实现 scoped repository/service、行锁内重新授权并把合同 Route
   从硬失败关闭接到只读 bounded path；Shared Write、Deletion、Attachment 与 Local Worker 仍关闭。
7. 前端修正继续等待用户指定下一位前端模型；Kimi 不再复用，DeepSeek 仍等 V20-12 终审。

## 模型所有权决定

- Kimi 只完成当前第一版整体原型设计及其原型代码；本次交接后不自动参与正式前端实现或后续版本迭代。
- 后续前端模型由用户另行指定；未指定前不得把 V20-10 前端任务派给任何外部模型。
- GLM/ZCode 继续采用手工桌面流程：用户粘贴任务提示词并启动，Windows Codex 负责任务包与验收；默认不由 Codex 操控 ZCode 图形界面。

## 已知阻塞与风险

- ADR-0029 与 V20-01/03/07 设计基线、V20-02 隔离迁移证明及 V20-04 合同门均已通过；ORM/服务、
  生产迁移、生产合规证据和敏感能力启用仍分别受独立门禁约束。
- V20-02 未登记 ORM，因此 `alembic check` 如实报告 0036 与元数据的差异；在 V20-08 收口前该候选
  不是可独立发布的候选。生产锁竞争、真实行数与恢复点也尚未验证。
- V20-04 的 11 个 Operation 只发布合同并硬失败关闭；即使误设主 Flag，也不会进入数据库。V20-08
  必须实现 scoped query、对象两端授权、锁内复核、响应字节/时间和分布式并发限制后才能讨论启用。
- 整仓测试目前为 332 passed、1 failed；唯一红项是未改动的候选发布清单仍期待迁移头 0035。
  整仓 Ruff format 还报告未改动的 `users/models.py` 一处格式差异；V20-04 限定文件格式门通过。
- V20-01/V20-03 worker 的终端交接完整，但 Windows `Path`/`PATH` 与 Orca 本地连接问题阻止了
  正常 `worker_done`；协调员已停止精确 Dispatch 并以显式恢复结果结算，未伪装正常交付通道。
- 第一版 UX 方向已批准，但 4 项浏览器 QA 修正尚未施工，且后续前端 owner 未指定。
- GLM 候选的纯内存图算法已通过模块验收，但尚无授权、Space scope、数据库查询、游标、响应
  字节、超时、速率和配额边界；不得直接作为正式 API 或 V20-08/V20-10 完成证据。
- 旧 A/B 的技术 accepted 不能误写为产品 approved。
- Kimi/GLM 均无 commit 或 push 权限；Kimi 的当前原型权限不会延续为后续前端所有权；DeepSeek 正式终审必须保持只读。

## 长期记忆位置

- 人类可读 SOP：[`AGENT_DELIVERY_WORKFLOW.md`](./AGENT_DELIVERY_WORKFLOW.md)
- 版本 DAG：[`V020_EXECUTION_PLAN.md`](./V020_EXECUTION_PLAN.md)
- 状态模型：[`AGENT_STATE_MODEL.md`](./AGENT_STATE_MODEL.md)
- 当前本地 Run：`.agents/coordination/runs/run-v020-integration`（活动指针已建立并通过校验）

状态变化后必须更新本文件并向当前 Run 追加事件；不得只在聊天中记录。

## V20-08 最新断点（2026-08-06，覆盖前述旧快照）

V20-08 bounded knowledge-space core 已由 Windows Codex 在 `codex/v020-integration` 完成并通过本地验收；V20-08 的三个 Codex 任务（核心服务、父级 scope ORM/兼容性登记、图内核回归测试）均已写入 `run-v020-core` 并接受。实现包括 SourceExcerpt/Citation ORM、Workspace/Space 授权、Private owner 隔离、Shared 写入默认关闭、ResearchClaim 当前用户约束、行锁复核、ETag、HMAC cursor、列表/图查询限额、TopicDependency 有界图读取和查询超时错误。

本轮实际证据：知识空间契约 23 passed、图内核 42 passed、迁移集成 3 passed、核心 API 集成 2 passed、候选清单 7 passed；整仓 Python 376 passed（61 integration tests 按默认门禁隔离），Ruff、Mypy、前端 lint/typecheck/test/build、contracts 与 `pnpm ci:fast` 全部通过。隔离 PostgreSQL 已完成 `upgrade head` 与 `alembic check`；临时容器仅用于验证，不代表生产迁移/备份恢复批准。

安全和发布状态保持不变：`LOGION_KNOWLEDGE_SPACE_API_ENABLED`、cursor keys 仍默认关闭/未写入仓库；Shared Write、Deletion、Attachment、Local Worker、AI Draft acceptance、Provider 和 sync-v1 均未启用或修改。图正式关系当前仅为 `TopicDependency`，Citation 图节点延后 V20-10。生产容量、备份恢复演练、DeepSeek 只读终审、浏览器 UX 验收仍是后续门禁，不能把本轮验收表述为整个 v0.2.0 完成。

长期记录：当前 Run 指针必须保持 `.agents/coordination/current-run.json -> run-v020-core`；事件、handoff、observation 和 SHA-256 证据位于 `.agents/coordination/runs/run-v020-core/`。提交/推送前继续执行最终 diff、路径越界和秘密扫描。

## V20-08 提交结果

已提交并推送：`bacc747f2e16a22c1d53e38c05878583b6a1a11f`（`feat: implement bounded knowledge-space core`）到 `origin/codex/v020-integration`。本提交只包含上述 21 个授权代码、测试和文档路径；生产启用和后续前端/DeepSeek 门禁仍未完成。
