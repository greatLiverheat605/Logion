# V20-03：权限与 API 设计（已批准）

- 状态：设计已批准（用户于 2026-08-05 明确确认）；V20-04 合同实施仍须单独授权
- 依赖：ADR-0029 / V20-M0（已观察到于 2026-08-05 接受）
- 范围：`SourceExcerpt`、`KnowledgeCitation`、AI Draft 接受和有界图读取的增量、Feature Flag
  控制、online-only API
- 明确排除：路由、Schema、迁移、OpenAPI 生成、认证/会话变更、`Space` 语义变更、sync-v1
  变更、Provider 工作和 GLM 派发

本提案保持 ADR-0004 不变：所有查询都从已认证的 `workspace_id + space_id` 边界开始。Private
Space 仍然只能由其 `owner_user_id` 读写；Workspace Owner/Admin 身份不会自动授予 Private
Space 正文访问权。Shared 访问继续由有效 Workspace membership 和命名 permission 决定。

审批记录：用户于 2026-08-05 批准本文权限矩阵、API 边界与推荐方案。该批准冻结合同设计基线，
不授权生成 OpenAPI、实现 Route、修改认证/会话、commit 或 push。

## 1. Feature 与能力门禁

设计采用三个服务端配置，默认值全部为 `false`：

| 配置                                    | 作用                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_space_api_enabled`           | 启用全部新端点。关闭时，路由返回 `404 KNOWLEDGE_FEATURE_DISABLED`；不暴露或写入任何新数据。                                                                                        |
| `knowledge_space_shared_writes_enabled` | 仅在 V20-07 设计获批且独立生产隐私/法律门禁、Write/Accept 负测通过后启用 Shared Space 的 Excerpt/Citation 写入和 Draft 接受。只有主 Flag 开启时才生效，不影响 Private owner 写入。 |
| `knowledge_space_deletion_enabled`      | 仅在删除、恢复、备份到期和孤儿闭包证据通过后启用 Excerpt/Citation 删除动作。只有主 Flag 开启时才生效。                                                                             |

这些 Flag 是部署配置，不是客户端声明。它们不增加 Session Capability、不进入 sync-v1，并且必须
在认证后、加载用户正文前检查。关闭任何 Flag 都必须失败关闭，且不会自动删除已有数据。

## 2. 命名 Permission 与角色矩阵

增加三个休眠 Permission，不改变任何现有 Permission：

- `shared_knowledge.read`
- `shared_knowledge.write`：准备 Excerpt/Evidence 和可编辑 Draft；单独持有该权限不能创建正式
  Citation
- `shared_knowledge.accept`：创建或替换正式 Citation，以及接受 AI Draft

已批准的 Shared Space 映射：

| Workspace 角色 | 读取 Excerpt/Citation/Graph |      准备 Excerpt/Evidence |     创建/替换正式 Citation 或接受 AI Draft |
| -------------- | --------------------------: | -------------------------: | -----------------------------------------: |
| owner          |                          是 | Shared-write Flag 开启时是 |                 Shared-write Flag 开启时是 |
| admin          |                          是 | Shared-write Flag 开启时是 |                 Shared-write Flag 开启时是 |
| editor         |                          是 | Shared-write Flag 开启时是 |                 Shared-write Flag 开启时是 |
| contributor    |                          是 | Shared-write Flag 开启时是 |                                         否 |
| reviewer       |                          是 |                         否 | Shared-write Flag 开启且使用已准备证据时是 |
| viewer         |                          是 |                         否 |                                         否 |

此设计刻意分离贡献与审批。`reviewer` 可以接受已经准备好的 Draft 或正式关系，但不能编辑来源
Excerpt；`contributor` 可以准备证据，但不能创建正式关系或提升 AI Draft。这样可防止 contributor
通过直接 Citation 路由绕过接受流程。不得复用 `shared_content.read` 或 `shared_plan.write`，因为
这会静默扩大旧能力。主 Flag 关闭时，新 Permission 不可达。

Private Space 行为不随 Workspace 角色变化：

| 主体                                                |             Read |            Write |           Accept |
| --------------------------------------------------- | ---------------: | ---------------: | ---------------: |
| `Space.owner_user_id` 且 Workspace membership 有效  |               是 |               是 |               是 |
| 不是 Space owner 的 Workspace owner/admin/editor 等 | 否（不透明 404） | 否（不透明 404） | 否（不透明 404） |
| 已撤权、暂停或非成员                                | 否（不透明 404） | 否（不透明 404） | 否（不透明 404） |

## 3. 授权顺序

每个端点都必须按以下顺序执行；前一项失败后不得继续执行后续检查：

1. 验证现有认证 Session。Mutation 还必须在任何写入前执行现有 trusted-Origin 和 CSRF 边界。
2. 检查 `knowledge_space_api_enabled`；关闭时不查询正文，直接返回 Feature-disabled 结果。
3. 使用现有范围 Join 解析活动 Workspace 和调用者的活动 Membership。缺失、已删、暂停、撤权和
   跨 Workspace 情况必须返回相同的不透明 404。
4. 通过 `(workspace_id, space_id)` 解析活动 Space，并在查询中强制可见性：Shared Space 或
   `owner_user_id == caller`。其他人的 Private Space 对 Workspace Owner/Admin 也必须与不存在
   的 Space 无法区分。
5. 对 Shared Space 要求当前操作对应的命名 Permission。为了不可枚举，没有 read Permission 的
   单对象请求返回不透明 404；已经可读 Shared Space、但缺少 write/accept Permission 的请求返回
   403 `KNOWLEDGE_OPERATION_DENIED`。
6. Shared write/accept 必须检查 `knowledge_space_shared_writes_enabled`；关闭时，只对已经授权的
   Shared reader 返回 403 `KNOWLEDGE_SHARED_WRITES_DISABLED`。
7. 删除动作必须在正常授权之后、加载待变更正文之前检查 `knowledge_space_deletion_enabled`。
   关闭时，所有已授权删除请求返回相同的 403 `KNOWLEDGE_DELETION_DISABLED`，且不产生生命周期写入。
8. 在昂贵对象/图查询前执行速率限制。Key 必须使用隐私哈希，并同时按 caller+Workspace 和
   Workspace 定界；日志中的 Key 不得包含正文或原始标识符。
9. 只能通过 `(workspace_id, space_id, object_id, active/not-deleted)` 加载对象。Citation 读取
   必须 Join 并授权 Excerpt 与 typed target 两端；任一端失败都返回不透明 404。
10. 验证形状、Target 类型、范围、状态、配额和当前操作的业务规则。
11. Mutation 按确定性的 UUID 顺序锁行，然后在事务内重新检查 Membership、Space Permission 和
    Feature Flag，再比较版本，以关闭撤权/Flag 竞态。
12. 比较 `expected_version`、ETag 前置条件、Excerpt Hash/Source Version 和 Draft 状态。只有
    所有检查通过后，事务才可修改数据并追加最小审计证据。

授权检查必须先于版本和存在性细节检查，因此调用者不能利用 stale ETag 探测其无权读取的对象。

## 4. Endpoint Contract 提案

Base path：

`/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge`

所有响应沿用现有错误信封并使用 `Cache-Control: private, no-store`。UUID 只是服务端范围标识，
绝不是授权凭证。Request Model 禁止未知字段。

### SourceExcerpt

| Method 与 Path                                | Permission | Request / Response Contract                                                                                                                                                                               |
| --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /source-excerpts`                       | write      | 从当前可读、同 Space 的 `Resource` 创建 Excerpt；请求包含客户端 UUID、`resource_id`、有界正文、定位、Source Version 标识及规范化/Hash Version。服务端计算规范 Excerpt Hash。返回 201、Version 1 和 ETag。 |
| `GET /source-excerpts/{excerpt_id}`           | read       | 返回活动 Excerpt、定位、来源身份/版本、stale 状态、规范 Hash 元数据、创建者和 Version；只有授权成功且 `If-None-Match` 匹配时才允许 304。                                                                  |
| `GET /source-excerpts`                        | read       | 按 `(created_at desc, id desc)` 进行 Keyset 分页；可选同 Space 的 `resource_id`、stale/status 过滤、`page_size` 和不透明 Cursor；不返回 total count。                                                     |
| `POST /source-excerpts/{excerpt_id}/deletion` | write      | Body 包含 `expected_version`。执行另行批准的保留/闭包规则，绝不留下可见孤儿 Citation。V20-07 决定删除模式前，该路由保持关闭。                                                                             |

Excerpt 证据不可变。正文、定位或 Source Version 身份被纠正时，通过新的
`POST /source-excerpts` 创建记录；现有活动 Citation 被关闭，任何替代关系都必须重新接受。API 不提供
原地修改 Excerpt 正文的 `PUT`。

初始字段限制：Excerpt 正文最多 32 KiB UTF-8 和 20,000 个 Unicode 标量值；Source Version 标识
必须非空且最多 512 UTF-8 bytes；定位使用与 V20-01 一致的显式页码、字符和章节字段。v0.2.0 不接受
任意 Locator JSON。Section Locator 最多 512 个字符。除 Tab/Newline 外拒绝控制字符。正文只作为
纯数据返回，不得作为可信 HTML 渲染。

### KnowledgeCitation

| Method 与 Path                                         | Permission | Request / Response Contract                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /knowledge-citations`                            | accept     | 创建人工编写的正式 Citation。请求包含客户端 UUID、`excerpt_id`、恰好一个 typed target（`topic_id`、`quiz_item_id`、`research_claim_id` 或 `note_id`）、受控关系和可选有界纯文本 Note。两端必须 active、可读且同范围。返回 201、Version 1 和 ETag。 |
| `GET /knowledge-citations/{citation_id}`               | read       | 只有 Excerpt 和 typed target 两端仍可读时才返回 Citation；端点不能暴露哪一端授权失败。                                                                                                                                                             |
| `GET /knowledge-citations`                             | read       | Keyset 分页；可按 `excerpt_id`、一个 typed target、关系和 Cursor 过滤；禁止跨 Space Target 搜索，不返回 total count。                                                                                                                              |
| `POST /knowledge-citations/{citation_id}/replacements` | accept     | 要求 `expected_version` 和一份完整的新不可变关系。在一个事务中以 `superseded` 关闭旧记录并创建重新接受的新记录；Target/Relation/Note 均不得原地修改。                                                                                              |
| `POST /knowledge-citations/{citation_id}/deletion`     | accept     | 要求 `expected_version`；保留模式受 V20-07 门禁控制。                                                                                                                                                                                              |

创建 Citation 是正式用户写入，不是 AI 绕过通道。AI 生成的 Citation 只能通过下述 Acceptance 进入。
在 Shared Space 中，只有 `shared_knowledge.write` 不足以调用三个 Citation Mutation 路由。
`TopicDependency` 永远不能由这些路由创建或表达。可选 Relation Note 是不可变纯文本，最多 2,000
个 Unicode 标量值、8 KiB UTF-8。

### AI Draft Acceptance

`POST /drafts/{draft_id}/acceptances`

Shared Space 要求 `shared_knowledge.accept`，Private Space 要求 owner 身份。Request 包含：

- `idempotency_key`（UUID）和规范 Payload Hash；
- `expected_draft_version` 与准确的已接受 Candidate ID 集合；
- 每个受影响 Target 的 `expected_version`；
- 每个被引用 Excerpt 的 `expected_version`、预期规范 Hash 和预期 Source Version ID；
- 用户明确接受的编辑，字段限制与直接写入一致。

服务必须在一个 PostgreSQL 事务中重新授权，锁定 Draft/Target/Excerpt，验证 Draft 仍为 Suggested
且未接受，写入正式 Node/Edge、typed Citation、幂等 Receipt 和最小 Audit Event，并把 Draft 标记为
Accepted。同一 Key + 同一规范 Payload 返回原始 200 Receipt，不产生新副作用；同一 Key + 不同
Payload 返回 409 `KNOWLEDGE_IDEMPOTENCY_CONFLICT`。任一 Version/Hash/Status stale 或写入失败都
返回 409，正式变化为 0。该事务中严禁调用 Provider。

### 有界图读取

`GET /graph`

必需参数：`root_type`（受支持的正式 Node 类型之一）和 `root_id`。可选参数：`depth`（1 或 2，
默认 1）、`direction`（`out`、`in`、`both`）、受控 `edge_types`、
`include_excerpt_preview`（默认 false）和 Cursor。不存在无范围 Graph Endpoint。

Repository 必须先在选定 Workspace/Space 中授权 Root，再执行按
`(hop, edge_type, edge_id, node_id)` 排序的确定性 BFS 查询。聚合前过滤每个 Node 及每条 Edge 的
两端。不得暴露全局 Count 或隐藏 Edge Count。每页存在不可配置上调的硬上限：150 个不同 Node、
400 条 Edge；部署配置只能降低上限。

Response Shape：

```json
{
  "root": { "type": "topic", "id": "..." },
  "depth": 2,
  "nodes": [],
  "edges": [],
  "truncated": true,
  "truncation_reasons": ["node_limit"],
  "next_cursor": "opaque-or-null",
  "limits": { "nodes": 150, "edges": 400, "bytes": 1048576 }
}
```

当 Node、Edge、候选行、字节或时间任一上限阻止完整分页时，`truncated` 为 true。
`truncation_reasons` 是 `node_limit`、`edge_limit`、`row_limit`、`byte_limit`、`time_limit`
的稳定子集。只有存在可恢复的确定性 Keyset 位置时才返回 `next_cursor`；若无法证明安全续页（尤其是
未完成 Keyset 边界前触发 Time Limit），Cursor 为 null，调用者必须缩小查询。截断响应返回 200，
因为已返回数据均有效且已授权；不得包含遗漏对象数量。

## 5. Version、ETag 与 Cursor 语义

每个生命周期可变实体都有从 1 开始的整数 `version`，每次成功提交的逻辑 Mutation 恰好递增一次。
Source Excerpt 证据和 Citation 关系字段不可变；其 Version 只覆盖生命周期变化，不代表原地内容更新。
单对象 200/201 响应暴露 `version` 和强不透明 ETag；表示变化时 ETag 必须变化，客户端不得解析 ETag。

- JSON Mutation 必须包含 `expected_version`；已授权的 stale 写入返回 409
  `KNOWLEDGE_VERSION_CONFLICT`，`details` 不返回当前 Version。
- JSON Mutation 可选提供 `If-Match`。提供时必须同时匹配已授权的当前 ETag 和 Body Version；
  Header 与 Body 不一致返回 400 `KNOWLEDGE_PRECONDITION_INVALID`。Deletion Action 仍使用 JSON
  `expected_version`，避免出现 DELETE Body 与纯 Header 两套客户端契约。
- 已授权 GET 可以使用 `If-None-Match`；返回 304 前必须重新授权。ETag 相等不得让已撤权主体获得 304。
- Version 只在实体内部使用，不是 Sync Cursor，也绝不进入 sync-v1。

List 和 Graph Cursor 使用 Base64url 编码、版本化、HMAC-SHA256 认证的不透明信封，最大 1,024
字符，有效期最多 15 分钟。信封携带非秘密 Signing-key ID。验证器只接受当前 Key 和前一个 Key；前一个
Key 仅用于验证，保留时间至少覆盖 15 分钟 Cursor Lifetime 加 5 分钟时钟偏差。紧急轮换可以让全部
Cursor 失效。Signing Key 始终是服务端 Secret，不得进入仓库、Cursor Payload、Response Log 或
Metric。Cursor 必须绑定：

- Caller User ID（或隐私安全的内部 Subject）、Workspace ID、Space ID 和 Endpoint Kind；
- 规范 Filter、Ordering、Page Size/Depth/Direction/Edge Types、Include Flag 和 Schema Version；
- 稳定 Keyset Position 与初始查询 Cutoff Timestamp。

每一页都重新授权当前 Membership、Space 可见性、对象端点和 Flag。Cursor 篡改、过期、跨 Endpoint
复用、跨 Caller/Workspace/Space 复用、Filter 改变或 Signing Version 退役，都返回相同消息的
400 `KNOWLEDGE_CURSOR_INVALID`。原始 Cursor 绝不进入日志。

## 6. 资源限制

除现有 Request Body 与基础设施限制外，强制以下硬上限：

| Surface                    | 默认值 | 硬上限 / 行为                                                |
| -------------------------- | -----: | ------------------------------------------------------------ |
| Excerpt/Citation List Page |     25 | 最多返回 100 行；范围过滤后 DB 最多读取 101 个 Candidate Row |
| Graph Depth                |      1 | 2；只能是整数                                                |
| Graph Node                 |    100 | 150 个不同且已授权的 Node                                    |
| Graph Edge                 |    250 | 400 条已授权 Edge                                            |
| Graph Candidate Row        |    n/a | 每个 Statement 最多扫描 600 行；截断或要求缩小查询           |
| Graph Serialized Response  |    n/a | 1 MiB；只能在完整 Node/Edge 边界停止                         |
| List Serialized Response   |    n/a | 512 KiB                                                      |
| Excerpt Request Body       |    n/a | 整体 64 KiB；Excerpt Text 本身仍为 32 KiB UTF-8              |
| DB Statement Time          |    n/a | Graph 750 ms，List 500 ms；由数据库 Statement Timeout 强制   |
| End-to-end API Time        |    n/a | Graph/List 2 秒；不在后台继续                                |

设计采用双 Bucket Rate Limit；两个 Bucket 都必须允许：

| 操作                               | 每 Caller+Workspace |          每 Workspace |
| ---------------------------------- | ------------------: | --------------------: |
| Excerpt/Citation List 或 Item Read |             120/min |             1,200/min |
| Graph Read                         |  20/min，最多并发 2 |  200/min，最多并发 20 |
| Excerpt/Citation Write             |             60/hour |              600/hour |
| Draft Acceptance                   | 20/hour，最多并发 1 | 200/hour，最多并发 10 |

429 响应使用 `KNOWLEDGE_RATE_LIMITED`、`retryable: true` 和 `Retry-After`，不得披露另一个
Bucket 的占用。只有无法形成有效截断页边界时，Query Timeout 才返回 503
`KNOWLEDGE_QUERY_TIMEOUT`。容量告警应暂停摄入/Shared Write，不能提高硬上限。

## 7. 稳定错误码

| HTTP | Code                               | 含义 / 披露规则                                                         |
| ---: | ---------------------------------- | ----------------------------------------------------------------------- |
|  400 | `KNOWLEDGE_CURSOR_INVALID`         | Cursor 无效、过期、被篡改或范围错误；消息完全相同                       |
|  400 | `KNOWLEDGE_PRECONDITION_INVALID`   | 授权后发现 Body/Header 前置条件不一致或格式错误                         |
|  401 | 现有认证错误码                     | 沿用现有 Session 行为；本设计不新增认证错误码                           |
|  403 | `KNOWLEDGE_OPERATION_DENIED`       | Shared Space 可见，但调用者缺少 write/accept Permission                 |
|  403 | `KNOWLEDGE_SHARED_WRITES_DISABLED` | 已授权 Shared reader 尝试全局关闭的 Shared Mutation                     |
|  403 | `KNOWLEDGE_DELETION_DISABLED`      | 已授权调用者在删除/恢复门开启前调用删除动作                             |
|  404 | `RESOURCE_NOT_FOUND`               | 对象缺失/非活动/跨范围/Private 非 owner/端点不可读；Body 大小与消息相同 |
|  404 | `KNOWLEDGE_FEATURE_DISABLED`       | 主能力关闭；尚未查询对象                                                |
|  409 | `KNOWLEDGE_VERSION_CONFLICT`       | 已授权实体/Draft/Target/Excerpt Version 或 Hash stale                   |
|  409 | `KNOWLEDGE_IDEMPOTENCY_CONFLICT`   | 同一 Acceptance Key 对应不同规范 Payload                                |
|  409 | `KNOWLEDGE_STATE_CONFLICT`         | 非法 active/deleted/stale/draft 状态转换；无部分写入                    |
|  409 | `KNOWLEDGE_QUOTA_EXCEEDED`         | 范围存储配额已满；不披露租户总量                                        |
|  422 | `KNOWLEDGE_TARGET_INVALID`         | 已授权请求包含零/多个/不支持的 typed target 或非法关系                  |
|  422 | `VALIDATION_ERROR`                 | 现有字段验证信封                                                        |
|  429 | `KNOWLEDGE_RATE_LIMITED`           | Rate 或 Concurrency Budget 超限                                         |
|  503 | `KNOWLEDGE_QUERY_TIMEOUT`          | 无法生成安全的有界/截断响应                                             |

Permission Denial 与不透明 404 可以使用只对安全平面可见的原因元数据审计；公开响应、延迟类别和
Payload 不得区分不存在与无权限。Error、Log、Metric 和 Audit Metadata 禁止包含正文、完整 Hash、
Locator Text、Filename、Target Title、Filter 和 Cursor。

## 8. 必需负测与边界测试

### 授权与枚举

1. 随机 ID、其他 Workspace、其他 Space、已删除对象和不可读 Citation 端点必须返回完全相同的
   `RESOURCE_NOT_FOUND` 信封，不包含 Version/Target 提示。
2. Workspace Owner/Admin 不能通过这些路由读取、List、Graph、Export、Write、Accept、获得 304，
   或推断他人 Private Space 的 Count。
3. Private owner 在有效状态下成功；初次解析与行锁之间发生 Membership 撤销/暂停时，事务失败关闭，
   Mutation 为 0。
4. Shared 各角色严格匹配 Read/Write/Accept 矩阵；角色变化必须从下一次请求和下一页 Cursor 立即生效。
5. 请求中途关闭主/Shared-write/Deletion Flag，提交前重新检查后不得落入任何写入。
6. 即使 Citation Row 仍为 active，只要 Excerpt 或 Target 任一端不可读，Citation Read 就必须不透明失败。

### 范围、Typed Target 与 Acceptance

7. 跨 Workspace、跨 Space、跨 Private Owner、零 Target、多 Target、错误类型、已删 Target 和 stale
   Resource/Excerpt 尝试全部失败，写入行数为 0。
8. AI/Worker 不得调用绕过 Acceptance Service 的 Repository 正式 Node/Citation 写路径；Route/
   Repository 审计必须证明不存在替代正式写入口。
9. Acceptance 与 Edit/Delete/Share/Revoke/Source-Version Change 竞态时，返回稳定冲突或不透明拒绝，
   Target/Citation/Audit/Receipt 不得部分写入。
10. 每个 Acceptance 写点都必须执行故障注入并证明全有或全无。N 个并发的同 Key 同 Payload 请求只
    产生一个 Receipt/副作用集合；不同 Payload 冲突。
11. Contributor 不能创建/替换/删除正式 Citation 或接受 Draft；Reviewer 不能编辑 Excerpt；Viewer
    不能写；Owner/Admin/Editor 遵循获批矩阵。

### Version、ETag、Cursor 与披露

12. stale `expected_version`、stale `If-Match` 以及 Header/Body 不一致，只能在授权之后拒绝，且不能
    暴露当前 Version。
13. `If-None-Match` 只有在当前授权仍成功时才返回 304；撤权或 Private Owner 变化后返回不透明 404。
14. Cursor 必须拒绝 Bit Flip、超长值、非法编码/签名/版本、过期、跨 User/Workspace/Space/Endpoint，
    以及任意 Filter/Order/Page-size/Depth/Include Flag 变化。
15. 增加一个不可见的 Private Node/Edge，不得改变其他条件相同查询的公开状态、Total Count（不存在）、
    Truncation Reason 或可明显区分的 Response Size。

### 有界查询与运维安全

16. Depth 0/3、Cycle、Self-edge、151+ Node、401+ Edge、601+ Candidate、稠密 Two-hop Graph、
    Slow Statement 和超过 1 MiB 的 Response，都必须在文档化边界停止。
17. 截断 Graph Page 只能包含完整 Node/Edge、稳定 Reason、无遗漏 Count，并且只在可证明可恢复的
    Keyset 边界返回 Cursor。每次重复分页都不得突破单请求上限。
18. Rate Test 必须分别覆盖 Caller 和 Workspace Bucket；Cancel/Exception 后释放 Concurrency；Key
    使用隐私哈希；返回 `Retry-After`；Telemetry 不含原始 ID/Cursor。
19. Unicode Byte Limit、非法控制字符、恶意 Markdown/HTML/URL 和最大 Locator 结构，不得造成 XSS、
    超大序列化或日志泄漏。
20. OpenAPI 工作获单独授权后，只能产生增量 Diff；sync-v1 Schema、Validator、Golden Vector、
    Operation、Pull/Bootstrap、Vault、IndexedDB 和 Outbox 在生成结果可确定时必须逐字节不变。

## 9. 已批准的设计决定与保留门禁

1. 三个 Permission 名称以及 Contributor/Reviewer 职责分离已批准。
2. 在 Accept Authority 下允许人工编写 `POST /knowledge-citations`；Shared Space 必须要求
   `shared_knowledge.accept`，防止 Contributor 利用 Write Authority 绕过正式接受。
3. 三 Flag 发布顺序已批准。Shared Read 可在 V20-04 获单独授权并通过 Read-path Security Gate 后先行；
   Shared Write/Accept 继续关闭，直到独立生产隐私/法律门禁和 Write/Accept 负测通过；Deletion 在恢复/
   备份证据通过前保持关闭。
4. JSON `expected_version` 是规范方式；ETag 仅作为 GET Validator/可选一致性检查，不形成另一套纯
   Header Mutation Contract。
5. Endpoint 名称已批准，包括 Action 风格的 `/replacements`、`/deletion` 和 `/acceptances`；V20-04
   获单独授权前不得生成 Contract/OpenAPI 文件。
6. 六种受控 Citation Relation、最多 2,000 标量值 / 8 KiB、不可变且可选的纯文本 Relation Note
   已批准；不得从 Target Type 推断 Relation 语义。
7. 正文/页码/行数/时间/字节/速率限制、显式 Locator Shape，以及带当前/上一 HMAC Key 轮换的 15 分钟
   Cursor Lifetime 已批准。生产测量可以降低这些值，但不得提高 150 Node、400 Edge 或 Depth 2。
8. V20-07 已冻结 Delete/Restore 与 Shared Contribution 保留方向；Deletion Route 或 Shared Write
   仍须分别通过实现、负测和生产启用门禁。
9. Time-truncated Graph 保留当前区分：存在完整、可恢复边界时返回 200 截断页；无法形成安全边界时
   返回 503 `KNOWLEDGE_QUERY_TIMEOUT`。

批准本文档只表示：在另行授权时，可以进入 V20-04 Contract 设计/生成；它不授权 Migration、Route/
Schema 实现、生产启用，也不授权改变冻结的 Auth、Space、AI Gateway 或 sync-v1 边界。
