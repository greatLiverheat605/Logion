# v0.2.0 当前进度快照

> 更新时间：2026-08-09（Asia/Shanghai）。
> 当前阶段：**V20-01～V20-14 已通过 Codex 验收；V20-15 候选已在 ECS 进入受控 prerelease 观察期，生产正式发布、邮件投递验收和流量切换仍未完成，敏感生产能力继续关闭**。
> 正式实现状态：**V20-08/V20-09 与 V20-10 服务端、前端首版均已进入 `codex/v020-integration`；知识空间 API、Shared Write、Deletion、Attachment、Local Worker、Provider、sync-v1 与 AI Acceptance 生产开关继续默认关闭**。
> 协调基线：集成工作树分支 `codex/v020-integration`；当前候选 source SHA：`448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；前端代码检查点仍由该候选固定。

## PR #198 integration follow-up（2026-08-08）

- 修复提交 `93eae8d` 后，GitHub Actions run `31254465425` 仅剩知识空间核心集成测试的 `POST /knowledge/search` 返回 404；图谱读取已通过。
- 根因是测试夹具只打开知识空间 API，却没有配置 HMAC 分页游标密钥；首次搜索需要生成 `next_cursor` 时，服务按 fail-closed 规则返回资源不存在。生产默认配置未改变。
- 提交 `dab9fcb` 为该夹具提供仅测试用的 32 字节游标密钥。其后的 run `31255160930` 在同一 head SHA `dab9fcbf0e4cac132a82ac0034e69addd64ab0ab` 上，integration、browser、fast 三个 job 全部成功；迁移往返、全量集成、真实认证浏览器、无障碍/响应式检查、`pnpm audit`、`pip-audit` 与 `pnpm ci:fast` 均由 CI 实际执行并通过。
- 本机窄集成测试仍因未运行且凭据不匹配的 PostgreSQL 无法执行；该限制不影响 CI 的真实 PostgreSQL 验收，也未启动 Docker。所有敏感生产开关继续关闭。

> 恢复记录：用户于 2026-08-06 明确要求从 V20-02 断点继续。Codex 已重新复核现有差异、PostgreSQL
> 往返/失败关闭和整仓遗留门禁，完成 V20-08/V20-09 实现、独立验收、提交与推送。

> 后续记录：用户于 2026-08-06 授权按计划继续并在必要时提交 GitHub。Codex 完成 V20-04，建立
> 默认关闭合同、休眠权限、严格 Schema、权限策略、HMAC 游标、ETag 与双桶限流原语；聚焦门禁、
> 生成门和 sync-v1 隔离门均通过。设计、迁移和合同拆为 3 个提交并已推送
> `origin/codex/v020-integration`，当前合同提交为 `5437135`。

## 总体判断

多 Agent 协调基础设施已经建立。Kimi 第一版整体动态知识空间原型已结束，用户批准按该原型
方向推进，并随后明确指定 Mac OpenCode Go 的 Kimi K2.7-code 完成本次正式前端首版施工。Windows Codex
已接管结果，将受控原型入口、真实 Review 数据适配、只读动态图谱、移动列表、键盘交互和状态面板集成到
`codex/v020-integration`；审查发现并修复了正式节点全部落在 `(0,0)` 的重叠问题，同时补齐仓库格式门。
M0 已按推荐方案通过：
首版复用 `Resource`，citation 显式指向四类目标，`TopicDependency` 保持唯一先修关系，API
只加法、online-only、默认关闭且 sync-v1 不变，共享知识写入继续保持关闭。V20-01、V20-03 和
V20-07 已完成协调复核并获用户批准；用户随后单独授权 V20-02，Windows Codex 已完成隔离
PostgreSQL 往返、约束负测、孤儿停止、非空降级停止、备份恢复和合成规模估算。V20-04 又完成了
加法 OpenAPI/TypeScript 快照、休眠 Permission、默认关闭 Route、严格输入输出 Schema 和可独立测试的
安全原语。ORM/核心服务及本次前端首版已经集成；生产策略、V20-11 准入评审和发布仍须按后续门禁推进。GLM
纯图内核仍只是无授权、无数据库、无游标和无服务端资源治理的候选，不计 V20-08/V20-10 完成。

不要使用虚构百分比衡量当前进度。按门禁判断：**架构 M0、第一版 UX 方向以及 V20-01/03/07
设计基线、V20-02 迁移证明、V20-04 合同门、V20-08 核心数据路径、V20-09 接受闭环与 V20-10
真实栈浏览器/移动安全门、V20-11 默认关闭准入、V20-12 集成门、V20-13 只读终审与 V20-14
隔离回滚演练已冻结；V20-15 发布门尚未完成。**

## 阶段状态

| 范围                              | 状态                                                 | 已有证据                                                                                                                                                                                                                                           | 下一门禁                                                          |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 多 Agent 协调闭环                 | 已完成基础能力                                       | `AGENTS.md`、协调 Skill/contract、状态 Schema/校验器、可验证 Runs；`codex/v011-coordination` 已推送                                                                                                                                                | 持续按本 SOP 更新账本和快照                                       |
| V20-00 / M0 架构基础              | 已批准                                               | ADR-0029 Accepted；Orca `task_5f8745a5770e` complete；五项推荐边界已冻结                                                                                                                                                                           | 执行 V20-01/03/07 设计门，不扩大为实现授权                        |
| 旧 Kimi A/B 原型                  | 技术验收通过、产品方向已否决                         | 9 个限定原型文件；23/23 Vitest、lint、typecheck、build 通过；A/B 评审包完整                                                                                                                                                                        | 仅保留历史证据，不进入施工                                        |
| 整体动态知识空间原型              | 已作为受控演示入口集成                               | Kimi 原型代码、既有浏览器 QA、正式施工提交 `5d737b7`；生产视图不默认使用 mock                                                                                                                                                                      | 保留演示边界；未来迭代 owner 仍由用户另行指定                     |
| V20-06 UI 冻结                    | 第一版方向与首版实现已集成                           | 用户批准 Kimi 第一版方向，并一次性指定 Kimi K2.7-code 施工；Codex 审查修正 `7a93ac9`，Nightly #40 真实浏览器门禁已通过                                                                                                                             | 进入 V20-11，前端后续 owner 仍由用户指定                          |
| GLM bounded graph kernel          | 纯图内核模块候选验收通过                             | 42 个 pytest、Ruff lint/format、mypy、空白/范围/秘密检查及四组关键运行时复现均由 Codex 独立通过                                                                                                                                                    | 保持未提交候选；正式接入须等待设计门及授权、scope、游标和资源治理 |
| V20-01/02 schema 与迁移           | V20-02 隔离证明已完成                                | [`V020_MIGRATION_PROOF.md`](./V020_MIGRATION_PROOF.md)；往返/负测/恢复/规模证据已通过；migration commit `91451bd`                                                                                                                                  | ORM 登记和 `alembic check` 收口留给 V20-08                        |
| V20-03/04 permission/API/OpenAPI  | V20-04 已完成并验收                                  | 9 Path/11 Operation/26 Schema 纯加法；133 个聚焦测试、264 个 API 测试、合同生成/检查、sync-v1 固定哈希一致；commit `5437135`                                                                                                                       | 进入 V20-08 前复核硬失败关闭边界；不得直接启用主 Flag             |
| V20-07 保留/隐私签核              | 设计与推荐矩阵已批准                                 | [`V020_RETENTION_THREAT_SIGNOFF.md`](./V020_RETENTION_THREAT_SIGNOFF.md)；用户于 2026-08-05 批准，敏感能力保持关闭                                                                                                                                 | 生产启用前完成独立合规证据与 Owner 门禁                           |
| V20-08 bounded core               | 已完成并推送                                         | Codex 独立验收；核心 ORM、授权、bounded read、图内核与整仓门禁均有证据                                                                                                                                                                             | 保持默认关闭；进入 V20-09/V20-10 后续门禁                         |
| V20-09 AI acceptance              | 已完成并推送                                         | 候选/收据迁移、RFC 8785 幂等 hash、事务锁定、并发/重放/stale 测试、整仓门禁均有证据                                                                                                                                                                | 进入 V20-10；Acceptance 生产开关继续关闭                          |
| V20-10 graph/search/rendering     | 已完成并通过 Nightly 真实栈验收                      | Nightly #40：`31147645530`，目标 SHA `64298ec597b6e45dfea9a94cc819c77daf0cda8b`；审计、Compose、迁移/空环境恢复、认证 Playwright、1440/390px、axe、移动节点、桌面图谱键盘导航、持久化主题值 XSS 防护全部通过                                       | 进入 V20-11 默认关闭准入评审，生产开关继续关闭                    |
| V20-11 默认关闭准入               | 已通过，生产能力继续关闭                             | 常驻 loopback clamd、加密卷/ACL、附件 clean/malware/fail-closed、Local Worker crash/upload 恢复、worker-offline 核心流、迁移、整仓门禁和依赖审计均有真实证据；协调 Run 已完成接受                                                                  | 保持全部生产开关关闭；进入 V20-12 集成门                          |
| V20-12～15 集成、终审、回滚、发布 | V20-12～V20-14 已通过；V20-15 候选已部署为 prerelease，生产正式发布仍阻塞 | [`V020_V15_ACCEPTANCE_MANIFEST.md`](./V020_V15_ACCEPTANCE_MANIFEST.md)；同 SHA provenance、Docker smoke、恢复、认证浏览器/WCAG 与候选 ECS 迁移/健康证据均已记录；真实邮件投递、24 小时观察与最终流量切换仍未完成 | 完成受邀真实邮件/设备验收、观察期和发布授权后再决定是否切换 |
| DeepSeek 最终审查                 | 已完成并由 Codex 接受                                | `task_66a2bdb9ab08` / `ctx_ce22e673e7fd`；审查目标 `7d50e675be19b2779613ed61ba31dc821afa73dc`；详见 [`V020_V13_DEEPSEEK_REVIEW.md`](./V020_V13_DEEPSEEK_REVIEW.md)                                                                                 | 不再派发；保留只读报告与清洁工作树证据                            |

## 当前等待点

当前执行顺序：

1. 在 `codex/v020-integration` 继续由 Windows Codex 单一 writer 集成；当前前端检查点为 `64298ec597b6e45dfea9a94cc819c77daf0cda8b`。
2. V20-01 与 V20-03 已通过异常交付恢复结算；正常 `worker_done` 未送达，不伪造该消息。
3. Windows Codex 已协调两份结果的冲突并完成 V20-07 retention/security 决策包。
4. 用户于 2026-08-05 单独授权 V20-02；迁移证明已完成，能力仍关闭。
5. V20-04、V20-08 与 V20-09 已完成并推送 `codex/v020-integration`；提交前后均通过整仓门禁。
6. V20-10 服务端、前端与真实 `127.0.0.1:8080` 栈验收均已完成；Nightly #40 对固定提交
   `64298ec597b6e45dfea9a94cc819c77daf0cda8b` 全绿。Shared Write、Deletion、Attachment 与 Local Worker 仍关闭。
7. V20-11 硬停止证据已补齐并由 Windows Codex 独立复核；当前 Run 为
   `.agents/coordination/runs/run-v020-v11-remediation`。生产开关继续关闭，V20-12 默认关闭任务节点已建立。
8. V20-13 DeepSeek 只读终审已完成：无 High/Medium，5 个 Low/Info 已由 Windows Codex 修复并通过目标测试、整仓门禁、依赖审计、迁移检查及真实附件栈复核；审查工作树已恢复 clean。
9. V20-14 隔离回滚演练已完成并接受；V20-15 Release candidate、同 SHA 镜像 provenance attestation 与 exact-candidate security scan 已通过，生产发布仍等待用户批准。本次正式首版前端由用户一次性指定 Kimi K2.7-code 完成；未来迭代 owner 仍待用户另行指定。

## 模型所有权决定

- 用户后续明确覆盖原限制，一次性指定 Kimi K2.7-code 完成本次正式前端首版；该任务已经结束。
- 这次授权不延续为未来版本所有权；后续前端模型仍由用户另行指定。
- GLM/ZCode 继续采用手工桌面流程：用户粘贴任务提示词并启动，Windows Codex 负责任务包与验收；默认不由 Codex 操控 ZCode 图形界面。

## 已知阻塞与风险

- ADR-0029 与 V20-01/03/07 设计基线、V20-02 隔离迁移证明及 V20-04 合同门均已通过；ORM/服务、
  生产迁移、生产合规证据和敏感能力启用仍分别受独立门禁约束。
- V20-09 已登记 `0037_knowledge_acceptance` ORM；当前 `alembic check` 已通过。生产锁竞争、真实行数、
  生产恢复点与容量预算仍未验证，Acceptance 生产开关保持关闭。
- V20-04 的 11 个 Operation 只发布合同并硬失败关闭；V20-08 已实现 scoped query、对象两端授权、
  锁内复核、响应字节/时间和并发限制。V20-09 Acceptance 仍独立 fail-closed，未进入生产启用讨论。
- 整仓 `pnpm ci:fast` 已通过：协调状态、格式、lint、类型、377 个 Python 测试、前端测试/构建与合同检查
  均为绿色；默认门禁仍隔离 62 个 integration tests，V20-09 目标集成测试另行通过。
- V20-01/V20-03 worker 的终端交接完整，但 Windows `Path`/`PATH` 与 Orca 本地连接问题阻止了
  正常 `worker_done`；协调员已停止精确 Dispatch 并以显式恢复结果结算，未伪装正常交付通道。
- 第一版 UX 方向和正式首版代码已集成；两条认证 Playwright 用例可发现，但因本机没有
  `127.0.0.1:8080` API/Web 栈且本轮不启动 Docker，真实浏览器执行记为 unrun，不计通过。
- GLM 候选的纯内存图算法已通过模块验收，但尚无授权、Space scope、数据库查询、游标、响应
  字节、超时、速率和配额边界；不得直接作为正式 API 或 V20-08/V20-10 完成证据。
- 旧 A/B 的技术 accepted 不能误写为产品 approved。
- Kimi/GLM 均无 commit 或 push 权限；Kimi 只产出工作树差异，提交与推送均由 Windows Codex 完成；
  本次一次性前端授权不会延续为后续版本所有权；DeepSeek 正式终审必须保持只读。

## 长期记忆位置

- 人类可读 SOP：[`AGENT_DELIVERY_WORKFLOW.md`](./AGENT_DELIVERY_WORKFLOW.md)
- 版本 DAG：[`V020_EXECUTION_PLAN.md`](./V020_EXECUTION_PLAN.md)
- 状态模型：[`AGENT_STATE_MODEL.md`](./AGENT_STATE_MODEL.md)
- 当前本地 Run：`.agents/coordination/runs/run-v020-v11-remediation`（活动指针已建立并通过校验；旧审查 Run 已关闭）

状态变化后必须更新本文件并向当前 Run 追加事件；不得只在聊天中记录。

## V20-15 最终发布门记录（2026-08-08）

候选提交 `0b66e033c822bdcd759af8cd19e9ec9ead4eba94` 的 acceptance manifest 已建立，且在非生产
隔离 PostgreSQL/Redis/API/Web/普通后台 Worker 上完成实时复核，记录完整
基线、差异/路径/秘密复核、整仓门禁、依赖审计、历史真实栈证据、未运行项、残余风险和清理边界，
详见 [`V020_V15_ACCEPTANCE_MANIFEST.md`](./V020_V15_ACCEPTANCE_MANIFEST.md)。本门不自动发布、不
merge、不启动 Docker，也不启用敏感生产能力；实时 PostgreSQL/认证浏览器、镜像签名/attestation
和发布授权必须在用户明确批准后另行执行。

## V20-15 发布准备复核（2026-08-08）

- 非 C 盘临时工具目录中的 Gitleaks `8.30.1` 已对当前仓库完整 Git 历史执行秘密扫描：406 个提交、
  约 15.74 MB，0 条泄漏；报告未写入仓库。
- GitHub 官方状态为 `All Systems Operational`。公开只读核对确认当前默认分支为 `main`，但当前
  `codex/v020-integration` 候选尚无同一 source SHA 的成功 Main candidate 与 full-capacity 运行；
  现有成功 Release/Capacity 运行属于 `main` 旧提交 `ebf93ee192598430393f93e9313665c36446f84e`，
  不可复用。
- GitHub CLI 未登录，本轮未触发 workflow_dispatch；没有创建镜像、签名/attestation、Docker release
  smoke，也没有 merge、发布或开启 Attachment、Local Worker、Shared Write、Deletion、Provider、
  sync-v1、AI Acceptance。V20-15 仍是候选可接受、生产发布阻塞。

## V20-08 最新断点（2026-08-06，覆盖前述旧快照）

V20-08 bounded knowledge-space core 已由 Windows Codex 在 `codex/v020-integration` 完成并通过本地验收；V20-08 的三个 Codex 任务（核心服务、父级 scope ORM/兼容性登记、图内核回归测试）均已写入 `run-v020-core` 并接受。实现包括 SourceExcerpt/Citation ORM、Workspace/Space 授权、Private owner 隔离、Shared 写入默认关闭、ResearchClaim 当前用户约束、行锁复核、ETag、HMAC cursor、列表/图查询限额、TopicDependency 有界图读取和查询超时错误。

本轮实际证据：知识空间契约 23 passed、图内核 42 passed、迁移集成 3 passed、核心 API 集成 2 passed、候选清单 7 passed；整仓 Python 376 passed（61 integration tests 按默认门禁隔离），Ruff、Mypy、前端 lint/typecheck/test/build、contracts 与 `pnpm ci:fast` 全部通过。隔离 PostgreSQL 已完成 `upgrade head` 与 `alembic check`；临时容器仅用于验证，不代表生产迁移/备份恢复批准。

安全和发布状态保持不变：`LOGION_KNOWLEDGE_SPACE_API_ENABLED`、cursor keys 与
`LOGION_KNOWLEDGE_SPACE_AI_ACCEPTANCE_ENABLED` 均默认关闭/未启用；Shared Write、Deletion、Attachment、
Local Worker、Provider 和 sync-v1 均未启用或修改。图正式关系当前仅为 `TopicDependency`，Citation 图节点
延后 V20-10。生产容量、备份恢复演练、DeepSeek 只读终审、浏览器 UX 验收仍是后续门禁，不能把本轮验收表述为整个 v0.2.0 完成。

长期记录：当前 Run 指针为 `.agents/coordination/current-run.json -> run-v020-v11-remediation`；本轮修复事件、handoff、observation 和 SHA-256 证据位于 `.agents/coordination/runs/run-v020-v11-remediation/`，第一轮只读审查保留在已关闭的 `run-v020-v11-review/`。提交/推送前继续执行最终 diff、路径越界和秘密扫描。

## V20-08 提交结果

## V20-09 完成记录（2026-08-06）

V20-09 已完成第一版后端闭环实现并通过 Codex 验收，能力仍保持默认关闭：

- `AIOutputDraftCandidate` 保存 AI 生成的最小证据候选、目标类型/版本和 Excerpt hash/source-version 快照；候选必须先落在 Draft scope 内，不能由 Provider 直接写正式 Citation。
- `KnowledgeAcceptanceReceipt` 以 `(workspace, accepted_by, idempotency_key)` 唯一约束保存只含 ID 与摘要 hash 的收据；相同 key+相同规范 payload 返回原收据，不同 payload 返回 `KNOWLEDGE_IDEMPOTENCY_CONFLICT`。
- Acceptance 在单一事务内重新授权并按确定顺序锁定 Space、Draft、Candidate、Excerpt 和 typed Target，所有版本/hash/status 检查完成后才创建正式 `KnowledgeCitation`、Receipt 和最小 Audit；任何 stale/冲突均保持正式写入为 0。
- 规范 payload hash 使用 RFC 8785，候选/期望集合按 ID 排序后计算；可选 `If-Match` 与 `expected_draft_version` 同时校验。接受逻辑不导入 Provider，也不自动重试未知外呼状态。
- 新增 `LOGION_KNOWLEDGE_SPACE_AI_ACCEPTANCE_ENABLED`，默认 `false`；即便主知识空间 flag 打开，Acceptance 路由仍 fail-closed，Shared Write、Deletion、Attachment、Local Worker、Provider 和 sync-v1 继续关闭。

本轮新增证据：Acceptance 集成 1 passed（并发同 key、同 key 重放、不同 payload 冲突、stale 全回滚），规范 hash 单测 1 passed；候选清单 7 passed；Ruff check/format、Mypy、`git diff --check`、`alembic check` 与整仓 `pnpm ci:fast` 全部通过。此前隔离 PostgreSQL 已完成 `0036 -> 0037` upgrade 往返验证。V20-09 已通过 Codex 验收，但不能把本轮表述为整个 v0.2.0 完成。

V20-08 提交并推送：`bacc747f2e16a22c1d53e38c05878583b6a1a11f`；V20-09 提交并推送：`e4dc335b922ea15ce976299c000b9bc061588306`（`feat: close AI knowledge acceptance loop`）。V20-10 已完成并推送；生产启用、V20-11 与后续 DeepSeek 门禁仍未完成。

## V20-10 后端增量与真实栈验收记录（2026-08-07）

本轮 V20-10 已完成代码与真实栈验收，但不代表整个 v0.2.0 发布完成：

- 已补齐知识空间词法搜索合同与实现：`POST /knowledge/search`，按 Space/当前用户授权，支持 Topic、QuizItem、当前用户 ResearchClaim、Note 四类目标；每类候选行、结果数、字节数、查询时间和 HMAC Cursor 均有界。
- 已修复图 route 对 `cursor` 的丢弃：请求现在会校验签名、范围、过滤器和 BFS keyset 位置，并使用签名快照时间边界读取候选图。当前不发放无法证明安全的图续页 Cursor，`next_cursor` 保持可为空，避免伪造“还有全局数量”的语义。
- OpenAPI/TypeScript 合同已按加法方式生成，未新增 sync-v1、Vault 或 Outbox。用户后续一次性指定
  Kimi K2.7-code 完成本次正式前端首版，Windows Codex 已将结果接入同一集成分支。
- 已观察：知识空间契约 27 passed、图内核 42 passed；开启测试专用知识空间 flag、Origin、独立测试 Redis 与 Cursor key 后，核心集成 2 passed，并覆盖跨 Space Topic 与共享 Space 内 ResearchClaim 当前用户隔离。全量 `pnpm test` 通过（381 passed, 62 deselected），前端 lint/typecheck/test/build、Python Ruff/Mypy 亦通过；提交后 `pnpm contracts:check` 与 `pnpm ci:fast` 均通过。
- 另修复了 Cursor Base64URL 非规范编码可绕过篡改负测的问题；解码现在要求规范编码，统一 fail-closed。

设计细节见 [`V020_GRAPH_SEARCH_RENDERING_DESIGN.md`](./V020_GRAPH_SEARCH_RENDERING_DESIGN.md)。当前已补充跨 Space/用户 ResearchClaim 隔离、控制字符/通配符、搜索与图 Cursor 非法位置/过滤器复用负测，并通过全量 Python 与前端门禁；服务端增量已提交并推送，提交为 `bfb4d35`（代码）与 `dfaaf5a`（状态文档）。

前端首版施工由 Mac OpenCode Go 的 Kimi K2.7-code 在独立工作树完成，原始提交由 Windows Codex
接管为 `5d737b7`。正式实现保留 `/app/knowledge-prototype` 受控演示入口，并在 ReviewCenter 中用
真实 Topic/TopicDependency/Mastery 数据驱动只读动态图谱，不把 mock 数据作为生产默认值，也不暴露
原型审批操作。Codex 审查发现真实节点被 `(0,0)` 占位坐标误判为已有布局，已改为可选坐标并增加
位置分散断言；同时把复习安排查找从逐节点扫描改为索引，审查修正提交为 `7a93ac9`。

已观察的前端与真实栈证据：Prettier、ESLint、TypeScript、44 个测试文件/224 个 Vitest 用例、生产构建和
`git diff --check` 通过；Nightly #40 在 GitHub Actions 官方状态恢复后针对固定提交
`64298ec597b6e45dfea9a94cc819c77daf0cda8b` 执行并通过。作业 `92770353461` 的 `pnpm audit`、
`pip-audit`、许可证策略、Compose smoke、migration/empty-environment restore、真实认证
Playwright、1440/390px 横向溢出、axe 无障碍、移动节点列表、桌面图谱键盘导航与持久化主题值
XSS 防护均为实际通过；运行记录：
<https://github.com/greatLiverheat605/Logion/actions/runs/31147645530>。

V20-10 收口后，下一步转入 V20-11 默认关闭准入评审。Shared Write、Deletion、Attachment、Local
Worker、Provider、sync-v1 与 AI Acceptance 的生产开关继续关闭；未取得 V20-11 证据前不得进入
V20-12 或启用任何本地执行/附件生产路径。

## V20-11 默认关闭准入评审记录（2026-08-07）

第一轮只读审查已执行，结论为硬停止，未进入 V20-12：

- `uv run --group dev pytest tests/test_compose_attachment_boundary.py tests/test_backup_bundle.py -q`：7 passed，覆盖附件初始化最小权限、只读消费者、备份挂载与 staging 排除。
- `pnpm --filter @logion/offline test`：7 个文件、55 tests passed；该结果证明 offline library 的加密/校验/同步边界，不等同于 Local Worker 准入。
- 当前设计与配置继续保持 `knowledge_space_attachment_ingest_enabled=false`、`knowledge_space_local_worker_enabled=false` 及其他敏感能力关闭；本轮未启动本机 Docker。
- 未运行且不可记为通过：Attachment migration 与 Malware/Polyglot corpus；准确 Volume 的 BitLocker 或等价静态加密、Recovery/ACL 证明；Lease 绑定、Crash/Reboot/上传中断残留清理；worker offline 时认证知识核心流程。

硬停止原因是上述任一项缺失都违反 V20-07/V20-11 的明确停止条件。协调记录位于
`.agents/coordination/runs/run-v020-v11-review/`，任务 handoff 标记为 `blocked`；在补齐证据并重新验收前，
不得启用 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 生产路径。

## V20-11 默认关闭边界修复记录（2026-08-07）

本轮只修复与验证默认关闭边界，不宣称 V20-11 已通过：

- `Settings` 新增 `knowledge_space_attachment_ingest_enabled` 与
  `knowledge_space_local_worker_enabled`，默认均为 `false`；两者在主知识空间 flag 关闭时拒绝启用。
- 附件初始化、上传、完成和下载路由现在统一先经过附件准入 flag；关闭时返回
  `KNOWLEDGE_ATTACHMENT_INGEST_DISABLED`、`404` 和 `Cache-Control: private, no-store`，不会触发认证、限流或文件访问。
- 附件验证失败后立即 best-effort 删除 staging 对象；若文件系统暂时不可用，数据库仍保持 `failed`，后续残留清扫仍是待完成门禁。
- 实际通过：`uv run --package logion-api pytest apps/api/tests/test_knowledge_space_contract.py apps/api/tests/test_attachments.py -q`
  （40 passed）；Ruff check/format 与 Mypy（4 个源文件）均通过；Compose 附件边界/备份测试 7 passed；offline 包 55 tests passed。
- 已在完整测试环境变量下重跑真实附件集成；注册阶段返回 `503 AUTH_RATE_LIMIT_UNAVAILABLE`，原因是本机 Redis
  服务不可用，附件断言没有执行；该结果不计为通过。迁移集成同样因本机 PostgreSQL 连接被拒绝而未执行断言。
- 本轮修复已由 Codex 提交并推送：`69a7c58`（`fix(api): enforce V20-11 default-closed boundaries`）。

以下硬停止仍未改变：准确 Volume 的 BitLocker/等价加密、Recovery/ACL 证据，Attachment migration 与
Malware/Polyglot corpus，Lease 绑定及 Crash/Reboot/上传中断残留清理，以及 worker offline 时认证知识核心流程。
在这些证据齐备前，不进入 V20-12，也不打开任何生产敏感开关。

## V20-11 环境复核记录（2026-08-07）

本轮环境复核的完整证据见 [`V020_V11_ENVIRONMENT_EVIDENCE.md`](./V020_V11_ENVIRONMENT_EVIDENCE.md)。结论仍为硬停止：

- 本地单元、默认关闭边界和 offline 包检查保持通过；完整测试环境变量已正确注入。
- Redis 不可用导致真实附件协议在注册阶段返回 `AUTH_RATE_LIMIT_UNAVAILABLE`；PostgreSQL 不可用导致迁移集成的 3 个断言连接被拒绝。两者均记录为未执行，不计为通过。
- 本机 `C:` 卷为未加密状态，不能作为生产附件卷加密证明；恢复密钥、准确命名卷 ACL、恶意/Polyglot 语料、Local Worker 租约/残留与 offline 核心流程仍缺证据。
- 继续保持 `knowledge_space_attachment_ingest_enabled=false`、`knowledge_space_local_worker_enabled=false` 及其余敏感生产开关关闭；不启动本机 Docker，不进入 V20-12。

## V20-11 方案 1 本机环境复核与真实集成补证（2026-08-07）

用户已批准方案 1：在非 C 盘建立隔离验收环境，恢复密钥保存到桌面。该环境仅用于验收，不改变生产开关：

- G: 上创建 `LogionV20.vhdx`，挂载为 J:；J: 使用 BitLocker XTS-AES 256，100% 已加密且 Protection On。恢复密钥仅保存于桌面，未进入仓库、Git 历史或协调账本。
- PostgreSQL 与 Redis 均由 G: 安装并使用 J: 数据目录；完整测试环境变量从加密卷读取。未启动 Docker。
- `test_attachment_integration.py`：1 passed；`test_knowledge_space_migration_integration.py`：3 passed；知识空间核心 + AI acceptance 组合：3 passed。此前因服务未启动导致的失败 observation 保留，新的成功 observation 已追加到 `run-v020-v11-remediation`。
- `pnpm audit --prod --audit-level high`、`pip-audit`、`pnpm ci:fast`、Compose/备份边界与 offline 包检查均通过。`J:\Attachments`/`staging`/`verified` ACL 已收紧，当前无 `.part` 残留；ClamAV 对干净 Polyglot/HTML/PNG/文本语料扫描退出码为 0。

本轮仍不能宣称 V20-11 或整个 v0.2.0 发布通过：尚缺经批准的恶意样本检测命中证据，以及 Local Worker 的 lease 绑定、撤销/过期拒绝、Crash/Reboot/上传中断残留清理和 worker-offline 时真实认证核心流程。`knowledge_space_attachment_ingest_enabled`、`knowledge_space_local_worker_enabled`、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭；在上述门禁补齐前不进入 V20-12。

## V20-11 隔离安全内核与在线脱离验证（2026-08-07）

- 新增 `apps/worker/src/logion_worker/local_worker_security.py` 作为未来 Local Worker 的隔离候选内核；它只处理短期租约、scope/input hash 绑定、单调 checkpoint、终态清理和残留清扫，不接 API、数据库、Provider 或生产开关。
- 新增 6 项安全内核测试：`uv run --package logion-worker pytest apps/worker/tests/test_local_worker_security.py -q` 通过；Worker 测试集合 30 passed（4 deselected）。新增模块 Ruff、format、mypy 均通过。整个 Worker 包的严格 mypy 仍受既有 workspace `logion-api` 未提供 `py.typed` 标记影响，未将该既有问题写成新增模块失败。
- ClamAV 临时 loopback daemon 从内存流式扫描标准 EICAR，实际命中 `Eicar-Test-Signature FOUND`；J: 上干净 PDF/HTML、PNG/PDF、纯文本语料均 `OK`。临时配置、日志、PID 和进程已清理，未关闭 Windows Defender，未将样本写入仓库。
- 在 Local Worker 进程不运行时，PostgreSQL/Redis 仍可用，知识空间核心 + AI acceptance 真实集成 3 passed，证明在线核心不依赖本地 Worker。

本轮仍不进入 V20-12：缺少真实远端 Local Worker lease/revoke API、job/Space/输入摘要协议、生产 Crash/Reboot/上传中断恢复和正式扫描器接入/处置演练。新增内核仅作为下一阶段设计候选；`knowledge_space_local_worker_enabled`、Attachment、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## V20-11 隔离内核加固与接入合同（2026-08-07）

- `apps/worker/src/logion_worker/local_worker_security.py` 继续保持隔离候选定位；新增检查点大小上限、允许文件名、未知工件拒绝、符号链接拒绝和 `fsync` 后原子替换。新增回归后，Local Worker 安全内核 8 passed，Worker 包 32 passed、4 deselected；Ruff lint/format 与新增模块 strict mypy 通过。
- 新增 [`V020_V11_LOCAL_WORKER_CONTRACT.md`](./V020_V11_LOCAL_WORKER_CONTRACT.md)，冻结待实现的远端 lease/revoke/checkpoint/result 合同、scope/input hash 绑定、fail-closed 语义、Crash/Reboot/上传中断恢复、扫描器隔离/告警/处置和进入 V20-12 的必要条件。该文档不授权 API、迁移、Provider 或任何生产开关。
- 本轮只完成隔离安全内核加固与设计合同，未宣称 V20-11 通过。真实远端 Local Worker 协议、生产扫描器接入/处置演练和认证恢复流程仍是硬停止；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭，不进入 V20-12。

## V20-11 服务端协议候选内核（2026-08-07）

- 新增 `apps/api/src/logion_api/knowledge_space/local_worker_protocol.py` 作为隔离的服务端协议候选内核：服务端生成短租约、绑定 job/workspace/space/input 摘要，支持幂等撤销、单调 checkpoint、uploaded 结果校验、单次 result receipt 和恢复元数据；没有 FastAPI 路由、数据库、认证依赖、Provider 或生产开关接入。
- 新增 `apps/api/tests/test_knowledge_space_local_worker_protocol.py`，实际通过 scope/过期、撤销、上传前结果拒绝、结果幂等、冲突 key 和非法 key 场景；目标协议与既有知识合同共 `31 passed`。核心知识空间回归 `1 passed, 3 deselected`；新模块 Ruff lint/format 与 strict mypy 通过。
- 本轮仍不能宣称远端 Local Worker API 已完成。需要后续独立设计/迁移/认证授权批准后，才能把候选内核接入真实 lease/revoke/checkpoint/result 路由；Crash/Reboot/上传中断演练、扫描器接入/处置和 worker-offline 认证流程仍为硬停止。所有敏感生产开关继续关闭，不进入 V20-12。

## V20-11 持久化 Local Worker API 候选（2026-08-07）

本轮由 Windows Codex 接管并完成 `task-api` 的独立验收；该结果是候选实现通过，不是生产启用批准：

- 新增 Job、Lease、Checkpoint、Result Receipt 持久化模型与 `0038_local_worker_protocol` 迁移；迁移包含 scope 外键、hash/状态约束、幂等键唯一性和非空降级保护。
- 新增严格请求/响应 Schema 与四组 API：`leases`、`revoke`、`checkpoints`、`result`、`recovery`。路由统一经过默认关闭 Feature Boundary；启用候选时要求 CSRF、可信 Origin、近期重新认证和 Private Space owner/admin 授权。
- 租约 token 只返回一次，数据库只保存 SHA-256 摘要；checkpoint 阶段单调、job/workspace/space/input hash 绑定；result receipt 单次提交，重复请求仅允许同 payload replay，不同 payload 返回稳定冲突；recovery 仅返回受限阶段摘要。
- 实际验收：目标合同/核心/Acceptance/图内核/协议测试 `74 passed, 3 deselected`；真实认证 Local Worker 集成 `3 passed`；迁移集成 `3 passed`；`alembic check` 报告无新升级操作；Ruff lint/format 与知识空间 strict mypy 通过；OpenAPI/TypeScript 合同已重新生成。
- 协调 Run 已追加 `handoff-api`、`obs-api-contract`、`obs-api-migration`、`obs-api-auth`，并记录 `task-api completed` 与 `task-api accepted`。候选实现仍受 `knowledge_space_local_worker_enabled=false` 约束，未启动 Docker、未绕过 SessionBoundary。
- 集成提交 `2ba0554`（`feat(api): add default-closed local worker protocol`）已由 Codex 推送到 `codex/v020-integration`；推送后的 `pnpm ci:fast` 与 `pnpm contracts:check` 均通过。

V20-11 仍保持硬停止：Crash/Reboot/上传中断真实恢复演练、正式扫描器接入/隔离/告警/人工处置及完整 worker-offline 认证证据尚未齐备；在这些门禁完成前不进入 V20-12，也不打开 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance 生产开关。

## V20-11 扫描器与恢复收口（2026-08-08）

- 新增 `attachment_scanner.py`：loopback-only clamd `INSTREAM`、固定超时/分块/大小上限、恶意命中和不可用 fail-closed；新增 scanner 配置和 `.env.example` 默认关闭项。
- Attachment finalize 只有在 MIME、大小、声明 SHA-256、扫描 SHA-256 全部一致时才执行；最终原子复制再次校验摘要；恶意命中尝试移动到 J: 加密隔离目录并写入最小审计告警，隔离失败返回固定错误码。
- 本机常驻 ClamAV 1.5.2 已在 G: 安装、J: 病毒库/日志/临时/隔离，Automatic/Running 且仅 `127.0.0.1:3310`；J: BitLocker XTS-AES-256、Protection On，相关 ACL 已收紧。
- 扫描器与附件单元/合同门禁 `45 passed`；真实附件认证集成 `1 passed`；真实 clamd clean + 内存 EICAR 命中 + 隔离/残留清理均已观察。Windows Defender 拦截落盘 EICAR 移动被记录为真实隔离失败并保持 fail-closed。
- 真实 clamd API 路径 `test_attachment_integration.py -k real_loopback` 为 `1 passed, 1 deselected`；J: staging/verified/quarantine 路径均实际经过扫描器，干净 PDF finalize 为 `verified`。
- Local Worker 新增 `recover_after_restart()` 及真实子进程 crash/上传中断演练；安全内核与恢复测试 `11 passed`。无 Worker 进程时知识空间核心 + AI acceptance 真实认证集成 `3 passed, 1 deselected`。

本节完成后进入 V20-11 admission 复核；在整仓门禁、协调 observation、生产开关核对和用户 release 批准完成前，仍不进入 V20-12、不启用 Attachment/Local Worker/Shared Write/Deletion/Provider/sync-v1/AI Acceptance。

## V20-11 最终准入决定与 V20-12 断点（2026-08-08）

Windows Codex 已完成最终 admission 复核，V20-11 以“候选实现和恢复前提通过、生产能力继续默认关闭”的边界通过：

- 扫描器/附件/知识合同 `45 passed`；真实附件、Local Worker API 与迁移集成合计 `9 passed`；Local Worker crash/upload 恢复 `11 passed`；无 Worker 进程时在线核心与 AI acceptance `3 passed, 1 deselected`。
- 发现并修复搜索游标把快照时间截断到整秒的问题；游标 schema 升至 v2 并保留微秒级快照边界，新增回归后目标游标测试 `5 passed`，此前偶发的第二页空结果已不再复现。
- `pnpm ci:fast` 全绿：402 Python tests、118 协调状态测试、224 Web Vitest、lint/typecheck/build/contracts 全部通过；`pnpm audit --prod --audit-level high` 与 `pip-audit` 均无已知漏洞，`alembic check` 无新升级操作。
- 本机证据复核为 J: XTS-AES-256、100% 加密、Protection On、Automatic Unlock Disabled；常驻 clamd Automatic/Running 且仅监听 `127.0.0.1:3310`；相关 ACL 收紧且 `.part` 残留为 0。真实内存 `INSTREAM` 恶意样本命中与干净 API finalize 均已重新观察。
- 默认设置实测：知识空间 API、Shared Write、Deletion、Attachment、Local Worker、AI Acceptance 与附件 scanner 均为 `false`，邮件 Provider 为 `disabled`；未启动 Docker，未绕过 SessionBoundary。

下一断点为 V20-12 负测/安全/集成门。该节点的建立不授权开启 Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 或 AI Acceptance，也不代表 v0.2.0 已具备发布条件；V20-12 全部通过后才进入 DeepSeek 只读终审。

## V20-11 协调账本收口与 V20-12 当前节点（2026-08-08）

- `task-v11-closeout` 已追加 `task.completed` 与 `task.accepted`；五项 Codex observation 已绑定最终 handoff 原始字节摘要：`obs-v11-scanner-contract`、`obs-v11-scanner-live`、`obs-v11-recovery-live`、`obs-v11-offline-auth`、`obs-v11-gates`。
- 恢复证据另由只读 `task-v11-recovery` 复核并接受，绑定 `obs-v11-recovery-rehearsal`；该任务不拥有或修改既有 Local Worker 安全源文件。
- 当前 Run 校验结果：`eventCount=38`、`nodeCount=46`、`handoffCount=8`、`observationCount=24`；`task-v11-closeout=accepted`、`task-v11-recovery=accepted`、`task-v20-12-integration=accepted`；graph/context/tasks/handoff/observation 一致，所有摘要均按原始 UTF-8 字节计算。
- V20-12 四组门禁真实通过：bounded negative `73 passed`；安全与隔离集成（Local Worker `11 passed`，API/迁移/附件/知识核心/Acceptance `12 passed, 1 deselected`）；默认关闭 `45 passed`；整仓 gates `pnpm ci:fast`（Python `402`、Web `224`、协调 `118`）、`pnpm audit` 无漏洞、`pip-audit` 无漏洞、`alembic check` 无新迁移、Compose 边界静态检查通过。此前发现的 `nanoid < 3.3.17` 高危依赖已通过 workspace override 与 lockfile 修复。
- V20-12 收口不授权生产启用：Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 均保持关闭；未启动本机 Docker、未绕过 SessionBoundary。下一步可建立 V20-13 DeepSeek 只读终审任务包，终审不得修改、提交或推送。

## V20-13 DeepSeek 只读终审与修复收口（2026-08-08）

DeepSeek V4 Flash 通过固定 OpenCode 只读工作树审查了候选提交
`7d50e675be19b2779613ed61ba31dc821afa73dc`（基线
`08babebcd5a09861106c9b05accf32bd8f2ea01c`）。Orca 任务
`task_66a2bdb9ab08`、Dispatch `ctx_ce22e673e7fd` 均返回 succeeded；审查没有 High/Medium
问题，发现的 5 项 Low/Info 均已由 Windows Codex 处置：

- `.env.example` 补齐附件 ingest 与知识游标配置示例，并保持默认关闭；
- deletion flag 在尚未接线时 fail-closed，避免“开启但恒定 404”的误导语义；
- 附件集成测试改用 `LOGION_TEST_ATTACHMENT_TMP_ROOT` 或系统临时目录，不再硬编码盘符；
- 图谱 excerpt preview 使用统一总时间预算，超时安全返回无 preview 并标记 `TIME_LIMIT`；
- 搜索响应显式返回 `truncated` 与 `truncation_reasons`，候选窗口/字节上限不再伪造可恢复的深分页游标。

本轮复核证据：针对性知识空间/图内核/合同测试 `69 passed`；整仓快速门禁在合同生成前的
上下游阶段全部通过（协调 118、Python 402、Web 224、lint/typecheck/build）；`pnpm audit`
无已知漏洞；`pip-audit` 无已知漏洞（工作区包按规范标记为非 PyPI 项）；临时非 C 盘 PostgreSQL
隔离集群完成全量 `upgrade head` 与 `alembic check`，真实 Redis/ClamAV 环境下附件集成
`3 passed`。临时集群已停止并清理，未启动 Docker，未绕过 SessionBoundary。

DeepSeek 工作树曾出现 OpenCode `.omo` 会话元数据残留；协调员已通过 Orca 清理，并再次核对
工作树 clean、HEAD 仍为目标 SHA。V20-13 现已接受，但不代表生产发布批准；Attachment、Local
Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

下一断点为 V20-14：在 staging/隔离恢复环境执行 upgrade/downgrade/upgrade、空环境恢复、
feature-off、孤儿扫描与引用闭包演练；首个正式写入后只允许禁用能力与前向修复，不允许破坏性降级。

## PR #198 integration remediation（2026-08-08）

- GitHub Actions run `31253445278` for commit `6d0cc65068fc395f1fbfcc8a821935b58164809f` failed in the integration job: 60 passed and 7 failed。
- 失败属于集成测试环境不一致，不是生产边界变更：知识空间与 AI acceptance 集成测试未显式启用候选 API flag；附件测试使用 `http://localhost:3000`，而 PR 环境仅允许 `http://test`；PostgreSQL 外键拒绝码实际为 SQLSTATE `23503`。
- 修复范围限定为集成测试夹具、loopback-only INSTREAM 协议测试服务（仍使用生产 `ClamdInstreamScanner` 客户端）、PR 集成允许来源和迁移断言；生产默认值及所有敏感生产开关保持关闭。
- 修复后已观察：目标 Ruff/lint/format 与 `git diff --check` 通过；附件扫描器与知识空间合同单测通过；`pnpm ci:fast` 通过（Python 402、Web 224、协调 118、lint/typecheck/build/contracts）；`pnpm audit --prod --audit-level high` 与 `pip-audit` 无已知漏洞。
- 本机数据库集成重跑已尝试，但隔离凭据无法建立连接，记录为环境限制而非通过；推送后必须等待 GitHub integration 在新提交上重新执行，PR 才能接受。

## PR #198 合并收口（2026-08-08）

- PR `#198` 已按用户授权使用 GitHub `Rebase and merge` 合并，页面状态为 `Merged`。
- 合并提交：`448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；正式集成目录已执行 `git fetch origin main`，`origin/main` 已指向该提交。
- 合并后的依赖复核真实执行：`pnpm audit --prod --audit-level high` 无已知漏洞；`uv run --group dev pip-audit` 无已知漏洞（`logion-api`/`logion-worker` 为工作区包，按工具规范跳过 PyPI 审计）。
- 合并不等于生产发布批准。Docker release smoke、镜像签名/attestation、发布授权仍是后续独立门禁；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。
- 下一断点保持为 V20-14：staging/隔离环境执行 upgrade → downgrade → upgrade、空环境恢复、feature-off、孤儿扫描与引用闭包检查；完成并复核后再进入 V20-15 发布准备。

## V20-15 合并后候选复核（2026-08-08）

- 合并提交 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a` 已触发 GitHub `Main candidate` run
  `31255904782`，结论为 `success`；该 run 的 `head_sha`、分支和主分支均已核对一致。
- 同一提交的 `Mobile builds` run `31255904757` 结论为 `success`。当前正式集成目录的 `pnpm ci:fast`、
  `pnpm audit --prod --audit-level high`、`uv run --group dev pip-audit` 及 34 项默认关闭/备份/Compose
  边界聚焦测试均真实通过，工作树保持 clean。
- Full-capacity profile 仍需 workflow_dispatch，Release candidate 还必须校验同一 source SHA 的
  Main candidate、capacity 与候选证据；本轮不启动 Docker、镜像发布或敏感生产能力，等待发布流程明确授权。

## V20-15 Full-capacity 证据（2026-08-08）

- 已按用户批准手动触发 `Full capacity profile` run `31257249374`，分支 `main`，
  `head_sha=448cbdf8bd43c45aa25e3f2068e2246f3299be3a`，结论为 `success`。
- GitHub job `93102425322` 的专用 PostgreSQL/Redis 容器初始化、迁移、实际容量数据生成和 artifact
  上传步骤均为 `success`；容量 artifact 为
  `capacity-profile-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`（未过期）。
- GitHub Actions 的 artifact 下载接口需要认证，协调员未将无法独立下载的内容伪造为本地复核；本次
  通过依据是该 job 的实际成功结论与工作流内置验证。Release candidate 仍需用户另行批准，不自动发布。

## V20-15 Release candidate 收口（2026-08-08）

- 已按用户批准触发 Release candidate `0.2.0-rc1` run `31259843000`，分支 `main`，
  `head_sha=448cbdf8bd43c45aa25e3f2068e2246f3299be3a`，结论为 `success`；job `93108836660` 全部步骤
  均为成功，Release artifact `release-candidate-0.2.0-rc1-448cbdf8bd43c45aa25e3f2068e2246f3299be3a`
  未过期。
- 实际通过的隔离门禁包括：同 SHA Main/capacity 证据校验、`pnpm ci:fast`、候选 manifest、digest
  镜像加载、Docker smoke、空环境恢复、旧客户端/恢复 epoch 兼容、认证浏览器/WCAG、5/25/100% rollout
  rehearsal、证据归档和 compose 清理。
- 本轮未执行生产发布；独立镜像签名/attestation 核验和生产授权仍是剩余门禁。所有 Attachment、Local
  Worker、Shared Write、Deletion、Provider、sync-v1 与 AI Acceptance 生产开关继续关闭。

## V20-15 同 SHA provenance 核验收口（2026-08-08）

- Main candidate run `31255904782` 的四个 `actions/attest-build-provenance` 步骤均为 `success`，并且
  `Verify provenance and scan exact candidate` 步骤（job `93099092811`，step 26）为 `success`。
- 该验证针对构建出的 web/api/worker/backup digest 使用 `gh attestation verify --repo`，并完成 exact
  candidate 的 Trivy/文件系统/IaC/镜像安全扫描；source SHA 与 Release candidate 均为
  `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。
- V20-15 候选验收与镜像 provenance 证据现已收口；生产发布、生产环境变更和敏感能力启用仍未执行，
  需用户另行明确批准。

## 生产发布执行断点（2026-08-08）

- 用户已批准开始生产发布执行；但仓库没有自动部署到生产环境的 workflow，正式入口是
  `infra/runbooks/aliyun-production-release.md` 所定义的受控阿里云 ECS 手册流程。
- 当前缺少可执行所需的目标 ECS/SSH 访问、正式域名与 DNS/TLS 状态、阿里云 DirectMail/RAM 配置、
  生产密钥环与异机加密备份位置。未获得这些外部前提前，不执行 SSH、DNS、数据库迁移、域名证书、邮件
  投递或生产流量切换。
- 已通过的候选仍固定为 `0.2.0-rc1` / source SHA `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；生产
  开关继续默认关闭，当前停在“生产目标与凭据准备”而非“已发布”。

## 生产目标只读预检（2026-08-08）

- 已复用首版现有 ECS 配置完成只读预检：Ubuntu 24.04、Docker 29.6.2、Compose 5.3.1、Nginx、jq、
  `/opt/logion`、生产 `.env` 与备份密钥文件均存在；SSH 密钥登录成功，未读取私钥或密钥值。
- 当前线上代码仍为旧提交 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`，迁移头为
  `0034_sync_conflicts`；候选 `448cbdf` 的迁移头更高，尚未进行线上替换或迁移。
- 现有服务全部运行且健康，当前线上 `logion.work/health` 返回 HTTP 200；最新备份文件
  `logion-20260808T054944Z-beta-v1.backup` 校验为 `OK`。
- `.env` 已配置 `aliyun_directmail`、`cn-hangzhou` 和 `LogionDirectMailSender`；ECS IMDSv2 只读角色名
  核对成功，未读取临时凭据正文。公网 DNS 已有 `mail.logion.work` SPF，但 `_dmarc.logion.work`
  当前未解析；DirectMail DKIM/DMARC 需在 DNS/控制台确认后，才能满足生产邮件门禁。
- 本轮仅执行只读检查，未停止服务、未修改 `.env`、未迁移数据库、未切换流量。下一断点是补齐
  DMARC/DKIM 与异机备份确认，再按 runbook 进入 prerelease 维护窗口。
- Windows `F:\LogionBackups` 现有异机副本最晚为 2026-07-30，且该卷当前未显示 BitLocker 保护；它不能
  作为本次候选的最新异机恢复证据。服务器 2026-08-08 备份 checksum 虽为 `OK`，仍需在受保护目标上
  完成复制、校验和空环境恢复。

## 生产发布前置修复（2026-08-09）

- 按已批准的方案 1，本机 `F:` 异机备份目标已完成 BitLocker XTS-AES-256 加密，状态为
  `FullyEncrypted`、`Protection On`、100%；恢复密钥仅保存到 Windows 桌面，不进入仓库、Git 历史或协调记录。
- `J:` 安全卷继续保持 XTS-AES-256、100% 加密和 `Protection On`。本轮尚未把 ECS 最新加密备份复制到
  `F:\LogionBackups`，也未执行空环境恢复，因此异机恢复门禁仍未通过。
- `_dmarc.logion.work` 仍未解析；DirectMail DKIM 仍需在阿里云控制台确认。生产数据库迁移、镜像替换、邮件
  投递和流量切换继续未执行，所有敏感生产开关继续关闭。

## 异机备份链路复核（2026-08-09）

- ECS 现有最新备份 `logion-20260808T054944Z-beta-v1.backup` 及 `.sha256` 已复制到加密的
  `F:\LogionBackups\encrypted`；Windows 重新计算的 SHA-256 与 sidecar 一致：
  `aa7b3f9421504d51601b67e4ccf0b197ba1ef7b6dd33d029f38a9aac2cbea20f`。
- 服务器 Backup 容器 `logion-verify-backup` 返回 `OK`；在 ECS 上使用临时数据库完成隔离恢复，恢复头为
  `0034_sync_conflicts`，`restore_requires_sync_epoch_bump=true`，临时数据库和附件目录已清理。
- 该产物绑定线上旧提交 `5f44833…`，不替代候选 `448cbdf…` 的发布前备份；候选维护窗口仍必须重新备份、
  校验、复制并恢复演练。线上当前仍为旧提交，未迁移、未替换镜像、未切流。

## DNS 与 SSH 入口复核（2026-08-09）

- 阿里云 DNS 已存在 DirectMail DKIM：`aliyun-cn-hangzhou._domainkey.mail.logion.work`；通过公共解析器复核
  记录可见。已新增 `_dmarc.logion.work` TXT，策略为 `v=DMARC1; p=none; adkim=s; aspf=s`，并通过公共解析器复核。
- 受控 SSH 会话的实际来源由服务器 `SSH_CONNECTION` 证明为 `183.159.53.63`；安全组中对应 `/32` 规则保留。
  删除多余 `100.104.0.0/16` 规则时触发阿里云短信二次验证，尚未提交删除，不把它记为完成。
- 生产候选 `0.2.0-rc1` 尚未部署；数据库迁移、镜像替换、真实邮件投递和流量切换继续保持停止状态。

## 候选镜像拉取失败与线上回滚（2026-08-09）

- 生产候选仍固定为 `0.2.0-rc1` / source SHA `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。在 ECS 维护窗口中，Public ECR 基础镜像和 Web 镜像拉取成功；API、Worker、Backup 的 GHCR 平台 manifest/API token 路径持续超时，未使用未验证代理、临时镜像或本地构建物。
- 候选未执行数据库迁移、Compose 候选启动、真实邮件、浏览器验收或流量切换；线上数据库没有被候选迁移触碰。
- 已执行回滚任务 `2714`：失败候选目录隔离为 `/opt/logion.failed-20260808T173400Z`，旧目录 `/opt/logion.before-20260808T170123Z` 恢复为 `/opt/logion`，并重新启动旧 API/Web/Worker/Reverse Proxy/Backup。
- 回滚后只读复核通过：线上提交仍为 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`，迁移头仍为 `0034_sync_conflicts`；API、Web、Worker、Reverse Proxy、Backup、PostgreSQL、Redis 均处于运行/健康状态，`http://127.0.0.1:8080/health` 返回 `{"status":"ok","service":"web","version":"0.1.0"}`。
- 本次发布门禁结论为 `blocked`，不是候选通过。下一次重试前必须先解决 ECS 到 GHCR blob/platform manifest 的网络问题（优先临时提升 ECS 公网带宽，或提供四个 digest 已完整校验的离线镜像包）；四个候选 digest 全部拉取并核验成功前，不执行迁移或切流。
- 线上仍保持旧版本与默认关闭边界；Attachment、Local Worker、Shared Write、Deletion、Provider、sync-v1、AI Acceptance 等生产开关继续关闭，不启动本机 Docker，不绕过 SessionBoundary。

## 候选镜像重试拉取完成（2026-08-09）

- 按用户要求在隔离候选目录 `/opt/logion.failed-20260808T173400Z` 重新执行完整 Compose pull；任务持续约 21 分钟，未中断，最终退出码为 0。
- 四个候选应用镜像均已成功拉取并与 `/root/logion-upgrade/candidate-manifest.json` 的固定 digest 一致：API `53528d1a…2607a`、Backup `a9b85709…0876`、Web `0639461f…e0b7`、Worker `bef54d48…8878c`。候选目录 source SHA 与 manifest 均为 `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`。
- 本次只执行镜像拉取和 digest 核验，没有创建候选 Compose 容器，没有执行数据库迁移、候选启动、真实邮件、浏览器验收或流量切换。
- 线上复核仍为旧提交 `5f44833dbfbe32e29ad2f64a4a9eb2b47f85ac50`、迁移头 `0034_sync_conflicts`，`/health` 返回 `{"status":"ok","service":"web","version":"0.1.0"}`。
- 下一步仍需单独进入受控 prerelease 维护窗口：重新生成候选维护备份并完成异地校验，随后才允许启动候选依赖、执行 `0038_local_worker_protocol` 迁移、健康检查和真实验收；本次拉取成功不等于生产发布批准。

## 候选受控 prerelease 部署与首轮验收（2026-08-09）

- 候选维护窗口已按用户批准的发布流程执行。候选 source SHA 为
  `448cbdf8bd43c45aa25e3f2068e2246f3299be3a`；四个应用镜像仍严格绑定 manifest digest：API
  `53528d1a…2607a`、Backup `a9b85709…0876`、Web `0639461f…e0b7`、Worker `bef54d48…8878c`。
- 迁移实际从 `0034_sync_conflicts` 执行到 `0038_local_worker_protocol`；候选 API ready、Web health、
  PostgreSQL、Redis、Worker、Reverse Proxy 均健康。正式 `/opt/logion` 已晋级为候选目录，旧源码保留在
  `/opt/logion.before-20260809T023701Z`，未删除任何数据卷；随后通过正式 `logion-compose` 强制重建并再次等待健康。
- 候选运行时复核：反向代理端口仍只绑定 `127.0.0.1:8080`；公网 `https://logion.work/health` 返回 HTTP 200；
  HSTS、CSP、X-Frame-Options、Referrer-Policy 和 X-Content-Type-Options 均存在；证书有效期至
  `2026-10-27`，`certbot renew --dry-run` 全部模拟成功。候选服务 OOM 与重启计数均为 0，近 15 分钟严重日志计数均为 0。
- 认证浏览器首轮 smoke 已真实执行：既有受控 Owner 会话在候选重建后仍保持登录，16 个应用路由均渲染 `main`、
  未出现登录表单；连续 3 次刷新保持会话，浏览器控制台错误为空。邀请注册页显示“仅受邀邮箱开放”，未执行实际发送。
- 迁移后的部署后加密备份已生成并通过 `logion-verify-backup`：
  `logion-20260809T023930Z-beta-v1.backup`，SHA-256
  `329f705215ae07fc5b1c5276e5bcbfbb55c83981fba61181eae8b0d5a913bbd9`；已复制至
  `F:\LogionBackups\encrypted`，Windows SHA 与 sidecar 一致。使用同一备份完成 ECS 隔离空环境恢复，恢复头为
  `0038_local_worker_protocol`、`workspace_count=1`、`null_sync_epoch_count=0`，临时数据库与附件目录已清理。
- 预发布观察起点记录为 `2026-08-09T03:22:21Z`。本轮没有开启 Shared Write、Deletion、Attachment、Local Worker、
  Provider、sync-v1 或 AI Acceptance，也没有执行真实邮件投递、移动实体设备验收或生产流量切换。
- 一次使用未审核 `alpine:3.20` 的临时备份导出尝试因镜像不可用而停止，未拉取或引入该镜像；随后改用现有 Backup 容器直接导出并完成校验，生产状态不受影响。
- 协调账本新增的 prerelease handoff/observation 已按实际结果写入；`pnpm agent:state:validate` 复核时仅剩历史
  `graph.json` 与 `tasks.jsonl` 的 encoded-content safe-scan budget 超限（没有新的私有 IP、Schema 或证据哈希错误），
  该本地账本校验问题保留为后续修复项，不影响已完成的 ECS 运行时、备份和恢复证据。

当前结论是 **prerelease 已启动且首轮技术验收通过，生产发布仍未完成**。继续观察至少 24 小时，并在受邀收件人
和实体设备验收完成、备份告警确认后，再请求下一次发布切换批准。
