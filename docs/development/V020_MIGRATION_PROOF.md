# V20-02：知识空间迁移证明

> 状态：**隔离迁移证明已完成，未提交、未推送，尚不可进入生产。**
> 执行日期：2026-08-05（Asia/Shanghai）。
> 冻结基线：`08babebcd5a09861106c9b05accf32bd8f2ea01c`。
> 工作分支：`codex/v020-integration`。

## 1. 本阶段结论

V20-02 已在只绑定本机回环地址的临时 PostgreSQL 17 容器中完成加法迁移、负测、
`0035 -> 0036 -> 0035 -> 0036` 往返、迁移前孤儿数据停止、非空表降级停止、逻辑备份恢复、
合成规模估算和质量检查。迁移没有修改认证/会话、`Space` 语义、OpenAPI、sync-v1、AI
Provider、共享写入、删除、附件或本地 Worker，也没有创建 commit 或 push。

本阶段只证明数据库结构和约束可行。新表尚未进入 ORM 元数据、API、后台任务或 sync-v1，
因此运行时不存在可达的知识写路径，能力保持关闭。V20-04 OpenAPI 和 V20-08 核心模型/服务
仍需分别授权。

## 2. 产物与边界

- 迁移：`apps/api/migrations/versions/0036_knowledge_space_foundation.py`；
- 集成矩阵：`apps/api/tests/test_knowledge_space_migration_integration.py`；
- 本证明：`docs/development/V020_MIGRATION_PROOF.md`；
- 同步更新：V20 Schema 设计、执行计划和状态页；
- 未增加依赖、manifest、lockfile、环境配置、ORM、路由、合同、生产数据修复或秘密。

迁移增加：

1. `spaces`、`resources`、`notes`、`quiz_items` 和 `ai_output_drafts` 的五个组合唯一键；
2. 现有 `resources`、`notes`、`topics`、`quiz_items` 和 `paper_records` 到 `spaces` 的五个
   组合范围外键，先 `NOT VALID` 再显式验证；
3. `source_excerpts` 与 `knowledge_citations` 两张新表；
4. 四类 typed target、Claim owner、AI Draft Workspace 和 Excerpt/Resource 的范围外键；
5. 哈希、文本、成对定位、恰好一个 Target、生命周期和版本约束；
6. 活动查询索引与四个活动语义边部分唯一索引；
7. 新证据链物理删除统一使用 `RESTRICT`，现有 Space 子表关系保持原有 `CASCADE`；
8. 当任一新表非空时拒绝降级；离线模式不能证明表为空，因此离线降级同样失败关闭。

所有动态 DDL 标识符均来自迁移文件内固定常量，不接收用户输入。最长新约束/索引名称小于
PostgreSQL 的 63 字节标识符上限。

## 3. 验证环境

| 项目          | 实际版本/方式                                                         |
| ------------- | --------------------------------------------------------------------- |
| PostgreSQL    | `17.10`，`postgres:17.10-alpine`                                      |
| Docker Engine | `29.6.2`                                                              |
| Python        | `3.12.13`                                                             |
| Alembic       | `1.18.5`                                                              |
| SQLAlchemy    | `2.0.51`                                                              |
| asyncpg       | `0.31.0`                                                              |
| 网络/认证     | 仅 `127.0.0.1` 动态端口；临时容器使用 trust，不在命令或仓库中保存密码 |

所有数据库均为本机临时合成库，不包含用户或生产数据。

## 4. 往返、行数和 Catalog 证明

在 `0035_add_user_settings` 上预置两套互相隔离的 Workspace/Space、Resource、Note、Topic、
QuizItem、PaperRecord、ResearchClaim 与 AIOutputDraft 数据，再执行同库往返：

| 步骤                    |       耗时 | 规范化 Schema SHA-256                                              |
| ----------------------- | ---------: | ------------------------------------------------------------------ |
| 0035 基线               |          — | `8ffe45200ae93efbc47eb1b70ecef1a6285576d707b9ea9df61a5dc12e52f422` |
| Upgrade A：0035 -> 0036 | 1887.20 ms | `f1884f7e610ed10cd9fbb9416cf55ea020629102a7e9b090b89a583569b26453` |
| Downgrade：0036 -> 0035 | 1728.16 ms | 与 0035 基线完全一致                                               |
| Upgrade B：0035 -> 0036 | 1860.25 ms | 与 Upgrade A 完全一致                                              |

PostgreSQL 17 的 `pg_dump` 会为每次文本输出生成随机 `\\restrict`/`\\unrestrict` 标记；指纹
只移除了这两类随机行，没有移除任何 DDL。往返后：

- 十个既有表的行数均为 2，升级、降级和再升级前后完全一致；
- 两个新表在 schema-only 阶段均为 0 行；
- 本次新增并要求验证的约束中，`NOT VALID` 残留数为 0；
- 小型夹具首次升级的数据库占用增量为 385,024 字节；数据库文件物理字节数不作为降级
  等价判据，因为 PostgreSQL Catalog 事务会保留可回收空间，逻辑 Schema 指纹和行数才是判据。

## 5. 备份与恢复点

在包含三套合成既有数据的 0035 数据库上创建 PostgreSQL custom-format 逻辑备份并恢复到全新
数据库：

- 备份大小：315,482 字节；
- `pg_restore` 成功；
- 十个目标既有表恢复前后均为 3 行；
- 表/列类型与非空性、约束身份、外键列映射和删除动作、索引身份/列映射组成的结构指纹均为
  `e591090ab8517e55a74a802dcd4c8cba`；
- 恢复库与原库结构指纹、行数完全一致，原库随后再次升级到 0036 成功。

完整文本 `pg_dump` 在 restore 后会因 PostgreSQL 对等价 CHECK 表达式重新规范化而出现括号和
显式 cast 的文本差异，因此不把原始 dump 文本哈希误当作恢复等价性。往返迁移仍使用同库规范化
Schema SHA-256 做严格比较。

## 6. 约束与失败关闭矩阵

目标集成测试实际结果为 `3 passed`。测试内包含 Catalog 检查、四类 typed target 正向插入、
替代关系正向插入，以及 31 个拒绝/回滚断言，覆盖：

- 跨 Workspace/Space 的 Resource、Excerpt、Topic、QuizItem、ResearchClaim、Claim owner、
  Note 和 AI Draft；
- Resource/乐观版本、空或超 32 KiB 摘录、512-byte 来源版本键、小写 SHA-256 和固定规范化配置；
- 页码/字符定位必须成对，不能依赖 SQL 三值逻辑放行半边数据；
- 零/多个 Target、Claim ID/owner 不成对、非法关系、Note 超限和生命周期冲突；
- 重复活动语义边；关闭旧 Citation 后重新接受替代关系；
- 删除被引用 Resource、Excerpt 或 Target 时 `RESTRICT`；
- 生命周期更新中途失败时 Savepoint 回滚，Excerpt 继续保持 active。

检查同时绑定 PostgreSQL 约束名和 SQLSTATE：CHECK `23514`、FK `23503`、唯一冲突 `23505`。

另建 0035 孤儿库后插入一个没有合法 Space 父对象的 Resource。升级按预期退出非零，错误明确
指向 `resources`，Alembic revision 保持 0035，且 `source_excerpts` 未创建；迁移没有自动修复数据。

降级保护也分别验证：

1. `knowledge_citations` 非空时拒绝降级并保持 0036；
2. 清空 Citation、保留 `source_excerpts` 时仍拒绝并保持 0036；
3. 两张新表都为空后才允许降级，再升级成功。

## 7. 合成规模、锁和磁盘估算

在另一个 0035 数据库中，为 `resources`、`notes`、`topics`、`quiz_items`、`paper_records` 和
`ai_output_drafts` 各写入 10,000 行，并准备对应 AI Run/父对象。结果：

- 约 70,000 行相关合成数据上的 0035 -> 0036 总耗时：2302.79 ms；
- 六个目标父表行数均保持 10,000，新表均为 0；
- 新增约束的未验证数量为 0；
- 数据库占用从 36,804,275 增至 39,704,243 字节，增量 2,899,968 字节。

该结果只用于开发机量级估算，不是生产延迟承诺，也没有模拟写入竞争。实际锁特征为：

- 父表唯一索引使用 `CREATE UNIQUE INDEX CONCURRENTLY`，避免长时间阻断普通读写；
- 挂接唯一约束和添加外键仍需要短暂表级 DDL 锁；
- `VALIDATE CONSTRAINT` 会扫描既有行，持续时间随表大小和 I/O 变化；
- Alembic 的 `autocommit_block` 会在并发索引阶段前提交当前事务，因此若后续步骤失败，已创建的
  并发索引可能需要受控人工清理，不能假设整份 revision 完全原子回滚。

生产执行前必须重新获取真实行数、表/索引大小、磁盘余量和可恢复备份，并设置经审批的
`lock_timeout`/`statement_timeout`。任何孤儿、跨范围行、无恢复点、磁盘预算不足、锁等待超限或
并发索引无效都必须停止；本阶段不授权生产执行或数据修复。

## 8. 质量、安全与已知红项

已通过：

- Ruff lint 与 format check；
- Mypy strict（迁移和集成测试）；
- Python 编译与 `git diff --check`；
- 仅编译 0035 -> 0036 的 Alembic 离线 SQL；输出确认并发索引在事务外执行，随后重新开始事务；
- 目标 PostgreSQL 集成测试；
- 迁移前孤儿扫描、非空降级门、备份恢复和合成规模演练；
- 动态 SQL 固定常量检查、秘密/凭据边界检查和仅回环数据库隔离。

实际运行但预期为红：

- `alembic check` 会报告删除两张新表、索引、五个组合键和五个范围外键。原因是 V20-02 明确只
  授权 migration/tests，ORM 模型登记属于后续 V20-08 范围。该结果不能伪报通过，也意味着当前
  候选尚不能独立通过 PR 的完整 migration job 或合并。

仓库从 base 到 head 的完整离线 SQL 生成仍会在既有 `0005_workspace` 数据回填处失败；该历史迁移
需要在线查询结果，与 0036 无关。限定 `0035:0036` 的离线 DDL 已成功编译并审查。

尚未运行且不计通过：

- 真实生产数据的行数、锁竞争、备份恢复、磁盘和耗时测量；本阶段无生产访问和生产执行授权；
- ORM/autogenerate 收口、API、权限、并发接受 Receipt、sync-v1 golden、浏览器和发布门；这些属于
  后续独立任务。

## 9. 下一审批门

### 断点恢复后的独立复核

用户于 2026-08-06 要求从 V20-02 断点继续后，Windows Codex 没有沿用聊天结论，而是重新执行了
目标 PostgreSQL 测试、质量门和独立数据库往返：3 个目标集成测试再次通过；同一合成库副本在
`0036 -> 0035 -> 0036` 后得到相同的规范化 0036 Schema SHA-256，十张既有表的行数签名前后一致；
Citation 非空和 Excerpt 非空分别拒绝降级并保持 0036；孤儿 Resource 数据再次在新表创建前拒绝
升级。10,000 行父表证据仍显示六个目标表各 10,000 行、V20 约束无未验证残留。

整仓复核仍精确保留两项后续门禁：非集成 Pytest 为 `292 passed, 1 failed`，唯一失败是未授权路径
中的发布候选清单仍期待迁移头 0035；完整类型检查仍只报告未改动 Worker 中四项阿里云 SDK 类型
标记问题。目标 Mypy、全仓格式、全仓 Lint 和 118 个协调状态测试均通过。这两项红色结果没有被
改写为通过，也不扩大 V20-02 权限。

V20-02 可以作为“数据库迁移证明”收口，但不是可发布功能。下一步应停在 V20-04 审批门：只有用户
单独授权后，Windows Codex 才能实现只加法、默认关闭的 OpenAPI/合同；V20-08 还需在 V20-04 完成后
登记 ORM、消除 `alembic check` 差异并接入授权过滤。Shared Write、Deletion、Attachment、Local
Worker、commit、push 和 production rollout 继续保持关闭。
