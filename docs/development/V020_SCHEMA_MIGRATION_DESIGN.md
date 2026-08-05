# V20-01：SourceExcerpt / KnowledgeCitation Schema 与迁移设计（已批准）

- 状态：设计已批准；用户随后于 2026-08-05 单独授权 V20-02，隔离迁移证明现已完成
- 基线：`08babebcd5a09861106c9b05accf32bd8f2ea01c`
- 依赖：ADR-0029 / V20-M0（已于 2026-08-05 接受）
- 范围：`SourceExcerpt` 与 `KnowledgeCitation` 的增量 Schema 方案
- 明确排除：迁移文件、ORM/产品代码、OpenAPI、认证/会话、`Space`、sync-v1、Provider、commit 和 push 变更

本文档是协调员复核后的 V20-01 worker 异常交付恢复版本。Worker 已在其终端完成设计，但正常的
`worker_done` 投递失败；Orca 记录的是协调员显式结算，而不是伪造的 worker 完成消息。

审批记录：用户于 2026-08-05 批准本文设计边界与推荐方案。该批准冻结 Schema/迁移设计基线，
不授权执行迁移、生产写入、合同实现、commit 或 push。

后续授权记录：用户于同日另行批准 V20-02 Migration Proof，仅授权 migration/tests 与隔离
PostgreSQL 验证；生产迁移、数据修复、ORM/API/OpenAPI、commit 和 push 仍未授权。

## 1. 提请审批的统一设计决定

1. `SourceExcerpt` 是不可变的证据快照。正文、定位、来源身份/版本和哈希不得原地修改。修订时创建
   新摘录；只有生命周期字段、操作者/时间元数据和乐观并发 `version` 可以变化。
2. `KnowledgeCitation` 是不可变的已接受关系。摘录、typed target、`relationship_kind` 和可选的
   `relation_note` 不得原地修改。纠正时关闭旧记录并创建一条重新接受的新记录；恢复操作不得自动
   重开旧 Citation。
3. 每条记录均以 `workspace_id + space_id` 定界。所有父对象引用都使用包含该范围的组合外键。
   Target 必须且只能是 `Topic`、`QuizItem`、`ResearchClaim` 或 `Note` 之一；不得使用通用的
   `target_type + target_id` 或 JSON 多态引用。
4. Citation 方向为 **excerpt -> formal target**。`relationship_kind` 仅允许 `source`、
   `definition`、`support`、`contradiction`、`example` 或 `derivation`。`TopicDependency`
   继续是唯一的先修关系。
5. `relation_note` 为可选、纯文本且不可变，最多 2,000 个 Unicode 标量值、8 KiB UTF-8。它绝不
   作为可信 HTML，也不得进入日志或运维审计元数据。
6. v0.2.0 的定位仅使用显式列：从 1 开始且两端包含的页码范围、从 0 开始且右端不包含的已解码
   Unicode 标量值字符范围，以及/或者有界章节定位。至少需要一种完整定位；任意 Locator JSON 延后。
7. 摘录规范化版本为 `utf8-nfc-lf-v1`：使用已验证的来源编码解码，将 CRLF/CR 规范为 LF，将
   Unicode 规范为 NFC，除此之外保留原有空白和码点。摘录长度为 1～20,000 个标量值，且 UTF-8
   字节数最多 **32 KiB**。
8. `source_version_key` 必须非空且最多 **512 UTF-8 bytes**。来源文件哈希可以为空；规范来源版本
   SHA-256 和摘录 SHA-256 必填。哈希只能证明一致性，不能证明权限、作者身份或事实真实性。
9. 物理删除使用 `RESTRICT`。软删除、stale、移动和纠正都必须在事务内关闭活动 Citation。跨范围
   移动采用“复制 + 重新授权 + 重新接受 + 关闭旧记录”；不得原地更新范围列。
10. 每条正式 Citation 都必须记录人工接受。在 Shared Space 中，创建或替换正式 Citation 必须具备
    `shared_knowledge.accept`；只有 `shared_knowledge.write` 的主体只能准备证据或 Draft，不能创建
    已接受关系。即使 V20-07 设计已获批，共享写入仍须保持关闭，直到独立生产合规与启用门禁通过。

## 2. 现有表的前置条件

建立新的范围外键前，需要以下增量键：

| 表                 | 现有可用键                                     | 需要新增的键                                 |
| ------------------ | ---------------------------------------------- | -------------------------------------------- |
| `spaces`           | PK `(id)`                                      | `UNIQUE (id, workspace_id)`                  |
| `resources`        | `UNIQUE (id, workspace_id)`                    | `UNIQUE (id, workspace_id, space_id)`        |
| `topics`           | `UNIQUE (id, workspace_id, space_id)`          | 无                                           |
| `quiz_items`       | `UNIQUE (id, workspace_id)`                    | `UNIQUE (id, workspace_id, space_id)`        |
| `research_claims`  | `UNIQUE (id, workspace_id, space_id, user_id)` | 无                                           |
| `notes`            | `UNIQUE (id, workspace_id)`                    | `UNIQUE (id, workspace_id, space_id)`        |
| `ai_output_drafts` | PK `(id)`                                      | 仅作为来源证明的 `UNIQUE (id, workspace_id)` |

迁移门禁还必须验证 `resources`、`notes`、`topics`、`quiz_items` 和 `paper_records` 的组合 Space
父子关系。先将现有数据对应的外键添加为 `NOT VALID`，扫描范围不一致，再在启用任何知识写路径之前
完成验证。只要发现一条不一致数据，V20-02 就必须停止；不得自动修复所有权。

## 3. 可审查的 DDL 结构

以下内容是契约层草图，不构成执行迁移的授权。

### `source_excerpts`

必需列：

- 身份/范围：`id`、`workspace_id`、`space_id`、`resource_id`；
- 不可变证据：`resource_version`、`source_version_key`、可空的 `source_file_sha256`、必填的
  `source_version_sha256`、`excerpt_text`、`excerpt_sha256`、`hash_algorithm='sha256'`、
  `normalization_version='utf8-nfc-lf-v1'`；
- 定位：成对可空的 `page_start/page_end`、成对可空的 `char_start/char_end`、可空的
  `section_locator`；
- 生命周期：`status in ('active','stale','deleted')`、`version >= 1`、创建/更新人员与时间、
  `stale_at`、`deleted_at`。

必需约束：

- `UNIQUE (id, workspace_id, space_id)`；
- `(resource_id, workspace_id, space_id)` 到 `resources` 的范围外键，使用
  `ON DELETE RESTRICT`；
- `resource_version >= 1`；
- `char_length(excerpt_text) between 1 and 20000` 且
  `octet_length(excerpt_text) <= 32768`；
- trim 后的 `source_version_key` 长度为 1～512 bytes；
- 必填哈希及可选文件哈希必须为小写、64 位十六进制；
- 页码范围要么全部为空，要么满足 `1 <= start <= end <= 100000`；
- 字符范围要么全部为空，要么满足 `0 <= start < end <= 1000000000`；
- 页码、字符或非空章节定位至少存在一种；
- 生命周期时间戳必须与 `status` 一致。

### `knowledge_citations`

必需列：

- 身份/范围：`id`、`workspace_id`、`space_id`、`source_excerpt_id`；
- 不可变关系：`relationship_kind`、可选的 `relation_note`、可空的 `topic_id`、
  `quiz_item_id`、`research_claim_id + research_claim_user_id` 和 `note_id`；
- 接受信息：可空的 `accepted_draft_id`、必填的 `acceptance_operation_id`、`accepted_by`、
  `accepted_at`；
- 生命周期/审计：`status in ('active','closed','deleted')`、`version >= 1`、创建者/时间、
  `closed_by`、`closed_at`、`close_reason` 和 `deleted_at`。

必需约束：

- `UNIQUE (id, workspace_id, space_id)`；
- 到摘录及四类 Target 表的范围外键，全部使用 `ON DELETE RESTRICT`；
- 当 `accepted_draft_id` 存在时，使用到 `ai_output_drafts` 的 Workspace 范围外键；
- `num_nonnulls(topic_id, quiz_item_id, research_claim_id, note_id) = 1`；
- Claim ID 与 Claim owner 必须同时为空或同时存在；
- 受控关系枚举；必须拒绝 `prerequisite`；
- 可选 Note 最多 2,000 个标量值、8 KiB UTF-8；
- 关闭原因只能是 `excerpt_stale`、`excerpt_deleted`、`target_deleted`、`target_moved`、
  `superseded` 或 `user_withdrawn`；
- active/closed/deleted 生命周期组合必须内部一致。

在 V20-09 定义权威 Receipt 和幂等唯一性之前，`acceptance_operation_id` 只作为关联字段。V20-01
不得提前发明后续契约。

## 4. 索引与重复边方案

- 活动摘录查询：`(workspace_id, space_id, resource_id, created_at desc, id)`。
- 活动摘录哈希查询：`(workspace_id, space_id, excerpt_sha256)`。
- stale 扫描：当状态为 stale 时使用 `(workspace_id, space_id, stale_at, id)`。
- 按摘录查询活动 Citation，以及分别面向四类 typed target 的反向查询索引。
- 接受操作查询：`(workspace_id, acceptance_operation_id, id)`。
- 四个部分唯一索引防止出现重复的**活动**语义边，键为
  `(workspace_id, space_id, source_excerpt_id, relationship_kind, typed_target)`。

已关闭记录作为历史保留，不阻止以后重新明确接受替代关系。哈希相同的不同摘录不得被静默去重。

## 5. 生命周期与失败关闭读取

1. 只有当 Citation 和 Excerpt 都处于 active、Target 处于 active，且调用者当前有权读取两个端点时，
   Citation 才可见。
2. Resource 版本变化会将受影响的 Excerpt 标记为 stale，并以 `excerpt_stale` 关闭其活动 Citation；
   不得重写已保存证据。
3. 删除时先锁定端点，再按确定性的 UUID 顺序锁定活动 Citation，在同一事务中关闭 Citation 并改变
   端点生命周期。
4. 纠正 Citation 时，以 `superseded` 关闭旧记录，再创建新的已接受记录。关系、Target、Note 或
   Excerpt 均不得原地修改。
5. 恢复端点不得重新激活历史 Citation，必须重新接受。
6. 物理清理顺序是 Citation -> Excerpt -> Source/Target，并且需要 V20-07 授权。不得使用数据库
   cascade 擦除接受证据。
7. 故障注入必须证明中断的生命周期事务会全部回滚；即使遇到旧数据或部分修复数据，查询谓词仍须
   失败关闭。

## 6. 增量迁移与证明顺序

### 迁移前检查

- 确认不可变基线、唯一迁移 writer、Schema/Alembic head、行数、约束/索引名称、备份恢复点，以及
  生产规模下的锁和磁盘估算。
- 扫描非法版本/哈希、重复父键、Space/Workspace 不一致、QuizItem/Topic 范围不一致，以及
  ResearchClaim/PaperRecord 范围或 owner 不一致。
- 只要查询返回任何记录，或恢复点不可用，V20-02 就必须停止；数据修复需要单独批准。

### Upgrade A（仅 Schema，Feature 关闭）

1. 构建增量父表唯一索引，并使用锁影响最小的路径挂接命名约束。
2. 将现有表的组合 Space 外键添加为 `NOT VALID`，零不一致扫描完成后再验证。
3. 创建两个新表及其 CHECK、FK 和索引。
4. 保持 API/共享写能力关闭，sync-v1 不变。
5. 执行会回滚的正向/负向插入矩阵，并检查 PostgreSQL 约束名称和 SQLSTATE。

### Downgrade 演练（仅限产生保留数据之前）

1. 断言两个新表均为空；否则中止。
2. 先删除 Citation 相关对象，再删除 Excerpt 相关对象。
3. 按依赖顺序只删除本次新增的组合 FK、唯一约束和索引。
4. 证明原始 Alembic revision、规范化 Schema 指纹及所有现有表行数与迁移前快照一致。

### Upgrade B

- 在同一个隔离 PostgreSQL 数据库上再次升级，并比较规范化 Catalog 指纹。
- 运行所有 typed target 正向用例、负测矩阵、生命周期事务和故障注入。
- 记录命令、退出码、PostgreSQL/Alembic 版本、耗时/锁、行数、恢复点和规范化 Schema Diff。
  计划执行或环境不可用的检查不能记为通过。

产生第一条需要保留的生产知识记录后，禁止破坏性 Downgrade。回滚只能关闭 Feature 并前向修复，
同时按照已批准策略保持数据可读、可导出。

## 7. 负测矩阵

| ID      | 尝试                                                        | 必需结果                                       |
| ------- | ----------------------------------------------------------- | ---------------------------------------------- |
| N01–N03 | 跨 Workspace/Space 的 Resource，或非法的现有 Space 父子关系 | 范围 FK 失败；发现旧数据不一致时迁移停止       |
| N04     | Resource 版本或乐观版本为 0/负数                            | CHECK 失败                                     |
| N05     | 空摘录、超过 20,000 标量值或超过 32 KiB                     | CHECK 失败                                     |
| N06     | 格式错误、大写、过短的哈希或错误算法                        | CHECK 失败                                     |
| N07–N09 | 无定位、只提供一侧、范围非法/溢出                           | CHECK 失败                                     |
| N10     | Excerpt 状态与生命周期时间戳冲突                            | CHECK 失败                                     |
| N11–N13 | 零/多个 Target，或 Claim ID/owner 组合非法                  | CHECK 失败                                     |
| N14–N18 | Excerpt 或任一 typed target 跨范围/Claim owner              | typed scoped FK 失败                           |
| N19     | 未知关系或 `prerequisite`                                   | relationship CHECK 失败                        |
| N20     | relation note 字符数或字节数超限                            | CHECK 失败                                     |
| N21     | 重复活动语义边                                              | 对应部分唯一索引失败                           |
| N22     | 旧记录关闭后创建替代关系                                    | 只有经过新一轮人工接受才成功                   |
| N23     | 物理删除被引用端点                                          | FK `RESTRICT` 失败                             |
| N24     | Citation 已关闭、端点状态改变前发生故障                     | 全部回滚；读取仍失败关闭                       |
| N25     | 调用者只能读取 Citation 的一个端点                          | 不透明拒绝且不泄露元数据                       |
| N26     | 接受过程中 Excerpt/Source/Hash 发生 stale 竞态              | 冲突且正式副作用为 0                           |
| N27     | 原地改变证据、关系、Note、Target 或范围                     | Service 拒绝                                   |
| N28     | 恢复端点并重新激活历史 Citation                             | 拒绝；必须重新接受                             |
| N29     | 只有 write、没有 accept 权限时创建 Shared 正式 Citation     | 插入前拒绝                                     |
| N30     | V20-07 未批准时执行 Shared mutation                         | 插入前由 Feature 拒绝                          |
| N31     | 新实体出现在 sync-v1/Vault/Outbox                           | 合同/Golden Gate 失败                          |
| N32     | AI Draft 属于其他 Workspace，或引用 stale/不同语义          | FK/Service 重新授权失败                        |
| N33     | N 个并发相同接受请求                                        | 仅一个 Receipt/Edge 集合；其余确定性重放或冲突 |

## 8. 仍需审批的决定

1. 批准六种关系值及方向，以及不可变可选 Note 的限制。
2. 批准 20,000 标量值 + 32 KiB UTF-8、512-byte 来源版本键、定位范围和
   `utf8-nfc-lf-v1` 规范化。
3. 批准增量组合键及对现有 Space 父子关系的验证；任何旧数据修复继续作为独立决定。
4. 批准移动使用复制/重新接受/关闭，纠正使用关闭/重新接受，恢复不自动重开。
5. 批准允许人工创建正式 Citation；Shared 创建必须具备 `shared_knowledge.accept`，AI Draft
   来源证明可以为空。
6. V20-07 必须批准保留/清理/去标识化/备份；V20-09 必须定义接受 Receipt 唯一性。在此之前，
   Shared 写入、删除路由和物理清理保持关闭。

批准本文档不代表授权 V20-02、执行迁移、生产写入或任何合同/产品实现。

## 9. V20-02 实施回填

历史上的 V20-01 审批不自动授权实施；V20-02 是用户后续单独打开的门。Windows Codex 已按本设计
完成迁移文件和 PostgreSQL 隔离证明，证据见 [`V020_MIGRATION_PROOF.md`](./V020_MIGRATION_PROOF.md)。

实现期间集成测试发现并修复了一个 SQL 三值逻辑漏洞：原始页码/字符范围 CHECK 在只提供一侧时会
得到 `NULL`，而 PostgreSQL 会把 `NULL` 视为未违反 CHECK。最终约束明确要求 start/end 同时非空后
再检查范围，半边定位已由回归测试绑定约束名和 SQLSTATE。

V20-02 不包含 ORM 元数据，因此 `alembic check` 的预期差异已写入证明文档；这不是通过项，也不
授权合并。V20-04 仍需单独审批，V20-08 负责 ORM/服务收口。本文末尾原有“批准本文档不代表授权
V20-02”的文字保留为当时审批边界的历史记录，不被后续授权倒改。
