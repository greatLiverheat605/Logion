# I3-C2 自定义 Workbench API/Schema 设计提案

状态：Proposed，仅供 API、Schema、数据库/迁移、配额、威胁模型和 Product Owner 评审
日期：2026-08-19
前置批准：[I3-C1 自定义 Workbench 合同提案](./I3_C1_CUSTOM_WORKBENCH_CONTRACT_PROPOSAL.md)
当前基线：`codex/product-workbench-v1-spec` / `4d538645305d72dcc8a9c67de6d973743a3fb018`

本文件只把已批准的 I3-C1 候选合同映射为 API/Schema 方案，不修改 `packages/contracts/**`、`apps/api/**`、数据库、迁移、锁文件、生产配置或 Feature Flag。所有路径、Schema、错误码、限额和状态码都是待审批提案。

## 1. 设计结论

推荐把三种职责映射为两类接口：

1. **Preference** 继续复用现有 `/api/v1/users/me/settings`，新增受控 key `workbench.preference`；不扩展旧 `persona` value，也不创建第二套设置并发语义。
2. **CustomWorkbenchDefinition / WorkbenchObjectLink** 使用独立的 `/api/v1/users/me/workbenches` 资源；它们不进入 UserSetting、sync-v1 或正式对象表。
3. 所有自定义能力由服务端 Feature Flag 默认关闭；关闭时不注册 Workbench 路由，因此响应与未知路径完全相同，且不查询定义、链接或目标对象。
4. 所有资源均以当前用户为所有者。Workbench 不产生 Workspace Role、Space Permission、Session Capability 或新的共享范围。

## 2. 与现有边界的复用

| 现有能力                                                  | I3-C2 复用方式                                  | 不得改变                                             |
| --------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `UserSetting` `(user_id, key)`、8192 字符、整数 `version` | Preference 的字符串外壳和 optimistic update     | `persona` key、旧客户端、一次 409 重读合并再重试语义 |
| `Strict` Pydantic model (`extra="forbid"`)                | 所有新 Request/Response Schema 默认拒绝未知字段 | 不用客户端过滤替代服务端校验                         |
| Session、trusted Origin、CSRF、用户限流                   | 所有 mutation 和 import/export                  | 不绕过现有认证或 CSRF                                |
| Workspace/Space/对象授权链                                | 每次 Link 读写、目标解析和导入重新授权          | Workbench 不扩权，不用 UI 可见性作为授权             |
| 强 ETag / `expected_version` 模式                         | Definition、Link 的单对象并发控制               | 不返回无权对象的版本、存在性或差异                   |
| 不透明 404 与 `Cache-Control: private, no-store`          | 无权/跨 Space/非活动对象和关闭能力的响应        | 不通过 403、总数、ETag 或 409 枚举对象               |

Preference 继续使用 `/api/v1/users/me/settings` 的理由是兼容性和最小变更；Definition/Link 不复用它，因为 8192 字符和单键合并无法承载长期实体、链接集合、导入收据和审计版本。

## 3. Feature Flag 与授权顺序

候选配置名为 `workbench_custom_api_enabled`，默认 `false`。它是服务端部署配置，不可由请求体、UserSetting 或客户端声明。关闭时：

- 不读取 Definition、Link、目标对象、Space 或成员；
- 不注册列表、单对象、导入、导出或 mutation 路由，响应与未知路径的 status、body 和 headers 完全相同；
- 旧 Persona 路径和固定 Workbench 继续工作；
- 不删除已存在配置，不产生半成功 receipt。

开启后的每个请求按以下顺序处理：

1. 验证现有认证 Session；
2. 对 mutation/import/export 校验 trusted Origin、CSRF 和用户级限流；
3. 路由仅在 Feature Flag 开启时注册；关闭时请求不会进入本处理顺序；
4. 从 URL 的当前用户范围解析 Definition/Link；找不到、非 owner、归档不允许的操作和跨用户请求统一不透明 404；
5. 解析 Schema、版本、大小、allowlist、幂等键和危险键；
6. 解析 typed target，并重新执行 Workspace/Space/Role/ACL 和对象活动状态授权；
7. 最后检查 quota、ETag/revision、业务命令和事务写入。

授权和存在性检查必须先于版本、冲突路径、配额当前值和目标详情，以避免侧信道枚举。

## 4. Preference Schema 与接口

### 4.1 复用 UserSetting

现有 endpoint 不变：

```text
GET /api/v1/users/me/settings?key=workbench.preference
PUT /api/v1/users/me/settings
```

`PUT` 仍使用现有 `UserSettingBatchUpdate` 外壳：`{"settings":[{"key":"workbench.preference","value":"...","version":7}]}`。单个 Preference 写入只是批量数组中的一项；数组的 1-50 项上限、键唯一性、`UserSettingWrite` 的 key/value/version 校验和原子批量更新全部保留。请求必须包含 trusted Origin、CSRF 和现有 `user_setting_write` 限流。Preference value 必须是 I3-C1 的严格 JSON 外壳：

```json
{
  "contract": "workbench.preference",
  "schemaVersion": 1,
  "revision": 7,
  "payload": {
    "activeWorkbenchId": "fixed.learning",
    "hiddenFixedWorkbenchIds": [],
    "workbenchOrder": ["fixed.learning", "fixed.research"],
    "density": "comfortable",
    "defaultViewByWorkbench": {},
    "defaultSpaceByWorkbench": {}
  }
}
```

`UserSetting.version` 是并发版本的唯一权威；外壳中的 `revision` 只作为迁移/导出元数据，写入时必须与当前设置版本一致或由服务端重建，不能形成第二个并发计数器。现有 UserSetting/OpenAPI/数据库的 8192 上限是字符语义，本提案不把它改成字节语义，也不改变 `persona` 或其他 key。若 Schema 门批准对 `workbench.preference` 增加更小的 4096 UTF-8 字节附加上限，必须作为该 key 的服务端校验，不得修改旧通用设置合同；未批准前沿用现有 8192 字符上限。

### 4.2 Preference 失败语义

| 情况                                                           | API 结果                                                                                                             | 客户端处理                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 未知 contract/version/字段/危险键                              | 422 `WORKBENCH_PREFERENCE_INVALID`                                                                                   | 保留旧值，回退固定学习入口                           |
| 版本不匹配                                                     | 409 `USER_SETTING_VERSION_CONFLICT`                                                                                  | 复用旧一次重读/合并/重试；再次冲突停止               |
| active/order/default view 指向未知、归档、删除或畸形 Workbench | 200 读取旧 Preference，投影时清除无效项                                                                              | 不隐藏固定必需入口，显示可行动修复提示               |
| 无权 default Space                                             | 200 Preference，投影清除该引用                                                                                       | 不显示 Space 名称或对象数量                          |
| Feature Flag 关闭                                              | Definition/Link 路由不注册；响应与未知路径完全相同；通用 UserSetting endpoint 合同不变，Workbench 适配器不解释新 key | 旧 Persona/固定 Workbench 正常，不显示自定义保存按钮 |

Preference 永不保存对象快照、Link、成员、ACL、Workspace Role 或正式业务状态。

## 5. Definition 资源接口（候选）

Base path：`/api/v1/users/me/workbenches`

| Method 与 Path                   | 结果                                                                                     | 写入/并发要求                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /workbenches`               | 当前用户可见的 active/archived Definition 摘要，按 `updatedAt desc, id desc` keyset 分页 | 不返回目标对象正文、成员或无权 Link 数量                  |
| `POST /workbenches`              | 从固定模板或 blank 创建 Definition，返回 201、`revision=1`、强 ETag                      | CSRF、`Idempotency-Key`、创建配额；模板只复制配置         |
| `GET /workbenches/{id}`          | 返回 Definition 与服务端元数据                                                           | owner 解析和 Feature Flag 先行；归档可读但不默认进入导航  |
| `PUT /workbenches/{id}`          | 全量替换配置，返回新 revision/ETag                                                       | `expectedRevision` 与可选 `If-Match` 必须一致             |
| `POST /workbenches/{id}/archive` | 归档配置，不删除 Link/正式对象                                                           | 版本前置条件；固定 Workbench 不可调用                     |
| `POST /workbenches/{id}/restore` | 恢复自定义配置                                                                           | 版本、配额和 Schema 重新检查                              |
| `DELETE /workbenches/{id}`       | 删除 Definition 与其 Link，不删除正式对象                                                | 先返回当前用户可见影响摘要；固定 Workbench 路由不存在     |
| `POST /workbenches/imports`      | 原子导入 Definition 与可授权 Link                                                        | `Idempotency-Key` + `sourceFingerprint`；失败回滚         |
| `GET /workbenches/{id}/export`   | 下载不含正文的定义导出包                                                                 | 当前用户 owner；`Cache-Control: no-store`；不记录导出正文 |

Definition Request 的 `additionalProperties=false`。客户端不能提交 `id`、`ownerUserId`、`createdAt`、`updatedAt`、`revision`、`lifecycle`、权限、Space 或审计字段。服务端从注册模块 Schema 逐层校验名称、布局、属性、quickCreate、URL、总大小和递归上限。

`DELETE` 是配置删除，不是正式对象删除；固定 Workbench 使用独立代码维护模板，不暴露 DELETE 操作。

## 6. Link 资源接口（候选）

Base path：`/api/v1/users/me/workbenches/{workbench_id}/links`

| Method 与 Path            | 结果                                                      | 并发/授权要求                                                                   |
| ------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /links`              | 返回当前用户有权读取的 typed Link，按 `position, id` 排序 | 每页最多 100；无权目标被过滤且不返回总数                                        |
| `POST /links`             | 创建一个 Link                                             | `baseLinkSetRevision`、`Idempotency-Key`、目标授权和 `(kind,id)` 唯一性         |
| `PATCH /links/{link_id}`  | 只更新 position/primaryContext/局部属性                   | 同时携带 Link `expectedRevision` 和 `baseLinkSetRevision`；正式对象字段不可修改 |
| `DELETE /links/{link_id}` | 删除当前 Workbench 的 Link                                | 同时携带 Link revision 和 `baseLinkSetRevision`；正式对象保持不变               |
| `POST /links/reorder`     | 原子提交一组稳定 Link ID 的新顺序                         | `baseLinkSetRevision`；缺失/重复 ID 直接 409/422                                |

Link 响应包含 `id`、`workbenchId`、typed `target`、`position`、`primaryContext`、局部属性、`revision` 和集合 `linkSetRevision`。不包含目标正文、成员、Role、Space 私密字段或未授权对象的存在性。

`target` 只接受注册 union：`task`、`source`、`topic`、`note`、`evidence`、`claim`、`project`。每个 kind 由服务端选择固定解析器，禁止请求传入任意查询、表名、Workspace/Space 覆盖值或原始 `target_type + target_id` 联合键。

## 7. Export/Import 与幂等

### 7.1 导出包

导出包只包含 `workbench.definition`、合同版本、模块/布局/属性配置和可选 typed target ID；不包含对象正文、成员、Space 私密内容、Cookie、Token、密钥、权限快照或服务端审计字段。导出响应使用 `Content-Disposition: attachment`、`Cache-Control: private, no-store`，日志只记录结果类别和哈希前缀。

### 7.2 导入请求

`POST /workbenches/imports` 必须同时携带：

- `Idempotency-Key`：UUID，服务端按当前用户隔离；
- `sourceFingerprint`：服务端按规范化 JSON 重新计算 SHA-256，客户端值只用于一致性检查；
- `payload`：完整导出包，不允许嵌套第二个导入包。

规范化步骤固定为：拒绝重复键和危险键，按 UTF-8 字节、字段名 Unicode 码点升序排序，数组保持合同定义顺序，数字采用有限 JSON 数字格式，移除服务端元数据后再计算 Hash。服务端不得信任客户端 fingerprint。

服务端以 `(ownerUserId, Idempotency-Key)` 唯一保存终态导入 receipt 和 source fingerprint：

- 相同 Key + 相同 fingerprint：返回同一个最终 receipt 和 Definition ID，不重复创建；
- 相同 Key + 不同 fingerprint：409 `WORKBENCH_IDEMPOTENCY_CONFLICT`，不写入；
- 提交点前的可恢复事务失败：事务全部回滚，返回 `503 retryable=true`，不创建 receipt，相同 Key 可重试；
- 合同、授权或配额失败：若形成终态失败 receipt，则固定为 `retryable=false`，相同 Key 返回同一失败结果；
- 成功：Definition 与可授权 Link 在同一事务内提交，无权/失效 Link 仅进入 `skippedLinks`，不产生半个 Link。

用户要有意创建第二份副本，必须更换 Idempotency-Key；服务端生成新的 Definition/Link ID。

Definition 创建和 Link 创建也遵循同一重放规则：相同 Key + 相同规范化请求返回第一次 201 receipt/资源 ID；相同 Key + 不同请求返回 409 `WORKBENCH_IDEMPOTENCY_CONFLICT`；可恢复事务失败不保留半个资源并允许相同 Key 重试。`skippedLinks` 只返回聚合形状 `{ "count": 2, "reason": "not_available" }`，不返回 target ID、kind、标题或失败是不存在还是无权。

## 8. Version、ETag 与 409

Definition 和单个 Link 使用从 1 开始的整数 `revision` 与强不透明 ETag；Link 集合另有 `linkSetRevision`，初始为 1，每次成功新增、删除或 reorder 原子递增一次。若请求同时带 `expectedRevision` 和 `If-Match`，两者必须都匹配，且 Header/Body 不一致返回 400 `WORKBENCH_PRECONDITION_INVALID`。

授权成功后才比较版本。冲突返回 409 `WORKBENCH_VERSION_CONFLICT`，结构候选为：

```json
{
  "code": "WORKBENCH_VERSION_CONFLICT",
  "message": "The workbench changed before this update.",
  "retryable": false,
  "details": {
    "entity": "definition",
    "baseRevision": 4,
    "remoteRevision": 5,
    "conflictPaths": ["modules[task-queue]"],
    "base": {},
    "local": {},
    "remote": {}
  }
}
```

## Approved Baseline Amendment (2026-08-20)

The approved baseline adds server-generated `ownerUserId` to Definition responses. A recoverable import failure before the commit point returns `503` with `retryable=true` and creates no receipt; a terminal failed import uses the existing failed receipt with `retryable=false`. The seven target kinds, Definition-row `linkSetRevision`, and default-off route registration are frozen for the next implementation gate.

This amendment supersedes the earlier C2 wording that required a durable `retryable=true` failed receipt. Database, migration, quota, threat-model, and production implementation remain separate gates.

`base`/`remote` 只包含当前用户有权看的配置，不包含目标正文或 ACL。Link 新增/删除/排序使用集合版本；同目标重复新增、删除与修改、交叉排序和局部属性修改必须列入 `conflictPaths`，不能最后写入者覆盖。客户端选择后提交完整 merged draft 和最新版本，再次 409 必须重新比较。

## 9. 错误码与非泄露规则

| HTTP | Code                             | 语义                                                                      |
| ---: | -------------------------------- | ------------------------------------------------------------------------- |
|  400 | `WORKBENCH_PRECONDITION_INVALID` | Header/Body 版本不一致或非法前置条件                                      |
|  401 | 现有认证错误                     | 沿用 Session 行为                                                         |
|  403 | `WORKBENCH_OPERATION_DENIED`     | 仅用于已确认可见的能力/命令被拒绝；不用于枚举对象                         |
|  404 | `RESOURCE_NOT_FOUND`             | 非 owner、跨用户、无权/跨 Space/非活动目标统一不透明结果                  |
|  409 | `WORKBENCH_VERSION_CONFLICT`     | Definition/Link revision 或集合版本冲突                                   |
|  409 | `WORKBENCH_IDEMPOTENCY_CONFLICT` | 同 Key 指向不同 fingerprint                                               |
|  422 | `WORKBENCH_SCHEMA_INVALID`       | 未知字段/版本、allowlist、大小、递归、危险键或 target 形状/未知 kind 失败 |
|  429 | `WORKBENCH_RATE_LIMITED`         | 用户级配额/速率限制，不披露剩余配额细节                                   |

目标解析的错误分层固定为：未知/畸形 `kind` 或 target 形状返回 422；合法 kind 对应的目标不存在、tombstone、跨 Space 或当前用户无权时统一返回 404 `RESOURCE_NOT_FOUND`。导入中的这些情况只聚合为 `skippedLinks.reason=not_available`，不返回具体目标细节。所有 Definition/Link 响应默认 `Cache-Control: private, no-store`；无权目标不能通过列表长度、Link 数、ETag、冲突路径或 error timing 被枚举。

## 10. OpenAPI 变化边界

正式 OpenAPI 只允许加法：新 Schemas、路径、操作和错误码必须由 Schema/API 门单独批准。生成快照前后必须确认：

- 旧 `/api/v1/users/me/settings` Path 和 `persona` Schema 零变化；
- sync-v1 Schema、OpenAPI operationId、认证/CSRF 行为无非预期变化；
- 新 Schema 全部 `additionalProperties=false`，枚举和数量上限落到生成合同；
- 409、422、429、403、404 响应均有可生成类型和非泄露测试；
- Feature Flag 关闭时新路由仍可被路由层稳定拒绝，不产生查询或写入。

本提案不运行 `contracts:generate`，不修改生成 OpenAPI，也不创建 API route。

## 11. 验收矩阵（API/Schema 门）

| 场景                   | 必须证明                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| 旧 Persona 兼容        | 旧 key、旧客户端、旧 409 测试不变                                                                     |
| Preference 严格 Schema | 未知字段/版本/危险键/超 8192 字符拒绝；若单独批准 4096 UTF-8 字节附加上限则同时验证；畸形引用安全回退 |
| Definition owner       | 跨用户/归档命令/固定删除失败关闭，不枚举存在性                                                        |
| Link typed target      | 未注册、tombstone、跨 Space、无权和重复目标拒绝                                                       |
| Link collection        | `linkSetRevision` 初始/递增、reorder 缺失/重复 ID 和并发冲突可复现                                    |
| Import idempotency     | 相同 Key+fingerprint 重放不重复；不同 fingerprint 409；可恢复失败可重试                               |
| Authorization order    | Flag、Session、CSRF、Space/对象授权先于版本/配额/详情                                                 |
| OpenAPI additive       | 旧快照/sync-v1/认证边界无非预期 diff                                                                  |
| Fail-closed            | Feature 关闭、未知 Schema、越权引用和异常响应不产生半写入                                             |

## 12. 审批门与明确不做

本提案通过后仍必须分别批准：

1. Schema/合同：字段、规范化 Hash、typed target registry 和错误 envelope；
2. API/OpenAPI：路径、operationId、状态码、ETag、CSRF、分页和 generated snapshot；
3. 数据库/迁移：Definition、Link、linkSetRevision、import receipt 的 DDL、索引、唯一性和回滚；
4. 配额/威胁模型：速率、大小、导入、XSS、原型污染、URL、侧信道、日志与保留；
5. 前端施工：完整原型、状态矩阵、键盘/axe/四视口和 Feature Flag 验收。

本轮不修改 Web/API/contracts/数据库/迁移/OpenAPI/锁文件，不写入用户设置，不创建真实 Workbench，不执行导入导出，不提交、不推送、不合并、不部署。任何门发现职责混淆、越权引用、未知字段或冲突语义不完整时立即停工。
