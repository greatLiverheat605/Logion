# I3-C3 自定义 Workbench Schema/合同定型提案

状态：Proposed，仅供 Schema、合同、安全与 Product Owner 评审
日期：2026-08-19
前置批准：[I3-C1 合同提案](./I3_C1_CUSTOM_WORKBENCH_CONTRACT_PROPOSAL.md)、[I3-C2 API/Schema 设计提案](./I3_C2_API_SCHEMA_DESIGN_PROPOSAL.md)
当前基线：`codex/product-workbench-v1-spec` / `4d538645305d72dcc8a9c67de6d973743a3fb018`

本文件只定型待实现的 Schema/合同。它不修改 `packages/contracts/**`、`apps/api/**`、数据库、迁移、OpenAPI、Web、锁文件、生产配置或 Feature Flag，也不批准这些实现。

## 1. 结论与兼容边界

I3-C3 推荐以下最小增量：

1. `WorkbenchPreference` 继续保存为现有 `UserSetting` 的字符串 value，不创建第二个设置接口或并发计数器。
2. `CustomWorkbenchDefinition` 与 `WorkbenchObjectLink` 使用严格、版本化、`additionalProperties=false` 的独立文档和资源响应。
3. 请求指纹统一采用 RFC 8785/JCS：API 复用现有 Python `rfc8785`，TypeScript 复用现有 `json-canonicalize`，两端共享测试向量；不再定义第二套自制排序算法或新增依赖。
4. typed target v1 固定为七个互斥 kind，每个 kind 只映射一个现有实体与一个授权解析器。
5. 错误继续使用现有 `ErrorResponse` 五字段外壳；Workbench 只增加 code-specific `details` 约束，不创建嵌套 `error` 外壳。
6. Schema 负责结构安全上限；active 数量、速率、保留和导出频率仍由后续配额/威胁模型门批准。

本提案不改变旧 `persona`、通用 `UserSettingBatchUpdate`、sync-v1、Workspace Role、Space ACL、SessionBoundary 或正式对象归属。

## 2. 通用解析与基本类型

### 2.1 严格 JSON 入口

所有 Workbench 文档必须先经过有界严格 JSON 解析，再进入 Pydantic/JSON Schema：

- UTF-8 编码；拒绝 BOM、无效 UTF-8、尾随数据和超过 endpoint 上限的正文；
- 使用 duplicate-aware parser，任意层重复键直接 422；
- 拒绝 `NaN`、`Infinity`、`-Infinity`、超出 JavaScript 安全整数范围的 integer token 和无法按 IEEE 754 binary64 往返的非整数；
- 任意层精确键 `__proto__`、`prototype`、`constructor` 直接拒绝；
- 对象字段大小写敏感，未知字段拒绝，不能静默剥离；
- 字符串保留原始 Unicode，不做隐式 NFC/NFKC 改写；字段名只允许 ASCII allowlist；
- 所有数组执行长度和唯一性校验，递归深度从文档根对象按 1 计数。

现有 `/api/v1/users/me/settings` 的外层 JSON 行为不变；仅 `workbench.preference` 的字符串 value 由 Workbench 适配器按上述规则二次解析。

### 2.2 公共标量

| 类型                | 合同                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `CustomWorkbenchId` | UUID 字符串；由服务端生成                                                                  |
| `FixedWorkbenchId`  | `fixed.learning`、`fixed.research`、`fixed.exam`、`fixed.mentor`                           |
| `WorkbenchRef`      | `FixedWorkbenchId` 或 `CustomWorkbenchId`                                                  |
| `SafeInteger`       | JSON integer，范围 `-9007199254740991..9007199254740991`；禁止布尔值、浮点伪装和解析后取整 |
| `Revision`          | `SafeInteger`，范围 `1..9007199254740991`                                                  |
| `FieldKey`          | `[a-z][a-z0-9_]{0,47}`，且不在危险键/保留键表中                                            |
| `StableItemId`      | `[a-z][a-z0-9_-]{0,63}`；仅用于一个 Definition 内模块、筛选和字段的稳定比较                |
| `Sha256Fingerprint` | `sha256:` 加 64 位小写十六进制                                                             |
| `PlainText`         | 禁止 C0/C1 控制字符；允许 tab/newline 的字段必须逐项声明                                   |
| `HttpUrl`           | 最长 2048 UTF-8 字节；仅绝对 `http:`/`https:`；使用下述可执行主机规则                      |

`ownerUserId`、Workspace/Space、角色、权限、审计时间、生命周期和服务端版本均不是客户端可提交字段。

本提案中未另列更小范围的所有 `integer` 均指 `SafeInteger`；原始数字 token 必须在转换为 JavaScript `number` 或 Python 数值前完成范围校验。

`HttpUrl` 必须拒绝 username/password、fragment、反斜杠、空白与控制字符。hostname 必须是非空 ASCII：只接受无尾点的 DNS 名（每段 1-63 字符，仅小写 `a-z`、数字、内部连字符；总长不超过 253，IDN 由客户端先转为 `xn--` punycode）、规范点分十进制 IPv4 或方括号规范 IPv6；拒绝 Unicode hostname、百分号编码 hostname、整数/八进制/十六进制 IPv4 和空端口，显式端口只允许十进制 `1..65535`。Schema 校验不主动访问 URL；任何后续下载、预览或抓取仍必须经过独立 SSRF/重定向/私网策略门和现有授权。

## 3. Preference v1

### 3.1 严格 value 文档

`workbench.preference` 的 value 解码后必须精确为：

```json
{
  "contract": "workbench.preference",
  "schemaVersion": 1,
  "revision": 8,
  "payload": {
    "activeWorkbenchId": "fixed.learning",
    "hiddenFixedWorkbenchIds": [],
    "workbenchOrder": ["fixed.learning"],
    "density": "comfortable",
    "defaultViewByWorkbench": {},
    "defaultSpaceByWorkbench": {}
  }
}
```

字段规则：

| 字段                      | 规则                                                      |
| ------------------------- | --------------------------------------------------------- |
| `contract`                | 常量 `workbench.preference`                               |
| `schemaVersion`           | 常量 `1`                                                  |
| `revision`                | 必须等于本次成功写入后的 `UserSetting.version`            |
| `activeWorkbenchId`       | 一个 `WorkbenchRef`                                       |
| `hiddenFixedWorkbenchIds` | 最多 3 个且唯一；不得包含 `fixed.learning`                |
| `workbenchOrder`          | 最多 24 个且唯一；必须包含 `fixed.learning`               |
| `density`                 | `compact` 或 `comfortable`                                |
| `defaultViewByWorkbench`  | 最多 24 项；键为 `WorkbenchRef`，值为 `StableItemId`      |
| `defaultSpaceByWorkbench` | 最多 24 项；值严格为 `{workspaceId: UUID, spaceId: UUID}` |

写入外层 `UserSettingWrite.version=n` 时，value 内 `revision` 必须为 `n + 1`；创建时外层版本为 0、内层版本为 1。服务端先校验这个关系，再把 value 作为不透明字符串交给现有设置写入流程；不得静默重建或改写客户端 value。成功响应的外层版本必须等于内层版本。读取发现二者不一致时，适配器不得把 value 当作可写事实源，应回退固定学习工作台并提供修复/导出入口。

这一定型取代 I3-C2 中“内层 revision 与当前版本一致或由服务端重建”的候选描述。`UserSetting.version` 仍是唯一并发权威；内层 `revision` 只是成功结果的自校验元数据，不参与冲突比较，也不形成第二个计数器。

通用设置仍是 8192 **字符**上限。本门不批准额外 4096 UTF-8 字节限制；若后续配额门批准，只能对 `workbench.preference` value 追加，不得改变 `persona` 或其他 key。

无效、归档、删除或无权的 Workbench/Space 引用属于投影失效：读取本身仍返回现有设置，Workbench 适配器清除无效投影，不在后台静默写回。

## 4. Definition v1

### 4.1 文档与资源分离

客户端可提交的 `WorkbenchDefinitionDocumentV1` 只有：

```json
{
  "contract": "workbench.definition",
  "schemaVersion": 1,
  "payload": {
    "name": "论文推进",
    "description": "研究来源、声明和行动的个人视图",
    "icon": "microscope",
    "accent": "cyan",
    "templateId": "fixed.research",
    "modules": [],
    "layout": { "columns": 2, "items": [] },
    "filters": [],
    "quickCreate": [],
    "fieldDefinitions": []
  }
}
```

服务端资源 `WorkbenchDefinitionResponse` 才能增加 `id`、`ownerUserId`、`revision`、`lifecycle`、`createdAt`、`updatedAt` 和上述 `document`。Create/replace 请求若提交这些服务端字段必须 422，而不是覆盖或忽略。

### 4.2 基本外观字段

| 字段          | 规则                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `name`        | trim 后 1-80 个 Unicode 标量、最多 320 UTF-8 字节；纯文本                                            |
| `description` | 最多 280 个 Unicode 标量、1120 UTF-8 字节；纯文本                                                    |
| `icon`        | `book-open`、`microscope`、`graduation-cap`、`users`、`layout-dashboard`、`target`、`folder`、`note` |
| `accent`      | `neutral`、`blue`、`green`、`amber`、`red`、`violet`、`cyan`                                         |
| `templateId`  | 四个 `FixedWorkbenchId` 或 `blank`                                                                   |

icon/accent 是展示 token，不接受 Emoji、CSS、颜色字符串、类名、SVG、URL 或组件名。

### 4.3 模块与布局

`modules` 最多 24 项，每项严格为：

```json
{
  "id": "primary_tasks",
  "kind": "task-queue",
  "title": "待办",
  "filterIds": ["open_tasks"],
  "quickCreateIds": ["task_create"]
}
```

`kind` 只允许 `next-action`、`task-queue`、`projects`、`sources`、`topics`、`review`、`evidence`、`timeline`、`graph-projection`、`saved-view`、`recent-objects`、`pinned-objects`。模块 ID 唯一；title 可省略，存在时遵循 name 上限；引用的 filter/quick-create ID 必须存在且唯一。

`layout` 只包含：

- `columns`：integer 1-4；
- `items`：最多 64 项，每项为 `{moduleId, region, order, span}`；
- `region`：`main`、`side`、`footer`；`order` 为 0-63 integer；`span` 为 1-4 integer；
- 每个 module 恰好出现一次；同一区域 `order` 唯一；`span` 不得大于 `columns`。

不接受坐标、像素、CSS、HTML、脚本、组件路径、任意查询、依赖图或模块私有 `params`。后续新增模块参数必须增加新的 `schemaVersion` 或显式注册的 discriminated union。

### 4.4 有界筛选与快捷创建

`filters` 最多 32 项，v1 只允许下列 discriminated union：

| kind                  | 额外字段                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `target-kind-in`      | `targetKinds`：1-7 个唯一 `WorkbenchTargetKind`                                                                           |
| `task-status-in`      | `statuses`：1-8 个唯一值，限 `backlog`、`planned`、`in_progress`、`submitted`、`verified`、`done`、`blocked`、`cancelled` |
| `updated-within-days` | `days`：integer 1-365                                                                                                     |
| `attribute-equals`    | `fieldId`：已注册 field；`value`：必须匹配该 field 的值 Schema                                                            |

每项还必须有唯一 `id`。这些筛选只在已授权结果集上执行，不能携带 SQL、字段路径、排序表达式、Workspace/Space 或任意服务端查询。

`quickCreate` 最多 16 项。v1 只注册 `task.create`、`note.create`、`source.create`、`topic.create`，每项形状为 `{id, command}`，不保存默认表单值。调用时必须进入现有命令/UI 流程并重新验证当前 Workspace/Space、Origin、CSRF、权限和 Feature Flag；Definition 不能创建新命令。

### 4.5 有限字段定义

`fieldDefinitions` 最多 32 项。公共字段为 `id: FieldKey`、`label`（1-80 标量）和 `required: boolean`。其余字段按 `type` 使用互斥变体：

| type               | 允许的额外约束                                             |
| ------------------ | ---------------------------------------------------------- |
| `text`             | `maxLength` 1-2000                                         |
| `number`           | 有限 `minimum`/`maximum`，且 minimum ≤ maximum             |
| `date`             | 无                                                         |
| `single-select`    | 1-32 个唯一 `{id: StableItemId, label}` option             |
| `multi-select`     | 同上，另有 `maxSelections` 1-32                            |
| `boolean`          | 无                                                         |
| `url`              | 复用 `HttpUrl`                                             |
| `rating`           | `minimum`/`maximum` 为 integer，0 ≤ minimum < maximum ≤ 10 |
| `object-reference` | `allowedTargetKinds`：1-7 个唯一 `WorkbenchTargetKind`     |

不同变体的字段不得混用。Definition 总 JSON UTF-8 大小硬上限为 32 KiB，递归深度上限为 6；这些是解析安全上限，不代表后续业务配额已经批准。

## 5. Link v1

### 5.1 typed target 与局部值

`WorkbenchTargetV1` 是严格 discriminated union：

```json
{ "kind": "task", "id": "00000000-0000-0000-0000-000000000001" }
```

除 `kind` 和 UUID `id` 外不允许其他字段。`attributes` 最多 32 项，键必须对应当前 Definition 的 `fieldDefinitions`，值必须匹配该字段变体；`object-reference` 值仍使用 `WorkbenchTargetV1` 并逐个重新授权。属性不能覆盖正式对象字段。

`WorkbenchLinkMutableV1` 只包含 `target`、`position`（integer 0-499）、`primaryContext`（boolean）和 `attributes`。单个 mutable 文档最多 2 KiB UTF-8；属性总量和 Link 数量仍待配额门确认。

### 5.2 请求与响应字段

| Schema                              | 必需字段                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `WorkbenchLinkCreateRequest`        | `baseLinkSetRevision`、`local: WorkbenchLinkMutableV1`                            |
| `WorkbenchLinkPatchRequest`         | `expectedRevision`、`baseLinkSetRevision`、`base`、`local`                        |
| `WorkbenchLinkDeleteRequest`        | `expectedRevision`、`baseLinkSetRevision`、`base`                                 |
| `WorkbenchLinkReorderRequest`       | `baseLinkSetRevision`、`baseOrder`、`orderedLinkIds`                              |
| `WorkbenchDefinitionReplaceRequest` | `expectedRevision`、`base: WorkbenchDefinitionDocumentV1`、`local: ...DocumentV1` |

`base`/`baseOrder` 是客户端最近确认的有界合并上下文，只用于生成 409 比较，不是授权或存在性事实。服务端当前 revision/ETag、当前授权和当前对象状态始终权威；即使客户端伪造 base，也只能影响返回给同一用户的建议冲突路径，不能影响写入是否被接受。成功写入仍只持久化严格校验后的 `local`。

`WorkbenchObjectLinkResponse` 增加服务端 `id`、`workbenchId`、`ownerUserId`、`revision`、`linkSetRevision`、时间戳和 `mutable`。客户端不得提交响应字段。一个 Workbench 内 `(target.kind, target.id)` 唯一。

## 6. typed target registry v1

每个 kind 精确绑定一个实体；解析器只能使用表中固定模型，不接受表名、查询名或客户端 scope：

| kind       | 现有实体                                 | 活动条件             | 额外授权条件                                      |
| ---------- | ---------------------------------------- | -------------------- | ------------------------------------------------- |
| `task`     | `execution.models.Task`                  | `deleted_at is null` | 现有 Workspace/Space Task read                    |
| `source`   | `content.models.Resource`                | `deleted_at is null` | 现有 Workspace/Space Resource read                |
| `topic`    | `memory.models.Topic`                    | `deleted_at is null` | 现有 Workspace/Space Topic read                   |
| `note`     | `content.models.Note`                    | `deleted_at is null` | 现有 Workspace/Space Note read                    |
| `evidence` | `execution.evidence_models.EvidenceItem` | `deleted_at is null` | 现有 Workspace/Space Evidence read                |
| `claim`    | `research.models.ResearchClaim`          | `deleted_at is null` | `user_id` 为当前用户且现有 Personal Research read |
| `project`  | `self_study.models.StudyProject`         | `deleted_at is null` | `user_id` 为当前用户且现有 Personal Study read    |

`source` 不同时解析 `PaperRecord`；`project` 不同时解析 `LearningGoal`、`LearningPlan` 或任意 project-like 表。它们若要进入后续版本，必须新增不歧义的 kind、resolver 和合同版本。未知 kind 在查询任何对象前返回 422。

Workbench 是个人投影，可以包含来自多个当前已授权 Space 的 Link；“跨 Space 拒绝”在本合同中精确定义为：客户端不能伪造 Workspace/Space scope，目标本身及其父关联必须在同一真实 scope，且每个目标均独立通过当前授权。Workbench 不把一个 Space 的权限传播到另一个 Space。

合法 kind 的目标不存在、tombstone、scope 关系不一致或无权时统一 404 `RESOURCE_NOT_FOUND`。列表和导入只过滤/聚合不可用 Link，不返回 kind、ID、标题、数量差异或失败原因细分。

## 7. 统一规范化与指纹

I3-C2 所有“相同规范化请求”统一使用以下算法；本节取代 I3-C2 的自制字段排序候选描述：

1. 严格解析并完成当前 Schema 和跨字段校验；
2. 构造指纹输入 `{operation, resource, body}`；`operation` 为固定 operation token，`resource` 只含路径中的当前用户范围资源 ID，`body` 为完整验证后的请求；
3. 排除 Header `Idempotency-Key`、客户端 `sourceFingerprint`，以及不属于已验证请求的服务端 owner/ID/时间戳/revision/ETag/receipt；请求体中的 `expectedRevision`、`baseLinkSetRevision`、`base`、`baseOrder` 等业务前置条件不得排除；
4. 使用 RFC 8785/JCS canonical JSON；不做 Unicode normalization，数组保留合同顺序；
5. 对 canonical UTF-8 bytes 计算 SHA-256，输出 `sha256:<lowercase-hex>`。

Definition create、Link create 和 import 必须遵循同一算法与同一跨语言 fixture。API 使用仓库现有 Python `rfc8785`，TypeScript 合同/客户端使用仓库现有 `json-canonicalize@2.0.0`；禁止通过子进程跨运行时调用，也禁止引入第三个 canonicalization 实现。operation token 至少为 `workbench.definition.create.v1`、`workbench.link.create.v1`、`workbench.import.v1`，避免同一个用户级幂等键跨操作重放。

导入 `sourceFingerprint` 是客户端一致性声明，服务端必须重算并 constant-time 比较。Definition/Link create 不要求客户端发送 fingerprint；服务端只保存自己的请求指纹用于幂等重放。正式实现必须用共享 fixture 证明 Python 与 TypeScript 对最大/最小安全整数、超界整数拒绝、边界 binary64、Unicode 键、空值和嵌套数组产生相同结果；本轮不新增依赖。

## 8. Export/Import 合同

`WorkbenchExportV1` 只包含：

- `contract: "workbench.export"`、`schemaVersion: 1`；
- 一个 `WorkbenchDefinitionDocumentV1`；
- 可选 `links`，每项只含 `WorkbenchLinkMutableV1`；
- 不含 owner、服务端 ID、revision、lifecycle、时间戳、对象正文、成员、ACL、Cookie、Token 或审计字段。

`WorkbenchImportRequest` 只包含 `sourceFingerprint` 和 `payload: WorkbenchExportV1`；幂等键使用 UUID `Idempotency-Key` Header。导入为 Definition 与可授权 Link 的单事务；不可用 Link 不写入，只在 receipt 中聚合为 `{count, reason: "not_available"}`。如果 Link 的局部 object-reference 属性不可用，整条 Link 计入 skipped，不保留部分 attributes。

`WorkbenchImportReceipt` 基础对象必须包含 `receiptId`、`idempotencyKey`、`sourceFingerprint`、`skippedLinks` 和 `createdAt`。联合响应 variant 通过 `allOf` 追加并要求 `status`、`retryable` 和 `definitionId`：成功 variant 为 `status=succeeded`、`retryable=false` 和非空 `definitionId`；终态失败 variant 为 `status=failed`、`retryable=false` 和 `definitionId=null`。提交点前的可恢复失败返回 `503 retryable=true` 错误 envelope，不创建 receipt。任何失败响应都不包含目标或配置正文。

## 9. 错误 envelope 与 details

所有错误继续严格复用现有根结构：

```json
{
  "code": "WORKBENCH_SCHEMA_INVALID",
  "message": "The workbench document is invalid.",
  "details": {},
  "retryable": false,
  "request_id": "request-id"
}
```

## Approved Baseline Amendment (2026-08-20)

Terminal import receipts remain `retryable=false`; only a proven pre-commit recoverable failure uses `503 retryable=true` without a receipt. Definition responses include server-generated `ownerUserId`. The seven target registry entries and Definition-row `linkSetRevision` placement are fixed for the next implementation gate.

五个字段始终必需，根对象不允许额外字段。message 是固定服务端文案，不回显输入、对象标题、URL、内部异常或验证值。

| code                             | HTTP | retryable | details 合同                                                                 |
| -------------------------------- | ---: | --------- | ---------------------------------------------------------------------------- |
| `WORKBENCH_PREFERENCE_INVALID`   |  422 | false     | `{issues}`；仅规则与有界字段路径                                             |
| `WORKBENCH_SCHEMA_INVALID`       |  422 | false     | `{issues}`；最多 32 项 `{path, rule}`，不含 rejected value                   |
| `WORKBENCH_PRECONDITION_INVALID` |  400 | false     | `{}`                                                                         |
| `WORKBENCH_VERSION_CONFLICT`     |  409 | false     | `{entity, baseRevision, remoteRevision, conflictPaths, base, local, remote}` |
| `WORKBENCH_IDEMPOTENCY_CONFLICT` |  409 | false     | `{}`；不返回两个 fingerprint                                                 |
| `WORKBENCH_OPERATION_DENIED`     |  403 | false     | `{}`；只用于已确认可见资源上的命令                                           |
| `RESOURCE_NOT_FOUND`             |  404 | false     | `{}`                                                                         |
| `WORKBENCH_RATE_LIMITED`         |  429 | true      | `{}`；可使用有界 `Retry-After` Header，不返回剩余配额                        |

`WORKBENCH_VERSION_CONFLICT.details` 只在完成 owner 与目标授权后生成：

- `entity` 为 `definition`、`link` 或 `link_set`；
- revisions 为最小 1 的 integer；`conflictPaths` 最多 128 个唯一、最长 256 字符的合同路径；
- `base`/`local` 只回显本次请求中已通过 Schema 的合并上下文；`remote` 只含当前用户仍有权读取的配置；
- `link_set` 的三个值只含 Link ID/order/局部属性，不含目标正文、成员或 ACL；
- 无合并上下文的 create/idempotency 冲突不能伪造三方版本，应使用相应 idempotency error。

版本冲突的 `retryable=false` 表示原请求不能自动重放；用户重读、比较并显式提交新的合并请求后，后者是一次新的受校验操作。该语义与现有设置冲突默认不自动重试保持一致。

通用 `ErrorResponse.details` 仍保持向后兼容；未来 Workbench response model 通过 code-specific details Schema 收紧，不修改旧 endpoint 的错误类型。

## 10. 授权、缓存与非泄露顺序

Schema/API 实现必须按以下顺序落测试：

1. Session；
2. mutation/import/export 的 trusted Origin、CSRF、用户限流；
3. 默认关闭的 Feature Flag；
4. URL 范围内 Definition/Link 的 owner 解析；
5. 有界严格 JSON、合同版本和字段 Schema；
6. typed target 的真实 scope、对象活动状态与现有 ACL；
7. 配额、revision/ETag、冲突计算和事务写入。

授权和对象活动检查先于当前版本、ETag、冲突路径、配额值和目标详情。能力开启后的 Definition/Link、Workbench 专用错误、导出和 receipt 响应统一 `Cache-Control: private, no-store`。Feature Flag 关闭时不注册路由，响应必须与现有未注册路由的 status、body 和 headers 完全相同，不使用 Workbench 专用 code/message、不查询资源、不创建幂等 receipt；这一定型取代 I3-C2 的 `WORKBENCH_FEATURE_DISABLED` 候选错误码。

## 11. 待生成 Schema 清单

后续 Schema/合同实现门只允许新增下列组件，不修改旧组件：

- `WorkbenchPreferenceDocumentV1`；
- `WorkbenchDefinitionDocumentV1`、create/replace/response；
- module/layout/filter/quick-create/field-definition unions；
- `WorkbenchTargetV1`、Link create/patch/delete/reorder/response；
- Export/Import request/receipt；
- Workbench code-specific error details/response variants；
- RFC 8785 canonicalization fixtures。

`UserSettingWrite`、`UserSettingBatchUpdate`、`UserSettingResponse`、`ErrorResponse`、sync-v1 schema/checksum vectors 和旧 OpenAPI operation 均必须保持 byte-for-byte 或语义等价不变。正式实现时先生成候选快照并审查，再决定是否接受 OpenAPI diff；本轮不运行 `contracts:generate`。

## 12. 验收矩阵

| 场景            | 必须证明                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Preference 版本 | 外层 n 写入对应内层 n+1；读取版本不一致失败关闭；旧 8192 字符语义不变                            |
| 严格解析        | 重复键、危险键、NaN/Infinity、不安全整数、未知字段、超限、尾随数据均拒绝                         |
| Definition      | 服务端字段不可提交；模块/布局引用完整；无任意 params/query/code                                  |
| Field union     | 每种 type 只接受自己的字段；attribute 值逐定义校验                                               |
| typed target    | 七个 kind 一对一映射；`source` 不猜测 PaperRecord；合法 kind 的无权/失效统一 404                 |
| scope           | scope 只从对象派生；多 Space Link 逐项授权；不能跨 Space 传播权限                                |
| 规范化          | Definition/Link/import 共享 RFC 8785 fixtures；数组顺序和 operation token 影响 fingerprint       |
| 幂等            | 同 Key/同指纹重放；同 Key/异指纹 409；不跨 operation 重放                                        |
| 409             | 只有授权后返回有界 base/local/remote；再次提交仍重新授权与比较                                   |
| 错误            | 五字段 ErrorResponse 完整；validation 不回显值；404/403/429 不泄露对象或配额                     |
| 兼容            | persona、UserSetting、ErrorResponse、sync-v1 和旧 OpenAPI 无非预期变化                           |
| fail-closed     | 任何未知版本、未知 registry entry、解析歧义或异常均不产生 Definition、Link、receipt 或设置半写入 |

## 13. 剩余审批门与明确不做

I3-C3 通过后仍需分别批准：

1. API/OpenAPI 路径、operationId、分页、Header 和生成快照；
2. 数据库/迁移 DDL、唯一性、revision/linkSetRevision、receipt、回滚和数据保留；
3. 配额与威胁模型的 active 数量、字节、速率、URL、日志、导入和侧信道；
4. Persona 迁移与 409 用户体验；
5. 完整前端原型和正式施工。

本轮不创建 Schema 文件、不修改 API/数据库/前端、不新增依赖、不写入用户设置、不创建真实 Workbench、不执行导入导出，不 commit、push、merge 或 deploy。任何复审 P0/P1 必须在进入下一门前收口。
