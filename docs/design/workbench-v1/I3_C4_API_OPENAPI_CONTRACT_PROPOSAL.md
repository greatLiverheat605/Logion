# I3-C4 自定义 Workbench API/OpenAPI 合同定型提案

状态：Proposed，仅供 API、OpenAPI、安全与 Product Owner 评审  
日期：2026-08-19  
前置批准：[I3-C2 API/Schema 设计提案](./I3_C2_API_SCHEMA_DESIGN_PROPOSAL.md)、[I3-C3 Schema/合同定型提案](./I3_C3_SCHEMA_CONTRACT_DESIGN_PROPOSAL.md)  
当前基线：`codex/product-workbench-v1-spec` / `4d538645305d72dcc8a9c67de6d973743a3fb018`

本文件只冻结待实现的 HTTP 与生成合同。它不修改 `apps/api/**`、`packages/contracts/**`、数据库、迁移、Web、根 Manifest、锁文件、生产配置或 Feature Flag，也不运行 `contracts:generate`，不批准任何正式数据路径。

## 1. 结论与最小边界

I3-C4 只增加一组当前用户所有的自定义 Workbench 资源，共 **10 个绝对 API path、15 个 operation**。这是冻结不变量；任何实现、生成快照或测试若得到的数量不是 `paths=10` 且 `operations=15`，立即失败。

- 前 10 个 operation 覆盖 Definition、生命周期、删除影响和导入导出；
- 其余 5 个 operation 覆盖 Link 列表与 mutation；二者合计始终为 15；
- Preference 继续复用现有 `GET/PUT /api/v1/users/me/settings`，不增加第三个 endpoint；
- 不增加 GraphQL、批量任意查询、异步 Job、Webhook、共享 Workbench、管理员旁路或第二套并发协议。

全部新路径位于 `/api/v1/users/me/workbenches`，只接受自定义 Workbench UUID。四个固定 Workbench 仍由代码定义，不是 Definition 资源，不进入这 10 个 path。

本门把 I3-C2/C3 的候选描述收紧为可生成合同，但仍不授权路由实现、Schema 文件、OpenAPI 快照、数据库表、迁移、配额、威胁模型、前端保存能力或生产启用。

## 2. 前置歧义的最终解释

### 2.1 Feature Flag 与路由注册

`workbench_custom_api_enabled=false` 时不注册本提案的 15 个操作。请求必须与现有未注册路径得到相同 status、body 和 headers，不返回 Workbench 专用错误码，也不运行 Session、CSRF、限流、数据库或目标解析。该规则取代 I3-C2 的 `WORKBENCH_FEATURE_DISABLED` 候选码。

能力开启且路由已注册后，单次请求才进入 Session、mutation 安全边界、owner、Schema、typed target ACL、并发和写入流程。Flag 变更属于启动配置，要求应用重启，不提供运行时请求参数或 UserSetting 开关。

### 2.2 Preference 不改旧 OpenAPI

现有操作保持原样：

```text
GET /api/v1/users/me/settings?key=workbench.preference
PUT /api/v1/users/me/settings
```

`UserSettingWrite`、`UserSettingBatchUpdate`、`UserSettingResponse`、两个 operationId、状态码和 8192 字符语义不得变化。能力开启时，服务端仅对 key 精确等于 `workbench.preference` 的字符串 value 执行 I3-C3 二次严格解析和 `outer version=n -> inner revision=n+1` 校验；其他 key 继续走现有路径。

`WorkbenchPreferenceDocumentV1` 作为新增、可独立生成的 component 暴露给类型消费者，但不通过修改 `UserSettingWrite.value: string` 建立条件 union。Flag 关闭时通用设置服务不解释该 key；若其中已有数据，固定 Workbench 与旧 Persona 仍按现有行为工作，自定义投影失败关闭。

### 2.3 JSON 命名与严格对象

I3-C3 冻结的便携文档和新资源 JSON 使用其既有 camelCase 字段。URL path/query/header 使用 HTTP 约定的 snake_case 或标准 Header 名。现有 API Schema 不改名。

普通对象均关闭未知字段。只有 I3-C3 明确批准的字典字段，例如 `defaultViewByWorkbench`、`defaultSpaceByWorkbench` 和 `attributes`，可以使用受 `propertyNames` 与 typed `additionalProperties` 共同约束的动态键；它们不是任意 JSON。

## 3. 路径与 operationId 清单

下表 `Path` 均为完整绝对 API path；实现方不得再拼接或移除任何前缀。

|   # | Method   | Path                                                          | operationId                                | 成功结果                                                                  |
| --: | -------- | ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
|   1 | `GET`    | `/api/v1/users/me/workbenches`                                | `workbench_definition_list`                | `200 WorkbenchDefinitionPageResponse`                                     |
|   2 | `POST`   | `/api/v1/users/me/workbenches`                                | `workbench_definition_create`              | `201 WorkbenchDefinitionResponse`                                         |
|   3 | `POST`   | `/api/v1/users/me/workbenches/imports`                        | `workbench_import`                         | `201 WorkbenchImportSucceededReceipt`; `200 WorkbenchImportFailedReceipt` |
|   4 | `GET`    | `/api/v1/users/me/workbenches/{workbench_id}`                 | `workbench_definition_get`                 | `200` 或 `304`                                                            |
|   5 | `PUT`    | `/api/v1/users/me/workbenches/{workbench_id}`                 | `workbench_definition_replace`             | `200 WorkbenchDefinitionResponse`                                         |
|   6 | `POST`   | `/api/v1/users/me/workbenches/{workbench_id}/archive`         | `workbench_definition_archive`             | `200 WorkbenchDefinitionResponse`                                         |
|   7 | `POST`   | `/api/v1/users/me/workbenches/{workbench_id}/restore`         | `workbench_definition_restore`             | `200 WorkbenchDefinitionResponse`                                         |
|   8 | `GET`    | `/api/v1/users/me/workbenches/{workbench_id}/deletion-impact` | `workbench_definition_deletion_impact_get` | `200 WorkbenchDefinitionDeletionImpact`                                   |
|   9 | `DELETE` | `/api/v1/users/me/workbenches/{workbench_id}`                 | `workbench_definition_delete`              | `200 WorkbenchDefinitionDeleteReceipt`                                    |
|  10 | `GET`    | `/api/v1/users/me/workbenches/{workbench_id}/export`          | `workbench_definition_export`              | `200 WorkbenchExportV1` 下载                                              |
|  11 | `GET`    | `/api/v1/users/me/workbenches/{workbench_id}/links`           | `workbench_link_list`                      | `200 WorkbenchLinkPageResponse`                                           |
|  12 | `POST`   | `/api/v1/users/me/workbenches/{workbench_id}/links`           | `workbench_link_create`                    | `201 WorkbenchObjectLinkResponse`                                         |
|  13 | `PATCH`  | `/api/v1/users/me/workbenches/{workbench_id}/links/{link_id}` | `workbench_link_patch`                     | `200 WorkbenchObjectLinkResponse`                                         |
|  14 | `DELETE` | `/api/v1/users/me/workbenches/{workbench_id}/links/{link_id}` | `workbench_link_delete`                    | `200 WorkbenchLinkDeleteReceipt`                                          |
|  15 | `POST`   | `/api/v1/users/me/workbenches/{workbench_id}/links/reorder`   | `workbench_link_reorder`                   | `200 WorkbenchLinkSetResponse`                                            |

`/imports` 和 `/links/reorder` 必须在相邻动态 UUID 路由前注册。`workbench_id` 与 `link_id` 使用自定义 UUID route converter/route wrapper：解析失败、`fixed.*` 或未知静态子路径在进入 FastAPI/Pydantic body/path validation 和资源查询前统一落入与未注册路径相同的 404；不得使用默认 UUID 参数让非法值产生 422。

operationId 必须全仓唯一。不得依赖 FastAPI 自动命名，也不得重命名任何旧 operationId。

## 4. 通用 HTTP 合同

### 4.1 Content type 与正文

- JSON request/response 使用 `application/json`，UTF-8；严格解析规则沿用 I3-C3；
- 导出响应使用 `application/json` 与 attachment disposition，不生成 ZIP；
- 不接受 multipart、form、YAML、HTML、JSON Patch、Merge Patch 或压缩嵌套包；
- 解析后 Definition 上限 32 KiB、单 Link mutable 上限 2 KiB；反向代理/应用的更大 transport 上限仍由威胁模型门冻结；
- transport 上限在 JSON 解析前触发时使用现有通用 413；合同大小、递归、字段或 union 失败使用 422 Workbench Schema error。

### 4.2 请求 Header

| Header            | 使用范围                                                     | 合同                                                                                                       |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `Origin`          | 所有 mutation、import、export                                | 必需 trusted Origin Header；字符串 1-2048 字符；缺失、不可信或不匹配沿用现有 403                           |
| `X-CSRF-Token`    | 所有 mutation、import、export                                | 继续使用现有 cookie/session 双提交校验；缺失或不匹配沿用现有 403                                           |
| `Idempotency-Key` | Definition create、Definition delete、Link create、import    | 必需 UUID；按当前 user 在 Workbench 能力内唯一；operation 进入 fingerprint，同一 Key 不得跨 operation 复用 |
| `If-Match`        | Definition replace/archive/restore/delete、Link patch/delete | 可选强不透明 ETag，2-256 字符；若提供，必须与 body revision 指向同一当前版本                               |
| `If-None-Match`   | Definition get                                               | 可选，1-1024 字符；授权复核后匹配才返回 304                                                                |

`Origin` 仍由现有安全边界校验，但对所有 mutation、import、export operation 必须作为 required Header 参数显式生成；它不是新的认证 scheme。认证继续使用现有 HttpOnly Session cookie，不增加 bearer token 合同。C4 **不新增或命名 OpenAPI `securitySchemes`**：Session cookie、trusted Origin 和 CSRF 是运行时安全顺序，不生成客户端可调用的 security object；现有 OpenAPI 的 security 元数据保持不变。C5 不得自行补充 security scheme。

### 4.3 响应 Header

- 能力开启后的所有 Workbench 成功响应与专用错误响应：`Cache-Control: private, no-store`；
- 单 Definition、单 Link 及其 mutation 成功响应：强不透明 `ETag`；客户端不得解析；
- Link 列表、reorder 和 Link 删除 receipt 的 `ETag` 表示提交后的整个 Link 集合版本（由 `linkSetRevision` 派生）；Definition 删除 receipt 和导出下载不携带 `ETag`，因为它们不再代表可写资源；
- create 成功响应：`Location` 指向新资源；资源仍可授权读取时，精确幂等重放返回与首次相同的 status、body、Location 与 ETag；资源后来不可读时适用下文的安全 404 终态，不返回旧正文；
- 429：有界整数秒 `Retry-After`，不返回剩余配额；
- export：`Content-Disposition: attachment; filename="workbench-<uuid>.json"`；
- 错误始终包含现有五字段 `ErrorResponse` 的 `request_id`。

幂等重放仍先验证当前 Session 和 receipt owner。首次成功产生的 receipt、Definition ID 或 Link ID 在当前用户范围内永久绑定该 `(operation, Idempotency-Key, fingerprint)`，不得因重试创建副本。Import 的 receipt 本身不含对象正文，因此只要 receipt owner 仍可验证，即使导入的 Definition 后来被删除，也返回同一安全 receipt；Definition/Link create 则在原资源仍可授权读取时返回首次相同的 status、body、`Location` 与 `ETag`，若原资源已删除、归档策略使其不可读或 target ACL 已撤销，重放返回不透明 404，**不返回旧正文或目标信息**，并将该 Key 视为已结算、不可改用。Definition delete 可以在验证当前 user 的 receipt owner 后返回不含对象正文的原删除 receipt。该安全例外是终态授权结果，不是可重试错误，且不改变 C2/C3 的“同 Key 不创建第二份资源”语义。

## 5. Definition 操作

### 5.1 List

`GET /api/v1/users/me/workbenches` 只接受：

| Query       | 合同                                      |
| ----------- | ----------------------------------------- |
| `lifecycle` | 可选 `active` 或 `archived`；省略表示两者 |
| `limit`     | integer 1-50，默认 25                     |
| `cursor`    | 可选不透明字符串，最长 1024               |

排序固定为 `updatedAt desc, id desc`。响应只含 `items` 与可空 `nextCursor`，不含 total、offset、页码、Link 数或目标对象数。cursor 必须绑定当前 user、lifecycle、排序和快照边界；非法、过期、跨用户或过滤器不匹配统一 422，不回显 cursor 内容。

`WorkbenchDefinitionSummary` 只含 `id`、服务端生成的 `ownerUserId`、`name`、`description`、`icon`、`accent`、`templateId`、`revision`、`lifecycle`、`createdAt`、`updatedAt`，不内联 document 模块、Link 或对象摘要。

### 5.2 Create 与 get

Create body 为 `WorkbenchDefinitionCreateRequest { document }`。模板只作为 document 中已冻结的 `templateId`，服务端不接受复制来源 ID、owner、scope 或任意参数。首次成功为 201、`revision=1`；同 user、operation、Idempotency-Key 与 fingerprint 的精确重放返回相同资源，不再次占用配额。

Get 返回 `WorkbenchDefinitionResponse`。active 与 archived 均可由 owner 读取；archived 不自动进入导航。`If-None-Match` 只有在重新确认 owner/lifecycle 后才能结算 304，且 304 仍带 `Cache-Control` 与 `ETag`。

### 5.3 Replace、archive 与 restore

Replace body 复用 I3-C3：

```json
{
  "expectedRevision": 4,
  "base": {},
  "local": {}
}
```

`base` 和 `local` 均为完整 `WorkbenchDefinitionDocumentV1`。成功仅保存 local，revision 原子加 1。

Archive/restore body 为 `WorkbenchDefinitionLifecycleRequest { expectedRevision, baseLifecycle }`。archive 只接受 `baseLifecycle=active`，restore 只接受 `baseLifecycle=archived`。它们不删除或恢复正式对象，不更改 Link 内容；成功 revision 原子加 1。restore 还必须重新满足后续配额门，但不把当前配额值写入错误。

三类操作的 body revision 是并发权威。可选 `If-Match` 若存在必须映射同一 revision；Header/body 不一致或 ETag 非法返回 400 `WORKBENCH_PRECONDITION_INVALID`。owner 与资源活动检查先于返回 revision/ETag/冲突详情。

### 5.4 删除影响与 delete

删除必须先读取 `deletion-impact`。响应仅含：

```text
workbenchId
revision
linkSetRevision
linkCount
preferenceWillFallback
fallbackWorkbenchId = fixed.learning
formalObjectDeleteCount = 0
impactFingerprint
```

## Approved Baseline Amendment (2026-08-20)

Definition summary and detail responses must expose `ownerUserId`. The existing terminal failed receipt remains `retryable=false`; only a proven pre-commit failure may return `503 retryable=true` without creating a receipt. `linkSetRevision` is the Definition-row collection version, atomically advanced with Link mutations. The production Feature Flag is the sole route-registration gate and remains default-off.

`linkCount` 统计当前用户拥有的 Link 记录，不按目标可见性分组，不返回 kind、Space、标题或成员。`impactFingerprint` 是服务端对上述有界影响、当前 user 和 revision 的不透明签名，最长 1024 字符。

Delete body 为 `WorkbenchDefinitionDeleteRequest { expectedRevision, expectedLinkSetRevision, impactFingerprint }`，并要求 `Idempotency-Key`。服务端重新计算影响并重新授权；预览过期返回 409，不自动扩大删除范围。成功在单事务内删除 Definition 与其 Link，并把 Preference 中的活动/默认引用回退或清除；正式对象删除数必须为 0。部署门必须证明受支持的 HTTP 代理会保留 DELETE JSON body；不支持或会丢弃 body 的部署不得注册该路由，禁止把关键字段降级到 query、URL 或未认证 fallback。

`WorkbenchDefinitionDeleteReceipt` 只含 receipt ID、已删除 Definition ID、删除 Link 数、Preference 回退结果和时间戳，不含对象正文、目标 ID、Space 或 ACL。精确幂等重放返回原 receipt。

固定 Workbench 不匹配 UUID 路由，因此不存在 archive/restore/delete 行为。

## 6. Link 操作

### 6.1 List

`GET /api/v1/users/me/workbenches/{workbench_id}/links` 只接受 `limit`（1-100，默认 50）和最长 1024 的不透明 `cursor`。排序固定为 `position asc, id asc`。

响应只含当前请求时仍可授权的 `items` 与可空 `nextCursor`，不含 total 或被过滤数量。cursor 绑定当前 user、Workbench、排序与快照。服务端候选扫描、响应字节和时间必须有界；具体上限由配额/威胁模型门批准。无法证明安全续页时返回 `nextCursor=null`，不能伪造完整性。

### 6.2 Create、patch 与 delete

Create body 为 `WorkbenchLinkCreateRequest { baseLinkSetRevision, local }`，并要求 `Idempotency-Key`。typed target 只从 `local.target` 解析，每次重放前仍重新确认当前 ACL；成功 Link revision 为 1，linkSetRevision 原子加 1。

Patch body 为 `WorkbenchLinkPatchRequest { expectedRevision, baseLinkSetRevision, base, local }`。`base`/`local` 都是完整 `WorkbenchLinkMutableV1`。target 不可修改；若 local.target 与现有 target 不同返回 422。成功同时递增 Link revision 与 linkSetRevision。

Delete body 为 `WorkbenchLinkDeleteRequest { expectedRevision, baseLinkSetRevision, base }`。成功只删除 Link 并递增集合版本，返回 `WorkbenchLinkDeleteReceipt { linkId, linkSetRevision, deletedAt }` 和表示新 Link 集合版本的强不透明 `ETag`；不删除或修改正式对象。部署门必须证明受支持的 HTTP 代理会保留 DELETE JSON body；否则该路由保持未注册，不能提供替代的 query、URL 或未认证 fallback。

Create、patch、delete 都必须按 I3-C3 registry 重新解析 target 及嵌套 object-reference 属性。合法 kind 的不存在、tombstone、scope 不一致或无权统一 404；未知 kind/字段/形状为 422。客户端提供的 Workspace/Space、owner、Role 或权限字段始终非法。

### 6.3 Reorder

Reorder body 为 `WorkbenchLinkReorderRequest { baseLinkSetRevision, baseOrder, orderedLinkIds }`。`baseOrder` 与 `orderedLinkIds` 都必须包含当前 Workbench 的完整 Link ID 集合，每个 ID 恰好一次，最多值由后续 Link 配额决定且不得超过 Schema 硬上限 500。

成功只更新 position 并把 linkSetRevision 原子加 1，返回 `WorkbenchLinkSetResponse { linkSetRevision, orderedLinkIds }`。缺失、额外、重复或外部 Link ID 为 422；集合在基线后变化为 409。响应和冲突详情不得包含目标正文、成员或 ACL。

## 7. Export 与 import

### 7.1 Export

`GET /api/v1/users/me/workbenches/{workbench_id}/export` 只接受 `include_links: boolean=false`。false 时省略 `links`；true 时只输出当前仍可授权的 `WorkbenchLinkMutableV1`，不返回被过滤数量或原因。导出包严格复用 `WorkbenchExportV1`，不含服务端 ID、revision、owner、对象正文、成员、ACL 或审计数据。

Export 是敏感读取：除 Session 与 owner 外仍要求 trusted Origin、CSRF 和用户级限流。与其他 mutation/import 一样，`Origin` 与 `X-CSRF-Token` 是该 GET operation 的必需 Header 参数，并必须在 OpenAPI 该 operation 的 `parameters` 中显式生成；Workbench operation 的 `security` 字段缺失，Session 只属于运行时授权顺序，不生成 OpenAPI security 元数据。响应不写日志正文，不形成共享 URL，不支持邮件发送。

### 7.2 Import

Import 要求 `Idempotency-Key` Header，body 为 `WorkbenchImportRequest { sourceFingerprint, payload }`。sourceFingerprint 和服务端请求 fingerprint 按 I3-C3 的 RFC 8785 operation token 分别重算；不匹配在任何 Definition/Link 写入前失败。operation token 至少扩展为 `workbench.definition.create.v1`、`workbench.definition.delete.v1`、`workbench.link.create.v1` 和 `workbench.import.v1`。

HTTP 结算固定为：

- 201：首次成功或相同 Key、operation 与 fingerprint 的成功重放，返回 `status=succeeded` receipt；
- 200：仅当后续数据库门能够持久化一个无 Definition/Link 半写入的终态失败时，返回 `status=failed, retryable=false` 的同一 receipt；200 不得与 `status=succeeded` 搭配；
- 409：相同 Key 对应不同 operation 或 fingerprint，不返回任一 fingerprint；
- 4xx：认证、Schema、sourceFingerprint、授权或配额在 attempt 接纳前失败，使用 ErrorResponse，不创建 receipt；
- 503：仅限**原子提交点之前**、且服务端能证明没有 Definition、Link、Preference 或 receipt 写入的瞬时基础设施失败；相同 Key 可以安全重试。

数据库/迁移门必须提供 Definition/Link/Preference 变更与幂等 receipt 的同事务提交，或等价的可证明 durable journal；不得出现资源已提交而 receipt 丢失的“不确定写入”状态。若事务在提交点后无法确认，服务端不得返回可重试 503，也不得让客户端盲重试创建；必须由原子 receipt 结算使同一 Key 可确定地返回原结算。若无法证明该恢复合同，v1 必须停止，不能声称导入/创建幂等已实现。本门不批准 failed receipt 的具体存储或事务方案；数据库门负责证明失败 receipt 与 Definition/Link 零半写入。

不可用 Link 仍按 I3-C3 聚合到 succeeded receipt 的 `skippedLinks={count, reason:not_available}`；Definition 创建成功不因个别 Link 无权而失败。任何 Link 的 object-reference 属性不可用时整条 Link 跳过，不保留部分属性。

## 8. 错误与状态码矩阵

所有 Workbench 专用错误都是现有五字段 ErrorResponse 的严格变体；不修改旧 `ErrorResponse` component。

| HTTP | Code                             | 使用条件                                            | retryable        |
| ---: | -------------------------------- | --------------------------------------------------- | ---------------- |
|  400 | `WORKBENCH_PRECONDITION_INVALID` | Header/body 前置条件不一致或 ETag 非法              | false            |
|  401 | 现有认证错误                     | Session 缺失/失效                                   | 现有语义         |
|  403 | 现有 CSRF/Origin 错误            | mutation/import/export 安全边界失败                 | false            |
|  403 | `WORKBENCH_OPERATION_DENIED`     | 已确认可见资源上的命令被策略拒绝                    | false            |
|  404 | `RESOURCE_NOT_FOUND`             | owner、资源、typed target、scope 或活动状态失败关闭 | false            |
|  409 | `WORKBENCH_VERSION_CONFLICT`     | Definition/Link/link set/删除影响冲突               | false            |
|  409 | `WORKBENCH_IDEMPOTENCY_CONFLICT` | 同 Key 的 operation 或 fingerprint 不同             | false            |
|  413 | 现有 transport 错误              | 原始 HTTP body 超过部署硬上限                       | false            |
|  422 | `WORKBENCH_PREFERENCE_INVALID`   | Preference 二次严格解析失败                         | false            |
|  422 | `WORKBENCH_SCHEMA_INVALID`       | 新请求、cursor、target 或跨字段合同失败             | false            |
|  429 | `WORKBENCH_RATE_LIMITED`         | 用户级速率/配额拒绝                                 | true             |
|  503 | 现有服务不可用错误               | 限流器、数据库或必要基础设施不可用                  | 按下述零写入规则 |

Feature Flag 关闭不出现在此表，因为路由未注册。validation details 最多 32 项 `{path, rule}`，不含 rejected value。404/403/409/429 不返回对象标题、目标 kind/ID、Space、成员、ACL、剩余配额或两个 fingerprint。

503 只有在服务端能够证明本次请求没有提交任何 Definition、Link、Preference 或 receipt 写入时才可 `retryable=true`；原子提交点后的不确定状态不得以 `retryable=false` 交给客户端猜测，必须由数据库门的原子 receipt 结算消除。网络中断本身不由 ErrorResponse 伪装成已知结算结果。

## 9. 请求处理与授权顺序

### 9.1 路由未注册分支

Flag 关闭：路由表不包含 15 个操作，直接走现有通用 404。此分支不执行下列 pipeline。

### 9.2 路由已注册分支

1. Session；
2. mutation/import/export 的 trusted Origin、CSRF 与用户级限流；
3. UUID 路径与当前用户 Definition/Link owner 解析；
4. 有界原始 body 读取、duplicate-aware JSON、Schema 与跨字段校验；
5. typed target 的真实 Workspace/Space/个人 scope、tombstone 和现有 ACL；
6. 配额、revision/ETag、冲突路径、幂等 fingerprint 与事务写入；
7. 固定响应、receipt 与最小审计。

对已注册 mutation，owner 失败必须先于 body 422、版本、ETag、冲突详情和配额当前值。FastAPI 默认 body 解析顺序若无法证明这一点，正式实现必须使用有界 raw-body dependency/route wrapper，而不是接受时序泄露。wrapper 只负责顺序和严格解析，不创建第二套业务 Schema。

每次幂等重放、409 合并再提交、导入、导出和列表续页都重新执行当前授权。缓存、旧 receipt、base/local/remote 或客户端 UI 状态都不是授权事实。

## 10. OpenAPI component 清单

正式候选至少新增以下命名 component；具体拆分可更细，但不得用无界 `object` 代替：

- `WorkbenchPreferenceDocumentV1`；
- `WorkbenchDefinitionDocumentV1` 及 module/layout/filter/quick-create/field unions；
- `WorkbenchDefinitionCreateRequest`、`WorkbenchDefinitionReplaceRequest`、`WorkbenchDefinitionLifecycleRequest`；
- `WorkbenchDefinitionSummary`、`WorkbenchDefinitionResponse`、`WorkbenchDefinitionPageResponse`；
- `WorkbenchDefinitionDeletionImpact`、`WorkbenchDefinitionDeleteRequest`、`WorkbenchDefinitionDeleteReceipt`；
- `WorkbenchTargetV1` 七种 discriminated variant；
- `WorkbenchLinkMutableV1`、create/patch/delete/reorder request；
- `WorkbenchObjectLinkResponse`、`WorkbenchLinkPageResponse`、`WorkbenchLinkDeleteReceipt`、`WorkbenchLinkSetResponse`；
- `WorkbenchExportV1`、`WorkbenchImportRequest`；`WorkbenchImportSucceededReceipt`（`status` const `succeeded`、`retryable` const `false`、`definitionId` required UUID）与 `WorkbenchImportFailedReceipt`（`status` const `failed`、`retryable` const `false`、`definitionId` const `null`）；两者共享 receipt 字段约束但必须是独立 response `$ref`；
- Workbench code-specific error response/details variants。

生成规则：

`WorkbenchImportSucceededReceipt` 与 `WorkbenchImportFailedReceipt` 都使用 `allOf: [{"$ref":"#/components/schemas/WorkbenchImportReceipt"}, <const overlay>]`；overlay 必须关闭未知字段并分别固定 `status`、`retryable`、`definitionId`。因此 201 response 只能引用成功 component，200 response 只能引用失败 component，不能把两个状态合并到一个 `$ref` 或仅靠文字条件表达。

- OpenAPI 3.1；所有 union 有显式 discriminator 与互斥 `oneOf`；
- UUID 使用 `format: uuid`；SafeInteger 有 minimum/maximum；数组有 maxItems 与必要 uniqueItems；
- 普通对象 `additionalProperties=false`；受控字典使用 propertyNames + typed additionalProperties；
- nullable、required、enum、const、长度、pattern 和数值范围必须进入快照；
- Header、200/201/304/400/401/403/404/409/413/422/429/503 响应必须出现在对应 operation；所有 mutation/import/export operation 必须显式包含 `Origin` 与 `X-CSRF-Token` Header 参数；所有 Workbench operation 的 OpenAPI `security` 字段必须缺失，Session 只属于运行时授权顺序，不生成 OpenAPI security 元数据；
- 不把 CSRF cookie、Session cookie、owner、内部 fingerprint、数据库 ID 或配置开关值生成为客户端可写字段。

## 11. 生成方式与 dormant contract

生产 `create_app()` 只在服务端 flag 开启时注册路由。合同导出器可以使用仅进程内的 `include_dormant_contracts=true` 构建模式注册同一 router 以生成快照，但该模式：

- 不是环境变量、HTTP 参数、UserSetting 或生产 Feature Flag；
- 不能启动服务、连接数据库、创建表、执行 mutation 或改变默认 Settings；
- 只允许 `logion_api.openapi_export` 和直接合同测试调用；
- 必须测试普通默认 app 不含这 10 个 path，合同 app 含精确 10 个 path、15 个 operationId。

不得维护一份手写 OpenAPI 路径副本。Pydantic/FastAPI Schema 是生成来源，现有流程继续为：

```text
pnpm contracts:generate
pnpm contracts:check
```

实现门必须先保存旧快照的 semantic manifest，再生成候选并验证：

- 只增加批准的 15 个 operation 和新 component；
- 旧 paths、operationId、parameters、responses、security 和 components 语义零变化；
- `UserSettingWrite`、`ErrorResponse`、persona、sync-v1、Vault/Outbox 固定合同零变化；
- `packages/contracts/src/openapi.d.ts` 只产生对应加法类型；
- 第二次生成工作树无差异。

本轮不执行生成，因此不报告新增 component 数量或快照已通过。

## 12. API/OpenAPI 验收矩阵

| 场景           | 必须证明                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Disabled       | 默认 app 的 10 个 path、15 个 operation 均为现有通用 404，status/body/headers 与未知路径相同，零 DB/限流调用 |
| Dormant export | 只在合同构建模式出现精确 10 个 path、15 个 operationId，不建立数据路径                                       |
| Preference     | 旧 UserSetting Schema/operation 零 diff；新 component 可生成；n -> n+1 校验失败关闭                          |
| Path           | fixed ID、非法 UUID、未知静态子路径为通用 404；imports/reorder 不被动态路径吞掉                              |
| Definition     | create/get/replace/archive/restore 的 status、ETag、Location、revision 与 owner 顺序准确                     |
| Delete         | 影响签名、版本、幂等 receipt 与 formalObjectDeleteCount=0；预览过期不扩大删除                                |
| Link           | 七种 target、嵌套 reference、link/linkSet revision、target 不可 patch、删除不改正式对象                      |
| Pagination     | cursor 绑定 user/resource/filter/order/snapshot；无 total/offset/未授权数量泄露                              |
| Import         | 同 Key 同 operation/fingerprint 重放；异 operation/fingerprint 409；零半写入                                 |
| Export         | 默认不含 Link；可选 Link 逐项授权；无正文/成员/ACL；下载和 no-store Header 完整                              |
| Errors         | 五字段含 request_id；409 不自动重试；422 不回显值；404/403/429 非泄露                                        |
| OpenAPI        | 只加法，component 约束可生成，旧路径/Schema/安全语义零变化，二次生成稳定                                     |
| Security       | Session、Origin/CSRF、owner、strict body、typed ACL、version/write 顺序有负测                                |
| Isolation      | sync-v1、Vault、Outbox、Persona、正式对象 API 和生产默认配置零变化                                           |

最低实现门的精确命令与 C5-A/C5-B 两阶段顺序由 I3-C5 冻结；C4 不维护第二份命令清单。数据库/迁移集成、完整 `ci:fast` 和浏览器只在其各自实现门与环境可用时执行；未运行必须单列原因。

## 13. 停止条件与下一门

遇到以下任一情况立即停止合同实现：

- 必须修改旧 UserSetting、ErrorResponse、persona、sync-v1 或现有 operationId；
- disabled 路由无法与未知路径保持相同响应，或 OpenAPI 生成要求打开生产 flag；
- FastAPI 解析顺序导致无权资源先返回 body/版本错误且无法在有界 wrapper 中修复；
- typed target 需要客户端 scope、任意表名/查询或新的共享权限；
- 删除、导入或幂等无法证明正式对象零删除/零半写入；
- 生成 diff 出现删除、重命名、旧 Schema 漂移或未批准依赖；
- 需要数据库 DDL、迁移、真实配额或生产配置才能伪造“合同已通过”。

I3-C4 通过后，仍需分别批准：

1. API/OpenAPI 合同实现白名单与候选生成；
2. 数据库/迁移设计和隔离证明；
3. 配额/威胁模型与 URL 网络访问策略；
4. Persona 迁移、409 用户体验和正式前端；
5. 集成、回滚、Git 与发布。

本轮只新增本提案，不 commit、push、merge、deploy，不启用 Feature Flag，不创建真实 Workbench，不写用户设置，不读取生产数据。
